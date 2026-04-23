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
  const [partner, setPartner] = useState<PartnerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchPartner = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id,display_name,avatar_url,avatar_key,avatar_nonce,public_key,is_online,last_seen,status_message,key_history')
          .neq('id', user.id)
          .limit(1)
          .single();

        if (!error && data) {
          setPartner(data as PartnerProfile);
        }
      } catch (err) {
        
      } finally {
        setLoading(false);
      }
    };

    fetchPartner();

    // ═══ Use RealtimeHub instead of creating a separate channel ═══
    // The hub already filters profiles to partner only
    const unsubscribe = realtimeHub.on('profiles', (payload) => {
      if (payload.eventType !== 'DELETE') {
        const newProfile = payload.new as PartnerProfile;
        // Only update if it's not our own profile
        if (newProfile.id !== user.id) {
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

