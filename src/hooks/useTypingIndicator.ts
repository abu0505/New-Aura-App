import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function useTypingIndicator(partnerId: string | undefined) {
  const { user } = useAuth();
  const [partnerIsTyping, setPartnerIsTyping] = useState(false);
  const [channel, setChannel] = useState<ReturnType<typeof supabase.channel> | null>(null);

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
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await typingChannel.track({ user_id: user.id, typing: false });
        }
      });

    setChannel(typingChannel);

    return () => {
      typingChannel.unsubscribe();
    };
  }, [user, partnerId]);

  const sendTypingEvent = async (isTyping: boolean) => {
    if (channel && user) {
      await channel.track({ user_id: user.id, typing: isTyping });
    }
  };

  return { partnerIsTyping, sendTypingEvent };
}
