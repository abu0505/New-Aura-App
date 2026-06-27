/**
 * videoChunker.ts
 *
 * VIDEO ARCHITECTURE v3 — "Whole-File Encrypt + Byte-Chunk Transport"
 *
 * PREVIOUS ARCHITECTURE (BROKEN):
 *   Used FFmpeg WASM segment muxer to split video into 5-second standalone
 *   MP4/WebM segments. Each segment was encrypted independently and uploaded.
 *   On the receiver side, segments were naively byte-concatenated.
 *   This FAILED because:
 *     - MP4: Each segment has its own ftyp+moov+mdat. Concatenating them
 *       produces [ftyp1+moov1+mdat1][ftyp2+moov2+mdat2]... The browser
 *       reads moov1, plays mdat1, then hits ftyp2 and STOPS.
 *     - WebM: Cluster-level concatenation without proper EBML header
 *       reconstruction causes glitchy/laggy playback.
 *
 * NEW ARCHITECTURE (WhatsApp/Telegram-style):
 *   1. Sender encrypts the ENTIRE video file as one unit (single key + nonce).
 *   2. The resulting ciphertext is split into fixed-size BYTE chunks (5MB each)
 *      purely for transport (Cloudinary has a 10MB per-upload limit).
 *   3. Receiver downloads all byte chunks, concatenates the raw encrypted bytes
 *      (valid because it's just reassembling a byte stream), decrypts once,
 *      and gets the original perfect video file.
 *   4. No FFmpeg needed for chunking. No container structure issues.
 *
 * This file now only provides:
 *   - splitIntoByteChunks() — simple byte-level splitting of Uint8Array
 *   - getVideoDuration()    — HTML5 video element duration extraction
 *   - generateVideoThumbnail() — canvas-based first-frame capture
 */

/* ── Byte-level chunking (transport only) ─────────────────────────────── */

/**
 * Web chunk size: 8MB
 * No Capacitor bridge overhead on web — bigger chunks = fewer HTTP calls,
 * fewer Supabase rows, faster overall upload on good connections.
 */
export const WEB_CHUNK_SIZE = 8 * 1024 * 1024;

/**
 * Native chunk size: 2MB
 * Capacitor JS→Native bridge passes chunk data as Base64 string.
 * Base64 inflates 2MB → ~2.7MB which is safely within WebView memory limits
 * on budget Android devices. Going higher risks OOM crashes on the bridge.
 */
export const NATIVE_CHUNK_SIZE = 2 * 1024 * 1024;

/** @deprecated Use WEB_CHUNK_SIZE / NATIVE_CHUNK_SIZE or getAdaptiveChunkSize() */
export const DEFAULT_BYTE_CHUNK_SIZE = WEB_CHUNK_SIZE;

/**
 * Returns the optimal chunk size for the current environment and network.
 *
 * Web (isNative = false):
 *   - Uses the Network Information API (if available) to pick between 3MB–8MB.
 *   - Fast WiFi / 4G  → 8MB  (fewest API calls, maximum throughput)
 *   - Decent 4G       → 5MB
 *   - 3G / slow       → 3MB  (smaller retry cost on failure)
 *   - Unknown         → 8MB  (optimistic default)
 *
 * Native Android (isNative = true):
 *   - Always 2MB regardless of network (Capacitor bridge constraint).
 */
export function getAdaptiveChunkSize(isNative: boolean): number {
  if (isNative) return NATIVE_CHUNK_SIZE;

  try {
    const nav = navigator as any;
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (conn) {
      const type = conn.effectiveType as string | undefined; // '4g'|'3g'|'2g'|'slow-2g'
      const dl   = typeof conn.downlink === 'number' ? conn.downlink : 0; // Mbps

      if (type === '4g' && dl >= 10) return 8 * 1024 * 1024; // blazing fast
      if (type === '4g' || dl >= 2)  return 5 * 1024 * 1024; // solid 4G
      if (type === '3g')             return 3 * 1024 * 1024; // 3G
      return 3 * 1024 * 1024; // slow / unknown mobile
    }
  } catch {
    // Network Information API not available — use safe default
  }

  return WEB_CHUNK_SIZE; // 8MB on desktop / unknown
}

export interface ByteChunk {
  data: Uint8Array;
  index: number;
  totalChunks: number;
}

