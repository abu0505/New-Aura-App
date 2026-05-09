import { useEffect, useRef, useCallback } from 'react';
import { useChatSettingsContext } from '../contexts/ChatSettingsContext';
import { usePlatform } from './usePlatform';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { realtimeHub } from '../lib/realtimeHub';

const BASE_TITLE = 'AURA';

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

    // Fetch exact count ONCE
    const fetchInitialCount = async () => {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('receiver_id', user.id)
        .eq('is_read', false);

      countRef.current = count ?? 0;
      updateTitle();
    };

    fetchInitialCount();

    // Subscribe to ALL messages table events and calculate locally
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

    // Re-fetch only when user comes back to the tab to ensure no dropped packets
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchInitialCount();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      unsubscribe();
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

