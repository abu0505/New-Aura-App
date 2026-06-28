import { useState, useCallback } from 'react';
import imageCompression from 'browser-image-compression';
// ── PERF: FFmpeg is NOT imported at the top level anymore. ──
// The compression functions are disabled. If re-enabled, use dynamic import():
//   const { FFmpeg } = await import('@ffmpeg/ffmpeg');
// This saves ~25MB WASM from the initial bundle.

import { useAuth } from '../contexts/AuthContext';
import {
  getStoredKeyPair,
  encryptFile,
  decryptFile,
  encryptFileKey,
  decryptFileKeyWithFallback,
  decodeBase64,
  encodeBase64
} from '../lib/encryption';
import { usePartner } from './usePartner';
import { splitIntoByteChunks, deriveBlockNonce, generateVideoThumbnail as splitAndGetThumb, getAdaptiveChunkSize } from '../utils/videoChunker';


import nacl from 'tweetnacl';
import { supabase } from '../lib/supabase';
import { isNativeUploadAvailable, enqueueSingleChunk as nativeEnqueueSingleChunk, getUploadStatusForMessage } from '../lib/backgroundUpload';


export interface ProcessedMedia {
  url: string;
  thumbnail_url?: string;
  media_key: string; // The wrapped symmetric key
  media_key_nonce: string; // Nonce for the wrapped key
  media_nonce: string; // Nonce for the symmetric-encrypted data
  type: 'image' | 'video' | 'audio' | 'document' | 'gif';
  mime_type: string;  // Fix 4.3: Explicit MIME type for deterministic playback
  name?: string;
  size?: number;
}

let ffmpegInstance: any = null;
let ffmpegLoaded = false;

// Global cache for decrypted blobs to save egress and decryption CPU
const decryptedBlobCache = new Map<string, Blob>();
const MAX_CACHE_SIZE = 200;

// Fix 4.1: In-flight deduplication — if the same URL is being decrypted by two callers
// (e.g. a ChatBubble and a MemoriesCard both mount simultaneously), the second call
// waits for the SAME promise instead of spawning a duplicate fetch+decrypt.
const inflightDecryptions = new Map<string, Promise<Blob | null>>();

// Fix 4.4: File size limits to prevent runaway uploads
export const FILE_SIZE_LIMITS = {
  image: 50 * 1024 * 1024,        // 50 MB
  video: 1024 * 1024 * 1024,      // 1 GB  — chunked upload via processAndUploadChunked
  audio: 25 * 1024 * 1024,        // 25 MB
  document: 100 * 1024 * 1024,    // 100 MB
} as const;


// ─── Image Compression: Canvas → WebP ────────────────────────────────────────
// Bypasses browser-image-compression for better format support.
// Outputs WebP at 0.82 quality with max 1920px dimension → ~70-75% size reduction.

// @ts-ignore — compression disabled intentionally; kept for future re-enable
async function _compressImageToWebP(file: File): Promise<File> {
  const MAX_DIMENSION = 1920;
  const WEBP_QUALITY = 0.82;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { naturalWidth: w, naturalHeight: h } = img;

      // Scale down if larger than max dimension (maintain aspect ratio)
      if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / w, MAX_DIMENSION / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2D context unavailable')); return; }

      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('toBlob returned null')); return; }
          // Preserve original name but with .webp extension
          const baseName = file.name.replace(/\.[^/.]+$/, '');
          const webpFile = new File([blob], `${baseName}.webp`, { type: 'image/webp' });

          resolve(webpFile);
        },
        'image/webp',
        WEBP_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image failed to load for WebP conversion'));
    };

    img.src = objectUrl;
  });
}

// ─── Video Compression: WebCodecs (GPU) via Web Worker ────────────────────────
// Strategy:
//   1. Extract frames from video using a hidden <video> + canvas polling loop.
//   2. Send ImageBitmap frames to the worker (transferable, zero-copy).
//   3. Worker encodes them using VideoEncoder (hardware-accelerated H.264) + mp4-muxer.
//   4. If VideoEncoder is unsupported, worker signals { type: 'fallback' } and
//      we fall back to the existing FFmpeg WASM path.

