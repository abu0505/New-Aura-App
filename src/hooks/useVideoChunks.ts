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

import { useEffect, useCallback, useState, useRef } from 'react';
import { realtimeHub } from '../lib/realtimeHub';
import { useAuth } from '../contexts/AuthContext';
import { usePartner } from './usePartner';
import nacl from 'tweetnacl';
import {
  getStoredKeyPair,
  decryptFileKeyWithFallback,
  decodeBase64,
  encodeBase64,
} from '../lib/encryption';
import { deriveBlockNonce } from '../utils/videoChunker';
import { getCachedBlob, setCachedBlob } from '../lib/mediaCache';

const LOG = (..._args: any[]) => {};
const WARN = (...args: unknown[]) => console.warn('[VideoChunks]', ...args);
const ERR = (...args: unknown[]) => console.error('[VideoChunks]', ...args);

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
  error?: string | null;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Module-level store (shared across all hook instances)                     */
/* ─────────────────────────────────────────────────────────────────────────── */

interface StoreEntry {
  /** mediasource: or blob: URL — set once when ready */
  blobUrl: string | null;
  /**
   * FIX: A reusable Blob URL created from the fully-assembled decrypted blocks.
   * Unlike the MSE blob URL (which is tied to a single MediaSource and can only
   * be assigned to one <video> element), this URL can be safely reused across
   * multiple <video> elements (e.g., inline player + fullscreen MediaViewer).
   */
  reusableBlobUrl: string | null;
  /** Strong reference to the decrypted Blob object to prevent garbage collection */
  blobObject?: Blob | null;
  /** Total video duration in seconds */
  duration: number;
  /** True once endOfStream() has been called (MSE) or blob assembled */
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
  /** The MediaSource object (null in blob-fallback mode) */
  mediaSource: MediaSource | null;
  /**
   * Blob-fallback mode: when MSE is not supported or addSourceBuffer fails
   * (e.g. non-fragmented gallery MP4), decrypted blocks are stored here.
   * Once all blocks are collected, they are concatenated into a single Blob URL.
   */
  blobFallbackBlocks: Map<number, Uint8Array> | null;
  /** True once we have determined MSE will NOT work and are using blob mode */
  useBlobFallback: boolean;
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
  /** Track which block indices have already been processed (prevents duplicates) */
  processedIndices: Set<number>;
  /** Track block indices that are currently in-flight downloading/decrypting */
  downloadingIndices: Set<number>;
  /**
   * FIX: Store decrypted block data so we can build a reusable Blob URL
   * once all blocks have been received. This is needed because the MSE blob URL
   * cannot be reused by a second <video> element (e.g., fullscreen viewer).
   */
  decryptedBlocks: Map<number, Uint8Array>;
  /** Optional error message if playback/decryption/download fails */
  error?: string | null;
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

  // In MSE mode: bufferedPercent reflects how much has been appended to SourceBuffer.
  // In blob mode: reflects how many blocks have been decrypted (assembly pending).
  const bufferedPercent = e.totalChunks > 0
    ? Math.round(
        (e.useBlobFallback
          ? (e.blobFallbackBlocks?.size ?? e.decryptedBlocks.size)
          : e.nextAppendIndex
        ) / e.totalChunks * 100
      )
    : 0;

  // FIX: Prefer the reusable blob URL over the MSE blob URL.
  // The MSE blob URL is tied to a single MediaSource and breaks if assigned
  // to a second <video> element. The reusable URL is a plain Blob that works
  // with any number of elements (inline preview, fullscreen viewer, etc.).
  const effectiveUrl = e.reusableBlobUrl || e.blobUrl;

  return [{
    chunkIndex: 0,
    totalChunks: e.totalChunks,
    blobUrl: effectiveUrl,
    isDecrypted: effectiveUrl !== null, // URL exists = player can attach
    duration: e.duration,
    bufferedPercent,
    error: e.error || null,
  }];
}


/* ─────────────────────────────────────────────────────────────────────────── */
/*  MIME sniff from first 12 bytes                                            */
/*                                                                             */
/*  FIX (audio glitch): Previously hardcoded 'avc1.42E01E' (Baseline) but     */
/*  camera.worker.ts encodes with 'avc1.640034' (High Profile, Level 5.2).    */
/*  MSE codec mismatch causes the SourceBuffer to reject appends or produce   */
/*  discontinuities — audible as pops/glitches at the 5MB chunk boundaries.   */
/*  Solution: use the most permissive codec string that all browsers accept.  */
/* ─────────────────────────────────────────────────────────────────────────── */

