import { useEffect, useState, useRef, useCallback } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface PresenceState {
  user_id: string;
  page?: string;
  online_at: string;
}

interface PartnerState {
  isOnline: boolean;
  /** True once the presence channel has completed its first sync.
   *  Before this, the DB `is_online` field is used as a fallback. */
  hasSynced: boolean;
  /** ISO timestamp of when we last detected the partner going offline
   *  via presence. Used as a reliable "last seen" that doesn't depend
   *  on the offline beacon reaching the DB. */
  lastOnlineAt?: string;
  page?: string;
}

/**
 * WhatsApp-style Presence Channel
 * ════════════════════════════════
 * 
 * CRITICAL: `trackMyStatus` and `untrackMyStatus` must have STABLE references.
 * They are dependencies of `useOnlineStatus` effects. If they change identity
 * on every render, the effect cleanup calls `untrackMyStatus()` → the partner
 * sees a `leave` event → then the effect re-runs and calls `trackMyStatus()`
 * → partner sees a `join` event → infinite Online/Offline flicker every 1-2s.
 *
 * Solution: Both functions are wrapped in `useCallback(fn, [])` with zero deps
 * because they only use refs (channelRef, joinStatusRef) which are stable.
 */
export function usePresenceChannel(partnerId: string | null, currentPage?: string) {
  const { user, encryptionStatus } = useAuth();
  const [partnerState, setPartnerState] = useState<PartnerState>({ isOnline: false, hasSynced: false });
  const channelRef = useRef<RealtimeChannel | null>(null);
  
  // Track if we've successfully joined so we can safely track/untrack
  const joinStatusRef = useRef<'DISCONNECTED' | 'JOINING' | 'JOINED'>('DISCONNECTED');

  useEffect(() => {
    if (!user) return;

    const channelName = 'aura-presence';

    // Remove any stale channel before creating a new one
    const allChannels = supabase.getChannels();
    const stale = allChannels.find(ch => ch.topic === `realtime:${channelName}`);
    if (stale) {
      supabase.removeChannel(stale);
    }

    const channel = supabase.channel(channelName, {
      config: {
        presence: {
          key: user.id,
        },
      },
    });

    channelRef.current = channel;
    joinStatusRef.current = 'JOINING';

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceState>();
        
        if (partnerId) {
          const partnerPresence = state[partnerId];
          const isPartnerOnline = !!(partnerPresence && partnerPresence.length > 0);
          const newPage = partnerPresence?.[0]?.page;

          // ═══ Smart update: only trigger re-render if values ACTUALLY changed ═══
          // Without this guard, every sync event (including from OUR OWN track calls)
          // creates a new state object → re-render → new function refs → flicker loop.
          setPartnerState(prev => {
            if (prev.hasSynced && prev.isOnline === isPartnerOnline && prev.page === newPage) {
              return prev; // Exact same reference → React skips re-render
            }
            return {
              isOnline: isPartnerOnline,
              hasSynced: true,
              page: newPage,
              // Preserve lastOnlineAt if partner is still online, stamp it if going offline
              lastOnlineAt: !isPartnerOnline
                ? (prev.isOnline ? new Date().toISOString() : prev.lastOnlineAt)
                : prev.lastOnlineAt,
            };
          });
        }
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (key === partnerId) {
          setPartnerState(prev => {
            if (prev.isOnline && prev.hasSynced) return prev; // Already online, skip
            return {
              isOnline: true,
              hasSynced: true,
              page: (newPresences[0] as unknown as PresenceState)?.page,
              lastOnlineAt: prev.lastOnlineAt,
            };
          });
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key === partnerId) {
          setPartnerState(prev => {
            if (!prev.isOnline && prev.hasSynced) return prev; // Already offline, skip
            return {
              ...prev,
              isOnline: false,
              hasSynced: true,
              lastOnlineAt: new Date().toISOString(),
            };
          });
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          joinStatusRef.current = 'JOINED';
          // Ensure we start off tracked if we're currently unlocked/visible
          if (encryptionStatus === 'ready' && document.visibilityState === 'visible') {
            channelRef.current?.track({
              user_id: user.id,
              page: currentPage,
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
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      channelRef.current = null;
      joinStatusRef.current = 'DISCONNECTED';
    };
  }, [user, partnerId]); // Only re-runs on auth/partner change

  /**
   * Pushes our presence into the channel.
   * ═══ STABLE REFERENCE via useCallback ═══
   * Only uses refs (channelRef, joinStatusRef) — zero reactive deps.
   */
  const trackMyStatus = useCallback(async (userId: string, page?: string) => {
    if (!channelRef.current || joinStatusRef.current !== 'JOINED') return;

    try {
      await channelRef.current.track({
        user_id: userId,
        page: page,
        online_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to track presence', err);
    }
  }, []);

  /**
   * Removes our presence from the channel (without leaving the channel).
   * ═══ STABLE REFERENCE via useCallback ═══
   */
  const untrackMyStatus = useCallback(async () => {
    if (!channelRef.current || joinStatusRef.current !== 'JOINED') return;

    try {
      await channelRef.current.untrack();
    } catch (err) {
      console.error('Failed to untrack presence', err);
    }
  }, []);

  return {
    partnerState,
    trackMyStatus,
    untrackMyStatus,
  };
}
