import { useEffect, useRef } from 'react';
import type { ChatMessage } from './useChat';

const BASE_TITLE = 'AURA';

/**
 * useTabNotification
 *
 * Updates the browser tab title with an unread message badge.
 * - "(3) AURA" when 3 unread partner messages
 * - "(9+) AURA" when 9+ unread
 * - "AURA" when all read or tab is focused
 *
 * Only runs on desktop — call this hook inside DesktopChatScreen.
 */
export function useTabNotification(messages: ChatMessage[]): void {
  // Keep a stable ref to the original title so we can restore it on unmount
  const originalTitleRef = useRef(document.title);

  useEffect(() => {
    // Count unread messages from partner (not mine, not read)
    const unreadCount = messages.filter(m => !m.is_mine && !m.is_read).length;

    if (unreadCount === 0) {
      document.title = BASE_TITLE;
    } else {
      const badge = unreadCount > 9 ? '9+' : String(unreadCount);
      document.title = `(${badge}) ${BASE_TITLE}`;
    }
  }, [messages]);

  // Reset title when the component unmounts (e.g. user logs out)
  useEffect(() => {
    return () => {
      document.title = originalTitleRef.current || BASE_TITLE;
    };
  }, []);
}
