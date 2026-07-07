import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function useEmojiInteraction(partnerId: string | undefined) {
  const { user } = useAuth();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!user || !partnerId) return;

    const chatRoomId = [user.id, partnerId].sort().join('-');
    const channelName = `emoji_interaction:${chatRoomId}`;

    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: true } }, // self: true means the sender also receives it
    });

    channel
      .on('broadcast', { event: 'emoji_click' }, (payload) => {
        const { messageId } = payload.payload as { messageId: string };
        // Dispatch custom event to notify AnimatedEmoji inside the bubble
        window.dispatchEvent(new CustomEvent(`emoji_click_${messageId}`));
      })
      .subscribe((status) => {
        subscribedRef.current = status === 'SUBSCRIBED';
      });

    channelRef.current = channel;

    return () => {
      subscribedRef.current = false;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [user, partnerId]);

  const triggerEmojiClick = useCallback((messageId: string) => {
    if (!channelRef.current || !subscribedRef.current) return;
    channelRef.current.send({
      type: 'broadcast',
      event: 'emoji_click',
      payload: { messageId }
    });
  }, []);

  return { triggerEmojiClick };
}
