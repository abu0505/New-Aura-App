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

/** Max age (ms) for a presence entry to be considered "alive". */
const PRESENCE_STALE_MS = 60_000; // 60 seconds
/** Heartbeat interval (ms) — refreshes online_at to stay "fresh". */
const HEARTBEAT_MS = 25_000;
/** Delay before attempting reconnect after CLOSED/ERROR. */
const RECONNECT_DELAY_MS = 3_000;
/** Max consecutive reconnect attempts before giving up. */
const MAX_RECONNECTS = 5;

/**
 * Presence Channel — WhatsApp Architecture (v4 — Production-hardened)
 * ═══════════════════════════════════════════════════════════════════
 *
 * BUGS FIXED:
 *   1. Stale CLOSED callbacks — gen counter incremented in cleanup BEFORE
 *      removeChannel(), so synchronous CLOSED from old channels is ignored.
 *
 *   2. Phantom/stuck entries — presence entries with online_at older than
 *      60s are filtered out. Combined with 25s heartbeat, only genuinely
 *      active sessions count as "online".
 *
 *   3. Auto-reconnect — when the ACTIVE channel gets CLOSED/CHANNEL_ERROR
 *      (WebSocket drop, server restart), we auto-reconnect after 3s.
 *      Max 5 retries, counter resets on successful SUBSCRIBED.
 *      Without this, a single WebSocket drop caused permanent "Last seen".
 *
 *   4. Heartbeat (25s) — re-tracks to survive silent drops + keeps
 *      online_at fresh for the partner's stale-entry filter.
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
  /** Generation counter — prevents stale callbacks from old channels */
  const channelGenRef = useRef(0);
  /** Triggers useEffect re-run to reconnect after CLOSED/ERROR */
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  /** Tracks consecutive reconnect attempts */
  const reconnectCountRef = useRef(0);
  /** Timer for delayed reconnect */
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;

    const channelName = 'aura-presence';
    const gen = ++channelGenRef.current;

    // Clean up any stale channel with the same topic (e.g. from HMR)
    const stale = supabase.getChannels().find(ch => ch.topic === `realtime:${channelName}`);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase.channel(channelName, {
      config: { presence: { key: user.id } },
    });

    channelRef.current = channel;
    joinStatusRef.current = 'JOINING';

    /**
     * Filters out phantom/stale presence entries.
     * An entry is "alive" if its `online_at` is within the last 60 seconds.
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

        // ── DIAGNOSTIC LOG ──
        console.log(`%c[PRESENCE:SYNC] ${new Date().toLocaleTimeString()}`, 'color: #00bcd4; font-weight: bold', {
          gen,
          partnerOnline: isOnline,
          totalEntries: entries?.length ?? 0,
          freshEntries: freshCount,
          allUsersInChannel: Object.keys(state),
        });

        setPartnerPresence(prev => {
          if (prev.hasSynced && prev.isOnline === isOnline) return prev;
          return { isOnline, hasSynced: true };
        });
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (gen !== channelGenRef.current) return;

        console.log(`%c[PRESENCE:JOIN] ${new Date().toLocaleTimeString()}`, 'color: #4caf50; font-weight: bold', {
          gen, joinedKey: key, isPartner: key === partnerId, newPresences,
        });

        if (key !== partnerId) return;
        setPartnerPresence(prev => {
          if (prev.isOnline && prev.hasSynced) return prev;
          return { isOnline: true, hasSynced: true };
        });
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        if (gen !== channelGenRef.current) return;

        if (key !== partnerId) {
          console.log(`%c[PRESENCE:LEAVE] ${new Date().toLocaleTimeString()}`, 'color: #f44336; font-weight: bold', {
            gen, leftKey: key, isPartner: false, leftPresences,
          });
          return;
        }

        // Partner left — check remaining entries for freshness
        const state = channel.presenceState();
        const remaining = state[partnerId] as any[] | undefined;
        const freshCount = getFreshEntryCount(remaining);
        const isOnline = freshCount > 0;

        console.log(`%c[PRESENCE:LEAVE] ${new Date().toLocaleTimeString()}`, 'color: #f44336; font-weight: bold', {
          gen, leftKey: key, isPartner: true, leftPresences,
          remainingTotal: remaining?.length ?? 0,
          remainingFresh: freshCount,
          resultIsOnline: isOnline,
        });

        setPartnerPresence(prev => {
          if (prev.isOnline === isOnline && prev.hasSynced) return prev;
          return { isOnline, hasSynced: true };
        });
      })
      .subscribe((status) => {
        if (gen !== channelGenRef.current) return;

        console.log(`%c[PRESENCE:CHANNEL_STATUS] ${new Date().toLocaleTimeString()}`, 'color: #ff9800; font-weight: bold', { gen, status });

        if (status === 'SUBSCRIBED') {
          joinStatusRef.current = 'JOINED';
          reconnectCountRef.current = 0; // Reset reconnect counter on success

          const desired = desiredTrackRef.current;
          if (desired) {
            console.log(`[PRESENCE] Gen ${gen}: Re-tracking after SUBSCRIBED`);
            channel.track({
              user_id: desired.userId,
              page: desired.page,
              online_at: new Date().toISOString(),
            }).catch(() => {});
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          joinStatusRef.current = 'DISCONNECTED';
          setPartnerPresence({ isOnline: false, hasSynced: false });

          // ── Auto-reconnect ──
          if (reconnectCountRef.current < MAX_RECONNECTS) {
            reconnectCountRef.current++;
            console.log(`%c[PRESENCE] Gen ${gen}: ${status} — reconnecting in ${RECONNECT_DELAY_MS / 1000}s (attempt ${reconnectCountRef.current}/${MAX_RECONNECTS})`, 'color: #ff9800; font-weight: bold');
            reconnectTimerRef.current = setTimeout(() => {
              reconnectTimerRef.current = null;
              setReconnectTrigger(prev => prev + 1);
            }, RECONNECT_DELAY_MS);
          } else {
            console.log(`%c[PRESENCE] Gen ${gen}: ${status} — max reconnects (${MAX_RECONNECTS}) reached, giving up`, 'color: #f44336; font-weight: bold');
          }
        }
      });

    // ── Heartbeat: re-track every 25s ──
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

    return () => {
      // Increment gen BEFORE removeChannel — prevents synchronous CLOSED
      // callback from passing the stale guard
      channelGenRef.current++;
      clearInterval(heartbeat);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      joinStatusRef.current = 'DISCONNECTED';
    };
  }, [user?.id, partnerId, reconnectTrigger]);

  /** Track self in presence channel. Stable ref — never recreated. */
  const trackMyStatus = useCallback(async (userId: string, page?: string) => {
    desiredTrackRef.current = { userId, page };
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
    desiredTrackRef.current = null;
    if (!channelRef.current || joinStatusRef.current !== 'JOINED') return;
    try {
      await channelRef.current.untrack();
    } catch (err) {
      console.error('[Presence] Untrack failed:', err);
    }
  }, []);

  return { partnerPresence, trackMyStatus, untrackMyStatus };
}
