import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function useTypingIndicator(partnerId: string | undefined) {
  const { user } = useAuth();
  const [partnerIsTyping, setPartnerIsTyping] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<number>(0);

  useEffect(() => {
    if (!user || !partnerId) return;

    // Create a deterministic room ID for these two users
    const chatRoomId = [user.id, partnerId].sort().join('-');
    const typingChannel = supabase.channel(`typing:${chatRoomId}`);

    typingChannel
      .on('presence', { event: 'sync' }, () => {
        const state = typingChannel.presenceState();
        let isTyping = false;
        
        for (const presences of Object.values(state)) {
            if ((presences as unknown as { user_id: string, typing: boolean }[]).some(p => p.user_id === partnerId && p.typing)) {
                isTyping = true;
            }
        }
        
        setPartnerIsTyping(isTyping);

        // Safety timeout: if we don't receive a sync or the partner disconnects abruptly,
        // force typing to false after 3 seconds
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }
        
        if (isTyping) {
          typingTimeoutRef.current = setTimeout(() => {
            setPartnerIsTyping(false);
          }, 3000);
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await typingChannel.track({ user_id: user.id, typing: false });
        }
      });

    channelRef.current = typingChannel;

    return () => {
      typingChannel.unsubscribe();
    };
  }, [user, partnerId]);

  const sendTypingEvent = async (isTyping: boolean) => {
    if (!channelRef.current || !user) return;

    const now = Date.now();
    // Debounce typing logic: allow 'false' explicitly anytime, but throttle 'true' to once per second
    if (isTyping && now - lastSentRef.current < 1000) {
      return;
    }

    lastSentRef.current = now;
    await channelRef.current.track({ user_id: user.id, typing: isTyping });
  };

  return { partnerIsTyping, sendTypingEvent };
}