// @ts-ignore — compression disabled intentionally; kept for future re-enable
async function _compressVideoWithWebCodecs(
  file: File,
  onProgress: (p: number) => void
): Promise<File | null> {
  // Quick feature check before expensive frame extraction
  if (typeof VideoEncoder === 'undefined') return null;

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const videoUrl = URL.createObjectURL(file);

    video.onloadedmetadata = async () => {
      const { videoWidth: srcW, videoHeight: srcH, duration } = video;

      // Compute output dimensions (max 720p, H.264 requires even dimensions)
      const MAX_H = 720;
      const ratio = srcH > MAX_H ? MAX_H / srcH : 1;
      let outW = Math.round(srcW * ratio);
      let outH = Math.round(srcH * ratio);
      if (outW % 2 !== 0) outW--;
      if (outH % 2 !== 0) outH--;

      const SAMPLE_FPS = 30;
      const frameCount = Math.ceil(duration * SAMPLE_FPS);

      onProgress(2); // Started

      const worker = new Worker(
        new URL('../workers/videoCompressor.worker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (e: MessageEvent) => {
        const { type } = e.data;
        if (type === 'init_done') {
          // Worker ready, begin frame extraction
          startExtraction();
        } else if (type === 'progress') {
          onProgress(30 + Math.round(e.data.progress * 0.65));
        } else if (type === 'complete') {
          worker.terminate();
          onProgress(100);
          resolve(new File([e.data.buffer as ArrayBuffer], file.name.replace(/\.[^/.]+$/, '.mp4'), { type: 'video/mp4' }));
        } else if (type === 'fallback') {
          worker.terminate();
          resolve(null);
        } else if (type === 'error') {
          worker.terminate();
          resolve(null);
        }
      };

      worker.onerror = () => {
        worker.terminate();
        resolve(null);
      };

      // 1. Initialize worker
      worker.postMessage({ type: 'init', outWidth: outW, outHeight: outH, fps: SAMPLE_FPS, totalFrames: frameCount });

      // 2. Stream frames
      const startExtraction = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d')!;
        
        let framesExtracted = 0;

        const captureNextFrame = (): Promise<void> => {
          return new Promise((resolveFrame) => {
            if (framesExtracted >= frameCount) { resolveFrame(); return; }
            video.currentTime = Math.min(framesExtracted / SAMPLE_FPS, duration - 0.001);

            const onSeeked = async () => {
              video.removeEventListener('seeked', onSeeked);
              ctx.drawImage(video, 0, 0, outW, outH);
              try {
                const bitmap = await createImageBitmap(canvas);
                worker.postMessage({ type: 'frame', bitmap, frameIndex: framesExtracted }, [bitmap]);
              } catch { /* skip bad frame */ }
              
              framesExtracted++;
              onProgress(5 + Math.round((framesExtracted / frameCount) * 25)); // 5-30%
              
              await captureNextFrame();
              resolveFrame();
            };
            video.addEventListener('seeked', onSeeked, { once: true });
          });
        };

        await captureNextFrame();
        URL.revokeObjectURL(videoUrl);
        video.remove();

        if (framesExtracted === 0) {
          worker.terminate();
          resolve(null);
          return;
        }

        // 3. Flush encoder
        worker.postMessage({ type: 'flush' });
      };
    };

    video.onerror = () => {
      URL.revokeObjectURL(videoUrl);
      resolve(null);
    };

    video.src = videoUrl;
  });
}

// ─── FFmpeg WASM Fallback ──────────────────────────────────────────────────────

