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

export function usePartner() {
  const { user } = useAuth();
  const [partner, setPartner] = useState<PartnerProfile | null>(null);
  const [isActuallyOnline, setIsActuallyOnline] = useState(false);
  const [loading, setLoading] = useState(true);

  // Calculate "actually online" status based on is_online boolean AND last_seen timestamp
  useEffect(() => {
    const checkStaleness = () => {
      if (!partner) {
        setIsActuallyOnline(false);
        return;
      }
      
      if (!partner.is_online) {
        setIsActuallyOnline(false);
        return;
      }

      const lastSeenTime = partner.last_seen ? new Date(partner.last_seen).getTime() : 0;
      const now = Date.now();
      
      // Heartbeat is every 20s. If we haven't seen a heartbeat in 45s, 
      // the user is effectively offline (app crashed, forced closed, or network lost).
      const isStale = (now - lastSeenTime) > 45000;
      setIsActuallyOnline(!isStale);
    };

    checkStaleness();
    const interval = setInterval(checkStaleness, 15000); // Re-check every 15s
    return () => clearInterval(interval);
  }, [partner]);

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
    partner: partner ? { ...partner, is_online: isActuallyOnline } : null, 
    loading 
  };
}
