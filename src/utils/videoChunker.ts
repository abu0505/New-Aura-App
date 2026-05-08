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

/** Default chunk size: 5MB — safely under Cloudinary's 10MB upload limit */
export const DEFAULT_BYTE_CHUNK_SIZE = 5 * 1024 * 1024;

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
    }, 2000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      safeResolve(isFinite(video.duration) ? video.duration : 60);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      safeResolve(60); // fallback estimate
    };

    video.src = url;
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
    video.preload = 'metadata';

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

    const timeout = setTimeout(() => {
      safeResolve(null);
    }, 3000);

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
      // Try currentTime=0 first — most reliable for Android WebM recordings
      // where seeking to 0.1s may hang if the media engine hasn't buffered enough.
      video.currentTime = 0;
    };

    video.onseeked = () => {
      if (video.videoWidth === 0 && video.currentTime < 0.05) {
        // Not rendered yet — try 0.1s as one-time fallback
        const prev = video.onseeked;
        video.onseeked = captureFrame;
        void prev; // suppress unused warning
        video.currentTime = 0.1;
        return;
      }
      captureFrame();
    };

    video.onerror = () => {
      clearTimeout(timeout);
      safeResolve(null);
    };

    video.src = url;
  });
}