// @ts-ignore — compression disabled intentionally; kept for future re-enable
async function _compressVideoWithFFmpeg(
  file: File,
  onProgress: (p: number) => void
): Promise<File> {
  if (!ffmpegInstance) {
    // @ts-ignore
    ffmpegInstance = new (window as any).FFmpeg();
  }
  if (!ffmpegLoaded) {
    await ffmpegInstance.load();
    ffmpegLoaded = true;
  }

  ffmpegInstance.on('progress', ({ progress }: any) => {
    onProgress(Math.round(progress * 100));
  });

  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp4';
  const cleanFileName = `input_compress.${ext}`;
  const cleanFile = new File([file], cleanFileName, { type: file.type });
  const inputName = `/workerfs/${cleanFileName}`;
  const outputName = 'output.mp4';

  // Mount file natively to avoid RAM crash on huge videos
  try { await ffmpegInstance.createDir('/workerfs'); } catch { /* ignore if exists */ }
  await ffmpegInstance.mount('WORKERFS' as any, { files: [cleanFile] }, '/workerfs');

  await ffmpegInstance.exec([
    '-i', inputName,
    '-c:v', 'libx264',
    '-crf', '28',
    '-vf', 'scale=-2:720',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    '-b:a', '128k',
    outputName,
  ]);

  const data = await ffmpegInstance.readFile(outputName);
  try { await ffmpegInstance.unmount('/workerfs'); } catch { /* ignore */ }
  return new File([data as any], file.name, { type: 'video/mp4' });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMedia() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Thumbnail uses WebP — much faster and smaller
  const generateThumbnail = async (file: File): Promise<Blob | null> => {
    if (!file.type.startsWith('image/')) return null;
    try {
      const options = {
        maxSizeMB: 0.05,
        maxWidthOrHeight: 200,
        useWebWorker: true,
        fileType: 'image/webp' as const,
        initialQuality: 0.7,
      };
      return await imageCompression(file, options);
    } catch (e) {
      return null;
    }
  };

  const processAndUpload = async (
    file: File,
    _options: { optimize?: boolean } = { optimize: true }
  ): Promise<ProcessedMedia | null> => {
    if (!user || !partner?.public_key) return null;

    // Fix 4.4: Enforce file size limits before any processing
    const fileType: keyof typeof FILE_SIZE_LIMITS =
      file.type.startsWith('image/') ? 'image' :
      file.type.startsWith('video/') ? 'video' :
      file.type.startsWith('audio/') ? 'audio' : 'document';
    if (file.size > FILE_SIZE_LIMITS[fileType]) {
      const limitMB = FILE_SIZE_LIMITS[fileType] / (1024 * 1024);
      throw new Error(`File exceeds ${limitMB}MB limit for ${fileType} files.`);
    }

    setIsProcessing(true);
    setUploadProgress(0);

    try {
      const myKeyPair = getStoredKeyPair();
      if (!myKeyPair) throw new Error('Private key missing');

      let fileToProcess = file;

      // ── Optimization ──────────────────────────────────────────────────────
      // if (options.optimize) {
      //   if (file.type.startsWith('image/') && file.type !== 'image/gif') {
      //     // NEW: Canvas → WebP (75% reduction, much faster than library)
      //     try {
      //       fileToProcess = await compressImageToWebP(file);
      //     } catch (err) {
      //       // Fallback to original library
      //       fileToProcess = await imageCompression(file, {
      //         maxSizeMB: 2,
      //         maxWidthOrHeight: 1920,
      //         useWebWorker: true,
      //       });
      //     }
      //   } else if (file.type.startsWith('video/')) {
      //     // NEW: Try WebCodecs first (GPU, 2-5s), fall back to FFmpeg WASM (CPU, 30s)
      //     setUploadProgress(2);
      //
      //
      //     const webCodecsResult = await compressVideoWithWebCodecs(file, setUploadProgress);
      //
      //     if (webCodecsResult) {
      //
      //       fileToProcess = webCodecsResult;
      //     } else {
      //       // Fallback to FFmpeg WASM
      //
      //       setUploadProgress(0);
      //       fileToProcess = await compressVideoWithFFmpeg(file, setUploadProgress);
      //     }
      //   }
      // }

      // ── Encryption (Symmetric) ────────────────────────────────────────────
      const arrayBuffer = await fileToProcess.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const { encryptedData, fileKey, nonce } = encryptFile(uint8Array);

      // ── Wrap Key (Asymmetric) ──────────────────────────────────────────────
      const { encryptedKey, nonce: keyNonce } = encryptFileKey(
        fileKey,
        decodeBase64(partner.public_key),
        myKeyPair.secretKey
      );

      // ── Upload Ciphertext ──────────────────────────────────────────────────
      const uploadFile = async (data: Uint8Array, type: 'raw' | 'image' = 'raw', filename?: string) => {
        const formData = new FormData();
        formData.append('file', new Blob([data as any]), filename || 'encrypted_file.raw');
        formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);

        const response = await fetch(
          `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/${type}/upload`,
          { method: 'POST', body: formData }
        );
        if (!response.ok) throw new Error('Upload failed');
        return await response.json();
      };

      const uploadResult = await uploadFile(encryptedData, 'raw', fileToProcess.name);

      // ── Thumbnail ──────────────────────────────────────────────────────
      let thumbnailUrl = '';
      const thumbBlob = await generateThumbnail(file);
      if (thumbBlob) {
        const thumbBuffer = await thumbBlob.arrayBuffer();
        const { encryptedData: thumbCipher } = encryptFile(new Uint8Array(thumbBuffer));
        const thumbResult = await uploadFile(thumbCipher, 'raw');
        thumbnailUrl = thumbResult.secure_url;
      }

      // Fix 4.3: Determine and return explicit MIME type
      const mimeType = file.type === 'image/gif' ? 'image/gif' :
                       file.type.startsWith('image/') ? 'image/webp' :
                       file.type.startsWith('video/') ? (fileToProcess.type || 'video/mp4') :
                       file.type.startsWith('audio/') ? (file.type || 'audio/webm') :
                       file.type || 'application/octet-stream';

      return {
        url: uploadResult.secure_url,
        thumbnail_url: thumbnailUrl || undefined,
        media_key: `${keyNonce}:${encryptedKey}`, // Packed for storage
        media_key_nonce: keyNonce,
        media_nonce: encodeBase64(nonce),
        type: (file.type === 'image/gif' || file.type.startsWith('image/')) ? 'image' :
              file.type.startsWith('video/') ? 'video' :
              file.type.startsWith('audio/') ? 'audio' : 'document',
        mime_type: mimeType, // Fix 4.3: explicit MIME to persist to DB
        name: file.name,
        size: file.size,
      };

    } catch (error) {
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  const getDecryptedBlob = useCallback(async (
    url: string,
    packedKey: string,
    mediaNonce: string,
    partnerPublicKey: string,
    senderPublicKey?: string | null,
    partnerKeyHistory?: string[],
    mediaType?: string | null   // Pass the known message type for correct MIME detection
  ): Promise<Blob | null> => {
    const shortUrl = url?.slice(-40) ?? 'null';
    const tag = `[useMedia][${shortUrl}]`;

    if (!user) { console.warn(`${tag} SKIP — no user`); return null; }
    const myKeyPair = getStoredKeyPair();
    if (!myKeyPair) { console.warn(`${tag} SKIP — no keypair in localStorage`); return null; }
    if (!url) { console.warn(`${tag} SKIP — url is empty`); return null; }
    if (!packedKey) { console.warn(`${tag} SKIP — packedKey is empty`); return null; }
    if (!mediaNonce) { console.warn(`${tag} SKIP — mediaNonce is empty`); return null; }
    if (!partnerPublicKey) { console.warn(`${tag} SKIP — partnerPublicKey is empty`); return null; }

    // Fix 4.1: Return cached blob immediately
    if (decryptedBlobCache.has(url)) {
      return decryptedBlobCache.get(url)!;
    }

    // Fix 4.1: If same URL is already being decrypted, wait for that promise
    if (inflightDecryptions.has(url)) {
      return inflightDecryptions.get(url)!;
    }

    const decryptionPromise = (async (): Promise<Blob | null> => {
      try {
        const [keyNonce, encryptedKey] = packedKey.split(':');
        if (!keyNonce || !encryptedKey) throw new Error('Invalid packed key — missing ":" separator. packedKey=' + packedKey?.slice(0,30));

        // NaCl box decryption: nacl.box.open(cipher, nonce, theirPublicKey, mySecretKey)
        // For a message I SENT:     "theirPublicKey" slot = Partner's public key
        // For a message I RECEIVED: "theirPublicKey" slot = partner's sender_public_key
        const isMine = senderPublicKey === encodeBase64(myKeyPair.publicKey);
        const primaryKey = isMine ? partnerPublicKey : (senderPublicKey || partnerPublicKey);

        // Try current partner key and all historical partner keys as fallbacks
        const passedHistory = partnerKeyHistory || [];
        const globalHistory = partner?.key_history?.map(k => k.public_key) || [];
        const combinedHistory = Array.from(new Set([...passedHistory, ...globalHistory]));
        const fallbackKeys = combinedHistory
          .filter(k => k !== primaryKey)
          .map(k => decodeBase64(k));

        const symmetricKey = decryptFileKeyWithFallback(
          encryptedKey, keyNonce,
          decodeBase64(primaryKey), myKeyPair.secretKey,
          fallbackKeys
        );
        if (!symmetricKey) {
          console.error(`${tag} FAILED — could not unwrap symmetric key. Tried primaryKey=${primaryKey?.slice(0,8)} + ${fallbackKeys.length} fallbacks.`);
          throw new Error('Failed to unwrap key');
        }

        const response = await fetch(url);
        if (!response.ok) {
          console.error(`${tag} fetch FAILED — HTTP ${response.status} ${response.statusText}`);
          return null;
        }
        const arrayBuffer = await response.arrayBuffer();
        const ciphertext = new Uint8Array(arrayBuffer);

        const decrypted = decryptFile(ciphertext, symmetricKey, decodeBase64(mediaNonce));
        if (!decrypted) {
          console.error(`${tag} FAILED — decryptFile returned null (wrong key or corrupted data?)`);
          return null;
        }

        // ── Magic-byte sniffing for reliable MIME detection ─────────────────────
        // Mobile cameras (iOS QuickTime, Android WebM) produce containers that
        // differ from the simple 'video/mp4' assumption. Sniffing the actual bytes
        // is the ONLY reliable way to get the correct MIME type.
        const sniffMime = (bytes: Uint8Array, hintType?: string | null): string => {
          // WebM / MKV: starts with 0x1A 0x45 0xDF 0xA3
          if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
            return hintType === 'audio' ? 'audio/webm' : 'video/webm';
          }
          // MP4 / QuickTime / MOV — check 'ftyp' box at offset 4 (bytes 4-7)
          // Signature: bytes[4..7] === 'ftyp'
          if (
            bytes.length >= 12 &&
            bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
          ) {
            // Major brand at bytes 8-11
            const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
            // QuickTime brands: 'qt  ', 'mqt '
            if (brand.startsWith('qt') || brand.startsWith('mqt')) return 'video/quicktime';
            // Common MP4 brands: 'isom', 'mp42', 'mp41', 'avc1', 'iso2', 'M4V ', 'f4v '
            return 'video/mp4';
          }
          // RIFF/AVI: starts with 'RIFF'
          if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
            return 'video/avi';
          }
          // OGG: starts with 'OggS'
          if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
            return hintType === 'audio' ? 'audio/ogg' : 'video/ogg';
          }
          // PNG: 0x89 'PNG'
          if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
          // JPEG: 0xFF 0xD8
          if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
          // GIF: 'GIF8'
          if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
          // WebP: 'RIFF' + 'WEBP'
          if (
            bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
          ) return 'image/webp';

          // ── Fallback: use hintType ─────────────────────────────────────────────
          if (hintType === 'audio') return 'audio/webm';
          if (hintType === 'video') return 'video/mp4';
          if (hintType === 'image') return 'image/webp';
          if (hintType === 'gif')   return 'image/gif';
          return 'application/octet-stream';
        };

        const mimeType = sniffMime(decrypted, mediaType);
        const blob = new Blob([decrypted as any], { type: mimeType });

        // Cache management (simple LRU by Map insertion order)
        if (decryptedBlobCache.size >= MAX_CACHE_SIZE) {
          const firstKey = decryptedBlobCache.keys().next().value;
          if (firstKey) decryptedBlobCache.delete(firstKey);
        }
        decryptedBlobCache.set(url, blob);

        return blob;
      } catch (error) {
        return null;
      } finally {
        // Fix 4.1: Remove from in-flight map once resolved (success or fail)
        inflightDecryptions.delete(url);
      }
    })();

    // Fix 4.1: Register the promise so concurrent callers can wait on it
    inflightDecryptions.set(url, decryptionPromise);
    return decryptionPromise;
  }, [user, partner]);

  const getRecentCachedMedia = useCallback((): { url: string; blob: Blob }[] => {
    return Array.from(decryptedBlobCache.entries())
      .filter(([_, blob]) => blob.type.startsWith('image/') || blob.type.startsWith('video/'))
      .map(([url, blob]) => ({ url, blob }))
      .reverse(); // Latest items to the top
  }, []);

  const getCacheSize = useCallback(() => {
    let size = 0;
    decryptedBlobCache.forEach(blob => {
      size += blob.size;
    });
    return size;
  }, []);

  const clearCache = useCallback(() => {
    // Note: We only clear the Blob references from the cache.
    // The blob URLs created by consumers (ChatBubble/MediaGridBubble via
    // URL.createObjectURL) are managed by those components' own useEffect cleanups.
    // We cannot revoke them here since we don't track them.
    decryptedBlobCache.clear();
  }, []);

  /**
   * Generates a video thumbnail from the first frame without FFmpeg.
   * Exposed so MessageInput can quickly create a thumbnail before chunking begins.
   */
  const generateVideoThumbnailFromFile = useCallback(async (file: File): Promise<Blob | null> => {
    return splitAndGetThumb(file);
  }, []);

  /**
   * processAndUploadChunked — v4: Per-Block Encrypt + Immediate Streaming Delivery.
   *
   * Architecture (YouTube/WhatsApp-style progressive streaming):
   *   1. Read entire video file into memory.
   *   2. Generate ONE symmetric key + ONE base nonce for the whole video.
   *   3. Split plaintext into 5MB blocks.
   *   4. For each block i: encrypt with deriveBlockNonce(baseNonce, i) → independent ciphertext.
   *   5. Upload blocks in parallel (limit 5).
   *   6. IMMEDIATELY after each block uploads: insert DB row → receiver gets realtime event.
   *   7. Receiver can decrypt chunk i independently using deriveBlockNonce(baseNonce, i).
   *   8. Receiver plays via MSE as chunks arrive — no wait for full upload.
   *
   * Thumbnail is uploaded FIRST (before any block), so wife sees it instantly.
   */
  const processAndUploadChunked = useCallback(async (
    fileToChunk: File,
    messageId: string,
    senderId: string,
    receiverId: string,
    onStatusChange: (status: string) => void,
    durationOverride?: number
  ): Promise<boolean> => {
    if (!user || !partner?.public_key) return false;
    const myKeyPair = getStoredKeyPair();
    if (!myKeyPair) return false;

    try {
      // ── Step 1: Get video duration ──────────────────────────────────────
      onStatusChange('Preparing video...');
      let videoDuration = durationOverride;
      if (videoDuration === undefined) {
        const { getVideoDuration } = await import('../utils/videoChunker');
        videoDuration = await getVideoDuration(fileToChunk);
      }

      // ── Step 2: Sender-side local preview (instant, no upload needed) ───
      import('./useVideoChunks').then(m => {
        m.addLocalVideoForSender(messageId, fileToChunk, videoDuration!);
      }).catch(() => {});

      // ── Step 3: Generate ONE key + ONE base nonce for the whole video ───
      const fileKey = nacl.randomBytes(nacl.secretbox.keyLength);  // 32 bytes
      const baseNonce = nacl.randomBytes(nacl.secretbox.nonceLength); // 24 bytes

      // Wrap symmetric key for receiver (asymmetric box)
      const { encryptedKey: receiverEncKey, nonce: receiverKeyNonce } = encryptFileKey(
        fileKey,
        decodeBase64(partner.public_key!),
        myKeyPair.secretKey
      );
      // Wrap for sender too (so I can watch my own video after page reload)
      const { encryptedKey: senderEncKey, nonce: senderKeyNonce } = encryptFileKey(
        fileKey,
        myKeyPair.publicKey,
        myKeyPair.secretKey
      );
      const packedKey = `${receiverKeyNonce}:${receiverEncKey}|${senderKeyNonce}:${senderEncKey}`;
      const baseNonceB64 = encodeBase64(baseNonce);

      // ── Step 4: Split plaintext into adaptive-size blocks ───────────────
      // Web: up to 8MB per chunk (no bridge overhead, fewer API calls).
      // Native: 2MB per chunk (bridge Base64 safety limit).
      const chunkSize = getAdaptiveChunkSize(isNativeUploadAvailable());
      onStatusChange('Encrypting video...');
      const arrayBuffer = await fileToChunk.arrayBuffer();
      const plaintext = new Uint8Array(arrayBuffer);
      const blocks = splitIntoByteChunks(plaintext, chunkSize);
      const totalChunks = blocks.length;

      // ── Step 5 & 6: Per-block encrypt → upload → IMMEDIATELY insert DB ─
      // Each block gets its own nonce derived from baseNonce XOR blockIndex.
      // This means receiver can decrypt ANY block independently.
      // We insert the DB row right after upload (not after ALL uploads),
      // so receiver gets realtime events as each block finishes — streaming!

      // ── NATIVE BACKGROUND PATH ─────────────────────────────────────────
      // Encrypt + enqueue one block at a time (3 in parallel) to WorkManager.
      // This avoids holding ALL encrypted blocks in memory simultaneously
      // (previously caused OOM on large videos), and keeps bridge calls
      // overlapped for faster enqueue throughput.
      if (isNativeUploadAvailable()) {
        onStatusChange('Encrypting & queuing video...');

        let enqueuedCount = 0;
        let allEnqueued = true;

        // Encrypt + enqueue with rolling parallelism (3 concurrent bridge calls)
        const NATIVE_PARALLEL = 3;
        const nativeTasks = new Set<Promise<void>>();

        for (let i = 0; i < totalChunks; i++) {
          const blockIndex = i;
          const task = (async () => {
            const blockNonce = deriveBlockNonce(baseNonce, blockIndex);
            const encryptedBlock = nacl.secretbox(blocks[blockIndex].data, blockNonce, fileKey);
            if (!encryptedBlock) throw new Error(`Encryption failed for block ${blockIndex}`);

            const ok = await nativeEnqueueSingleChunk(
              encryptedBlock,
              blockIndex,
              messageId,
              totalChunks,
              packedKey,
              baseNonceB64,
              Math.round(videoDuration!),
              senderId,
              receiverId,
            );
            if (!ok) allEnqueued = false;
            enqueuedCount++;
            onStatusChange(`Queuing ${enqueuedCount}/${totalChunks} chunks...`);
          })();

          nativeTasks.add(task);
          task.finally(() => nativeTasks.delete(task));
          if (nativeTasks.size >= NATIVE_PARALLEL) await Promise.race(nativeTasks);
        }
        await Promise.all(nativeTasks);

        if (allEnqueued) {
          // Poll WorkManager status until all chunks uploaded
          let isDone = false;
          let retryCount = 0;
          while (!isDone) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            const status = await getUploadStatusForMessage(messageId);
            if (!status) {
              retryCount++;
              if (retryCount > 10) break;
              continue;
            }
            retryCount = 0;

            if (status.total > 0) {
              const uploaded = status.succeeded;
              const total = status.total;
              onStatusChange(`Uploading (${uploaded}/${total} chunks)...`);

              if (status.failed > 0) {
                console.error(`[useMedia] Native upload failed for some chunks:`, status);
                throw new Error('Some video chunks failed to upload');
              }

              if (uploaded === total) isDone = true;
            } else {
              onStatusChange('Uploading in background...');
            }
          }
        } else {
          // Some chunks failed to enqueue — fall through to web JS path
          await jsUploadPath();
        }
      } else {
        // ── WEB PATH (fetch-based uploads) ───────────────────────────────
        await jsUploadPath();
      }

      // Extracted JS upload path into a function for reuse as fallback
      async function jsUploadPath() {
        const uploadBlock = async (data: Uint8Array): Promise<string> => {
          const formData = new FormData();
          formData.append('file', new Blob([data as unknown as BlobPart]), 'chunk.enc');
          formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
          const res = await fetch(
            `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/raw/upload`,
            { method: 'POST', body: formData }
          );
          if (!res.ok) {
            let errText = '';
            try { errText = await res.text(); } catch {}
            throw new Error(`Cloudinary upload failed (HTTP ${res.status}): ${errText}`);
          }
          return (await res.json()).secure_url as string;
        };

        const encryptAndUploadAndInsert = async (blockIndex: number) => {
          // 1. Derive unique nonce for this block
          const blockNonce = deriveBlockNonce(baseNonce, blockIndex);
          // 2. Encrypt THIS block independently
          const encryptedBlock = nacl.secretbox(
            blocks[blockIndex].data,
            blockNonce,
            fileKey
          );
          if (!encryptedBlock) throw new Error(`Encryption failed for block ${blockIndex}`);
          // 3. Upload encrypted block
          onStatusChange(`Uploading ${blockIndex + 1}/${totalChunks}...`);
          const chunkUrl = await uploadBlock(encryptedBlock);
          // 4. IMMEDIATELY insert DB row → triggers realtime on receiver
          const { error } = await supabase.from('video_chunks').insert({
            message_id: messageId,
            chunk_index: blockIndex,
            total_chunks: totalChunks,
            chunk_url: chunkUrl,
            chunk_key: packedKey,      // same for all — key is video-level
            chunk_nonce: baseNonceB64, // base nonce — receiver derives per-block nonce
            duration: Math.round(videoDuration!),
            sender_id: senderId,
            receiver_id: receiverId,
          });
          if (error) throw new Error(`DB insert failed for block ${blockIndex}: ${error.message}`);
        };

        // Parallel upload with limit 3.
        // With 8MB chunks, 3 concurrent uploads fills most connections without
        // saturating the upload bandwidth or stalling the JS event loop.
        const PARALLEL_LIMIT = 3;
        const activeTasks = new Set<Promise<void>>();
        for (let i = 0; i < totalChunks; i++) {
          const task = encryptAndUploadAndInsert(i);
          activeTasks.add(task);
          task.finally(() => activeTasks.delete(task));
          if (activeTasks.size >= PARALLEL_LIMIT) await Promise.race(activeTasks);
        }
        await Promise.all(activeTasks);
      }

      onStatusChange('Done');
      return true;
    } catch (err) {
      console.error('[processAndUploadChunked] Error:', err);
      return false;
    }
  }, [user, partner]);

  return { processAndUpload, processAndUploadChunked, generateVideoThumbnailFromFile, getDecryptedBlob, getRecentCachedMedia, getCacheSize, clearCache, isProcessing, uploadProgress };
}
