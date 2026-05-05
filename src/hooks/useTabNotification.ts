import { useEffect, useRef } from 'react';
import { useNotifications } from '../contexts/NotificationContext';
import { useChatSettings } from './useChatSettings';
import { usePlatform } from './usePlatform';

const BASE_TITLE = 'AURA';

/**
 * useTabNotification
 *
 * Updates the browser tab title with an unread global notification badge.
 * - "(3) AURA" when 3 unread notifications
 * - "(9+) AURA" when 9+ unread
 * - "AURA" when all read
 *
 * Browser-only — automatically disabled on native Android.
 * (Tab title has no meaning inside the Android WebView.)
 */
export function useTabNotification(): void {
  const originalTitleRef = useRef(document.title);
  const { settings } = useChatSettings();
  const { unreadCount } = useNotifications();
  const { isNative } = usePlatform();

  useEffect(() => {
    // No-op on native Android — there are no browser tabs
    if (isNative) return;

    if (!settings?.tab_badge_enabled || unreadCount === 0) {
      document.title = BASE_TITLE;
    } else {
      const badge = unreadCount > 9 ? '9+' : String(unreadCount);
      document.title = `(${badge}) ${BASE_TITLE}`;
    }
  }, [unreadCount, settings?.tab_badge_enabled, isNative]);

  // Reset title when the component unmounts
  useEffect(() => {
    return () => {
      document.title = originalTitleRef.current || BASE_TITLE;
    };
  }, []);
}
