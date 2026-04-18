import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { encryptMessage, decryptMessageWithFallback, getStoredKeyPair, decodeBase64, encodeBase64 } from '../lib/encryption';
import { realtimeHub } from '../lib/realtimeHub';
import type { Database } from '../integrations/supabase/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];

export interface ChatMessage extends Omit<MessageRow, 'type'> {
  type: MessageRow['type'] | 'gif';
  decrypted_content?: string;
  decrypted_media_url?: string;
  is_mine: boolean;
  decryption_error?: boolean;
  is_pending?: boolean;
  is_send_failed?: boolean;  // Fix 1.1: permanent send failure flag
  retry_count?: number;      // Fix 1.1: tracks retry attempts
  is_uploading?: boolean;    // NEW: flag for background media upload
  // Chunked video fields
  is_chunked_video?: boolean;     // true = video is being progressively uploaded
  chunk_upload_status?: string;   // e.g. 'Splitting video...' | 'Uploading chunk 2 of 8...'
  thumbnail_local_url?: string;   // local blob URL for thumbnail before upload completes
}

// ═══ Module-level push debounce — MUST be outside the hook so it persists ═══
// Previously was inside sendMessage body — recreated every call, breaking debounce entirely.
// Fix 1.4: Exported so it can be cleared on logout.
export const pushDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Fix 1.1: Max retries before marking message as permanently failed
const MAX_SEND_RETRIES = 5;

