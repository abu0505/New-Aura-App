import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/**
 * Online Status Manager — WhatsApp Architecture
 * ═══════════════════════════════════════════════
 * Orchestrates WHEN to track/untrack presence and update the DB.
 *
 * LIFECYCLE:
 * ┌──────────────────┬───────────────────────────────────────────┐
 * │ PIN unlocked     │ Track presence + DB is_online = true      │
 * │ Tab visible      │ Track presence + DB is_online = true      │
 * │ Tab hidden       │ Untrack presence → beacon after 1s        │
 * │ Tab close        │ Offline beacon (keepalive fetch)          │
 * │ Page unload      │ Offline beacon (keepalive fetch)          │
 * │ Signout / lock   │ Untrack presence + DB is_online = false   │
 * └──────────────────┴───────────────────────────────────────────┘
 *
 * DB WRITES:
 *   Going ONLINE  → { is_online: true }                (no last_seen stamp)
 *   Going OFFLINE → { is_online: false, last_seen: now }
 *
 * EGRESS: 1 small PATCH per transition (~150 bytes). Presence uses WS.
 */
export function useOnlineStatus(
  trackMyStatus: (userId: string, page?: string) => Promise<void>,
  untrackMyStatus: () => Promise<void>,
  currentPage?: string,
) {
  const { user, encryptionStatus } = useAuth();

  // Refs for event listener access (avoids stale closures)
  const userIdRef = useRef<string | null>(null);
  const isUnlockedRef = useRef(false);
  const currentPageRef = useRef<string | undefined>(undefined);
  const jwtTokenRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs fresh
  useEffect(() => { userIdRef.current = user?.id ?? null; }, [user?.id]);
  useEffect(() => { isUnlockedRef.current = encryptionStatus === 'ready'; }, [encryptionStatus]);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

  // ── Keep JWT fresh for offline beacon ─────────────────────────────────
  useEffect(() => {
    const update = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        jwtTokenRef.current = data.session?.access_token ?? null;
      } catch { jwtTokenRef.current = null; }
    };
    update();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, session) => {
      jwtTokenRef.current = session?.access_token ?? null;
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── DB update (async, for when React is running) ──────────────────────
  const setDbStatus = async (userId: string, online: boolean) => {
    try {
      const update: Record<string, unknown> = {
        is_online: online,
        last_seen: new Date().toISOString()
      };
      await supabase.from('profiles').update(update).eq('id', userId);
    } catch (err) {
      
    }
  };

  // ── Offline beacon (fire-and-forget, survives tab close) ──────────────
  const fireOfflineBeacon = (uid: string) => {
    const jwt = jwtTokenRef.current;
    if (!jwt) return;

    const url = `${(supabase as any).supabaseUrl}/rest/v1/profiles?id=eq.${uid}`;
    const apiKey = (supabase as any).supabaseKey;

    try {
      fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': apiKey,
          'Authorization': `Bearer ${jwt}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          is_online: false,
          last_seen: new Date().toISOString(),
        }),
        keepalive: true,
      });
    } catch { /* best-effort */ }
  };

  // ── Event listeners (mount once, use refs for fresh values) ───────────
  useEffect(() => {
    // Desktop tab/window close
    const handleBeforeUnload = () => {
      const uid = userIdRef.current;
      if (uid) fireOfflineBeacon(uid);
    };

    // Mobile bfcache / true unload
    const handlePageHide = () => {
      const uid = userIdRef.current;
      if (uid) fireOfflineBeacon(uid);
    };

    // Tab visibility (phone lock, app switch, tab switch)
    let visTimer: ReturnType<typeof setTimeout>;
    const handleVisibility = () => {
      const uid = userIdRef.current;
      if (!uid) return;
      clearTimeout(visTimer);

      if (document.visibilityState === 'hidden') {
        // Immediately untrack from presence (instant for partner)
        untrackMyStatus();
        // Fire DB beacon after 1s (allows quick tab-switch without DB write)
        visTimer = setTimeout(() => fireOfflineBeacon(uid), 1000);
      } else if (document.visibilityState === 'visible') {
        // Re-track after a short settle to avoid thrashing
        visTimer = setTimeout(() => {
          if (isUnlockedRef.current && userIdRef.current) {
            trackMyStatus(userIdRef.current, currentPageRef.current);
            setDbStatus(userIdRef.current, true);
          }
        }, 500);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibility);

    let appStateListener: any = null;
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        const uid = userIdRef.current;
        if (!uid) return;
        clearTimeout(visTimer);

        if (!isActive) {
          untrackMyStatus();
          visTimer = setTimeout(() => fireOfflineBeacon(uid), 1000);
        } else {
          visTimer = setTimeout(() => {
            if (isUnlockedRef.current && userIdRef.current) {
              trackMyStatus(userIdRef.current, currentPageRef.current);
              setDbStatus(userIdRef.current, true);
            }
          }, 500);
        }
      }).then(listener => {
        appStateListener = listener;
      });
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (appStateListener) appStateListener.remove();
      clearTimeout(visTimer);
      untrackMyStatus();
    };
  }, [trackMyStatus, untrackMyStatus]);

  useEffect(() => {
    if (!user) return;
    const isUnlocked = encryptionStatus === 'ready';

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (isUnlocked) {
        trackMyStatus(user.id, currentPage);
        setDbStatus(user.id, true);
      } else {
        untrackMyStatus();
        setDbStatus(user.id, false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [user?.id, encryptionStatus, currentPage, trackMyStatus, untrackMyStatus]);

  // ── Heartbeat (Periodic last_seen updates for Edge Function) ────────────
  useEffect(() => {
    if (!user || encryptionStatus !== 'ready') return;
    
    // Ping every 15 seconds while the app is active to update last_seen.
    // This allows the push notification Edge Function to correctly detect "zombie" online states.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', user.id).then();
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [user?.id, encryptionStatus]);
}
