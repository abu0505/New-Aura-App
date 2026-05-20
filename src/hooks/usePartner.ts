import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { realtimeHub } from '../lib/realtimeHub';

export interface PartnerProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_key: string | null;
  avatar_nonce: string | null;
  public_key: string | null;
  is_online: boolean;
  last_seen: string | null;
  status_message: string | null;
  key_history: { public_key: string; created_at: string }[] | null;
}

let cachedPartner: PartnerProfile | null = null;
let fetchPromise: Promise<PartnerProfile | null> | null = null;

/**
 * Fetches and subscribes to the partner's profile from the DB.
 * 
 * IMPORTANT: This hook returns RAW DB data. The online status
 * (is_online / last_seen) is only used as a fallback for "Last seen" text.
 * The LIVE online/offline state comes exclusively from the presence channel
 * and is merged in App.tsx's stability filter.
 */
export function usePartner() {
  const { user } = useAuth();
  const [partner, setPartner] = useState<PartnerProfile | null>(cachedPartner);
  const [loading, setLoading] = useState(!cachedPartner);

  useEffect(() => {
    if (!user) {
      // Clear cache on logout so next login gets a fresh fetch
      cachedPartner = null;
      fetchPromise = null;
      setLoading(false);
      return;
    }

    const fetchPartner = async () => {
      // If cached partner has no public_key (e.g. a test/garbage account),
      // invalidate the cache and re-fetch so the real partner is picked up.
      if (cachedPartner && cachedPartner.public_key && cachedPartner.public_key !== '') {
        setPartner(cachedPartner);
        setLoading(false);
        return;
      }
      // Stale or invalid cache — clear it and re-fetch
      cachedPartner = null;
      
      if (!fetchPromise) {
        fetchPromise = (async () => {
          try {
            // First: try to find a partner who has already set up encryption (has a public_key)
            // This prevents test/garbage accounts from being picked up as the partner.
            const { data: keyedData } = await supabase
              .from('profiles')
              .select('id,display_name,avatar_url,avatar_key,avatar_nonce,public_key,is_online,last_seen,status_message,key_history')
              .neq('id', user.id)
              .neq('public_key', '')
              .not('public_key', 'is', null)
              .order('created_at', { ascending: true })
              .limit(1)
              .maybeSingle();

            if (keyedData) {
              cachedPartner = keyedData as PartnerProfile;
              return cachedPartner;
            }

            // Fallback: pick any other profile (partner hasn't set up encryption yet)
            const { data, error } = await supabase
              .from('profiles')
              .select('id,display_name,avatar_url,avatar_key,avatar_nonce,public_key,is_online,last_seen,status_message,key_history')
              .neq('id', user.id)
              .order('created_at', { ascending: true })
              .limit(1)
              .maybeSingle();
              
            if (!error && data) {
              cachedPartner = data as PartnerProfile;
              return cachedPartner;
            }
            return null;
          } finally {
            fetchPromise = null;
          }
        })();
      }

      const data = await fetchPromise;
      if (data) setPartner(data);
      setLoading(false);
    };


    fetchPartner();

    // ═══ Use RealtimeHub instead of creating a separate channel ═══
    // The hub already filters profiles to partner only
    const unsubscribe = realtimeHub.on('profiles', (payload) => {
      if (payload.eventType !== 'DELETE') {
        const newProfile = payload.new as PartnerProfile;
        // Only update if it's not our own profile
        if (newProfile.id !== user.id) {
          cachedPartner = newProfile;
          setPartner(newProfile);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [user?.id]);

  return { partner, loading };
}

