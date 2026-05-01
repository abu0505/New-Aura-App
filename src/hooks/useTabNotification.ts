import { useEffect, useRef } from 'react';
import { useNotifications } from '../contexts/NotificationContext';

const BASE_TITLE = 'AURA';

/**
 * useTabNotification
 *
 * Updates the browser tab title with an unread global notification badge.
 * - "(3) AURA" when 3 unread notifications
 * - "(9+) AURA" when 9+ unread
 * - "AURA" when all read
 *
 * Runs globally on desktop inside AppLayout or similar.
 */
export function useTabNotification(): void {
  const originalTitleRef = useRef(document.title);
  const { unreadCount } = useNotifications();

  useEffect(() => {
    if (unreadCount === 0) {
      document.title = BASE_TITLE;
    } else {
      const badge = unreadCount > 9 ? '9+' : String(unreadCount);
      document.title = `(${badge}) ${BASE_TITLE}`;
    }
  }, [unreadCount]);

  // Reset title when the component unmounts
  useEffect(() => {
    return () => {
      document.title = originalTitleRef.current || BASE_TITLE;
    };
  }, []);
}