/**
 * Splits a Uint8Array into fixed-size byte chunks.
 * This is purely a transport-level split — no video structure awareness needed.
 * Concatenating all chunks in order reconstructs the original byte array exactly.
 */
export function splitIntoByteChunks(
  data: Uint8Array,
  chunkSize: number = DEFAULT_BYTE_CHUNK_SIZE
): ByteChunk[] {
  const totalChunks = Math.ceil(data.length / chunkSize);
  const chunks: ByteChunk[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, data.length);
    chunks.push({
      data: data.slice(start, end),
      index: i,
      totalChunks,
    });
  }

  return chunks;
}

/**
 * Derives a per-block nonce from a base nonce + block index.
 *
 * WHY: NaCl secretbox uses authenticated encryption (MAC over the whole message).
 * You CANNOT decrypt partial ciphertext — the MAC check will fail.
 * To enable per-block decryption (streaming), each block must have its OWN nonce.
 *
 * APPROACH: XOR the last 4 bytes of the base nonce with the block index (big-endian).
 * This is the same approach used by libsodium's streaming API (secretstream).
 * - nonce[20..23] ^= blockIndex (big-endian uint32)
 * - Base nonce bytes [0..19] are unchanged → prevents nonce reuse across different messages
 * - Block index [0..N] XOR'd into last 4 bytes → each block gets a unique nonce
 *
 * The base nonce is stored in the DB once. Receivers derive the per-block nonce
 * from (baseNonce, chunk_index) — no extra DB column needed.
 */
export function deriveBlockNonce(baseNonce: Uint8Array, blockIndex: number): Uint8Array {
  const derived = new Uint8Array(baseNonce); // copy — don't mutate original
  // XOR last 4 bytes with blockIndex (big-endian uint32)
  derived[20] ^= (blockIndex >>> 24) & 0xff;
  derived[21] ^= (blockIndex >>> 16) & 0xff;
  derived[22] ^= (blockIndex >>> 8) & 0xff;
  derived[23] ^= blockIndex & 0xff;
  return derived;
}


/* ── Video duration extraction ────────────────────────────────────────── */

export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    // Style and append offscreen to ensure mobile WebViews load and process it
    video.style.position = 'fixed';
    video.style.top = '0';
    video.style.left = '0';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);

    const url = URL.createObjectURL(file);

    let resolved = false;
    const safeResolve = (duration: number) => {
      if (resolved) return;
      resolved = true;
      URL.revokeObjectURL(url);
      video.remove();
      resolve(duration);
    };

    const timeout = setTimeout(() => {
      safeResolve(60); // fallback estimate
    }, 4000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      safeResolve(isFinite(video.duration) ? video.duration : 60);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      safeResolve(60); // fallback estimate
    };

    video.src = url;
    video.load();
  });
}

/* ── Thumbnail generation ─────────────────────────────────────────────── */

/**
 * Generates a WebP thumbnail from the first frame of a video file.
 * Uses a hidden <video> element + canvas — no FFmpeg required.
 * Returns a Blob (WebP), or null on failure.
 */
export function generateVideoThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    // Style and append offscreen to ensure mobile WebViews load and process it
    video.style.position = 'fixed';
    video.style.top = '0';
    video.style.left = '0';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);

    const url = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    let resolved = false;
    const safeResolve = (blob: Blob | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(blob);
    };

    // Increase timeout to 5000ms for mobile devices
    const timeout = setTimeout(() => {
      safeResolve(null);
    }, 5000);

    const captureFrame = () => {
      try {
        clearTimeout(timeout);
        const canvas = document.createElement('canvas');
        // Preserve actual aspect ratio — do NOT force 16:9 (breaks portrait videos)
        // Cap longest dimension to 480px for reasonable file sizes
        const w = video.videoWidth || 480;
        const h = video.videoHeight || 480;
        const ratio = Math.min(480 / w, 480 / h, 1); // never upscale
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);

        const ctx = canvas.getContext('2d');
        if (!ctx) { safeResolve(null); return; }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => safeResolve(blob),
          'image/webp',
          0.75
        );
      } catch {
        safeResolve(null);
      }
    };

    video.onloadedmetadata = () => {
      // Seek slightly forward to force frame decoding and avoid black frames
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      captureFrame();
    };

    video.onerror = () => {
      clearTimeout(timeout);
      safeResolve(null);
    };

    video.src = url;
    video.load();
  });
}
