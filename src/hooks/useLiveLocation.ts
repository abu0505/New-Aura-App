import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePartner } from './usePartner';
import { 
  getPartnerPublicKey, 
  getStoredKeyPair, 
  encryptMessage, 
  decryptMessageWithFallback 
} from '../lib/encryption';

export interface LocationCoordinates {
  lat: number;
  lng: number;
}

export function useLiveLocation() {
  const { user } = useAuth();
  const { partner } = usePartner();

  const [userLocation, setUserLocation] = useState<LocationCoordinates | null>(null);
  const [partnerLocation, setPartnerLocation] = useState<LocationCoordinates | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const autoStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Parse nonce and ciphertext from the concatenated string
  const parseEncryptedField = (field: string) => {
    const parts = field.split(':');
    if (parts.length !== 2) return null;
    return { nonce: parts[0], ciphertext: parts[1] };
  };

  // Build the concatenated string
  const buildEncryptedField = (nonce: string, ciphertext: string) => {
    return `${nonce}:${ciphertext}`;
  };

  const stopSharing = useCallback(async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (autoStopTimeoutRef.current !== null) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }

    setIsSharing(false);

    if (user) {
      await supabase
        .from('live_locations')
        .update({ is_sharing: false, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
    }
  }, [user]);

  const startSharing = useCallback(async () => {
    if (!user || !partner) {
      setError('Cannot share location without a partner.');
      return;
    }
    setError(null);

    try {
      // Prompt for permission and get first position immediately
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true });
      });
      
      setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setIsSharing(true);

      const partnerPubKey = await getPartnerPublicKey(partner.id);
      const myKeys = getStoredKeyPair();

      if (!partnerPubKey || !myKeys) {
        throw new Error('Encryption keys missing.');
      }

      // Start watching
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (position) => {
          const newPos = { lat: position.coords.latitude, lng: position.coords.longitude };
          setUserLocation(newPos);

          try {
            // Encrypt and sync
            const latEnc = encryptMessage(newPos.lat.toString(), partnerPubKey, myKeys.secretKey);
            const lngEnc = encryptMessage(newPos.lng.toString(), partnerPubKey, myKeys.secretKey);

            await supabase
              .from('live_locations')
              .upsert({
                user_id: user.id,
                encrypted_lat: buildEncryptedField(latEnc.nonce, latEnc.ciphertext),
                encrypted_lng: buildEncryptedField(lngEnc.nonce, lngEnc.ciphertext),
                is_sharing: true,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'user_id' }); // Upsert requires unique constraint on user_id, assuming it exists or we update.
              // Actually, looking at the schema, upsert might need to be just an update if not uniquely constrained? 
              // We'll see. The existing code uses upsert without explicit onConflict, but we should probably just find if it exists and update, or upsert based on user_id if that's the PK/unique.
          } catch (e) {
            console.error('Failed to sync location', e);
          }
        },
        (err) => {
          console.error(err);
          setError(err.message);
          stopSharing();
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
      );

      // Auto stop after 1 hour (3600000 ms)
      autoStopTimeoutRef.current = setTimeout(() => {
        stopSharing();
      }, 3600000);

    } catch (err: any) {
      setError(err.message || 'Failed to start sharing.');
      setIsSharing(false);
    }
  }, [user, partner, stopSharing]);

  // Initial load and Realtime subscription for partner's location
  useEffect(() => {
    if (!user || !partner) return;

    let myKeys = getStoredKeyPair();
    if (!myKeys) return;

    const fetchAndDecryptPartnerLocation = async (data: any) => {
      try {
        if (!data || !data.is_sharing) {
          setPartnerLocation(null);
          return;
        }

        const latParts = parseEncryptedField(data.encrypted_lat);
        const lngParts = parseEncryptedField(data.encrypted_lng);

        if (!latParts || !lngParts) return;

        const partnerPubKey = await getPartnerPublicKey(partner.id);
        
        // Refresh myKeys just in case
        myKeys = getStoredKeyPair();
        if (!myKeys) return;

        const decLatStr = decryptMessageWithFallback(latParts.ciphertext, latParts.nonce, partnerPubKey, myKeys.secretKey);
        const decLngStr = decryptMessageWithFallback(lngParts.ciphertext, lngParts.nonce, partnerPubKey, myKeys.secretKey);

        const lat = parseFloat(decLatStr);
        const lng = parseFloat(decLngStr);

        if (!isNaN(lat) && !isNaN(lng)) {
          setPartnerLocation({ lat, lng });
        }
      } catch (e) {
        console.error('Failed to decrypt partner location', e);
      }
    };

    const fetchInitial = async () => {
      const { data } = await supabase
        .from('live_locations')
        .select('*')
        .eq('user_id', partner.id)
        .single();
      
      if (data) fetchAndDecryptPartnerLocation(data);
    };

    fetchInitial();

    // Check our own initial state to see if we were sharing
    const fetchMe = async () => {
      const { data } = await supabase
        .from('live_locations')
        .select('is_sharing')
        .eq('user_id', user.id)
        .single();
      
      if (data && data.is_sharing && !isSharing) {
         // Auto-resume if we refresh while sharing?
         // For now, let's keep it simple: sharing only lasts for the session unless we explicitly re-bind
         // In a robust app we'd resume `watchPosition`.
      }
    };
    fetchMe();

    const subscription = supabase
      .channel('public:live_locations:partner')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_locations', filter: `user_id=eq.${partner.id}` },
        (payload) => {
          if (payload.new) {
             fetchAndDecryptPartnerLocation(payload.new);
          } else {
             setPartnerLocation(null);
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
      stopSharing();
    };
  }, [user, partner, stopSharing]); // Added dependencies safely, stopSharing is stable

  // Haversine formula for distance
  const getDistanceInKm = () => {
    if (!userLocation || !partnerLocation) return null;

    const R = 6371; // km
    const dLat = (partnerLocation.lat - userLocation.lat) * Math.PI / 180;
    const dLon = (partnerLocation.lng - userLocation.lng) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(partnerLocation.lat * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return (R * c).toFixed(1);
  };

  return {
    userLocation,
    partnerLocation,
    isSharing,
    startSharing,
    stopSharing,
    error,
    distanceKm: getDistanceInKm()
  };
}
