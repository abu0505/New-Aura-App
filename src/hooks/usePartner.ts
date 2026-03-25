import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface PartnerProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  public_key: string | null;
  is_online: boolean;
  last_seen: string | null;
  status_message: string | null;
}

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
      // In a 2-person app, the partner is just the other user in the profiles table
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
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
      .channel('public:profiles')
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

  return { partner, loading };
}
