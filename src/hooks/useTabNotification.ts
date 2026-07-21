import { useEffect, useRef, useCallback } from 'react';
import { useChatSettingsContext } from '../contexts/ChatSettingsContext';
import { usePlatform } from './usePlatform';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { realtimeHub } from '../lib/realtimeHub';

const BASE_TITLE = 'AURA';
// How often to re-fetch the unread count from DB while the tab is hidden.
// Browsers throttle/suspend WebSocket events in background tabs, so we poll
// as a reliable fallback so the badge is always correct.
const BG_POLL_INTERVAL_MS = 15_000;

export function useTabNotification(): void {
  const { settings } = useChatSettingsContext();
  const { isNative } = usePlatform();
  const { user } = useAuth();
  const countRef = useRef(0);
  const enabledRef = useRef(false);

  useEffect(() => {
    enabledRef.current = !!settings?.tab_badge_enabled;
  }, [settings?.tab_badge_enabled]);

  // Update title based on local count
  const updateTitle = useCallback(() => {
    if (!enabledRef.current || countRef.current === 0) {
      document.title = BASE_TITLE;
    } else {
      const badge = countRef.current > 9 ? '9+' : String(countRef.current);
      document.title = `(${badge}) ${BASE_TITLE}`;
    }
  }, []);

  // ── Mount: initial fetch + realtime subscription ───────────────────
  useEffect(() => {
    if (!user?.id || isNative) return;

    // Fetch exact count from DB — used on mount, tab focus, and background poll
    const fetchCount = async () => {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('receiver_id', user.id)
        .eq('is_read', false);

      countRef.current = count ?? 0;
      updateTitle();
    };

    fetchCount();

    // ── Realtime: increment/decrement locally on WS events ─────────────────
    // This is the primary update path when the tab is active and WS is alive.
    const unsubscribe = realtimeHub.on('messages', (payload) => {
      const row = payload.new as any;
      const oldRow = payload.old as any;

      if (payload.eventType === 'INSERT') {
        if (row.receiver_id === user.id && !row.is_read) {
          countRef.current += 1;
          updateTitle();
        }
      } else if (payload.eventType === 'UPDATE') {
        // If it was marked as read
        if (row.receiver_id === user.id && row.is_read && oldRow && !oldRow.is_read) {
          countRef.current = Math.max(0, countRef.current - 1);
          updateTitle();
        }
      } else if (payload.eventType === 'DELETE') {
        if (oldRow?.receiver_id === user.id && !oldRow.is_read) {
          countRef.current = Math.max(0, countRef.current - 1);
          updateTitle();
        }
      }
    });

    // ── Background polling fallback ─────────────────────────────────────────
    // Browsers (Chrome, Edge, Firefox) aggressively throttle WebSocket delivery
    // in hidden/background tabs — timers fire slowly and WS frames may be
    // buffered until the tab becomes active again. This means the tab badge can
    // stay stale for a long time while the user is doing other work.
    //
    // Solution: poll Supabase directly every 15 s while the tab is hidden.
    // The DB query is tiny (COUNT, head-only) so egress cost is negligible.
    // When the tab is visible the realtime WS handles updates instantly; the
    // poll does NOT run, so there is zero overhead on the active tab.
    let bgPollTimer: ReturnType<typeof setInterval> | null = null;

    const startBgPoll = () => {
      if (bgPollTimer) return;
      bgPollTimer = setInterval(() => {
        if (document.visibilityState === 'hidden') {
          fetchCount();
        }
      }, BG_POLL_INTERVAL_MS);
    };

    const stopBgPoll = () => {
      if (bgPollTimer) {
        clearInterval(bgPollTimer);
        bgPollTimer = null;
      }
    };

    // Start the background poll right away — the interval only fires when hidden
    startBgPoll();

    // ── Visibility change: re-fetch on focus + manage poll lifecycle ────────
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Tab became active — do an immediate re-fetch to catch anything missed
        // while the tab was hidden, then stop the background poll (WS takes over)
        fetchCount();
        stopBgPoll();
      } else {
        // Tab became hidden — start background polling so the badge stays fresh
        startBgPoll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      unsubscribe();
      stopBgPoll();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user?.id, isNative, updateTitle]);

  // ── Re-apply title when the setting is toggled ─────────────────────
  useEffect(() => {
    if (isNative) return;
    updateTitle();
  }, [settings?.tab_badge_enabled, isNative, updateTitle]);

  // ── Cleanup ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      document.title = BASE_TITLE;
    };
  }, []);
}

