import { useEffect, useState, useRef, useCallback } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface PresenceState {
  user_id: string;
  page?: string;
  online_at: string;
}

export interface PartnerState {
  isOnline: boolean;
  /** True once the presence channel has completed its first sync. */
  hasSynced: boolean;
  page?: string;
}

/**
 * Raw Presence Channel
 * ════════════════════
 * Reports presence events AS-IS with identity-check guards
 * to prevent unnecessary re-renders. NO debounce logic here.
 *
 * The stability filter (debounced offline) lives in App.tsx,
 * keeping this hook simple and predictable.
 *
 * CRITICAL: trackMyStatus / untrackMyStatus use useCallback([])
 * for stable references — prevents useOnlineStatus effect re-fires.
 */
export function usePresenceChannel(partnerId: string | null) {
  const { user } = useAuth();
  const [partnerState, setPartnerState] = useState<PartnerState>({ isOnline: false, hasSynced: false });
  const channelRef = useRef<RealtimeChannel | null>(null);
  const joinStatusRef = useRef<'DISCONNECTED' | 'JOINING' | 'JOINED'>('DISCONNECTED');
  // Store the user's intended tracking state to handle connection race conditions
  const desiredTrackStateRef = useRef<{ userId: string; page?: string } | null>(null);

  useEffect(() => {
    if (!user) return;

    const channelName = 'aura-presence';

    // Remove any stale channel
    const allChannels = supabase.getChannels();
    const stale = allChannels.find(ch => ch.topic === `realtime:${channelName}`);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase.channel(channelName, {
      config: { presence: { key: user.id } },
    });

    channelRef.current = channel;
    joinStatusRef.current = 'JOINING';

    channel
      .on('presence', { event: 'sync' }, () => {
        if (!partnerId) return;
        const state = channel.presenceState<PresenceState>();
        const partnerPresence = state[partnerId];
        const isOnline = !!(partnerPresence && partnerPresence.length > 0);
        const page = partnerPresence?.[0]?.page;

        // Identity guard: only update if values actually changed
        setPartnerState(prev => {
          if (prev.hasSynced && prev.isOnline === isOnline && prev.page === page) {
            return prev; // Same reference → React skips re-render
          }
          return { isOnline, hasSynced: true, page };
        });
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (key !== partnerId) return;
        const page = (newPresences[0] as unknown as PresenceState)?.page;
        setPartnerState(prev => {
          if (prev.isOnline && prev.hasSynced) return prev;
          return { isOnline: true, hasSynced: true, page };
        });
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key !== partnerId) return;
        setPartnerState(prev => {
          if (!prev.isOnline && prev.hasSynced) return prev;
          return { ...prev, isOnline: false, hasSynced: true };
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          joinStatusRef.current = 'JOINED';
          // Immediately apply the desired tracking state! No stale closures!
          const desired = desiredTrackStateRef.current;
          if (desired) {
            channelRef.current?.track({
              user_id: desired.userId,
              page: desired.page,
              online_at: new Date().toISOString(),
            }).catch(() => {});
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          joinStatusRef.current = 'DISCONNECTED';
          if (partnerId) {
            setPartnerState(prev => ({ ...prev, isOnline: false, hasSynced: false }));
          }
        }
      });

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      joinStatusRef.current = 'DISCONNECTED';
    };
  }, [user?.id, partnerId]);

  /** STABLE reference — only uses refs */
  const trackMyStatus = useCallback(async (userId: string, page?: string) => {
    desiredTrackStateRef.current = { userId, page }; // Save intention
    if (!channelRef.current || joinStatusRef.current !== 'JOINED') return;
    try {
      await channelRef.current.track({
        user_id: userId, page, online_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to track presence', err);
    }
  }, []);

  /** STABLE reference — only uses refs */
  const untrackMyStatus = useCallback(async () => {
    desiredTrackStateRef.current = null; // Clear intention
    if (!channelRef.current || joinStatusRef.current !== 'JOINED') return;
    try {
      await channelRef.current.untrack();
    } catch (err) {
      console.error('Failed to untrack presence', err);
    }
  }, []);

  return { partnerState, trackMyStatus, untrackMyStatus };
}
