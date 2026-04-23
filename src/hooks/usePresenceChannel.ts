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
 * Max age (ms) for a presence entry to be considered "alive".
 * Heartbeat fires every 25s → entry refreshed every 25s when partner is active.
 * 45s = heartbeat (25s) + buffer (20s for network/throttling).
 */
const PRESENCE_STALE_MS = 45_000;
/** Heartbeat interval — refreshes our own `online_at` so partner's stale filter sees us as alive. */
const HEARTBEAT_MS = 25_000;
/**
 * Periodic scanner — re-evaluates partner's entries for staleness.
 * Without this, stale entries sit forever if no new SYNC/JOIN/LEAVE fires.
 * This is THE critical safety net for detecting offline when LEAVE doesn't fire.
 */
const STALE_CHECK_MS = 15_000;
/** Delay before auto-reconnect after CLOSED/ERROR. */
const RECONNECT_DELAY_MS = 3_000;
/** Max consecutive reconnect attempts. */
const MAX_RECONNECTS = 5;

/**
 * Presence Channel — WhatsApp Architecture (v5 — Bulletproof)
 * ════════════════════════════════════════════════════════════
 *
 * ARCHITECTURE:
 *   Primary detection:  SYNC/JOIN/LEAVE events from Supabase Presence
 *   Stale entry filter: Entries with `online_at` older than 45s are ignored
 *   Periodic scanner:   Every 15s, re-evaluate entries even if no events fire
 *   Heartbeat:          Every 25s, re-track ourselves to keep our `online_at` fresh
 *   Auto-reconnect:     On CLOSED/ERROR, reconnect after 3s (max 5 retries)
 *   Generation guard:   All callbacks ignore events from old/stale channels
 *
 * WHY PERIODIC SCANNER:
 *   When partner closes their app, the LEAVE event SHOULD fire.
 *   But sometimes it doesn't (network drop, browser killed, phantom entries
 *   from old connections). The stale filter marks old entries as dead, but
 *   it only runs inside SYNC/JOIN/LEAVE handlers. If no events fire,
 *   stale entries persist forever. The periodic scanner fixes this by
 *   re-checking presenceState() every 15s independently of events.
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
  const desiredTrackRef = useRef<{ userId: string; page?: string } | null>(null);
  const channelGenRef = useRef(0);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;

    const channelName = 'aura-presence';
    const gen = ++channelGenRef.current;

    // ── Remove ALL stale channels (not just first) ──
    // Previous bug: `find()` only removed one. If multiple channels existed
    // from HMR/strict mode/effect re-runs, the rest leaked and created
    // phantom presence entries (entries growing: 1→2→3).
    const staleChannels = supabase.getChannels().filter(
      ch => ch.topic === `realtime:${channelName}`
    );
    staleChannels.forEach(ch => supabase.removeChannel(ch));

    const channel = supabase.channel(channelName, {
      config: { presence: { key: user.id } },
    });

    channelRef.current = channel;
    joinStatusRef.current = 'JOINING';

    /**
     * Filters out phantom/stale presence entries.
     * Returns count of entries whose `online_at` is within PRESENCE_STALE_MS.
     */
    const getFreshEntryCount = (entries: any[] | undefined): number => {
      if (!entries || entries.length === 0) return 0;
      const now = Date.now();
      return entries.filter(e => {
        const onlineAt = e.online_at ? new Date(e.online_at).getTime() : 0;
        return (now - onlineAt) < PRESENCE_STALE_MS;
      }).length;
    };

    channel
      .on('presence', { event: 'sync' }, () => {
        if (gen !== channelGenRef.current) return;
        if (!partnerId) return;
        const state = channel.presenceState();
        const entries = state[partnerId] as any[] | undefined;
        const freshCount = getFreshEntryCount(entries);
        const isOnline = freshCount > 0;

        setPartnerPresence(prev => {
          if (prev.hasSynced && prev.isOnline === isOnline) return prev;
          return { isOnline, hasSynced: true };
        });
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        if (gen !== channelGenRef.current) return;

        if (key !== partnerId) return;
        setPartnerPresence(prev => {
          if (prev.isOnline && prev.hasSynced) return prev;
          return { isOnline: true, hasSynced: true };
        });
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (gen !== channelGenRef.current) return;

        if (key !== partnerId) {
          return;
        }

        const state = channel.presenceState();
        const remaining = state[partnerId] as any[] | undefined;
        const freshCount = getFreshEntryCount(remaining);
        const isOnline = freshCount > 0;

        setPartnerPresence(prev => {
          if (prev.isOnline === isOnline && prev.hasSynced) return prev;
          return { isOnline, hasSynced: true };
        });
      })
      .subscribe((status) => {
        if (gen !== channelGenRef.current) return;
        if (status === 'SUBSCRIBED') {
          joinStatusRef.current = 'JOINED';
          reconnectCountRef.current = 0;

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

          if (reconnectCountRef.current < MAX_RECONNECTS) {
            reconnectCountRef.current++;
            reconnectTimerRef.current = setTimeout(() => {
              reconnectTimerRef.current = null;
              setReconnectTrigger(prev => prev + 1);
            }, RECONNECT_DELAY_MS);
          }
        }
      });

    // ── Heartbeat: refresh our own online_at every 25s ──
    const heartbeat = setInterval(() => {
      if (gen !== channelGenRef.current) return;
      const desired = desiredTrackRef.current;
      if (!desired || !channelRef.current || joinStatusRef.current !== 'JOINED') return;
      channelRef.current.track({
        user_id: desired.userId,
        page: desired.page,
        online_at: new Date().toISOString(),
      }).catch(() => {});
    }, HEARTBEAT_MS);

    // ── Periodic stale scanner: re-evaluate partner's entries every 15s ──
    // This is the CRITICAL safety net. Without it, stale entries persist
    // forever if no SYNC/JOIN/LEAVE events fire (e.g., partner's phone
    // killed, WiFi died, phantom entries from old connections).
    const staleCheck = setInterval(() => {
      if (gen !== channelGenRef.current) return;
      if (!partnerId || joinStatusRef.current !== 'JOINED') return;

      const state = channel.presenceState();
      const entries = state[partnerId] as any[] | undefined;
      const freshCount = getFreshEntryCount(entries);
      const isOnline = freshCount > 0;

      setPartnerPresence(prev => {
        if (prev.isOnline === isOnline && prev.hasSynced) return prev;
        if (!prev.hasSynced) return prev; // Don't override initial sync
        return { isOnline, hasSynced: true };
      });
    }, STALE_CHECK_MS);

    return () => {
      channelGenRef.current++; // Invalidate BEFORE removeChannel
      clearInterval(heartbeat);
      clearInterval(staleCheck);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      joinStatusRef.current = 'DISCONNECTED';
    };
  }, [user?.id, partnerId, reconnectTrigger]);

  const trackMyStatus = useCallback(async (userId: string, page?: string) => {
    desiredTrackRef.current = { userId, page };
    if (!channelRef.current || joinStatusRef.current !== 'JOINED') return;
    try {
      await channelRef.current.track({
        user_id: userId, page, online_at: new Date().toISOString(),
      });
    } catch (err) {
      
    }
  }, []);

  const untrackMyStatus = useCallback(async () => {
    desiredTrackRef.current = null;
    if (!channelRef.current || joinStatusRef.current !== 'JOINED') return;
    try {
      await channelRef.current.untrack();
    } catch (err) {
      
    }
  }, []);

  return { partnerPresence, trackMyStatus, untrackMyStatus };
}
