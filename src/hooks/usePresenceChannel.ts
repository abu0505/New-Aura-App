import { useEffect, useState, useRef, useCallback } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface PartnerPresence {
  /** True when partner is tracked in the presence channel. */
  isOnline: boolean;
  /** True after the presence channel has completed its first sync. */
  hasSynced: boolean;
}

/**
 * Presence Channel — WhatsApp Architecture
 * ═════════════════════════════════════════
 * Manages ONE Supabase Realtime Presence channel for the whole app.
 *
 * DESIGN PRINCIPLES:
 *   1. Reports RAW presence state — no debounce here
 *   2. `desiredTrackRef` solves the connection race condition:
 *      if trackMyStatus() is called before WebSocket is JOINED,
 *      the intention is saved and auto-applied on SUBSCRIBED
 *   3. Callbacks use useCallback([]) for stable references —
 *      prevents parent effects from re-firing
 *
 * EGRESS: 0 bytes — presence runs over WebSocket, not REST
 */
export function usePresenceChannel(partnerId: string | null) {
  const { user } = useAuth();
  const [partnerPresence, setPartnerPresence] = useState<PartnerPresence>({
    isOnline: false,
    hasSynced: false,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const joinStatusRef = useRef<'DISCONNECTED' | 'JOINING' | 'JOINED'>('DISCONNECTED');
  /** Stores the INTENTION to be tracked, survives connection phases */
  const desiredTrackRef = useRef<{ userId: string; page?: string } | null>(null);

  useEffect(() => {
    if (!user) return;

    const channelName = 'aura-presence';

    // Clean up any stale channel with the same topic
    const stale = supabase.getChannels().find(ch => ch.topic === `realtime:${channelName}`);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase.channel(channelName, {
      config: { presence: { key: user.id } },
    });

    channelRef.current = channel;
    joinStatusRef.current = 'JOINING';

    channel
      .on('presence', { event: 'sync' }, () => {
        if (!partnerId) return;
        const state = channel.presenceState();
        const entries = state[partnerId];
        const isOnline = !!(entries && entries.length > 0);

        setPartnerPresence(prev => {
          if (prev.hasSynced && prev.isOnline === isOnline) return prev;
          return { isOnline, hasSynced: true };
        });
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        if (key !== partnerId) return;
        setPartnerPresence(prev => {
          if (prev.isOnline && prev.hasSynced) return prev;
          return { isOnline: true, hasSynced: true };
        });
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key !== partnerId) return;
        setPartnerPresence(prev => {
          if (!prev.isOnline && prev.hasSynced) return prev;
          return { isOnline: false, hasSynced: true };
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          joinStatusRef.current = 'JOINED';
          // Apply saved intention — eliminates the race condition
          const desired = desiredTrackRef.current;
          if (desired) {
            channel.track({
              user_id: desired.userId,
              page: desired.page,
              online_at: new Date().toISOString(),
            }).catch(() => {});
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          joinStatusRef.current = 'DISCONNECTED';
          setPartnerPresence({ isOnline: false, hasSynced: false });
        }
      });

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      joinStatusRef.current = 'DISCONNECTED';
    };
  }, [user?.id, partnerId]);

  /** Track self in presence channel. Stable ref — never recreated. */
  const trackMyStatus = useCallback(async (userId: string, page?: string) => {
    desiredTrackRef.current = { userId, page }; // Save intention
    if (!channelRef.current || joinStatusRef.current !== 'JOINED') return;
    try {
      await channelRef.current.track({
        user_id: userId, page, online_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[Presence] Track failed:', err);
    }
  }, []);

  /** Untrack self from presence channel. Stable ref — never recreated. */
  const untrackMyStatus = useCallback(async () => {
    desiredTrackRef.current = null; // Clear intention
    if (!channelRef.current || joinStatusRef.current !== 'JOINED') return;
    try {
      await channelRef.current.untrack();
    } catch (err) {
      console.error('[Presence] Untrack failed:', err);
    }
  }, []);

  return { partnerPresence, trackMyStatus, untrackMyStatus };
}
