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
    return decrypted;
  } catch (err) {
    if (attempt < 3) {
      WARN(`Block ${chunkIndex}: failed (attempt ${attempt}), retrying in ${attempt}s...`, err);
      await new Promise(res => setTimeout(res, attempt * 1000));
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
  entry.isComplete = true;
  entry.blobFallbackBlocks = null; // free memory
  videoStore.set(messageId, { ...entry });
  LOG(`Blob fallback: assembled ${(blob.size / 1024 / 1024).toFixed(2)}MB blob for msg=${messageId} type=${blobMime} ✓`);
  notifyAll();
}



/* ─────────────────────────────────────────────────────────────────────────── */
/*  MSE: Ordered SourceBuffer flush                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Drains appendQueue in strict order (0, 1, 2, …) into the SourceBuffer.
 * Must be called after every new block arrives AND after every 'updateend'.
 *
 * Contract:
 *   - Only appends the next expected block (nextAppendIndex).
 *   - Skips if SourceBuffer.updating (another append in flight).
 *   - Calls mediaSource.endOfStream() once all blocks are appended.
 *   - After endOfStream, assembles a static reusableBlobUrl from decryptedBlocks
 *     so future video elements (fullscreen viewer, etc.) get a plain Blob URL
 *     that doesn't depend on the MediaSource lifetime.
 */
function flushAppendQueue(messageId: string) {
  const entry = videoStore.get(messageId);
  if (!entry) return;
  const { sourceBuffer, appendQueue, nextAppendIndex, isAppending, mediaSource, totalChunks } = entry;

  if (!sourceBuffer || !mediaSource || isAppending) return;
  if (mediaSource.readyState !== 'open') return;
  if (sourceBuffer.updating) return;

  // Append blocks in strict order
  const nextBlock = appendQueue.get(nextAppendIndex);
  if (!nextBlock) return; // next expected block not yet available

  entry.isAppending = true;
  videoStore.set(messageId, entry);

  try {
    // Normalize to plain ArrayBuffer for SourceBuffer (NaCl returns Uint8Array
    // backed by potentially shared memory — explicit slice ensures plain buffer)
    const buffer = nextBlock.buffer.slice(nextBlock.byteOffset, nextBlock.byteOffset + nextBlock.byteLength) as ArrayBuffer;
    sourceBuffer.appendBuffer(buffer);
    appendQueue.delete(nextAppendIndex); // free memory after queuing

    // Check if this was the final block
    if (nextAppendIndex + 1 >= totalChunks) {
      // Wait for the updateend event (fired by sourceBuffer listener) which
      // increments nextAppendIndex, then call endOfStream from there.
      sourceBuffer.addEventListener('updateend', () => {
        const e = videoStore.get(messageId);
        if (!e || !e.mediaSource || e.mediaSource.readyState !== 'open') return;
        try {
          e.mediaSource.endOfStream();
          e.isComplete = true;

          // Assemble reusableBlobUrl from decryptedBlocks so fullscreen viewer
          // and future mounts can use a stable Blob URL instead of the MSE URL.
          if (e.decryptedBlocks.size >= e.totalChunks) {
            const ordered: Uint8Array[] = [];
            for (let i = 0; i < e.totalChunks; i++) {
              const b = e.decryptedBlocks.get(i);
              if (b) ordered.push(b);
            }
            if (ordered.length === e.totalChunks) {
              const sniffed = e.mimeType || sniffMime(ordered[0]);
              const blobMime = sniffed.split(';')[0].trim();
              const blobParts = ordered.map(b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
              const blob = new Blob(blobParts, { type: blobMime });
              e.reusableBlobUrl = URL.createObjectURL(blob);
              e.decryptedBlocks.clear(); // free memory
            }
          }

          videoStore.set(messageId, { ...e });
          LOG(`MSE endOfStream OK for msg=${messageId} ✓`);
          notifyAll();
        } catch (err) {
          WARN(`endOfStream failed for msg=${messageId}:`, err);
        }
      }, { once: true });
    }
  } catch (err) {
    WARN(`appendBuffer failed for msg=${messageId} block=${nextAppendIndex}:`, err);
    // Fall back to blob-assembly on append error
    const e = videoStore.get(messageId)!;
    const mseBlobUrl = e.blobUrl;
    e.useBlobFallback = true;
    e.blobFallbackBlocks = new Map(e.decryptedBlocks);
    e.blobUrl = null;
    e.mediaSource = null;
    e.isAppending = false;
    if (mseBlobUrl) URL.revokeObjectURL(mseBlobUrl);
    videoStore.set(messageId, { ...e });
    tryAssembleBlobFallback(messageId);
    notifyAll();
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
  let entry = videoStore.get(messageId);

  // Initialize entry on first block
  if (!entry) {
    LOG(`Store init for msg=${messageId}, totalChunks=${totalChunks}, duration=${duration}s`);
    entry = {
      blobUrl: null,
      reusableBlobUrl: null,
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

  // FIX: Skip duplicate block processing (realtime may deliver the same chunk twice)
  if (entry.processedIndices.has(chunkIndex)) {
    LOG(`Block ${chunkIndex}: skipped — already processed`);
    return;
  }
  entry.processedIndices.add(chunkIndex);

  // Download + decrypt this block
  let decrypted: Uint8Array;
  try {
    decrypted = await downloadAndDecryptBlock(
      chunkUrl, chunkIndex, packedKey, baseNonce, partnerPublicKey
    );
  } catch (err) {
    ERR(`Block ${chunkIndex}: permanently failed, removing from processedIndices for potential retry`);
    // Allow retry by removing from processedIndices
    const currentEntry = videoStore.get(messageId);
    if (currentEntry) {
      currentEntry.processedIndices.delete(chunkIndex);
      currentEntry.error = 'Video decryption failed. The decryption key or file may be corrupted.';
      videoStore.set(messageId, { ...currentEntry });
      notifyAll();
    }
    return;
  }

  entry = videoStore.get(messageId)!;
  entry.receivedCount++;

  // ── Always store decrypted block for reusable Blob assembly ────────────
  entry.decryptedBlocks.set(chunkIndex, decrypted);

  // ── MSE Streaming Path ─────────────────────────────────────────────────
  // Try MSE first (video starts playing after first chunk, YouTube-style).
  // If MSE fails (non-fragmented MP4, unsupported codec, etc.) we fall back
  // to blob-assembly automatically.
  if (!entry.useBlobFallback && typeof MediaSource !== 'undefined') {
    // Initialise MSE on the very first block (index 0)
    if (!entry.mseInitialised) {
      entry.mseInitialised = true;
      const ms = new MediaSource();
      entry.mediaSource = ms;
      // NOTE: We intentionally keep blobUrl as the MSE mediasource: URL for
      // the lifetime of the MediaSource. We NEVER replace it mid-play.
      // reusableBlobUrl is set separately once the full video is assembled.
      const mseBlobUrl = URL.createObjectURL(ms);
      entry.blobUrl = mseBlobUrl;
      videoStore.set(messageId, { ...entry });
      notifyAll();

      ms.addEventListener('sourceopen', () => {
        const currentEntry = videoStore.get(messageId);
        if (!currentEntry || currentEntry.useBlobFallback) return;

        const mime = currentEntry.mimeType || sniffMime(decrypted);
        if (!mime || !MediaSource.isTypeSupported(mime)) {
          LOG(`MSE: codec ${mime} not supported, switching to blob fallback`);
          const e2 = videoStore.get(messageId)!;
          e2.useBlobFallback = true;
          e2.blobFallbackBlocks = new Map(e2.decryptedBlocks); // copy already-held blocks
          e2.blobUrl = null;
          e2.mediaSource = null;
          URL.revokeObjectURL(mseBlobUrl);
          videoStore.set(messageId, { ...e2 });
          tryAssembleBlobFallback(messageId);
          notifyAll();
          return;
        }

        try {
          const sb = ms.addSourceBuffer(mime);
          sb.mode = 'segments';
          currentEntry.sourceBuffer = sb;
          currentEntry.mimeType = mime;
          videoStore.set(messageId, currentEntry);

          sb.addEventListener('updateend', () => {
            const e3 = videoStore.get(messageId);
            if (!e3) return;
            e3.isAppending = false;
            e3.nextAppendIndex++;
            videoStore.set(messageId, e3);
            flushAppendQueue(messageId);
          });

          sb.addEventListener('error', () => {
            WARN(`MSE SourceBuffer error on msg=${messageId}, falling back to blob-assembly`);
            const e4 = videoStore.get(messageId)!;
            e4.useBlobFallback = true;
            e4.blobFallbackBlocks = new Map(e4.decryptedBlocks);
            e4.blobUrl = null;
            e4.mediaSource = null;
            URL.revokeObjectURL(mseBlobUrl);
            videoStore.set(messageId, { ...e4 });
            tryAssembleBlobFallback(messageId);
            notifyAll();
          });

          // Flush any blocks that already arrived before sourceopen fired
          flushAppendQueue(messageId);
        } catch (err) {
          WARN(`MSE addSourceBuffer failed for msg=${messageId}:`, err);
          const e5 = videoStore.get(messageId)!;
          e5.useBlobFallback = true;
          e5.blobFallbackBlocks = new Map(e5.decryptedBlocks);
          e5.blobUrl = null;
          e5.mediaSource = null;
          URL.revokeObjectURL(mseBlobUrl);
          videoStore.set(messageId, { ...e5 });
          tryAssembleBlobFallback(messageId);
          notifyAll();
        }
      }, { once: true });
    }

    // Queue this block for SourceBuffer append
    const e6 = videoStore.get(messageId)!;
    if (!e6.mimeType) e6.mimeType = sniffMime(decrypted);
    e6.appendQueue.set(chunkIndex, decrypted);
    videoStore.set(messageId, e6);
    flushAppendQueue(messageId);
  } else {
    // ── Blob-assembly fallback (non-fragmented video, or MSE already failed) ─
    if (!entry.blobFallbackBlocks) {
      entry.blobFallbackBlocks = new Map();
    }
    entry.blobFallbackBlocks.set(chunkIndex, decrypted);
    videoStore.set(messageId, { ...entry });
    LOG(`Block ${chunkIndex}: stored in blob assembly. have=${entry.blobFallbackBlocks!.size}/${entry.totalChunks}`);
    tryAssembleBlobFallback(messageId);
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

    // FIX: Only skip if FULLY complete. A partial entry (e.g. from a dropped realtime
    // event) should NOT block a fresh load from DB on page reload.
    if (existing?.blobUrl && existing.isComplete) {
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
          blobFallbackBlocks: null,
          useBlobFallback: false,
          decryptedBlocks: new Map(),
        };
        videoStore.set(msgId, entry);
      } else {
        // Reset error on reload/retry attempt
        entry.error = null;
        entry.processedIndices.clear();
        entry.receivedCount = 0;
        if (entry.blobFallbackBlocks) {
          entry.blobFallbackBlocks.clear();
        }
        videoStore.set(msgId, entry);
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
    entry.processedIndices.clear();
    entry.receivedCount = 0;
    if (entry.blobFallbackBlocks) {
      entry.blobFallbackBlocks.clear();
    }
    videoStore.set(messageId, { ...entry });
    notifyAll();
  }
}
