/**
 * useVideoChunks.ts  —  v4: Per-Block Decrypt + MSE Streaming
 *
 * ARCHITECTURE EVOLUTION:
 *   v1/v2 (broken): FFmpeg segment → naive MP4 concatenation → browser stops after first moov.
 *   v3 (wait-all):  Whole-file encrypt → byte chunks → wait for ALL → decrypt once → play.
 *                   Correct playback but LONG wait on large videos.
 *   v4 (streaming): Per-block encrypt (unique nonce per block) → each block independently
 *                   decryptable → feed into MediaSource Extensions as blocks arrive →
 *                   YouTube-style: video starts playing after first few blocks land.
 *
 * KEY INSIGHT — Why per-block nonce enables streaming:
 *   NaCl secretbox is an AEAD cipher: it verifies a MAC over the WHOLE message.
 *   You cannot decrypt a partial secretbox ciphertext — MAC check will fail.
 *   Solution: each 5MB block is encrypted with its OWN nonce:
 *     blockNonce_i = baseNonce XOR i   (last 4 bytes)
 *   So block i can be downloaded + decrypted independently → MSE can receive it.
 *
 * SENDER (useMedia.ts):
 *   - splits plaintext into 5MB blocks
 *   - encrypts each block with deriveBlockNonce(baseNonce, i)
 *   - uploads block i → IMMEDIATELY inserts DB row
 *   - receiver gets realtime event for each block as it finishes
 *
 * RECEIVER (this file):
 *   - On first chunk row (index=0): create MediaSource + video.src
 *   - Each chunk: download → decrypt → push to appendQueue
 *   - appendQueue flushes in strict order (0,1,2...) into SourceBuffer
 *   - When last chunk appended: mediaSource.endOfStream()
 *   - Video plays from the moment first blocks are in the buffer
 */

import { useEffect, useCallback, useState } from 'react';
import { realtimeHub } from '../lib/realtimeHub';
import { useAuth } from '../contexts/AuthContext';
import { usePartner } from './usePartner';
import nacl from 'tweetnacl';
import {
  getStoredKeyPair,
  decryptFileKeyWithFallback,
  decodeBase64,
} from '../lib/encryption';
import { deriveBlockNonce } from '../utils/videoChunker';

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Public types                                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

export interface ReceivedChunk {
  chunkIndex: number;
  totalChunks: number;
  blobUrl: string | null;   // the mediasource: URL (set on init, never changes)
  isDecrypted: boolean;     // true = MSE is ready / video can play
  duration?: number;
  bufferedPercent: number;  // 0-100 — how much has been appended to SourceBuffer
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Module-level store (shared across all hook instances)                     */
/* ─────────────────────────────────────────────────────────────────────────── */

interface StoreEntry {
  /** mediasource: blob URL — set once when MediaSource is created */
  blobUrl: string | null;
  /** Total video duration in seconds */
  duration: number;
  /** True once endOfStream() has been called */
  isComplete: boolean;
  /** Number of blocks received so far (for progress) */
  receivedCount: number;
  /** Total blocks expected */
  totalChunks: number;
  /** The dual-wrapped symmetric key (receiver|sender) */
  chunkKey: string;
  /** Base nonce (b64) — per-block nonce is derived as baseNonce XOR blockIndex */
  baseNonce: string;
  /** Partner public key for key unwrapping */
  partnerPublicKey: string;
  /** The MediaSource object */
  mediaSource: MediaSource | null;
  /** The SourceBuffer — created inside 'sourceopen' handler */
  sourceBuffer: SourceBuffer | null;
  /** Ordered queue of decrypted blocks waiting to be appended */
  appendQueue: Map<number, Uint8Array>;
  /** Next block index we need to append in order */
  nextAppendIndex: number;
  /** Whether a SourceBuffer.appendBuffer() call is in flight */
  isAppending: boolean;
  /** MIME type detected from first block's magic bytes */
  mimeType: string | null;
  /** Whether MSE initialisation has started */
  mseInitialised: boolean;
}

const videoStore = new Map<string, StoreEntry>();
const loadingSet = new Set<string>();
const updateCallbacks = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifyAll() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const cb of updateCallbacks) cb();
  }, 80);
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Store → ReceivedChunk[] adapter                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