function sniffMime(bytes: Uint8Array): string {
  // WebM / MKV: 0x1A 0x45 0xDF 0xA3
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
    // Try VP8 first (older recordings), then VP9 (modern)
    const webmVP9 = 'video/webm; codecs="vp9,opus"';
    const webmVP8 = 'video/webm; codecs="vp8,vorbis"';
    if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(webmVP9)) {
      LOG('MIME sniff → WebM/VP9');
      return webmVP9;
    }
    LOG('MIME sniff → WebM/VP8');
    return webmVP8;
  }

  // MP4 / QuickTime — 'ftyp' at bytes 4-7
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  ) {
    // FIX: Use 'avc1' without a specific profile level. This is a catch-all
    // that works for Baseline, Main, AND High profile H.264 streams.
    // Previously 'avc1.42E01E' only matched Baseline — High Profile frames
    // caused the SourceBuffer to error, dropping audio sync.
    const mimeMP4 = 'video/mp4; codecs="avc1,mp4a.40.2"';
    if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mimeMP4)) {
      LOG('MIME sniff → MP4 (avc1,mp4a.40.2)');
      return mimeMP4;
    }
    // Broader fallback with explicit level for stricter browsers
    const mimeMP4Fallback = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
    LOG('MIME sniff → MP4 fallback (avc1.42E01E)');
    return mimeMP4Fallback;
  }

  // Default: fragmented MP4 with generic codec
  LOG('MIME sniff → MP4 default');
  return 'video/mp4; codecs="avc1,mp4a.40.2"';
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

  const myPubB64 = encodeBase64(myKeyPair.publicKey);
  const parts = packedKey.split('|');
  LOG(`unwrapSymmetricKey: ${parts.length} part(s), partnerPub=${partnerPublicKey.slice(0,8)}…, myPub=${myPubB64.slice(0,8)}…`);

  for (let pi = 0; pi < parts.length; pi++) {
    const packed = parts[pi];
    const colonIdx = packed.indexOf(':');
    if (colonIdx === -1) continue;
    const keyNonce = packed.slice(0, colonIdx);
    const encryptedKey = packed.slice(colonIdx + 1);
    if (!keyNonce || !encryptedKey) continue;

    // Try with partner's public key (works for BOTH sender and receiver
    // because NaCl box DH: encrypt(theirPub, mySec) == decrypt(theirPub, mySec))
    try {
      const key = decryptFileKeyWithFallback(
        encryptedKey, keyNonce,
        decodeBase64(partnerPublicKey),
        myKeyPair.secretKey
      );
      if (key) {
        LOG(`unwrapSymmetricKey: SUCCESS with partnerPub on part[${pi}]`);
        return key;
      }
    } catch { /* try next */ }

    // Try with my own public key (sender self-wrapped part)
    try {
      const key = decryptFileKeyWithFallback(
        encryptedKey, keyNonce,
        myKeyPair.publicKey,
        myKeyPair.secretKey
      );
      if (key) {
        LOG(`unwrapSymmetricKey: SUCCESS with myPub (self-wrap) on part[${pi}]`);
        return key;
      }
    } catch { /* try next */ }
  }
  ERR(`unwrapSymmetricKey: ALL parts failed! packedKey length=${packedKey.length}`);
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Decrypt a single block (with retry)                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