export function useChat(partnerId: string | undefined, partnerPublicKey: string | null | undefined, partnerKeyHistory?: string[]) {
  const { user, encryptionStatus } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<Database['public']['Tables']['pinned_messages']['Row'][]>([]);
  const [pinnedMessageDetails, setPinnedMessageDetails] = useState<Record<string, ChatMessage>>({});
  // Cache of reply target messages — persists even after they scroll out of the loaded window
  const [replyMessageCache, setReplyMessageCache] = useState<Record<string, ChatMessage>>({});
  const [dataLoading, setDataLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? window.navigator.onLine : true);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const PAGE_SIZE = 25;
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable ref for encryptionStatus so realtime handlers have fresh value
  // without needing it in effect deps (which causes full message reset)
  const encryptionStatusRef = useRef(encryptionStatus);
  useEffect(() => { encryptionStatusRef.current = encryptionStatus; }, [encryptionStatus]);

  // Only fetch columns we actually need — huge egress savings vs select('*')
  const MSG_COLUMNS = 'id,sender_id,receiver_id,encrypted_content,nonce,type,media_url,media_key,media_nonce,thumbnail_url,file_name,file_size,duration,reaction,reply_to,is_read,is_delivered,is_edited,is_deleted_for_everyone,is_deleted_for_sender,is_deleted_for_receiver,updated_at,read_at,delivered_at,created_at,sender_public_key' as const;

  // Track latest partnerPublicKey via ref so realtime handlers always use the current value
  const partnerKeyRef = useRef(partnerPublicKey);
  useEffect(() => { partnerKeyRef.current = partnerPublicKey; }, [partnerPublicKey]);

  // Track partner key history via ref
  const partnerKeyHistoryRef = useRef(partnerKeyHistory);
  useEffect(() => { partnerKeyHistoryRef.current = partnerKeyHistory; }, [partnerKeyHistory]);

  // Track latest message timestamp for gap-fill
  const lastMessageTimeRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const pinnedMessageDetailsRef = useRef<Record<string, ChatMessage>>({});
  const replyMessageCacheRef = useRef<Record<string, ChatMessage>>({});
  // Tracks IDs we've already attempted to fetch — prevents ANY re-fetch on message state changes
  // (read receipts, reactions, realtime ticks all update `messages`, but egress stays O(1) per unique reply ID)
  const replyFetchAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    messagesRef.current = messages;
    if (messages.length > 0) {
      const maxTime = messages.reduce((max, msg) => msg.created_at > max ? msg.created_at : max, messages[0].created_at);
      lastMessageTimeRef.current = maxTime;
    }
  }, [messages]);

  useEffect(() => { pinnedMessageDetailsRef.current = pinnedMessageDetails; }, [pinnedMessageDetails]);
  useEffect(() => { replyMessageCacheRef.current = replyMessageCache; }, [replyMessageCache]);

  // Fix 1.2: Web Worker for Crypto Operations
  const cryptoWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Initialize Web Worker exactly once
    cryptoWorkerRef.current = new Worker(new URL('../workers/cryptography.worker.ts', import.meta.url), { type: 'module' });
    return () => {
      cryptoWorkerRef.current?.terminate();
    };
  }, []);

  const decryptRowsAsync = useCallback(async (rows: ReadonlyArray<any>, myKeyPair: { secretKey: Uint8Array, publicKey: Uint8Array } | null | undefined, partnerKey: string | null | undefined, keyHistory?: string[]): Promise<ChatMessage[]> => {
    return new Promise((resolve) => {
      if (!cryptoWorkerRef.current || !myKeyPair || rows.length === 0) {
        // Fallback or empty
        resolve(rows.map(row => ({
          ...row,
          decrypted_content: '⚠️ Could not decrypt this message',
          is_mine: row.sender_id === user?.id,
          decryption_error: true
        })));
        return;
      }

      // Generate a batch ID
      const reqIds = rows.map(() => Math.random().toString(36).substring(7));
      const payload = rows.map((row, i) => ({
        id: reqIds[i],
        row,
        mySecretKey: myKeyPair.secretKey,
        partnerKey,
        keyHistory,
        userId: user?.id
      }));

      const onMessage = (e: MessageEvent) => {
        if (e.data.type === 'batch_complete') {
          // Check if this batch belongs to our request
          if (e.data.results.some((r: any) => r.id === reqIds[0])) {
            cryptoWorkerRef.current?.removeEventListener('message', onMessage);
            const resultDict = e.data.results.reduce((acc: any, r: any) => {
              acc[r.id] = r;
              return acc;
            }, {});

            const finalMessages = rows.map((row, i) => {
              const res = resultDict[reqIds[i]];
              return {
                ...row,
                decrypted_content: res.decrypted_content,
                is_mine: res.is_mine,
                decryption_error: res.decryption_error
              };
            });
            resolve(finalMessages);
          }
        }
      };

      cryptoWorkerRef.current.addEventListener('message', onMessage);
      cryptoWorkerRef.current.postMessage({ type: 'decrypt_batch', payload });
    });
  }, [user?.id]);

  // Decrypts a single message row — correctly uses per-message sender_public_key when available
  const decryptRow = useCallback((row: any, myKeyPair: { secretKey: Uint8Array, publicKey: Uint8Array } | null | undefined, partnerKey: string | null | undefined, keyHistory?: string[]): ChatMessage => {
    const isMine = row.sender_id === user?.id;
    let decryptedText = '';
    let decryptionError = false;

    if (row.is_deleted_for_everyone) {
      decryptedText = 'This message was deleted';
    } else if (partnerKey && myKeyPair && row.encrypted_content && row.nonce) {
      try {
        // NaCl box decryption: nacl.box.open(cipher, nonce, theirPublicKey, mySecretKey)
        const decryptionKey = isMine
          ? partnerKey!
          : (row.sender_public_key || partnerKey!);

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
    } else if (partnerKey && myKeyPair) {
      decryptedText = ''; // No content to decrypt (e.g. media without caption)
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

  // Fix 1.1: Flush pending messages with exponential backoff + max retry limit
  useEffect(() => {
    if (!isOnline || pendingMessages.length === 0) return;

    let mounted = true;
    const flush = async () => {
      const toSend = [...pendingMessages];

      for (const msg of toSend) {
        if (!mounted) break;
        try {
          const { error } = await supabase.from('messages').insert({
            id: msg.id,
            sender_id: msg.sender_id,
            receiver_id: msg.receiver_id,
            encrypted_content: msg.encrypted_content,
            nonce: msg.nonce,
            type: msg.type as any,
            media_url: msg.media_url,
            media_key: msg.media_key,
            media_nonce: msg.media_nonce,
            reply_to: msg.reply_to,
            sender_public_key: msg.sender_public_key,
          });

          if (!error) {
            setPendingMessages(prev => prev.filter(p => p.id !== msg.id));
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_pending: false, retry_count: 0 } : m));
          } else {
            // Fix 1.1: Increment retry count, mark as failed after MAX_SEND_RETRIES
            const retries = (msg.retry_count || 0) + 1;
            if (retries >= MAX_SEND_RETRIES) {
              setPendingMessages(prev => prev.filter(p => p.id !== msg.id));
              setMessages(prev => prev.map(m =>
                m.id === msg.id ? { ...m, is_pending: false, is_send_failed: true } : m
              ));
            } else {
              setPendingMessages(prev => prev.map(p =>
                p.id === msg.id ? { ...p, retry_count: retries } : p
              ));
            }
          }
        } catch (err) {
          console.error('Failed to flush pending message', msg.id, err);
        }
      }
    };

    // Fix 1.1: Exponential backoff — 3s, 6s, 12s, 24s, 48s max
    const maxRetry = Math.max(...pendingMessages.map(m => m.retry_count || 0));
    const delay = Math.min(3000 * Math.pow(2, maxRetry), 60_000);
    const timer = setTimeout(flush, delay);
    return () => {
      mounted = false;
      clearTimeout(timer);
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
       : decryptRow(row as any, myKeyPair, partnerPublicKey || partnerKeyRef.current, partnerKeyHistoryRef.current)
    ));
  }, [partnerPublicKey, encryptionStatus]);

  useEffect(() => {
    if (!user || !partnerId) return;

    const fetchMissedUpdates = async () => {
      try {
        // Fetch status updates for MY messages that aren't marked as read yet
        const unreadMyMessagesIds = messagesRef.current.filter(m => m.is_mine && !m.is_read).map(m => m.id);
        if (unreadMyMessagesIds.length === 0) return;

        const { data, error } = await supabase
          .from('messages')
          .select('id,is_read,is_delivered,read_at,delivered_at,reaction,is_edited,encrypted_content,nonce,sender_public_key,is_deleted_for_sender,is_deleted_for_receiver,updated_at')
          .in('id', unreadMyMessagesIds);

        if (!error && data) {
          const myKeyPair = getStoredKeyPair();
          const currentPartnerKey = partnerKeyRef.current;
          const currentKeyHistory = partnerKeyHistoryRef.current;

          setMessages(prev => prev.map(m => {
            const update = data.find(d => d.id === m.id);
            if (!update) return m;

            // If content changed (edit), re-decrypt
            if (update.is_edited && update.encrypted_content !== m.encrypted_content) {
              return decryptRow(update as any, myKeyPair, currentPartnerKey, currentKeyHistory);
            }

            return { ...m, ...update };
          }));
        }
      } catch (err) {
        console.error('Failed to sync missed updates', err);
      }
    };

    const fetchMissedMessages = async () => {
      if (!lastMessageTimeRef.current) return;
      const myKeyPair = getStoredKeyPair();
      const currentPartnerKey = partnerKeyRef.current;
      const currentKeyHistory = partnerKeyHistoryRef.current;
      
      try {
        const { data, error } = await supabase
          .from('messages')
          .select(MSG_COLUMNS)
          .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`)
          .gt('created_at', lastMessageTimeRef.current)
          .order('created_at', { ascending: true });

        if (error) throw error;

        if (data && data.length > 0) {
          let newMessages: ChatMessage[] = [];
          if (myKeyPair) {
            newMessages = await decryptRowsAsync(data, myKeyPair, currentPartnerKey, currentKeyHistory);
          } else {
            newMessages = data.map(row => ({ ...row, is_mine: row.sender_id === user.id }));
          }
          
          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const uniqueNew = newMessages.filter(m => !existingIds.has(m.id));
            if (uniqueNew.length === 0) return prev;
            return [...prev, ...uniqueNew];
          });
          
          const undeliveredIds = data.filter(m => m.sender_id === partnerId && !m.is_delivered).map(m => m.id);
          if (undeliveredIds.length > 0) {
            await supabase.from('messages').update({ is_delivered: true, delivered_at: new Date().toISOString() }).in('id', undeliveredIds);
          }
        }
        
        // Also fetch status updates for existing messages
        fetchMissedUpdates();
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
          .select(MSG_COLUMNS)
          .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${user.id})`)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE);

        if (error) throw error;

        if (myKeyPair && data) {
          // Reverse data because we fetched most recent but want to display ascending
          const sortedData = [...data].reverse();
          const decrypted = await decryptRowsAsync(sortedData, myKeyPair, currentPartnerKey, currentKeyHistory);
          setMessages(decrypted);
          setHasMore(data.length === PAGE_SIZE);

          // Find first unread from partner
          const firstUnread = decrypted.find(m => !m.is_mine && !m.is_read);
          if (firstUnread) {
            setFirstUnreadId(firstUnread.id);
          }

          // Mark undelivered messages from partner as delivered
          const undeliveredIds = data.filter(m => m.sender_id === partnerId && !m.is_delivered).map(m => m.id);
          if (undeliveredIds.length > 0) {
            await supabase.from('messages').update({ is_delivered: true, delivered_at: new Date().toISOString() }).in('id', undeliveredIds);
          }
        } else {
          setMessages((data || []).map(row => ({ ...row, is_mine: row.sender_id === user.id })));
        }

        // Fetch pinned messages
        const { data: pinnedData } = await supabase
          .from('pinned_messages')
          .select('id,message_id,pinned_by,created_at');
        if (pinnedData) {
          setPinnedMessages(pinnedData);
        }

      } finally {
        setDataLoading(false);
      }
    };

    fetchMessages();

    // ═══ Use RealtimeHub instead of creating a separate channel ═══

    // Fix 2.3: Realtime subscription for pinned_messages changes
    const unsubPins = realtimeHub.on('pinned_messages', (payload) => {
      if (payload.eventType === 'INSERT') {
        const newPin = payload.new as Database['public']['Tables']['pinned_messages']['Row'];
        setPinnedMessages(prev => {
          if (prev.some(p => p.id === newPin.id)) return prev; // Dedup guard
          return [...prev, newPin];
        });
      } else if (payload.eventType === 'DELETE') {
        const oldPin = payload.old as any;
        if (oldPin?.id) {
          setPinnedMessages(prev => prev.filter(p => p.id !== oldPin.id));
        }
      }
    });

    const unsubMessages = realtimeHub.on('messages', (payload) => {
      const myKeyPair = getStoredKeyPair();
      const currentPartnerKey = partnerKeyRef.current;
      const currentKeyHistory = partnerKeyHistoryRef.current;
      if (!myKeyPair) return;

      const row = payload.new as any;
      const oldRow = payload.old as any;

      // Client-side filter: only care about messages between us
      if (payload.eventType !== 'DELETE') {
        if (row.sender_id !== user.id && row.sender_id !== partnerId) return;
        if (row.receiver_id !== user.id && row.receiver_id !== partnerId) return;
      }

      if (payload.eventType === 'INSERT') {
        const newMsg = decryptRow(row as MessageRow, myKeyPair, currentPartnerKey, currentKeyHistory);
        
        if (row.sender_id === user.id) {
          setMessages((prev) => {
            const exists = prev.find(m => m.id === newMsg.id);
            if (exists) {
              return prev.map(m => m.id === newMsg.id ? { ...m, ...newMsg, is_pending: false } : m);
            }
            return [...prev, newMsg];
          });
          setPendingMessages(prev => prev.filter(m => m.id !== newMsg.id));
        } else {
          setMessages((prev) => {
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          supabase.from('messages').update({ is_delivered: true, delivered_at: new Date().toISOString() }).eq('id', newMsg.id).then();
        }
      } else if (payload.eventType === 'UPDATE') {
        setMessages((prev) => prev.map(m => {
          if (m.id !== row.id) return m;
          const mergedRow = { ...m, ...row } as MessageRow;
          if (row.is_edited && row.encrypted_content) {
            return decryptRow(mergedRow, myKeyPair, currentPartnerKey, currentKeyHistory);
          }
          return { ...m, ...row };
        }));
      } else if (payload.eventType === 'DELETE') {
        setMessages((prev) => prev.filter(m => m.id !== oldRow?.id));
      }
    });

    // Gap-fill on visibility/online change (no channel management needed — hub handles it)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchMissedMessages();
      }
    };

    const handleOnlineEvent = () => {
      fetchMissedMessages();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnlineEvent);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnlineEvent);
      
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      unsubMessages();
      unsubPins(); // Fix 2.3: cleanup pinned_messages subscription
    };
  // ══ CRITICAL: encryptionStatus was REMOVED from deps ══
  // Having it here caused the entire effect (fetchMessages + channel subscribe)
  // to re-run whenever encryption readiness changed — this would:
  // 1. Re-fetch only the latest 10 messages, wiping 100+ loaded messages
  // 2. Destroy and recreate the realtime channel
  // Encryption readiness is handled by the separate re-decrypt effect below.
  }, [user?.id, partnerId]);

  // Fetch missing pinned message details
  // ══ FIXED: Removed `messages` and `pinnedMessageDetails` from deps ══
  // Having them caused this effect to fire on every message change (new msg, status update, etc.),
  // triggering unnecessary DB fetches and cascading re-renders.
  // We use refs to check current state without creating dependencies.
  useEffect(() => {
    if (!pinnedMessages || pinnedMessages.length === 0) return;
    
    const currentMessages = messagesRef.current;
    // Find message IDs that are NOT currently loaded AND NOT already fetched
    const missingIds = pinnedMessages
      .map(p => p.message_id)
      .filter(id => !currentMessages.find(m => m.id === id) && !pinnedMessageDetailsRef.current[id]);

    if (missingIds.length === 0) return;

    const fetchDetails = async () => {
      try {
        const { data, error } = await supabase
          .from('messages')
          .select(MSG_COLUMNS)
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
  }, [pinnedMessages, decryptRow]);

  // ═══════════════════════════════════════════════════════════════════════
  // REPLY MESSAGE CACHE — Two-Layer Strategy (EGRESS-OPTIMIZED)
  // ═══════════════════════════════════════════════════════════════════════
  //
  // LAYER 1 — Proactive In-Memory Cache (ZERO egress)
  //   Every time `messages` changes, scan for messages that are reply targets.
  //   Cache them NOW so they persist when they paginate out later.
  //   Example: Messages [A, B(reply→A), C] — A gets cached immediately.
  //   When user scrolls down and A unloads, the cache still has it.
  //
  // LAYER 2 — DB Fetch for Truly Missing Messages (at most 1 fetch per ID)
  //   If a reply target was NEVER in the loaded window (e.g., reply to a
  //   message from weeks ago), fetch it once from DB.
  //   `replyFetchAttemptedRef` ensures no duplicate fetches.
  //
  // Total egress cost: O(N) where N = unique reply targets not already
  // in any loaded page. For typical usage: ≈0–5 small fetches per session.
  // ═══════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (messages.length === 0) return;

    const currentMessages = messagesRef.current;
    const currentCache = replyMessageCacheRef.current;
    const attempted = replyFetchAttemptedRef.current;

    // ─── LAYER 1: Pre-cache loaded messages that are reply targets ───
    // Collect all reply_to IDs from currently loaded messages
    const replyTargetIds = new Set(
      messages
        .map(m => m.reply_to)
        .filter((id): id is string => !!id)
    );

    // For each reply target that IS in the loaded window, cache it proactively
    // (no DB call needed — the data is right here in memory)
    if (replyTargetIds.size > 0) {
      const newProactiveEntries: Record<string, ChatMessage> = {};
      for (const targetId of replyTargetIds) {
        if (currentCache[targetId]) continue; // Already cached
        const loadedMsg = currentMessages.find(m => m.id === targetId);
        if (loadedMsg) {
          newProactiveEntries[targetId] = loadedMsg;
          attempted.add(targetId); // Mark as handled so Layer 2 skips it
        }
      }
      if (Object.keys(newProactiveEntries).length > 0) {
        setReplyMessageCache(prev => ({ ...prev, ...newProactiveEntries }));
      }
    }

    // ─── LAYER 2: Fetch truly missing reply targets from DB ───
    const missingReplyIds = Array.from(replyTargetIds).filter(id =>
      !currentMessages.find(m => m.id === id) &&
      !currentCache[id] &&
      !attempted.has(id)
    );

    if (missingReplyIds.length === 0) return;

    // Mark ALL ids as attempted SYNCHRONOUSLY before the async fetch.
    // Prevents duplicate fetches even if the effect fires again
    // (due to a realtime tick) before the first fetch resolves.
    missingReplyIds.forEach(id => attempted.add(id));

    const fetchReplyMessages = async () => {
      try {
        const { data, error } = await supabase
          .from('messages')
          .select(MSG_COLUMNS)
          .in('id', missingReplyIds);

        if (error) throw error;

        if (data && data.length > 0) {
          const myKeyPair = getStoredKeyPair();
          const currentPartnerKey = partnerKeyRef.current;
          const currentKeyHistory = partnerKeyHistoryRef.current;

          const newEntries: Record<string, ChatMessage> = {};
          for (const row of data) {
            const decrypted = decryptRow(row, myKeyPair, currentPartnerKey, currentKeyHistory);
            newEntries[row.id] = decrypted;
          }

          setReplyMessageCache(prev => ({ ...prev, ...newEntries }));
        }
      } catch (err) {
        console.error('Error fetching reply messages:', err);
        // On error, remove from attempted so retry is possible
        missingReplyIds.forEach(id => attempted.delete(id));
      }
    };

    fetchReplyMessages();
  }, [messages, decryptRow]);

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
      thumbnail_url: null,
      file_name: null,
      file_size: null,
      duration: null,
      reaction: null,
      reply_to: replyToId || null,
      is_read: false,
      is_delivered: false,
      is_edited: false,
      is_deleted_for_sender: false,
      is_deleted_for_receiver: false,
      is_deleted_for_everyone: false,
      read_at: null,
      delivered_at: null,
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
        type: optimisticMsg.type as any,
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
        setPendingMessages(prev => [...prev, { ...optimisticMsg, retry_count: 0 }]);
      } else {
        // Fix 1.1: Non-network errors = permanent failure, show failed state
        setMessages(prev => prev.map(m =>
          m.id === optimisticMsg.id ? { ...m, is_pending: false, is_send_failed: true } : m
        ));
      }
    } else {
      // Trigger Web Push Notification asynchronously with a 5s debounce
      // This prevents rapid message bursts from triggering Chrome's spam detection.
      const existingTimer = pushDebounceTimers.get(partnerId);
      if (existingTimer) clearTimeout(existingTimer);
      
      const newTimer = setTimeout(async () => {
        // Fix 1.3: Guard — verify message is still in sent state (not failed) before pushing
        const stillValid = messagesRef.current.find(
          m => m.id === optimisticMsg.id && !m.is_send_failed && !m.is_pending
        );
        if (!stillValid) {
          pushDebounceTimers.delete(partnerId);
          return;
        }
        try {
          // Ensure session is fresh — prevents 401 on expired JWT
          const { data: { session: freshSession } } = await supabase.auth.getSession();
          if (freshSession) {
            await supabase.functions.invoke('send-push', {
              body: { 
                record: { 
                  id: optimisticMsg.id,
                  sender_id: user.id,
                  receiver_id: partnerId,
                } 
              }
            });
          }
        } catch {
          // Push notifications are best-effort — silently ignore failures
        }
        pushDebounceTimers.delete(partnerId);
      }, 5000);
      
      pushDebounceTimers.set(partnerId, newTimer);
    }
  };

  const addOptimisticMediaMessage = (text: string, localMediaUrl: string, type: string, replyToId?: string): string => {
    if (!user || !partnerId) return '';
    const tempId = crypto.randomUUID();
    const optimisticMsg: ChatMessage = {
      id: tempId,
      sender_id: user.id,
      receiver_id: partnerId,
      encrypted_content: '', // Will be filled later
      nonce: '',
      type: type as any,
      media_url: localMediaUrl, // temporary local url proxy
      decrypted_media_url: localMediaUrl,
      media_key: null,
      media_nonce: null,
      thumbnail_url: null,
      file_name: null,
      file_size: null,
      duration: null,
      reaction: null,
      reply_to: replyToId || null,
      is_read: false,
      is_delivered: false,
      is_edited: false,
      is_deleted_for_sender: false,
      is_deleted_for_receiver: false,
      is_deleted_for_everyone: false,
      read_at: null,
      delivered_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sender_public_key: '', 
      decrypted_content: text,
      is_mine: true,
      is_pending: true,
      is_uploading: true, // Show loading UI
    };
    setMessages(prev => [...prev, optimisticMsg]);
    return tempId;
  };

  const commitOptimisticMediaMessage = async (
    tempId: string, 
    text: string, 
    media: { url: string, media_key: string, media_nonce: string, type: string }, 
    replyToId?: string
  ) => {
    if (!user || !partnerId) return;

    const myKeyPair = getStoredKeyPair();
    if (!myKeyPair || !partnerPublicKey) {
      console.error('Missing encryption keys!');
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, is_uploading: false, is_send_failed: true } : m));
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

    setMessages(prev => prev.map(m => 
      m.id === tempId ? { 
        ...m, 
        encrypted_content: ciphertext,
        nonce,
        media_url: media.url,
        media_key: media.media_key,
        media_nonce: media.media_nonce,
        sender_public_key: myPublicKeyStr,
        is_uploading: false,
        is_pending: !isOnline
      } : m
    ));

    if (!isOnline) {
      const msg = messagesRef.current.find(m => m.id === tempId);
      if (msg) setPendingMessages(prev => [...prev, msg]);
      return;
    }

    const { error } = await supabase
      .from('messages')
      .insert({
        id: tempId,
        sender_id: user.id,
        receiver_id: partnerId,
        encrypted_content: ciphertext,
        nonce: nonce,
        type: media.type,
        media_url: media.url,
        media_key: media.media_key,
        media_nonce: media.media_nonce,
        reply_to: replyToId || null,
        sender_public_key: myPublicKeyStr,
      });

    if (error) {
      console.error('Failed to commit media message', error);
      if (error.message?.includes('fetch') || error.code === 'PGRST301') {
        const msg = messagesRef.current.find(m => m.id === tempId);
        if (msg) {
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, is_pending: true } : m));
          setPendingMessages(prev => [...prev, { ...msg, retry_count: 0 }]);
        }
      } else {
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, is_pending: false, is_send_failed: true } : m));
      }
    } else {
      const existingTimer = pushDebounceTimers.get(partnerId);
      if (existingTimer) clearTimeout(existingTimer);
      
      const newTimer = setTimeout(async () => {
        const stillValid = messagesRef.current.find(m => m.id === tempId && !m.is_send_failed && !m.is_pending);
        if (!stillValid) return;
        try {
          const { data: { session: freshSession } } = await supabase.auth.getSession();
          if (freshSession) {
             await supabase.functions.invoke('send-push', { body: { record: { id: tempId, sender_id: user.id, receiver_id: partnerId } } });
          }
        } catch {}
      }, 5000);
      pushDebounceTimers.set(partnerId, newTimer);
    }
  };

  /**
   * addChunkedVideoMessage
   * Creates an optimistic video message bubble immediately.
   * The bubble shows a thumbnail with a shimmer overlay and animated status text.
   * Returns the tempId so the caller can update status or commit later.
   */
  const addChunkedVideoMessage = (
    thumbnailLocalUrl: string,
    replyToId?: string
  ): string => {
    const tempId = crypto.randomUUID();
    const optimisticMsg: ChatMessage = {
      id: tempId,
      sender_id: user?.id || '',
      receiver_id: partnerId || '',
      encrypted_content: '',
      nonce: '',
      type: 'video' as any,
      media_url: null,
      decrypted_media_url: thumbnailLocalUrl,
      media_key: null,
      media_nonce: null,
      thumbnail_url: null,
      file_name: null,
      file_size: null,
      duration: null,
      reaction: null,
      reply_to: replyToId || null,
      is_read: false,
      is_delivered: false,
      is_edited: false,
      is_deleted_for_sender: false,
      is_deleted_for_receiver: false,
      is_deleted_for_everyone: false,
      read_at: null,
      delivered_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sender_public_key: '',
      decrypted_content: '',
      is_mine: true,
      is_uploading: true,
      is_chunked_video: true,
      chunk_upload_status: 'Preparing...',
      thumbnail_local_url: thumbnailLocalUrl,
    };
    setMessages(prev => [...prev, optimisticMsg]);
    return tempId;
  };

  /**
   * updateChunkStatus
   * Updates the animated status text shown on the video thumbnail shimmer overlay.
   */
  const updateChunkStatus = (tempId: string, status: string) => {
    setMessages(prev =>
      prev.map(m => m.id === tempId ? { ...m, chunk_upload_status: status } : m)
    );
  };

  /**
   * commitChunkedVideoMessage
   * Inserts the message into Supabase once the thumbnail is uploaded.
   * media_url stays NULL — chunks live in video_chunks table.
   * Once done, clears is_uploading so the shimmer fades (receiver gets chunk notifications separately).
   */
  const commitChunkedVideoMessage = async (
    tempId: string,
    thumbResult: { url: string; key: string; nonce: string } | null,
    replyToId?: string
  ) => {
    if (!user || !partnerId || !partnerPublicKey) return;
    const myKeyPair = getStoredKeyPair();
    if (!myKeyPair) return;

    const myPublicKeyStr = encodeBase64(myKeyPair.publicKey);

    // Update local state: replace thumbnail placeholder
    setMessages(prev =>
      prev.map(m =>
        m.id === tempId
          ? { 
              ...m, 
              thumbnail_url: thumbResult?.url || null, 
              media_key: thumbResult?.key || null,
              media_nonce: thumbResult?.nonce || null,
              sender_public_key: myPublicKeyStr 
            }
          : m
      )
    );

    const { error } = await supabase.from('messages').insert({
      id: tempId,
      sender_id: user.id,
      receiver_id: partnerId,
      encrypted_content: '',
      nonce: '',
      type: 'video',
      media_url: null,          // intentionally null — chunks in video_chunks
      media_key: thumbResult?.key || null,
      media_nonce: thumbResult?.nonce || null,
      thumbnail_url: thumbResult?.url || null,
      reply_to: replyToId || null,
      sender_public_key: myPublicKeyStr,
    });

    if (error) {
      console.error('[ChunkedVideo] Failed to commit message:', error);
      setMessages(prev =>
        prev.map(m => m.id === tempId ? { ...m, is_send_failed: true, is_uploading: false } : m)
      );
    }
  };

  /**
   * finalizeChunkedVideoMessage
   * Called when all chunks are uploaded. Clears the shimmer overlay for the sender.
   */
  const finalizeChunkedVideoMessage = (tempId: string) => {
    setMessages(prev =>
      prev.map(m =>
        m.id === tempId
          ? { ...m, is_uploading: false, is_chunked_video: false, chunk_upload_status: undefined }
          : m
      )
    );
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
      const msg = messagesRef.current.find(m => m.id === messageId);
      const isSender = msg?.sender_id === user?.id;
      const deleteField = isSender ? 'is_deleted_for_sender' : 'is_deleted_for_receiver';
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, [deleteField]: true } : m));
      await supabase.from('messages').update({ [deleteField]: true }).eq('id', messageId);
    }
  };

  const markAsRead = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) return;
    
    // Optimistic update
    const readAtIso = new Date().toISOString();
    setMessages(prev => prev.map(m => messageIds.includes(m.id) ? { ...m, is_read: true, is_delivered: true, read_at: readAtIso } : m));
    
    const { error } = await supabase
      .from('messages')
      .update({ 
        is_read: true, 
        is_delivered: true, 
        read_at: new Date().toISOString() 
      })
      .in('id', messageIds);
      
    if (error) {
      console.error('Failed to mark messages as read', error);
    }
  }, []);

  const pinMessage = async (messageId: string): Promise<{ success: boolean; reason?: 'max_pins' }> => {
    if (!user) return { success: false };
    // Check if this message is already pinned by anyone (not just user)
    const existing = pinnedMessages.find(p => p.message_id === messageId);
    if (existing) {
      // Unpin: only the person who pinned it can unpin (or allow both for 2-person app)
      setPinnedMessages(prev => prev.filter(p => p.id !== existing.id));
      await supabase.from('pinned_messages').delete().eq('id', existing.id);
      return { success: true };
    } else {
      // Fix 2.4: Enforce maximum of 3 pins
      if (pinnedMessages.length >= 3) {
        return { success: false, reason: 'max_pins' };
      }
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
      return { success: true };
    }
  };

  // ══ FIXED: Removed `messages` from deps ══
  // Having `messages` here means loadMore gets a new identity on every single message
  // state change, which causes MobileChatScreen's effects that depend on loadMore to
  // re-fire, creating cascading re-renders and potentially re-triggering scroll loading.
  // We use messagesRef.current instead to get the oldest timestamp.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !user || !partnerId) return;

    setLoadingMore(true);
    const myKeyPair = getStoredKeyPair();
    const currentPartnerKey = partnerKeyRef.current;
    const currentKeyHistory = partnerKeyHistoryRef.current;
    
    // Use ref instead of messages array to avoid dependency
    const currentMessages = messagesRef.current;
    const oldestTimestamp = currentMessages.length > 0 ? currentMessages[0].created_at : null;
    if (!oldestTimestamp) {
      setLoadingMore(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('messages')
        .select(MSG_COLUMNS)
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
  }, [user?.id, partnerId, loadingMore, hasMore, decryptRow]);

  return { 
    messages, 
    pinnedMessages,
    pinnedMessageDetails,
    replyMessageCache,
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
    isOnline,
    addOptimisticMediaMessage,
    commitOptimisticMediaMessage,
    addChunkedVideoMessage,
    updateChunkStatus,
    commitChunkedVideoMessage,
    finalizeChunkedVideoMessage,
  };
}