function storeEntryToChunks(messageId: string): ReceivedChunk[] {
  const e = videoStore.get(messageId);
  if (!e) return [];

  const bufferedPercent = e.totalChunks > 0
    ? Math.round((e.nextAppendIndex / e.totalChunks) * 100)
    : 0;

  return [{
    chunkIndex: 0,
    totalChunks: e.totalChunks,
    blobUrl: e.blobUrl,
    isDecrypted: e.blobUrl !== null, // URL exists = player can attach
    duration: e.duration,
    bufferedPercent,
  }];
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  MIME sniff from first 12 bytes                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

function sniffMime(bytes: Uint8Array): string {
  // WebM / MKV
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
    return 'video/webm; codecs="vp8,vorbis"';
  }
  // MP4 / QuickTime — 'ftyp' at bytes 4-7
  if (bytes.length >= 12 &&
      bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand.startsWith('qt') || brand.startsWith('mqt')) return 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
    return 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
  }
  // Default: mp4
  return 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Key unwrapping (handles dual-key format "receiverPart|senderPart")        */
/* ─────────────────────────────────────────────────────────────────────────── */

function unwrapSymmetricKey(
  packedKey: string,
  partnerPublicKey: string
): Uint8Array | null {
  const myKeyPair = getStoredKeyPair();
  if (!myKeyPair) return null;

  const parts = packedKey.split('|');
  for (const packed of parts) {
    const colonIdx = packed.indexOf(':');
    if (colonIdx === -1) continue;
    const keyNonce = packed.slice(0, colonIdx);
    const encryptedKey = packed.slice(colonIdx + 1);
    if (!keyNonce || !encryptedKey) continue;

    // Try as receiver (partner is sender)
    try {
      const key = decryptFileKeyWithFallback(
        encryptedKey, keyNonce,
        decodeBase64(partnerPublicKey),
        myKeyPair.secretKey
      );
      if (key) return key;
    } catch { /* try next */ }

    // Try as sender (watching my own video)
    try {
      const key = decryptFileKeyWithFallback(
        encryptedKey, keyNonce,
        myKeyPair.publicKey,
        myKeyPair.secretKey
      );
      if (key) return key;
    } catch { /* try next */ }
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Decrypt a single block                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

async function downloadAndDecryptBlock(
  chunkUrl: string,
  chunkIndex: number,
  packedKey: string,
  baseNonceB64: string,
  partnerPublicKey: string
): Promise<Uint8Array> {
  // Download raw encrypted bytes
  const response = await fetch(chunkUrl);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status} for chunk ${chunkIndex}`);
  const cipherBytes = new Uint8Array(await response.arrayBuffer());

  // Unwrap symmetric key
  const symmetricKey = unwrapSymmetricKey(packedKey, partnerPublicKey);
  if (!symmetricKey) throw new Error('Failed to unwrap symmetric key');

  // Derive per-block nonce
  const baseNonce = decodeBase64(baseNonceB64);
  const blockNonce = deriveBlockNonce(baseNonce, chunkIndex);

  // Decrypt
  const decrypted = nacl.secretbox.open(cipherBytes, blockNonce, symmetricKey);
  if (!decrypted) throw new Error(`Decryption failed for block ${chunkIndex}`);

  return decrypted;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  MSE initialisation                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

function initMSE(messageId: string, mimeType: string) {
  const entry = videoStore.get(messageId);
  if (!entry || entry.mseInitialised) return;
  entry.mseInitialised = true;

  // Check MSE support
  if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(mimeType)) {
    console.warn(`[useVideoChunks] MSE not supported for ${mimeType} — falling back to simple blob`);
    // Fallback: will use legacy full-assembly path
    return;
  }

  const ms = new MediaSource();
  entry.mediaSource = ms;
  entry.blobUrl = URL.createObjectURL(ms);
  entry.mimeType = mimeType;

  ms.addEventListener('sourceopen', () => {
    try {
      const sb = ms.addSourceBuffer(mimeType);
      entry.sourceBuffer = sb;

      sb.addEventListener('updateend', () => {
        entry.isAppending = false;
        flushAppendQueue(messageId);
      });

      // Kick off flushing in case blocks already arrived
      flushAppendQueue(messageId);
    } catch (err) {
      console.error('[useVideoChunks] addSourceBuffer failed:', err);
    }
  }, { once: true });

  videoStore.set(messageId, { ...entry });
  notifyAll(); // blobUrl is now set → ChunkedVideoPlayer can set video.src
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  SourceBuffer append queue (must append blocks in strict order)            */
/* ─────────────────────────────────────────────────────────────────────────── */

function flushAppendQueue(messageId: string) {
  const entry = videoStore.get(messageId);
  if (!entry) return;
  const { sourceBuffer, appendQueue, nextAppendIndex, isAppending, mediaSource } = entry;

  if (!sourceBuffer || isAppending || sourceBuffer.updating) return;
  if (!appendQueue.has(nextAppendIndex)) return;

  const data = appendQueue.get(nextAppendIndex)!;
  appendQueue.delete(nextAppendIndex);
  entry.nextAppendIndex++;
  entry.isAppending = true;

  try {
    sourceBuffer.appendBuffer(data as unknown as BufferSource);
  } catch (err) {
    console.error(`[useVideoChunks] appendBuffer error at index ${nextAppendIndex - 1}:`, err);
    entry.isAppending = false;
  }

  // If this was the last block, signal end of stream
  if (entry.nextAppendIndex >= entry.totalChunks && entry.receivedCount >= entry.totalChunks) {
    // Wait for current append to finish, then end stream
    const endStream = () => {
      if (mediaSource && mediaSource.readyState === 'open') {
        try { mediaSource.endOfStream(); } catch { /* ignore */ }
        entry.isComplete = true;
      }
    };
    sourceBuffer.addEventListener('updateend', endStream, { once: true });
  }

  videoStore.set(messageId, { ...entry });
  notifyAll();
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Process a received/fetched block                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

async function processBlock(
  messageId: string,
  chunkIndex: number,
  chunkUrl: string,
  totalChunks: number,
  packedKey: string,
  baseNonce: string,
  partnerPublicKey: string,
  duration: number
) {
  let entry = videoStore.get(messageId);

  // Initialize entry if first block
  if (!entry) {
    entry = {
      blobUrl: null,
      duration,
      isComplete: false,
      receivedCount: 0,
      totalChunks,
      chunkKey: packedKey,
      baseNonce,
      partnerPublicKey,
      mediaSource: null,
      sourceBuffer: null,
      appendQueue: new Map(),
      nextAppendIndex: 0,
      isAppending: false,
      mimeType: null,
      mseInitialised: false,
    };
    videoStore.set(messageId, entry);
    notifyAll();
  }

  if (entry.isComplete) return;

  // Download + decrypt this block
  let decrypted: Uint8Array;
  try {
    decrypted = await downloadAndDecryptBlock(
      chunkUrl, chunkIndex, packedKey, baseNonce, partnerPublicKey
    );
  } catch (err) {
    console.error(`[useVideoChunks] Block ${chunkIndex} failed:`, err);
    return;
  }

  entry = videoStore.get(messageId)!;
  entry.receivedCount++;

  // Detect MIME from first block's magic bytes
  if (!entry.mseInitialised && chunkIndex === 0) {
    const mime = sniffMime(decrypted);
    initMSE(messageId, mime);
    // Re-fetch entry after MSE init (blobUrl may have been set)
    entry = videoStore.get(messageId)!;
  }

  // Push block into append queue
  entry.appendQueue.set(chunkIndex, decrypted);
  videoStore.set(messageId, { ...entry });

  // Try to flush queue
  flushAppendQueue(messageId);
  notifyAll();
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Sender-side local preview                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

export function addLocalVideoForSender(messageId: string, file: Blob, duration: number) {
  const existing = videoStore.get(messageId);
  if (existing?.blobUrl) return; // already set

  const blobUrl = URL.createObjectURL(file);
  videoStore.set(messageId, {
    blobUrl,
    duration,
    isComplete: true,
    receivedCount: 1,
    totalChunks: 1,
    chunkKey: '',
    baseNonce: '',
    partnerPublicKey: '',
    mediaSource: null,
    sourceBuffer: null,
    appendQueue: new Map(),
    nextAppendIndex: 1,
    isAppending: false,
    mimeType: null,
    mseInitialised: true,
  });
  notifyAll();
}

// Legacy compat
export function addLocalChunkForSender(
  messageId: string, _i: number, _total: number, blob: Blob, duration?: number
) {
  if (!videoStore.has(messageId)) addLocalVideoForSender(messageId, blob, duration ?? 0);
}
export function updateTotalChunksForSender(_msgId: string, _total: number) { /* no-op v4 */ }

/* ─────────────────────────────────────────────────────────────────────────── */
/*  React hook                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

export function useVideoChunks(messageId?: string) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const [chunks, setChunks] = useState<ReceivedChunk[]>([]);

  // ── Subscribe to store updates ──────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      if (messageId) setChunks(storeEntryToChunks(messageId));
    };
    update();
    updateCallbacks.add(update);
    return () => { updateCallbacks.delete(update); };
  }, [messageId]);

  // ── Realtime: receive chunk inserts from DB ──────────────────────────────
  useEffect(() => {
    if (!user?.id || !partner?.id) return;

    const unsubscribe = realtimeHub.on('video_chunks', async (payload) => {
      if (payload.eventType !== 'INSERT') return;
      const row = payload.new as any;
      if (row.receiver_id !== user.id) return;

      const partnerKey = partner?.public_key;
      if (!partnerKey) return;

      await processBlock(
        row.message_id,
        row.chunk_index,
        row.chunk_url,
        row.total_chunks,
        row.chunk_key,
        row.chunk_nonce,    // this is the base nonce in v4
        partnerKey,
        row.duration ?? 0
      );
    });

    return () => unsubscribe();
  }, [user?.id, partner?.id, partner?.public_key]);

  // ── getChunksForMessage ──────────────────────────────────────────────────
  const getChunksForMessage = useCallback((msgId: string): ReceivedChunk[] | null => {
    if (!videoStore.has(msgId)) return null;
    return storeEntryToChunks(msgId);
  }, []);

  // ── loadExistingChunks (chat reopen / page reload) ───────────────────────
  const loadExistingChunks = useCallback(async (
    msgId: string,
    rows: {
      chunk_index: number;
      total_chunks: number;
      chunk_url: string;
      chunk_key: string;
      chunk_nonce: string;
      duration?: number;
    }[],
    partnerPublicKey: string,
    _senderPublicKey?: string | null
  ) => {
    const existing = videoStore.get(msgId);
    if (existing?.blobUrl && existing.isComplete) return; // already done
    if (loadingSet.has(msgId)) return;
    loadingSet.add(msgId);

    try {
      if (!rows.length) return;

      const totalChunks = rows[0]?.total_chunks ?? rows.length;
      const baseNonce   = rows[0]?.chunk_nonce ?? '';
      const packedKey   = rows[0]?.chunk_key ?? '';
      const duration    = rows[0]?.duration ?? 0;

      // Process blocks in parallel batches of 5, in index order
      const PARALLEL = 5;
      // Sort rows by chunk_index to process in order
      const sorted = [...rows].sort((a, b) => a.chunk_index - b.chunk_index);

      for (let i = 0; i < sorted.length; i += PARALLEL) {
        const batch = sorted.slice(i, i + PARALLEL);
        await Promise.all(batch.map(row =>
          processBlock(
            msgId,
            row.chunk_index,
            row.chunk_url,
            totalChunks,
            packedKey,
            baseNonce,
            partnerPublicKey,
            duration
          )
        ));
      }
    } catch (err) {
      console.error('[useVideoChunks] loadExistingChunks error:', err);
    } finally {
      loadingSet.delete(msgId);
    }
  }, []);

  // ── isChunkedVideo ───────────────────────────────────────────────────────
  const isChunkedVideo = useCallback(
    (msg: { type?: string | null; media_url?: string | null }) =>
      msg.type === 'video' && !msg.media_url,
    []
  );

  return { chunks, getChunksForMessage, loadExistingChunks, isChunkedVideo };
}