async function downloadAndDecryptBlock(
  chunkUrl: string,
  chunkIndex: number,
  packedKey: string,
  baseNonceB64: string,
  partnerPublicKey: string,
  attempt = 1
): Promise<Uint8Array> {
  LOG(`Block ${chunkIndex}: downloading (attempt ${attempt})...`);
  try {
    // BANDWIDTH FIX: Check IndexedDB for previously decrypted chunk
    const idbBlob = await getCachedBlob(chunkUrl);
    if (idbBlob) {
      LOG(`Block ${chunkIndex}: loaded from IndexedDB cache`);
      return new Uint8Array(await idbBlob.arrayBuffer());
    }

    const response = await fetch(chunkUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status} for chunk ${chunkIndex}`);
    const cipherBytes = new Uint8Array(await response.arrayBuffer());
    LOG(`Block ${chunkIndex}: downloaded ${cipherBytes.length} bytes, decrypting...`);

    const symmetricKey = unwrapSymmetricKey(packedKey, partnerPublicKey);
    if (!symmetricKey) throw new Error('Failed to unwrap symmetric key');

    const baseNonce = decodeBase64(baseNonceB64);
    const blockNonce = deriveBlockNonce(baseNonce, chunkIndex);

    const decrypted = nacl.secretbox.open(cipherBytes, blockNonce, symmetricKey);
    if (!decrypted) throw new Error(`NaCl MAC check failed for block ${chunkIndex}`);

    LOG(`Block ${chunkIndex}: decrypted OK → ${decrypted.length} bytes`);
    
    // BANDWIDTH FIX: Persist decrypted chunk to IndexedDB
    const blob = new Blob([decrypted as unknown as BlobPart], { type: 'application/octet-stream' });
    setCachedBlob(chunkUrl, blob).catch(() => {});

    return decrypted;
  } catch (err) {
    if (attempt < 3) {
      WARN(`Block ${chunkIndex}: failed (attempt ${attempt}), retrying in ${attempt * 200}ms...`, err);
      await new Promise(res => setTimeout(res, attempt * 200));
      return downloadAndDecryptBlock(chunkUrl, chunkIndex, packedKey, baseNonceB64, partnerPublicKey, attempt + 1);
    }
    ERR(`Block ${chunkIndex}: all ${attempt} attempts failed`, err);
    throw err;
  }
}


function tryAssembleBlobFallback(messageId: string) {
  const entry = videoStore.get(messageId);
  if (!entry || !entry.useBlobFallback || !entry.blobFallbackBlocks) return;
  if (entry.isComplete) return;
  if (entry.blobFallbackBlocks.size < entry.totalChunks) {
    LOG(`Blob fallback: have ${entry.blobFallbackBlocks.size}/${entry.totalChunks} blocks for msg=${messageId}`);
    return;
  }

  // All blocks collected — assemble in order
  LOG(`Blob fallback: all ${entry.totalChunks} blocks received for msg=${messageId}, assembling...`);
  const ordered: Uint8Array[] = [];
  for (let i = 0; i < entry.totalChunks; i++) {
    const block = entry.blobFallbackBlocks.get(i);
    if (!block) {
      WARN(`Blob fallback: block ${i} missing during assembly for msg=${messageId}, aborting`);
      return;
    }
    ordered.push(block);
  }

  // Sniff MIME from first block's magic bytes for the Blob type
  const sniffedMime = sniffMime(ordered[0]);
  // Extract just the base MIME (without codec string) for Blob constructor
  const blobMime = sniffedMime.split(';')[0].trim();
  // Normalize each block to a plain ArrayBuffer before passing to Blob.
  // NaCl's Uint8Array may carry ArrayBufferLike (potentially SharedArrayBuffer),
  // but the Blob constructor strictly requires ArrayBuffer-backed views.
  const blobParts: BlobPart[] = ordered.map(b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const blob = new Blob(blobParts, { type: blobMime });
  entry.blobUrl = URL.createObjectURL(blob);
  entry.reusableBlobUrl = entry.blobUrl; // Blob fallback URLs are already reusable
  entry.blobObject = blob; // Keep strong reference to prevent GC
  entry.isComplete = true;
  entry.blobFallbackBlocks = null; // free memory
  videoStore.set(messageId, { ...entry });
  LOG(`Blob fallback: assembled ${(blob.size / 1024 / 1024).toFixed(2)}MB blob for msg=${messageId} type=${blobMime} ✓`);
  notifyAll();
}


/* ─────────────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────── */
/*  MSE Helpers & Blob Assembly                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

function assembleReusableBlob(messageId: string) {
  const entry = videoStore.get(messageId);
  if (!entry || entry.reusableBlobUrl) return;

  if (entry.decryptedBlocks.size < entry.totalChunks) {
    return;
  }

  const ordered: Uint8Array[] = [];
  for (let i = 0; i < entry.totalChunks; i++) {
    const block = entry.decryptedBlocks.get(i);
    if (!block) return;
    ordered.push(block);
  }

  const sniffedMime = sniffMime(ordered[0]);
  const blobMime = sniffedMime.split(';')[0].trim();
  // Create a clean ArrayBuffer slice for each block to ensure compatibility with Blob
  const blobParts: BlobPart[] = ordered.map(b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const blob = new Blob(blobParts, { type: blobMime });
  entry.reusableBlobUrl = URL.createObjectURL(blob);
  entry.blobObject = blob;
  
  if (entry.useBlobFallback) {
    entry.blobUrl = entry.reusableBlobUrl;
  }
  
  videoStore.set(messageId, { ...entry });
  LOG(`Assembled reusable Blob URL for msg=${messageId} (${(blob.size / 1024 / 1024).toFixed(2)}MB) ✓`);
}

function fallbackToBlobMode(messageId: string, reason: string) {
  const entry = videoStore.get(messageId);
  if (!entry || entry.useBlobFallback) return;

  WARN(`Switching to Blob Fallback mode for msg=${messageId}. Reason: ${reason}`);
  entry.useBlobFallback = true;
  entry.blobFallbackBlocks = new Map();
  
  for (const [idx, bytes] of entry.decryptedBlocks.entries()) {
    entry.blobFallbackBlocks.set(idx, bytes);
  }

  if (entry.sourceBuffer) {
    try {
      if (entry.mediaSource && entry.mediaSource.readyState === 'open') {
        entry.mediaSource.removeSourceBuffer(entry.sourceBuffer);
      }
    } catch {}
    entry.sourceBuffer = null;
  }
  
  if (entry.mediaSource) {
    try {
      if (entry.mediaSource.readyState === 'open') {
        entry.mediaSource.endOfStream();
      }
    } catch {}
    entry.mediaSource = null;
  }

  if (entry.blobUrl && entry.blobUrl.startsWith('blob:') && !entry.reusableBlobUrl) {
    try {
      URL.revokeObjectURL(entry.blobUrl);
    } catch {}
    entry.blobUrl = null;
  }

  entry.isAppending = false;
  videoStore.set(messageId, { ...entry });
  
  tryAssembleBlobFallback(messageId);
  notifyAll();
}

function flushAppendQueue(messageId: string) {
  const entry = videoStore.get(messageId);
  if (!entry || entry.useBlobFallback || !entry.sourceBuffer || entry.isAppending) return;

  const sb = entry.sourceBuffer;
  if (sb.updating) return;

  const idx = entry.nextAppendIndex;
  
  if (idx >= entry.totalChunks) {
    if (!entry.isComplete) {
      try {
        if (entry.mediaSource && entry.mediaSource.readyState === 'open') {
          entry.mediaSource.endOfStream();
        }
        entry.isComplete = true;
        assembleReusableBlob(messageId);
        LOG(`MSE streaming: complete for msg=${messageId} ✓`);
        notifyAll();
      } catch (err) {
        WARN(`endOfStream failed:`, err);
      }
    }
    return;
  }

  if (!entry.appendQueue.has(idx)) {
    return;
  }

  const bytes = entry.appendQueue.get(idx)!;
  entry.appendQueue.delete(idx);
  entry.isAppending = true;

  try {
    LOG(`MSE append: appending block ${idx} (${bytes.length} bytes) to SourceBuffer`);
    sb.appendBuffer(bytes as any);
  } catch (err) {
    ERR(`MSE append failed for block ${idx}:`, err);
    fallbackToBlobMode(messageId, `MSE append failed: ${err}`);
  }
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
  // Guard: if any critical field is missing (e.g. Reels rows that have no chunk_key),
  // bail out immediately instead of crashing inside unwrapSymmetricKey.
  if (!packedKey || !baseNonce || !chunkUrl || chunkIndex == null) {
    WARN(`processBlock: skipping msg=${messageId} chunk=${chunkIndex} — missing required fields (packedKey=${!!packedKey}, baseNonce=${!!baseNonce}, chunkUrl=${!!chunkUrl}, chunkIndex=${chunkIndex})`);
    return;
  }
  let entry = videoStore.get(messageId);

  // Initialize entry on first block
  if (!entry) {
    LOG(`Store init for msg=${messageId}, totalChunks=${totalChunks}, duration=${duration}s`);
    entry = {
      blobUrl: null,
      reusableBlobUrl: null,
      blobObject: null,
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
      processedIndices: new Set(),
      downloadingIndices: new Set(),
      blobFallbackBlocks: null,
      useBlobFallback: false,
      decryptedBlocks: new Map(),
    };
    videoStore.set(messageId, entry);
    notifyAll();
  }

  if (entry.isComplete) {
    LOG(`Block ${chunkIndex}: skipped — video already complete`);
    return;
  }

  // Skip if block is already decrypted
  if (entry.decryptedBlocks.has(chunkIndex)) {
    LOG(`Block ${chunkIndex}: already decrypted, skipping download`);
    return;
  }

  // Skip duplicate block processing or active download
  if (entry.processedIndices.has(chunkIndex) || entry.downloadingIndices.has(chunkIndex)) {
    LOG(`Block ${chunkIndex}: skipped — already processed or downloading`);
    return;
  }
  entry.downloadingIndices.add(chunkIndex);

  // Download + decrypt this block
  let decrypted: Uint8Array;
  try {
    decrypted = await downloadAndDecryptBlock(
      chunkUrl, chunkIndex, packedKey, baseNonce, partnerPublicKey
    );
  } catch (err) {
    ERR(`Block ${chunkIndex}: permanently failed, removing from downloadingIndices/processedIndices for potential retry`);
    const currentEntry = videoStore.get(messageId);
    if (currentEntry) {
      currentEntry.downloadingIndices.delete(chunkIndex);
      currentEntry.processedIndices.delete(chunkIndex);
      currentEntry.error = 'Video decryption failed. The decryption key or file may be corrupted.';
      videoStore.set(messageId, { ...currentEntry });
      notifyAll();
    }
    return;
  }

  entry = videoStore.get(messageId)!;
  entry.downloadingIndices.delete(chunkIndex);
  entry.processedIndices.add(chunkIndex);
  entry.receivedCount++;

  // Store decrypted block for final assembly
  entry.decryptedBlocks.set(chunkIndex, decrypted);

  if (entry.useBlobFallback) {
    if (!entry.blobFallbackBlocks) {
      entry.blobFallbackBlocks = new Map();
    }
    entry.blobFallbackBlocks.set(chunkIndex, decrypted);
    videoStore.set(messageId, { ...entry });
    tryAssembleBlobFallback(messageId);
  } else {
    entry.appendQueue.set(chunkIndex, decrypted);
    videoStore.set(messageId, { ...entry });

    // Initialize MediaSource on block 0
    if (!entry.mediaSource && chunkIndex === 0) {
      const mimeType = sniffMime(decrypted);
      entry.mimeType = mimeType;
      
      try {
        const ms = new MediaSource();
        entry.mediaSource = ms;
        
        ms.addEventListener('sourceopen', () => {
          const e = videoStore.get(messageId);
          if (!e || !e.mediaSource || e.useBlobFallback) return;
          
          try {
            LOG(`MSE sourceopen: creating SourceBuffer for type: ${mimeType}`);
            const sb = e.mediaSource.addSourceBuffer(mimeType);
            e.sourceBuffer = sb;
            
            sb.addEventListener('updateend', () => {
              const currentE = videoStore.get(messageId);
              if (!currentE) return;
              currentE.isAppending = false;
              currentE.nextAppendIndex++;
              videoStore.set(messageId, currentE);
              flushAppendQueue(messageId);
              notifyAll();
            });
            
            sb.addEventListener('error', (sbErr) => {
              ERR(`SourceBuffer error for msg=${messageId}:`, sbErr);
              fallbackToBlobMode(messageId, 'SourceBuffer error event');
            });
            
            videoStore.set(messageId, e);
            flushAppendQueue(messageId);
            notifyAll();
          } catch (sbErr) {
            ERR(`Failed to add SourceBuffer for mime=${mimeType}:`, sbErr);
            fallbackToBlobMode(messageId, `addSourceBuffer error: ${sbErr}`);
          }
        });
        
        entry.blobUrl = URL.createObjectURL(ms);
        entry.mseInitialised = true;
        videoStore.set(messageId, { ...entry });
        notifyAll();
      } catch (mseErr) {
        ERR(`MediaSource creation failed:`, mseErr);
        fallbackToBlobMode(messageId, `MediaSource construction error: ${mseErr}`);
      }
    } else {
      if (entry.sourceBuffer) {
        flushAppendQueue(messageId);
      }
    }
  }

  // Check if fully loaded
  if (entry.decryptedBlocks.size === entry.totalChunks) {
    assembleReusableBlob(messageId);
  }
  notifyAll();
}


/* ─────────────────────────────────────────────────────────────────────────── */
/*  Sender-side local preview                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

export function addLocalVideoForSender(messageId: string, file: Blob, duration: number) {
  const existing = videoStore.get(messageId);
  if (existing?.blobUrl) return; // already set

  const blobUrl = URL.createObjectURL(file);
  LOG(`Sender local preview set for msg=${messageId}, duration=${duration}s`);
  videoStore.set(messageId, {
    blobUrl,
    reusableBlobUrl: blobUrl, // Sender blob URLs are already reusable
    blobObject: file, // Store the local Blob reference to prevent GC
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
    processedIndices: new Set([0]),
    downloadingIndices: new Set(),
    blobFallbackBlocks: null,
    useBlobFallback: false,
    decryptedBlocks: new Map(),
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

  // ── FIX: Use a ref for partner public key to avoid stale closure in realtime callback ──
  const partnerKeyRef = useRef<string | null>(partner?.public_key ?? null);
  useEffect(() => {
    partnerKeyRef.current = partner?.public_key ?? null;
  }, [partner?.public_key]);

  // ── FIX: Queue chunks that arrive before partner key is available ──
  const pendingChunksRef = useRef<Array<{
    message_id: string;
    chunk_index: number;
    chunk_url: string;
    total_chunks: number;
    chunk_key: string;
    chunk_nonce: string;
    duration: number;
  }>>([]);

  // ── Subscribe to store updates ──────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      if (messageId) setChunks(storeEntryToChunks(messageId));
    };
    update();
    updateCallbacks.add(update);
    return () => { updateCallbacks.delete(update); };
  }, [messageId]);

  // ── FIX: Process pending chunks when partner key becomes available ──────
  useEffect(() => {
    const partnerKey = partner?.public_key;
    if (!partnerKey) return;
    if (pendingChunksRef.current.length === 0) return;

    const pending = [...pendingChunksRef.current];
    pendingChunksRef.current = [];
    LOG(`Partner key now available — processing ${pending.length} queued chunks`);

    for (const row of pending) {
      processBlock(
        row.message_id,
        row.chunk_index,
        row.chunk_url,
        row.total_chunks,
        row.chunk_key,
        row.chunk_nonce,
        partnerKey,
        row.duration
      );
    }
  }, [partner?.public_key]);

  // ── Realtime: receive chunk inserts from DB ──────────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    const unsubscribe = realtimeHub.on('video_chunks', async (payload) => {
      if (payload.eventType !== 'INSERT') return;
      const row = payload.new as any;

      // Only process rows where current user is the RECEIVER
      if (row.receiver_id !== user.id) {
        LOG(`Realtime chunk ignored (not for me): msg=${row.message_id} chunk=${row.chunk_index}`);
        return;
      }

      // FIX: Read partner key from ref (always latest) instead of stale closure
      const partnerKey = partnerKeyRef.current;
      if (!partnerKey) {
        LOG(`Realtime chunk queued (partner key not yet available): msg=${row.message_id} chunk=${row.chunk_index}`);
        pendingChunksRef.current.push({
          message_id: row.message_id,
          chunk_index: row.chunk_index,
          chunk_url: row.chunk_url,
          total_chunks: row.total_chunks,
          chunk_key: row.chunk_key,
          chunk_nonce: row.chunk_nonce,
          duration: row.duration ?? 0,
        });
        return;
      }

      LOG(`Realtime chunk received: msg=${row.message_id} chunk=${row.chunk_index}/${row.total_chunks - 1}`);

      await processBlock(
        row.message_id,
        row.chunk_index,
        row.chunk_url,
        row.total_chunks,
        row.chunk_key,
        row.chunk_nonce,
        partnerKey,
        row.duration ?? 0
      );
    });

    return () => unsubscribe();
  }, [user?.id]);

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

    // FIX: Only skip if FULLY complete, has no playback error, and has a strong blobObject reference.
    if (existing?.blobUrl && existing.isComplete && !existing.error && existing.blobObject) {
      LOG(`loadExistingChunks: msg=${msgId} already fully buffered, skipping`);
      return;
    }

    if (loadingSet.has(msgId)) {
      LOG(`loadExistingChunks: msg=${msgId} already loading, skipping`);
      return;
    }
    loadingSet.add(msgId);
    LOG(`loadExistingChunks: msg=${msgId}, ${rows.length} chunks to process`);

    try {
      if (!rows.length) return;

      const totalChunks = rows[0]?.total_chunks ?? rows.length;
      const baseNonce   = rows[0]?.chunk_nonce ?? '';
      const packedKey   = rows[0]?.chunk_key ?? '';
      const duration    = rows[0]?.duration ?? 0;

      let entry = videoStore.get(msgId);
      if (!entry) {
        entry = {
          blobUrl: null,
          reusableBlobUrl: null,
          blobObject: null,
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
          processedIndices: new Set(),
          downloadingIndices: new Set(),
          blobFallbackBlocks: null,
          useBlobFallback: false,
          decryptedBlocks: new Map(),
        };
        videoStore.set(msgId, entry);
      } else {
        // Reset/clean retry only if error exists, to preserve already decrypted blocks
        if (entry.error) {
          entry.error = null;
          entry.processedIndices.clear();
          entry.downloadingIndices.clear();
          entry.receivedCount = 0;
          entry.blobObject = null;
          entry.blobUrl = null;
          entry.reusableBlobUrl = null;
          entry.decryptedBlocks.clear();
          if (entry.blobFallbackBlocks) {
            entry.blobFallbackBlocks.clear();
          }
          entry.appendQueue.clear();
          entry.nextAppendIndex = 0;
          entry.isAppending = false;
          entry.mseInitialised = false;
          entry.useBlobFallback = false;
          videoStore.set(msgId, entry);
        }
      }

      if (rows.length < totalChunks) {
        WARN(`loadExistingChunks: msg=${msgId} has only ${rows.length}/${totalChunks} chunks in DB. Incomplete upload.`);
        entry.error = 'Video upload was incomplete. Some parts are missing.';
        videoStore.set(msgId, { ...entry });
        notifyAll();
        return;
      }

      // Process blocks with a rolling parallel window (max 6 concurrent downloads)
      // This is faster than batch-sequential because we start the next block
      // as soon as any slot frees up, rather than waiting for a full batch of 6.
      const PARALLEL = 6;
      const sorted = [...rows].sort((a, b) => a.chunk_index - b.chunk_index);

      const activeTasks = new Set<Promise<void>>();
      for (const row of sorted) {
        const task: Promise<void> = processBlock(
          msgId,
          row.chunk_index,
          row.chunk_url,
          totalChunks,
          packedKey,
          baseNonce,
          partnerPublicKey,
          duration
        ).then(() => { activeTasks.delete(task); }).catch(() => { activeTasks.delete(task); });
        activeTasks.add(task);
        if (activeTasks.size >= PARALLEL) await Promise.race(activeTasks);
      }
      await Promise.all(activeTasks);
      LOG(`loadExistingChunks: msg=${msgId} complete`);
    } catch (err) {
      ERR(`loadExistingChunks error for msg=${msgId}:`, err);
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

export function clearVideoChunksError(messageId: string) {
  const entry = videoStore.get(messageId);
  if (entry) {
    entry.error = null;
    entry.blobUrl = null;
    entry.reusableBlobUrl = null;
    entry.blobObject = null;
    entry.isComplete = false;
    entry.processedIndices.clear();
    entry.downloadingIndices.clear();
    entry.receivedCount = 0;
    if (entry.blobFallbackBlocks) {
      entry.blobFallbackBlocks.clear();
    }
    entry.decryptedBlocks.clear();
    entry.appendQueue.clear();
    entry.nextAppendIndex = 0;
    entry.isAppending = false;
    entry.mseInitialised = false;
    entry.useBlobFallback = false;
    videoStore.set(messageId, { ...entry });
    notifyAll();
  }
}
