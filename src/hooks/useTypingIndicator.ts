import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function useTypingIndicator(partnerId: string | undefined) {
  const { user } = useAuth();
  const [partnerIsTyping, setPartnerIsTyping] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<number>(0);
  // Stable refs so the sync closure always reads the latest values
  const myUserIdRef = useRef<string | undefined>(undefined);
  const partnerIdRef = useRef<string | undefined>(undefined);

  useEffect(() => { myUserIdRef.current = user?.id; }, [user?.id]);
  useEffect(() => { partnerIdRef.current = partnerId; }, [partnerId]);

  useEffect(() => {
    if (!user || !partnerId) return;

    // Create a deterministic room ID for these two users
    const chatRoomId = [user.id, partnerId].sort().join('-');
    const typingChannel = supabase.channel(`typing:${chatRoomId}`);

    typingChannel
      .on('presence', { event: 'sync' }, () => {
        const myId = myUserIdRef.current;
        const theirId = partnerIdRef.current;

        if (!myId || !theirId) return;

        const state = typingChannel.presenceState();
        let isTyping = false;

        for (const presences of Object.values(state)) {
          for (const p of presences as unknown as { user_id: string; typing: boolean }[]) {
            // Strictly skip anything that is ours
            if (p.user_id === myId) continue;
            // Only care about the partner
            if (p.user_id === theirId && p.typing) {
              isTyping = true;
            }
          }
        }

        setPartnerIsTyping(isTyping);

        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }

        // Safety timeout must be longer than the throttle interval (1s) + network latency
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
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingChannel.unsubscribe();
      channelRef.current = null;
    };
  }, [user, partnerId]);

  // MUST be useCallback so the reference is stable across renders.
  // Without this, MessageInput's typing effect re-runs on every parent render,
  // causing spurious track(true) calls and timeout resets → self-typing + flickering.
  const sendTypingEvent = useCallback(async (isTyping: boolean) => {
    if (!channelRef.current) return;

    const now = Date.now();
    // Debounce: allow 'false' anytime, but throttle 'true' to once per second
    if (isTyping && now - lastSentRef.current < 1000) {
      return;
    }

    lastSentRef.current = now;
    await channelRef.current.track({ user_id: myUserIdRef.current, typing: isTyping });
  }, []);

  return { partnerIsTyping, sendTypingEvent };
}
