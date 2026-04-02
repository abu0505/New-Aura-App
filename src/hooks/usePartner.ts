import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePresenceChannel } from './usePresenceChannel';

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

export function usePartner() {
  const { user } = useAuth();
  const [partner, setPartner] = useState<PartnerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Consume Presence state for the partner
  const { partnerState } = usePresenceChannel(partner?.id || null);


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

    // Listen to partner profile realtime changes (like online status)
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

  return { 
    partner: partner ? { ...partner, is_online: partnerState.isOnline } : null, 
    loading 
  };
}
