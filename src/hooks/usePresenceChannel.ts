import { useEffect, useState, useRef } from 'react';
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

export function usePresenceChannel(partnerId: string | null, currentPage?: string) {
  const { user, encryptionStatus } = useAuth();
  const [partnerState, setPartnerState] = useState<PartnerState>({ isOnline: false, hasSynced: false });
  const channelRef = useRef<RealtimeChannel | null>(null);
  
  // Track if we've successfully joined so we can safely track/untrack
  const joinStatusRef = useRef<'DISCONNECTED' | 'JOINING' | 'JOINED'>('DISCONNECTED');

  useEffect(() => {
    if (!user) return;

    // 1. Use a stable shared channel name (both users must share the same channel
    //    so their presence keys are visible to each other).
    const channelName = 'aura-presence';

    // Before creating the channel, forcefully remove any stale existing channel
    // with the same name from Supabase's internal registry. Without this,
    // supabase.channel() returns the already-subscribed channel, and adding
    // .on('presence', ...) to it throws "cannot add presence callbacks after joining".
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

    // 2. Subscribe to channel with presence event listeners
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceState>();
        
        // Update our view of the partner if their key exists in the current state
        if (partnerId) {
          const partnerPresence = state[partnerId];
          const isPartnerOnline = !!(partnerPresence && partnerPresence.length > 0);
          setPartnerState({
            isOnline: isPartnerOnline,
            hasSynced: true,
            page: partnerPresence?.[0]?.page,
            // If partner just went offline, stamp the time
            ...(!isPartnerOnline ? { lastOnlineAt: new Date().toISOString() } : {}),
          });
        }
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (key === partnerId) {
          setPartnerState({
            isOnline: true,
            hasSynced: true,
            page: (newPresences[0] as unknown as PresenceState)?.page,
          });
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key === partnerId) {
          setPartnerState((prev) => ({
            ...prev,
            isOnline: false,
            hasSynced: true,
            lastOnlineAt: new Date().toISOString(),
          }));
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          joinStatusRef.current = 'JOINED';
          // Ensure we start off tracked if we're currently unlocked/visible
          if (encryptionStatus === 'ready' && document.visibilityState === 'visible') {
            trackMyStatus(user.id, currentPage);
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          joinStatusRef.current = 'DISCONNECTED';
          if (partnerId) {
             setPartnerState(prev => ({ ...prev, isOnline: false, hasSynced: false }));
          }
        }
      });

    return () => {
      // Cleanup: remove channel completely on unmount
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      channelRef.current = null;
      joinStatusRef.current = 'DISCONNECTED';
    };
  }, [user, partnerId]); // Reacts to user auth changes, and partnerId binding

  /**
   * Pushes our presence config into the channel
   */
  const trackMyStatus = async (userId: string, page?: string) => {
    if (!channelRef.current || joinStatusRef.current !== 'JOINED') {
       return;
    }

    try {
      await channelRef.current.track({
        user_id: userId,
        page: page,
        online_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to track presence', err);
    }
  };

  /**
   * Removes our presence from the channel (without leaving the channel completely)
   */
  const untrackMyStatus = async () => {
    if (!channelRef.current || joinStatusRef.current !== 'JOINED') {
       return;
    }

    try {
      await channelRef.current.untrack();
    } catch (err) {
      console.error('Failed to untrack presence', err);
    }
  };

  return {
    partnerState,
    trackMyStatus,
    untrackMyStatus,
  };
}
