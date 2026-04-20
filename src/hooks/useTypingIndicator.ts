import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function useTypingIndicator(partnerId: string | undefined) {
  const { user } = useAuth();
  const [partnerIsTyping, setPartnerIsTyping] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const subscribedRef = useRef(false);
  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<number>(0);

  useEffect(() => {
    if (!user || !partnerId) return;

    // Deterministic room ID for these two users
    const chatRoomId = [user.id, partnerId].sort().join('-');

    // self: false → sender NEVER receives their own broadcasts.
    // This eliminates any self-typing bug at the protocol level.
    const typingChannel = supabase.channel(`typing:${chatRoomId}`, {
      config: { broadcast: { self: false } },
    });

    typingChannel
      .on('broadcast', { event: 'typing' }, (payload) => {
        const data = payload.payload as { user_id: string; typing: boolean };
        
        // Only care about partner's typing events
        if (data.user_id !== partnerId) return;

        setPartnerIsTyping(data.typing);

        // Clear any existing safety timeout
        if (safetyTimeoutRef.current) {
          clearTimeout(safetyTimeoutRef.current);
          safetyTimeoutRef.current = null;
        }

        // If partner started typing, set a safety timeout to auto-hide
        // in case we miss the "typing: false" broadcast.
        if (data.typing) {
          safetyTimeoutRef.current = setTimeout(() => {
            setPartnerIsTyping(false);
          }, 4000); // 4 seconds
        }
      })
      .subscribe((status) => {
        subscribedRef.current = status === 'SUBSCRIBED';
      });

    channelRef.current = typingChannel;

    return () => {
      if (safetyTimeoutRef.current) clearTimeout(safetyTimeoutRef.current);
      subscribedRef.current = false;
      supabase.removeChannel(typingChannel);
      channelRef.current = null;
    };
  }, [user, partnerId]);

  // Stable reference — only depends on refs, no closures over changing values.
  const sendTypingEvent = useCallback(async (isTyping: boolean) => {
    // Only send when channel is fully subscribed via WebSocket.
    // This prevents the "Realtime send() automatically falling back to REST API"
    // warning that fires when send() is called before the WS is connected.
    if (!channelRef.current || !subscribedRef.current) return;

    const now = Date.now();
    // Throttle 'true' to once per second; allow 'false' anytime
    if (isTyping && now - lastSentRef.current < 1000) {
      return;
    }
    // Only update throttle timestamp for 'true' — sending 'false' should
    // never block a subsequent 'true' from going through immediately.
    if (isTyping) lastSentRef.current = now;

    channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: user?.id, typing: isTyping },
    });
  }, [user?.id, partnerId]);

  return { partnerIsTyping, sendTypingEvent };
}
