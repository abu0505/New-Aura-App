import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { encryptMessage, decryptMessage, getStoredKeyPair, decodeBase64 } from '../lib/encryption';
import type { Database } from '../integrations/supabase/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];

export interface ChatMessage extends MessageRow {
  decrypted_content?: string;
  decrypted_media_url?: string;
  is_mine: boolean;
  decryption_error?: boolean;
  is_pending?: boolean;
}

export function useChat(partnerId: string | undefined, partnerPublicKey: string | null | undefined) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<Database['public']['Tables']['pinned_messages']['Row'][]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? window.navigator.onLine : true);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track latest partnerPublicKey via ref so realtime handlers always use the current value
  const partnerKeyRef = useRef(partnerPublicKey);
  useEffect(() => { partnerKeyRef.current = partnerPublicKey; }, [partnerPublicKey]);

  // Decrypts a single message row — takes partnerKey as explicit param (no closure dependency)
  const decryptRow = useCallback((row: MessageRow, myKeyPair: { secretKey: Uint8Array, publicKey: Uint8Array } | null | undefined, partnerKey: string | null | undefined): ChatMessage => {
    const isMine = row.sender_id === user?.id;
    let decryptedText = '';
    let decryptionError = false;

    if (row.is_deleted_for_everyone) {
      decryptedText = 'This message was deleted';
    } else if (partnerKey && myKeyPair) {
      if (row.type === 'text' || row.type === 'sticker' || !row.type) {
        try {
          const result = decryptMessage(
            row.encrypted_content,
            row.nonce,
            decodeBase64(partnerKey),
            myKeyPair.secretKey
          );
          decryptedText = result;
        } catch (e) {
          console.error('Decryption failed for message', row.id, e);
          decryptedText = '⚠️ Could not decrypt this message';
          decryptionError = true;
        }
      } else {
        decryptedText = ''; // Media messages might not have text content
      }
    } else {
      decryptedText = '[Awaiting Keys]';
    }

    return {
      ...row,
      decrypted_content: decryptedText || (decryptionError ? '⚠️ Could not decrypt this message' : ''),
      is_mine: isMine,
      decryption_error: decryptionError,
    };
  }, [user?.id]);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Flush pending messages loop (retries every 3 seconds if there are pending messages)
  useEffect(() => {
    if (!isOnline || pendingMessages.length === 0) return;

    let mounted = true;
    const flush = async () => {
      const toSend = [...pendingMessages];
      console.log(`Attempting to flush ${toSend.length} pending messages...`);
      // Don't clear pending state immediately; do it on successful insert.
      
      for (const msg of toSend) {
        if (!mounted) break;
        try {
          const { error } = await supabase.from('messages').insert({
            id: msg.id,
            sender_id: msg.sender_id,
            receiver_id: msg.receiver_id,
            encrypted_content: msg.encrypted_content,
            nonce: msg.nonce,
            type: msg.type,
            media_url: msg.media_url,
            media_key: msg.media_key,
            media_nonce: msg.media_nonce,
            reply_to: msg.reply_to,
          });

          if (!error) {
             setPendingMessages(prev => prev.filter(p => !toSend.some(ts => ts.id === p.id && ts.id === msg.id)));
             setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_pending: false } : m));
          }
        } catch (err) {
          console.error('Failed to flush pending message', msg.id, err);
        }
      }
    };

    const interval = setInterval(flush, 3000);
    return () => {
       mounted = false;
       clearInterval(interval);
    };
  }, [isOnline, pendingMessages]);

  // Re-decrypt messages when partnerPublicKey becomes available (without re-subscribing)
  useEffect(() => {
    if (!partnerPublicKey || messages.length === 0) return;
    const myKeyPair = getStoredKeyPair();
    if (!myKeyPair) return;

    setMessages(prev => prev.map(row => decryptRow(row, myKeyPair, partnerPublicKey)));
  }, [partnerPublicKey]);

  useEffect(() => {
    if (!user || !partnerId) return;

    const fetchMessages = async () => {
      const myKeyPair = getStoredKeyPair();
      const currentPartnerKey = partnerKeyRef.current;
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`)
          .order('created_at', { ascending: true })
          .limit(100);

        if (error) throw error;

        if (myKeyPair && data) {
          const decrypted = data.map(row => decryptRow(row, myKeyPair, currentPartnerKey));
          setMessages(decrypted);

          // Find first unread from partner
          const firstUnread = decrypted.find(m => !m.is_mine && !m.is_read);
          if (firstUnread) {
            setFirstUnreadId(firstUnread.id);
          }

          // Mark unread messages from partner as read
          const unreadIds = data.filter(m => m.sender_id === partnerId && !m.is_read).map(m => m.id);
          if (unreadIds.length > 0) {
            if (document.hasFocus()) {
              await supabase.from('messages').update({ is_read: true, is_delivered: true }).in('id', unreadIds);
            } else {
              const undeliveredIds = data.filter(m => m.sender_id === partnerId && !m.is_delivered).map(m => m.id);
              if (undeliveredIds.length > 0) {
                 await supabase.from('messages').update({ is_delivered: true }).in('id', undeliveredIds);
              }
            }
          }
        } else {
          setMessages((data || []).map(row => ({ ...row, is_mine: row.sender_id === user.id })));
        }

        // Fetch pinned messages
        const { data: pinnedData } = await supabase
          .from('pinned_messages')
          .select('*');
        if (pinnedData) {
          setPinnedMessages(pinnedData);
        }

      } catch (err) {
        console.error('Error fetching messages', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();

    let channelMsg: ReturnType<typeof supabase.channel> | null = null;
    let channelPinned: ReturnType<typeof supabase.channel> | null = null;
    let isSubscribing = false;

    const setupSubscriptions = () => {
      if (isSubscribing) return;
      isSubscribing = true;

      // Clean up existing channels if any
      if (channelMsg) supabase.removeChannel(channelMsg);
      if (channelPinned) supabase.removeChannel(channelPinned);

      channelMsg = supabase
        .channel(`messages:${user.id}:${partnerId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'messages',
            filter: `receiver_id=eq.${user.id}`, // Listen for messages sent to me
          },
          (payload) => {
            const myKeyPair = getStoredKeyPair();
            const currentPartnerKey = partnerKeyRef.current;
            if (!myKeyPair) return;
            
            if (payload.eventType === 'INSERT') {
              const newMsg = decryptRow(payload.new as MessageRow, myKeyPair, currentPartnerKey);
              setMessages((prev) => {
                 if (prev.some(m => m.id === newMsg.id)) return prev;
                 return [...prev, newMsg];
              });

              if (document.hasFocus()) {
                supabase.from('messages').update({ is_read: true, is_delivered: true }).eq('id', newMsg.id).then();
              } else {
                supabase.from('messages').update({ is_delivered: true }).eq('id', newMsg.id).then();
              }
            } else if (payload.eventType === 'UPDATE') {
               const updatedMsg = decryptRow(payload.new as MessageRow, myKeyPair, currentPartnerKey);
               setMessages((prev) => prev.map(m => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m));
            } else if (payload.eventType === 'DELETE') {
               setMessages((prev) => prev.filter(m => m.id !== (payload.old as any).id));
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'messages',
            filter: `sender_id=eq.${user.id}`, // Also listen to my own messages
          },
          (payload) => {
            const myKeyPair = getStoredKeyPair();
            const currentPartnerKey = partnerKeyRef.current;
            if (!myKeyPair) return;

            if (payload.eventType === 'INSERT') {
              const newMsg = decryptRow(payload.new as MessageRow, myKeyPair, currentPartnerKey);
              setMessages((prev) => {
                const exists = prev.find(m => m.id === newMsg.id);
                if (exists) {
                   return prev.map(m => m.id === newMsg.id ? { ...m, ...newMsg, is_pending: false } : m);
                }
                return [...prev, newMsg];
              });
              setPendingMessages(prev => prev.filter(m => m.id !== newMsg.id));
            } else if (payload.eventType === 'UPDATE') {
              const updatedMsg = decryptRow(payload.new as MessageRow, myKeyPair, currentPartnerKey);
              setMessages((prev) => prev.map(m => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m));
            } else if (payload.eventType === 'DELETE') {
              setMessages((prev) => prev.filter(m => m.id !== (payload.old as any).id));
            }
          }
        );

      channelMsg.subscribe((status, err) => {
        isSubscribing = false;
        if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.warn(`Message channel status: ${status}. Attempting reconnect...`, err);
          if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(setupSubscriptions, 5000);
        }
      });

      channelPinned = supabase.channel(`pinned:${user.id}:${partnerId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pinned_messages' }, (payload) => {
          if (payload.eventType === 'INSERT') {
            setPinnedMessages(prev => {
               if (prev.some(p => p.id === (payload.new as any).id)) return prev;
               return [...prev, payload.new as Database['public']['Tables']['pinned_messages']['Row']];
            });
          } else if (payload.eventType === 'DELETE') {
            setPinnedMessages(prev => prev.filter(p => p.id !== (payload.old as any).id));
          }
        });
        
      channelPinned.subscribe();
    };

    setupSubscriptions();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (channelMsg) supabase.removeChannel(channelMsg);
      if (channelPinned) supabase.removeChannel(channelPinned);
    };
  }, [user, partnerId]);

  const sendMessage = async (
    text: string, 
    media?: { url: string, media_key: string, media_nonce: string, type: string },
    replyToId?: string
  ) => {
    if (!user || !partnerId) return;

    const myKeyPair = getStoredKeyPair();
    if (!myKeyPair || !partnerPublicKey) {
      console.error('Missing encryption keys!');
      return;
    }

    let ciphertext = '';
    let nonce = '';

    if (text || media?.type === 'sticker') {
      const encrypted = encryptMessage(text || '[[STICKER]]', decodeBase64(partnerPublicKey), myKeyPair.secretKey);
      ciphertext = encrypted.ciphertext;
      nonce = encrypted.nonce;
    }

    const optimisticMsg: ChatMessage = {
      id: crypto.randomUUID(),
      sender_id: user.id,
      receiver_id: partnerId,
      encrypted_content: ciphertext,
      nonce: nonce,
      type: (media?.type as any) || 'text',
      media_url: media?.url || null,
      media_key: media?.media_key || null,
      media_nonce: media?.media_nonce || null,
      reaction: null,
      reply_to: replyToId || null,
      is_read: false,
      is_delivered: false,
      is_edited: false,
      is_deleted_for_me: false,
      is_deleted_for_everyone: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      decrypted_content: text || (media?.type === 'sticker' ? text : ''),
      is_mine: true,
      is_pending: !isOnline
    };

    setMessages((prev) => [...prev, optimisticMsg]);

    if (!isOnline) {
      setPendingMessages(prev => [...prev, optimisticMsg]);
      return;
    }

    const { error } = await supabase
      .from('messages')
      .insert({
        id: optimisticMsg.id,
        sender_id: user.id,
        receiver_id: partnerId,
        encrypted_content: ciphertext,
        nonce: nonce,
        type: optimisticMsg.type,
        media_url: media?.url || null,
        media_key: media?.media_key || null,
        media_nonce: media?.media_nonce || null,
        reply_to: replyToId || null,
      });

    if (error) {
      console.error('Failed to send message', error);
      if (error.message?.includes('fetch') || error.code === 'PGRST301') {
         setMessages(prev => prev.map(m => m.id === optimisticMsg.id ? { ...m, is_pending: true } : m));
         setPendingMessages(prev => [...prev, optimisticMsg]);
      } else {
         setMessages((prev) => prev.filter(m => m.id !== optimisticMsg.id));
      }
    } else {
      // Trigger Web Push Notification asynchronously
      supabase.functions.invoke('send-push', {
        body: { 
          record: { 
            id: optimisticMsg.id,
            sender_id: user.id,
            receiver_id: partnerId,
            ciphertext: ciphertext,
            encrypted_content: ciphertext,
            nonce: nonce 
          } 
        }
      }).catch(err => console.error("Failed to trigger push notification", err));
    }
  };

  const reactToMessage = async (messageId: string, emoji: string | null) => {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reaction: emoji } : m));
    await supabase.from('messages').update({ reaction: emoji }).eq('id', messageId);
  };

  const editMessage = async (messageId: string, newText: string) => {
    if (!user || !partnerPublicKey) return;
    const myKeyPair = getStoredKeyPair();
    if (!myKeyPair) return;

    const encrypted = encryptMessage(newText, decodeBase64(partnerPublicKey), myKeyPair.secretKey);
    
    setMessages(prev => prev.map(m => m.id === messageId ? { 
      ...m, 
      decrypted_content: newText, 
      encrypted_content: encrypted.ciphertext, 
      nonce: encrypted.nonce, 
      is_edited: true 
    } : m));

    await supabase.from('messages').update({
      encrypted_content: encrypted.ciphertext,
      nonce: encrypted.nonce,
      is_edited: true
    }).eq('id', messageId);
  };

  const deleteMessage = async (messageId: string, forEveryone: boolean) => {
    if (forEveryone) {
      setMessages(prev => prev.map(m => m.id === messageId ? { 
        ...m, 
        is_deleted_for_everyone: true, 
        decrypted_content: 'This message was deleted',
        media_url: null
      } : m));
      
      await supabase.from('messages').update({ 
        is_deleted_for_everyone: true,
        encrypted_content: '',
        nonce: '',
        media_url: null,
        media_key: null,
        media_nonce: null
      }).eq('id', messageId);
    } else {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, is_deleted_for_me: true } : m));
      await supabase.from('messages').update({ is_deleted_for_me: true }).eq('id', messageId);
    }
  };

  const markAsRead = async (messageIds: string[]) => {
    await supabase.from('messages').update({ is_read: true }).in('id', messageIds);
  };

  const pinMessage = async (messageId: string) => {
    if (!user) return;
    const existing = pinnedMessages.find(p => p.message_id === messageId);
    if (existing) {
      setPinnedMessages(prev => prev.filter(p => p.id !== existing.id));
      await supabase.from('pinned_messages').delete().eq('id', existing.id);
    } else {
      const newPin: Database['public']['Tables']['pinned_messages']['Row'] = { 
        id: crypto.randomUUID(), 
        message_id: messageId, 
        pinned_by: user.id,
        created_at: new Date().toISOString()
      };
      setPinnedMessages(prev => [...prev, newPin]);
      await supabase.from('pinned_messages').insert({
        id: newPin.id,
        message_id: newPin.message_id,
        pinned_by: newPin.pinned_by
      });
    }
  };

  return { messages, pinnedMessages, loading, sendMessage, reactToMessage, editMessage, deleteMessage, markAsRead, pinMessage, firstUnreadId, isOnline };
}

