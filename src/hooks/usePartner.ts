import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

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
 * `partnerPresenceOnline` is injected from the SINGLE usePresenceChannel
 * call in App.tsx — this eliminates the previous bug where two separate
 * presence channels were fighting each other and destroying online status.
 */
export function usePartner(partnerPresenceOnline?: boolean) {
  const { user } = useAuth();
  const [partner, setPartner] = useState<PartnerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchPartner = async () => {
      // In a 2-person app, the partner is just the other user in the profiles table
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
        console.error('Error fetching partner', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPartner();

    // Listen to partner profile realtime changes (like avatar, display_name, last_seen)
    const subscription = supabase
      .channel(`public:profiles:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `id=neq.${user.id}`,
        },
        (payload) => {
          setPartner(payload.new as PartnerProfile);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [user]);

  // Merge presence-based online state (from the single App-level presence channel)
  // If partnerPresenceOnline is undefined (not yet initialized), fall back to DB value
  const isOnline = partnerPresenceOnline !== undefined ? partnerPresenceOnline : (partner?.is_online ?? false);

  return { 
    partner: partner ? { ...partner, is_online: isOnline } : null, 
    loading 
  };
}
