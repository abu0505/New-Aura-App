/**
 * useVideoChunks.ts
 *
 * Receiver-side hook: subscribes to the video_chunks table via realtimeHub,
 * collects chunks as they arrive, and decrypts them so ChunkedVideoPlayer
 * can start playing the first chunk immediately while later ones buffer.
 *
 * Bug fixes applied:
 *  - loadingSet: prevents double-loading race condition when ChatBubble re-renders
 *    before the first loadExistingChunks resolves.
 *  - Use partner.public_key instead of row.sender_public_key (column doesn't exist in video_chunks).
 */

import { useEffect, useCallback, useState } from 'react';
import { realtimeHub } from '../lib/realtimeHub';
import { useAuth } from '../contexts/AuthContext';
import { useMedia } from './useMedia';
import { usePartner } from './usePartner';

export interface ReceivedChunk {
  chunkIndex: number;
  totalChunks: number;
  blobUrl: string | null; // null = still decrypting
  isDecrypted: boolean;
  duration?: number;
}

type ChunkMap = Map<string, ReceivedChunk[]>;

// Module-level shared state — persists across hook re-mounts in the same session
const chunkStore: ChunkMap = new Map();
const loadingSet = new Set<string>(); // tracks in-progress loadExistingChunks calls
const updateCallbacks = new Set<() => void>();
let notifyTimeout: any = null;
function notifyAll() {
  if (notifyTimeout) return;
  notifyTimeout = setTimeout(() => {
    notifyTimeout = null;
    console.log('[CHUNK_STORE] notifyAll (throttled)', { subscriberCount: updateCallbacks.size });
    for (const cb of updateCallbacks) cb();
  }, 100); // Max 10 updates per second
}

function getSafeTotal(total: number, index: number = 0): number {
  if (!isFinite(total) || total <= 0) return Math.max(index + 1, 1);
  return Math.min(total, 1000); // Cap at 1000 chunks
}

export function addLocalChunkForSender(messageId: string, chunkIndex: number, totalChunks: number, blob: Blob, duration?: number) {
  let chunks = chunkStore.get(messageId);
  
  const safeTotal = getSafeTotal(totalChunks, chunkIndex);

  if (!chunks) {
    chunks = Array.from({ length: safeTotal }, (_, i) => ({
      chunkIndex: i,
      totalChunks: safeTotal,
      blobUrl: null,
      isDecrypted: false,
    }));
  }
  
  // If the array is too small (e.g. estimate was wrong), expand it
  if (chunkIndex >= chunks.length) {
    const additional = Array.from({ length: chunkIndex - chunks.length + 1 }, (_, i) => ({
      chunkIndex: chunks!.length + i,
      totalChunks: safeTotal,
      blobUrl: null,
      isDecrypted: false,
    }));
    chunks = [...chunks, ...additional];
  }

  chunks[chunkIndex] = {
    chunkIndex: chunkIndex,
    totalChunks: safeTotal,
    blobUrl: URL.createObjectURL(blob),
    isDecrypted: true,
    duration: duration,
  };
  chunkStore.set(messageId, [...chunks]);
  notifyAll();
}

export function updateTotalChunksForSender(messageId: string, total: number) {
  let chunks = chunkStore.get(messageId);
  if (chunks) {
    if (chunks.length > total) {
      const newChunks = chunks.slice(0, total).map(c => ({ ...c, totalChunks: total }));
      chunkStore.set(messageId, newChunks);
      notifyAll();
    }
  }
}

