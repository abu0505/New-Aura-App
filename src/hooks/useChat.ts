import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { encryptMessage, decryptMessageWithFallback, getStoredKeyPair, decodeBase64, encodeBase64 } from '../lib/encryption';
import type { Database } from '../integrations/supabase/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];

export interface ChatMessage extends MessageRow {
  decrypted_content?: string;
  decrypted_media_url?: string;
  is_mine: boolean;
  decryption_error?: boolean;
  is_pending?: boolean;
}

export function useChat(partnerId: string | undefined, partnerPublicKey: string | null | undefined, partnerKeyHistory?: string[]) {
  const { user, encryptionStatus } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<Database['public']['Tables']['pinned_messages']['Row'][]>([]);
  const [pinnedMessageDetails, setPinnedMessageDetails] = useState<Record<string, ChatMessage>>({});
  const [dataLoading, setDataLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? window.navigator.onLine : true);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const PAGE_SIZE = 10;
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track latest partnerPublicKey via ref so realtime handlers always use the current value
  const partnerKeyRef = useRef(partnerPublicKey);
  useEffect(() => { partnerKeyRef.current = partnerPublicKey; }, [partnerPublicKey]);

  // Track partner key history via ref
  const partnerKeyHistoryRef = useRef(partnerKeyHistory);
  useEffect(() => { partnerKeyHistoryRef.current = partnerKeyHistory; }, [partnerKeyHistory]);

  // Track latest message timestamp for gap-fill
  const lastMessageTimeRef = useRef<string | null>(null);
  useEffect(() => {
    if (messages.length > 0) {
      const maxTime = messages.reduce((max, msg) => msg.created_at > max ? msg.created_at : max, messages[0].created_at);
      lastMessageTimeRef.current = maxTime;
    }
  }, [messages]);

  // Decrypts a single message row — uses per-message sender_public_key when available
  const decryptRow = useCallback((row: MessageRow, myKeyPair: { secretKey: Uint8Array, publicKey: Uint8Array } | null | undefined, partnerKey: string | null | undefined, keyHistory?: string[]): ChatMessage => {
    const isMine = row.sender_id === user?.id;
    let decryptedText = '';
    let decryptionError = false;

    if (row.is_deleted_for_everyone) {
      decryptedText = 'This message was deleted';
    } else if (partnerKey && myKeyPair) {
      if (row.type === 'text' || row.type === 'sticker' || !row.type) {
        try {
          // NaCl box decryption: nacl.box.open(cipher, nonce, theirPublicKey, mySecretKey)
          // For a message I SENT:    "theirPublicKey" slot = Partner's public key (partnerKey)
          // For a message I RECEIVED: "theirPublicKey" slot = partner's sender_public_key
          const decryptionKey = isMine
            ? partnerKey!
            : (row.sender_public_key || partnerKey!);

          // For ALL messages, we should try the current partnerKey and all historical partner keys as fallbacks.
          const fallbackKeys = (keyHistory || [])
            .filter(k => k !== decryptionKey)
            .map(k => decodeBase64(k));

          const result = decryptMessageWithFallback(
            row.encrypted_content,
            row.nonce,
            decodeBase64(decryptionKey),
            myKeyPair.secretKey,
            fallbackKeys
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
            sender_public_key: msg.sender_public_key,
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

  // Re-decrypt messages when partnerPublicKey or my encryption readiness changes
  useEffect(() => {
    if ((!partnerPublicKey && !partnerKeyHistoryRef.current) || messages.length === 0 || encryptionStatus !== 'ready') return;
    const myKeyPair = getStoredKeyPair();
    if (!myKeyPair) return;

    setMessages(prev => prev.map(row => 
       row.decrypted_content && row.decrypted_content !== '[Awaiting Keys]' && !row.decryption_error 
       ? row 
       : decryptRow(row, myKeyPair, partnerPublicKey || partnerKeyRef.current, partnerKeyHistoryRef.current)
    ));
  }, [partnerPublicKey, encryptionStatus]);

  useEffect(() => {
    if (!user || !partnerId) return;

    const fetchMissedMessages = async () => {
      if (!lastMessageTimeRef.current) return;
      const myKeyPair = getStoredKeyPair();
      const currentPartnerKey = partnerKeyRef.current;
      const currentKeyHistory = partnerKeyHistoryRef.current;
      
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`)
          .gt('created_at', lastMessageTimeRef.current)
          .order('created_at', { ascending: true });

        if (error) throw error;

        if (data && data.length > 0) {
          let newMessages: ChatMessage[] = [];
          if (myKeyPair) {
            newMessages = data.map(row => decryptRow(row, myKeyPair, currentPartnerKey, currentKeyHistory));
          } else {
            newMessages = data.map(row => ({ ...row, is_mine: row.sender_id === user.id }));
          }
          
          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const uniqueNew = newMessages.filter(m => !existingIds.has(m.id));
            if (uniqueNew.length === 0) return prev;
            return [...prev, ...uniqueNew];
          });
          
          const unreadIds = data.filter(m => m.sender_id === partnerId && !m.is_read).map(m => m.id);
          if (unreadIds.length > 0) {
            if (document.visibilityState === 'visible') {
              await supabase.from('messages').update({ is_read: true, is_delivered: true }).in('id', unreadIds);
            } else {
              const undeliveredIds = data.filter(m => m.sender_id === partnerId && !m.is_delivered).map(m => m.id);
              if (undeliveredIds.length > 0) {
                await supabase.from('messages').update({ is_delivered: true }).in('id', undeliveredIds);
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch missed messages', err);
      }
    };

    const fetchMessages = async () => {
      const myKeyPair = getStoredKeyPair();
      const currentPartnerKey = partnerKeyRef.current;
      const currentKeyHistory = partnerKeyHistoryRef.current;
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE);

        if (error) throw error;

        if (myKeyPair && data) {
          // Reverse data because we fetched most recent but want to display ascending
          const sortedData = [...data].reverse();
          const decrypted = sortedData.map(row => decryptRow(row, myKeyPair, currentPartnerKey, currentKeyHistory));
          setMessages(decrypted);
          setHasMore(data.length === PAGE_SIZE);

          // Find first unread from partner
          const firstUnread = decrypted.find(m => !m.is_mine && !m.is_read);
          if (firstUnread) {
            setFirstUnreadId(firstUnread.id);
          }

          // Mark unread messages from partner as read
          const unreadIds = data.filter(m => m.sender_id === partnerId && !m.is_read).map(m => m.id);
          if (unreadIds.length > 0) {
            if (document.visibilityState === 'visible') {
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

      } finally {
        setDataLoading(false);
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
        .channel(`messages:${user.id}:${partnerId}:${Date.now()}`)
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
            const currentKeyHistory = partnerKeyHistoryRef.current;
            if (!myKeyPair) return;
            
            if (payload.eventType === 'INSERT') {
              const newMsg = decryptRow(payload.new as MessageRow, myKeyPair, currentPartnerKey, currentKeyHistory);
              setMessages((prev) => {
                 if (prev.some(m => m.id === newMsg.id)) return prev;
                 return [...prev, newMsg];
              });

              if (document.visibilityState === 'visible') {
                supabase.from('messages').update({ is_read: true, is_delivered: true }).eq('id', newMsg.id).then();
              } else {
                supabase.from('messages').update({ is_delivered: true }).eq('id', newMsg.id).then();
              }
            } else if (payload.eventType === 'UPDATE') {
               const updatedMsg = decryptRow(payload.new as MessageRow, myKeyPair, currentPartnerKey, currentKeyHistory);
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
            const currentKeyHistory = partnerKeyHistoryRef.current;
            if (!myKeyPair) return;

            if (payload.eventType === 'INSERT') {
              const newMsg = decryptRow(payload.new as MessageRow, myKeyPair, currentPartnerKey, currentKeyHistory);
              setMessages((prev) => {
                const exists = prev.find(m => m.id === newMsg.id);
                if (exists) {
                   return prev.map(m => m.id === newMsg.id ? { ...m, ...newMsg, is_pending: false } : m);
                }
                return [...prev, newMsg];
              });
              setPendingMessages(prev => prev.filter(m => m.id !== newMsg.id));
            } else if (payload.eventType === 'UPDATE') {
              const updatedMsg = decryptRow(payload.new as MessageRow, myKeyPair, currentPartnerKey, currentKeyHistory);
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

      channelPinned = supabase.channel(`pinned:${user.id}:${partnerId}:${Date.now()}`)
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchMissedMessages();
        setupSubscriptions();
      }
    };

    const handleOnlineEvent = () => {
      fetchMissedMessages();
      setupSubscriptions();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnlineEvent);

    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchMissedMessages();
      }
    }, 30_000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnlineEvent);
      clearInterval(intervalId);
      
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (channelMsg) supabase.removeChannel(channelMsg);
      if (channelPinned) supabase.removeChannel(channelPinned);
    };
  }, [user, partnerId, encryptionStatus]); // Added encryptionStatus to re-subscribe if needed or at least re-trigger

  // Fetch missing pinned message details
  useEffect(() => {
    if (!pinnedMessages || pinnedMessages.length === 0) return;
    
    // Find message IDs that are NOT in the `messages` array AND NOT already in `pinnedMessageDetails`
    const missingIds = pinnedMessages
      .map(p => p.message_id)
      .filter(id => !messages.find(m => m.id === id) && !pinnedMessageDetails[id]);

    if (missingIds.length === 0) return;

    const fetchDetails = async () => {
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .in('id', missingIds);
          
        if (error) throw error;
          
        if (data && data.length > 0) {
          const myKeyPair = getStoredKeyPair();
          const currentPartnerKey = partnerKeyRef.current;
          const currentKeyHistory = partnerKeyHistoryRef.current;
          
          const decryptedDetails: Record<string, ChatMessage> = {};
          for (const row of data) {
            const decrypted = decryptRow(row, myKeyPair, currentPartnerKey, currentKeyHistory);
            decryptedDetails[row.id] = decrypted;
          }

          setPinnedMessageDetails(prev => ({ ...prev, ...decryptedDetails }));
        }
      } catch (err) {
        console.error('Error fetching pinned messages:', err);
      }
    };

    fetchDetails();
  }, [pinnedMessages, messages, pinnedMessageDetails, decryptRow]);

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

    const myPublicKeyStr = encodeBase64(myKeyPair.publicKey);

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
      sender_public_key: myPublicKeyStr,
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
        sender_public_key: myPublicKeyStr,
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
      // Trigger Web Push Notification asynchronously — only send what the Edge Function needs
      supabase.functions.invoke('send-push', {
        body: { 
          record: { 
            id: optimisticMsg.id,
            sender_id: user.id,
            receiver_id: partnerId,
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
    const myPublicKeyStr = encodeBase64(myKeyPair.publicKey);
    
    setMessages(prev => prev.map(m => m.id === messageId ? { 
      ...m, 
      decrypted_content: newText, 
      encrypted_content: encrypted.ciphertext, 
      nonce: encrypted.nonce, 
      is_edited: true,
      sender_public_key: myPublicKeyStr, 
    } : m));

    await supabase.from('messages').update({
      encrypted_content: encrypted.ciphertext,
      nonce: encrypted.nonce,
      is_edited: true,
      sender_public_key: myPublicKeyStr,
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
    const existing = pinnedMessages.find(p => p.message_id === messageId && p.pinned_by === user.id);
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

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !user || !partnerId) return;

    setLoadingMore(true);
    const myKeyPair = getStoredKeyPair();
    const currentPartnerKey = partnerKeyRef.current;
    const currentKeyHistory = partnerKeyHistoryRef.current;
    
    // Use the oldest message in state as the cursor
    const oldestTimestamp = messages.length > 0 ? messages[0].created_at : null;
    if (!oldestTimestamp) {
      setLoadingMore(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`)
        .lt('created_at', oldestTimestamp)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;
      if (!data || data.length === 0) {
        setHasMore(false);
        return;
      }

      if (myKeyPair) {
        // Reverse to maintain ASC sequence
        const sortedData = [...data].reverse();
        const decrypted = sortedData.map(row => decryptRow(row, myKeyPair, currentPartnerKey, currentKeyHistory));
        setMessages(prev => [...decrypted, ...prev]);
      } else {
        const sortedData = [...data].reverse();
        setMessages(prev => [...sortedData.map(row => ({ ...row, is_mine: row.sender_id === user.id })), ...prev]);
      }
      
      setHasMore(data.length === PAGE_SIZE);
    } catch (err) {
      console.error('Error loading more messages', err);
    } finally {
      setLoadingMore(false);
    }
  }, [user?.id, partnerId, messages, loadingMore, hasMore, decryptRow]);

  return { 
    messages, 
    pinnedMessages,
    pinnedMessageDetails,
    loading: dataLoading || (encryptionStatus !== 'ready' && encryptionStatus !== 'error' && encryptionStatus !== 'pin_setup_required'), 
    loadingMore,
    hasMore,
    sendMessage, 
    loadMore,
    reactToMessage, 
    editMessage, 
    deleteMessage, 
    markAsRead, 
    pinMessage, 
    firstUnreadId, 
    isOnline 
  };
}
