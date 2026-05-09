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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(false);

  useEffect(() => {
    enabledRef.current = !!settings?.tab_badge_enabled;
  }, [settings?.tab_badge_enabled]);

  // ── Core: fetch unread count from DB and update title ──────────────
  const refreshCount = useCallback(async (reason: string) => {
    if (!user?.id || isNative) return;

    const { count, error } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('receiver_id', user.id)
      .eq('is_read', false);

    const c = count ?? 0;
    countRef.current = c;

    if (!enabledRef.current || c === 0) {
      document.title = BASE_TITLE;
    } else {
      const badge = c > 9 ? '9+' : String(c);
      const title = `(${badge}) ${BASE_TITLE}`;
      document.title = title;
    }
  }, [user?.id, isNative]);

  // ── Debounced refresh ──────────────────────────────────────────────
  const debouncedRefresh = useCallback((reason: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      refreshCount(reason);
    }, 500);
  }, [refreshCount]);

  // ── Mount: initial fetch + realtime subscription ───────────────────
  useEffect(() => {
    if (!user?.id || isNative) return;

    // Fetch once immediately
    refreshCount('initial-mount');

    // Subscribe to ALL messages table events
    const unsubscribe = realtimeHub.on('messages', (payload) => {
      const row = payload.new as any;
      const eventType = payload.eventType;

      if (row?.receiver_id === user.id || row?.sender_id === user.id) {
        debouncedRefresh(`realtime-${eventType}`);
      }
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshCount('visibility-change');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [user?.id, isNative, refreshCount, debouncedRefresh]);

  // ── Re-apply title when the setting is toggled ─────────────────────
  useEffect(() => {
    if (isNative) return;

    if (!settings?.tab_badge_enabled || countRef.current === 0) {
      document.title = BASE_TITLE;
    } else {
      const badge = countRef.current > 9 ? '9+' : String(countRef.current);
      document.title = `(${badge}) ${BASE_TITLE}`;
    }
  }, [settings?.tab_badge_enabled, isNative]);

  // ── Cleanup ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      document.title = BASE_TITLE;
    };
  }, []);
}