export function useVideoChunks(messageId?: string) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();
  const [chunks, setChunks] = useState<ReceivedChunk[]>([]);

  // Register update listener so consuming components can re-render when chunks arrive
  useEffect(() => {
    const update = () => {
      if (messageId) {
        const c = chunkStore.get(messageId);
        if (c) setChunks([...c]);
      }
    };
    
    update(); // initial load
    updateCallbacks.add(update);
    return () => { updateCallbacks.delete(update); };
  }, [messageId]);

  // ── Subscribe to realtime video_chunks inserts ──────────────────────────
  useEffect(() => {
    if (!user?.id || !partner?.id) return;

    const unsubscribe = realtimeHub.on('video_chunks', async (payload) => {
      if (payload.eventType !== 'INSERT') return;
      const row = payload.new as any;
      
      


      // Only process chunks addressed to me
      if (row.receiver_id !== user.id) {
        return;
      }

      const msgId: string = row.message_id;
      const chunkIndex: number = row.chunk_index;
      const totalChunks: number = row.total_chunks;

      const safeTotal = getSafeTotal(totalChunks, chunkIndex);

      // Initialize chunk array for this message if needed
      if (!chunkStore.has(msgId)) {
        const placeholders: ReceivedChunk[] = Array.from({ length: safeTotal }, (_, i) => ({
          chunkIndex: i,
          totalChunks: safeTotal,
          blobUrl: null,
          isDecrypted: false,
        }));
        chunkStore.set(msgId, placeholders);
      }

      // Use partner.public_key — video_chunks table does NOT have sender_public_key column
      const partnerKey = partner?.public_key;
      if (!partnerKey) {

        return;
      }



      const blob = await getDecryptedBlob(
        row.chunk_url,
        row.chunk_key,
        row.chunk_nonce,
        partnerKey,
        undefined, // senderPublicKey not in video_chunks table
        undefined,
        'video'
      );



      const chunks = chunkStore.get(msgId);
      if (!chunks) return;

      const blobUrl = blob ? URL.createObjectURL(blob) : null;
      chunks[chunkIndex] = {
        chunkIndex,
        totalChunks,
        blobUrl,
        isDecrypted: true,
        duration: row.duration ?? undefined,
      };

      chunkStore.set(msgId, [...chunks]);
      notifyAll();
    });

    return () => unsubscribe();
  }, [user?.id, partner?.id, partner?.public_key, getDecryptedBlob]);

  /**
   * Returns the chunks received so far for a given message ID.
   * Returns null if no chunks have been received yet.
   */
  const getChunksForMessage = useCallback((messageId: string): ReceivedChunk[] | null => {
    return chunkStore.get(messageId) ?? null;
  }, []);

  /**
   * Pre-populates the chunk store from existing video_chunks rows
   * (for when the receiver opens the chat after all chunks were already sent,
   * OR when the sender opens their own sent video after page reload).
   *
   * Bug fix: uses `loadingSet` to prevent double-loading when ChatBubble
   * re-renders before the first call resolves.
   */
  const loadExistingChunks = useCallback(async (
    messageId: string,
    rows: { chunk_index: number; total_chunks: number; chunk_url: string; chunk_key: string; chunk_nonce: string; duration?: number }[],
    partnerPublicKey: string,
    _senderPublicKey?: string | null  // reserved for future use, currently unused
  ) => {
    // Guard: allow re-loading if existing chunks aren't decrypted (e.g., stuck placeholders)
    const existing = chunkStore.get(messageId);
    if (existing && existing.some(c => c.isDecrypted && c.blobUrl)) {
      return;
    }
    if (loadingSet.has(messageId)) {
      return;
    }
    loadingSet.add(messageId);

    try {
      if (!rows.length) return;

      const totalChunks = rows[0]?.total_chunks ?? rows.length;
      const safeTotal = getSafeTotal(totalChunks, rows.length);

      const placeholders: ReceivedChunk[] = Array.from({ length: safeTotal }, (_, i) => ({
        chunkIndex: i,
        totalChunks: safeTotal,
        blobUrl: null,
        isDecrypted: false,
      }));
      chunkStore.set(messageId, placeholders);
      notifyAll();

      // Decrypt chunks in parallel batches for much faster loading on slow networks
      const PARALLEL_DOWNLOADS = 5;
      for (let i = 0; i < rows.length; i += PARALLEL_DOWNLOADS) {
        const batch = rows.slice(i, i + PARALLEL_DOWNLOADS);
        
        // We use Promise.all to wait for the batch, but notice that we update the UI
        // INDIVIDUALLY the exact millisecond a chunk finishes, allowing instant play.
        await Promise.all(batch.map(async (row) => {
          const blob = await getDecryptedBlob(
            row.chunk_url,
            row.chunk_key,
            row.chunk_nonce,
            partnerPublicKey,
            undefined,
            undefined,
            'video'
          );



          const chunks = chunkStore.get(messageId);
          if (!chunks) return;

          const blobUrl = blob ? URL.createObjectURL(blob) : null;
          chunks[row.chunk_index] = {
            chunkIndex: row.chunk_index,
            totalChunks: row.total_chunks,
            blobUrl,
            isDecrypted: true,
            duration: row.duration,
          };
          chunkStore.set(messageId, [...chunks]);
          notifyAll();
        }));
      }

    } catch (err) {
      console.error(`[useVideoChunks] Error loading chunks for ${messageId}:`, err);
    } finally {
      loadingSet.delete(messageId);
    }
  }, [getDecryptedBlob]);

  /**
   * Returns true if a message should use the chunked video player.
   * A chunked video has type='video' but media_url is null (chunks stored in video_chunks table).
   */
  const isChunkedVideo = useCallback((msg: { type?: string | null; media_url?: string | null }): boolean => {
    return msg.type === 'video' && !msg.media_url;
  }, []);

  return { chunks, getChunksForMessage, loadExistingChunks, isChunkedVideo };
}
