import { useState, useCallback } from 'react';
import imageCompression from 'browser-image-compression';
import { FFmpeg } from '@ffmpeg/ffmpeg';

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
import { splitVideoIntoChunksStreaming, generateVideoThumbnail as splitAndGetThumb } from '../utils/videoChunker';
import { supabase } from '../lib/supabase';

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

let ffmpegInstance: FFmpeg | null = null;
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
  image: 50 * 1024 * 1024,   // 50 MB
  video: 200 * 1024 * 1024,  // 200 MB (video before compression)
  audio: 25 * 1024 * 1024,   // 25 MB
  document: 100 * 1024 * 1024, // 100 MB
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
    ffmpegInstance = new FFmpeg();
  }
  if (!ffmpegLoaded) {
    await ffmpegInstance.load();
    ffmpegLoaded = true;
  }

  ffmpegInstance.on('progress', ({ progress }) => {
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

    console.log(`%c[Media Pipeline] Starting process/upload for: ${file.name} (${file.type})`, 'color: #3b82f6; font-weight: bold;');

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

        console.log(`%c[Media Pipeline] Starting upload: ${filename || 'file'}`, 'color: #f59e0b; font-weight: bold;');
        const response = await fetch(
          `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/${type}/upload`,
          { method: 'POST', body: formData }
        );
        if (!response.ok) throw new Error('Upload failed');
        return await response.json();
      };

      const uploadResult = await uploadFile(encryptedData, 'raw', fileToProcess.name);
      console.log(`%c[Media Pipeline] Upload successful: ${file.name}`, 'color: #10b981; font-weight: bold;', {
        url: uploadResult.secure_url,
        size: file.size,
        type: file.type
      });

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
      console.error(`%c[Media Pipeline] FAILED: ${file.name}`, 'color: #ef4444; font-weight: bold;', error);
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
    if (!user) return null;
    const myKeyPair = getStoredKeyPair();
    if (!myKeyPair) return null;

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
        if (!keyNonce || !encryptedKey) throw new Error('Invalid packed key');

        // NaCl box decryption: nacl.box.open(cipher, nonce, theirPublicKey, mySecretKey)
        // For a message I SENT:     "theirPublicKey" slot = Partner's public key
        // For a message I RECEIVED: "theirPublicKey" slot = partner's sender_public_key
        const isMine = senderPublicKey === encodeBase64(myKeyPair.publicKey);
        const primaryKey = isMine ? partnerPublicKey : (senderPublicKey || partnerPublicKey);

        // Try current partner key and all historical partner keys as fallbacks
        const fallbackKeys = (partnerKeyHistory || [])
          .filter(k => k !== primaryKey)
          .map(k => decodeBase64(k));

        const symmetricKey = decryptFileKeyWithFallback(
          encryptedKey, keyNonce,
          decodeBase64(primaryKey), myKeyPair.secretKey,
          fallbackKeys
        );
        if (!symmetricKey) throw new Error('Failed to unwrap key');

        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const ciphertext = new Uint8Array(arrayBuffer);

        const decrypted = decryptFile(ciphertext, symmetricKey, decodeBase64(mediaNonce));
        if (!decrypted) return null;

        // Determine MIME type: prefer the explicit mediaType param (from message.type)
        // Cloudinary raw upload URLs don't have file extensions, so URL-sniffing is unreliable
        let mimeType = 'application/octet-stream';
        if (mediaType === 'audio') {
          mimeType = 'audio/webm';
        } else if (mediaType === 'video') {
          mimeType = 'video/mp4';
        } else if (mediaType === 'image') {
          // WebP images won't have extension in Cloudinary raw URLs — default to webp
          if (url.includes('.png')) mimeType = 'image/png';
          else if (url.includes('.gif')) mimeType = 'image/gif';
          else if (url.includes('.webp')) mimeType = 'image/webp';
          else mimeType = 'image/webp'; // Default to WebP since we now compress to WebP
        } else if (mediaType === 'gif') {
          mimeType = 'image/gif';
        } else {
          // Fallback: sniff from URL when no type provided
          if (url.includes('.webm')) mimeType = 'audio/webm';
          else if (url.includes('.mp4')) mimeType = 'video/mp4';
          else if (url.includes('.jpg') || url.includes('.jpeg')) mimeType = 'image/jpeg';
          else if (url.includes('.png')) mimeType = 'image/png';
          else if (url.includes('.gif')) mimeType = 'image/gif';
          else if (url.includes('.mp3')) mimeType = 'audio/mpeg';
          else if (url.includes('.ogg')) mimeType = 'audio/ogg';
          else mimeType = 'image/webp'; // Default for unknown image types
        }

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
  }, [user]);

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
    decryptedBlobCache.forEach((_, url) => URL.revokeObjectURL(url));
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
   * processAndUploadChunked — Progressive chunked video pipeline.
   *
   * 1. Splits the (optionally compressed) video into 15-second chunks via FFmpeg WASM.
   * 2. For each chunk: encrypt → upload to Cloudinary → insert row into video_chunks.
   * 3. Calls onStatusChange(text) before each phase so the UI can animate the text.
   *
   * The caller is responsible for:
   *   - Already having created the optimistic message in Supabase (with thumbnail_url, media_url=null).
   *   - Removing the shimmer overlay once all chunks are uploaded.
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
      onStatusChange('Preparing video...');

      // Helper: upload raw encrypted bytes to Cloudinary
      const uploadEncryptedBytes = async (data: Uint8Array): Promise<string> => {
        const formData = new FormData();
        formData.append('file', new Blob([data as unknown as BlobPart]), 'chunk.raw');
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
        const json = await res.json();
        return json.secure_url as string;
      };

      type EncryptedChunk = {
        encryptedData: Uint8Array;
        chunkKey: string;
        chunkNonce: string;
        index: number;
        durationSec: number;
        totalChunks: number;
      };

      // Encrypt a single chunk
      const encryptChunk = async (chunk: { file: File; index: number; durationSec: number }, total: number): Promise<EncryptedChunk> => {
        const arrayBuffer = await chunk.file.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        const { encryptedData, fileKey, nonce } = encryptFile(uint8);
        const { encryptedKey, nonce: keyNonce } = encryptFileKey(
          fileKey,
          decodeBase64(partner.public_key!),
          myKeyPair.secretKey
        );
        return {
          encryptedData,
          chunkKey: `${keyNonce}:${encryptedKey}`,
          chunkNonce: encodeBase64(nonce),
          index: chunk.index,
          durationSec: chunk.durationSec,
          totalChunks: total,
        };
      };

      const uploadEncryptedChunk = async (enc: EncryptedChunk): Promise<{ enc: EncryptedChunk, chunkUrl: string }> => {
        const chunkUrl = await uploadEncryptedBytes(enc.encryptedData);
        return { enc, chunkUrl };
      };

      const insertChunkToDB = async (enc: EncryptedChunk, chunkUrl: string): Promise<void> => {
        const { error } = await supabase.from('video_chunks').insert({
          message_id: messageId,
          chunk_index: enc.index,
          total_chunks: enc.totalChunks,
          chunk_url: chunkUrl,
          chunk_key: enc.chunkKey,
          chunk_nonce: enc.chunkNonce,
          duration: Math.round(enc.durationSec),
          sender_id: senderId,
          receiver_id: receiverId,
        });
        if (error) throw new Error(`Failed to insert chunk ${enc.index}: ${error.message}`);
      };

      // We need total chunk count upfront for the DB rows — get video duration first
      const CHUNK_DURATION_SEC = 5; // Reduced to 5s to guarantee chunks < 10MB for Cloudinary (even with VBR spikes on Desktop 8Mbps)
      let videoDuration = durationOverride;
      if (videoDuration === undefined) {
        const { getVideoDuration } = await import('../utils/videoChunker');
        videoDuration = await getVideoDuration(fileToChunk);
      }
      let totalChunks = Math.ceil(videoDuration / CHUNK_DURATION_SEC);
      if (!isFinite(totalChunks) || totalChunks <= 0) totalChunks = 12; // 60s estimate fallback
      let actualChunksYielded = 0;

      onStatusChange('Processing chunk 1...');

      const PARALLEL_LIMIT = 5;
      let nextDeliverIndex = 0;
      const uploadedChunksQueue = new Map<number, {enc: EncryptedChunk, chunkUrl: string}>();
      let isDelivering = false;
      let deliveryError: any = null;

      const tryDeliverQueue = async () => {
        if (isDelivering || deliveryError) return;
        isDelivering = true;
        try {
          while (true) {
            if (nextDeliverIndex === 0) {
              if (totalChunks === 1) {
                if (uploadedChunksQueue.has(0)) {
                  const item = uploadedChunksQueue.get(0)!;
                  uploadedChunksQueue.delete(0);
                  onStatusChange(`Delivering chunk 1 of 1...`);
                  await insertChunkToDB(item.enc, item.chunkUrl);
                  nextDeliverIndex++;
                } else break;
              } else {
                if (uploadedChunksQueue.has(0) && uploadedChunksQueue.has(1)) {
                  const item0 = uploadedChunksQueue.get(0)!;
                  const item1 = uploadedChunksQueue.get(1)!;
                  uploadedChunksQueue.delete(0);
                  uploadedChunksQueue.delete(1);
                  onStatusChange(`Delivering chunks 1 & 2 of ${totalChunks}...`);
                  await insertChunkToDB(item0.enc, item0.chunkUrl);
                  await insertChunkToDB(item1.enc, item1.chunkUrl);
                  nextDeliverIndex += 2;
                } else break;
              }
            } else {
              if (uploadedChunksQueue.has(nextDeliverIndex)) {
                const item = uploadedChunksQueue.get(nextDeliverIndex)!;
                uploadedChunksQueue.delete(nextDeliverIndex);
                onStatusChange(`Delivering chunk ${item.enc.index + 1} of ${totalChunks}...`);
                await insertChunkToDB(item.enc, item.chunkUrl);
                nextDeliverIndex++;
              } else break;
            }
          }
        } catch (err) {
            deliveryError = err;
        } finally {
          isDelivering = false;
          if (!deliveryError) {
             const canDeliverMore = nextDeliverIndex === 0 
                ? (totalChunks === 1 ? uploadedChunksQueue.has(0) : uploadedChunksQueue.has(0) && uploadedChunksQueue.has(1))
                : uploadedChunksQueue.has(nextDeliverIndex);
             if (canDeliverMore) {
                tryDeliverQueue();
             }
          }
        }
      };

      const processChunkAsync = async (chunk: any) => {
        
        const encrypted = await encryptChunk(chunk, totalChunks);
        
        const result = await uploadEncryptedChunk(encrypted);
        
        uploadedChunksQueue.set(chunk.index, result);
        tryDeliverQueue(); 
      };

      const activeTasks = new Set<Promise<void>>();
      const allTasks: Promise<void>[] = [];

      for await (const chunk of splitVideoIntoChunksStreaming(fileToChunk, CHUNK_DURATION_SEC)) {
        if (deliveryError) throw deliveryError;

        actualChunksYielded++;

        import('./useVideoChunks').then(m => {
          m.addLocalChunkForSender(messageId, chunk.index, totalChunks, chunk.file, chunk.durationSec);
        }).catch(() => {});

        const task = processChunkAsync(chunk);
        allTasks.push(task);
        activeTasks.add(task);

        task.finally(() => {
          activeTasks.delete(task);
        });

        if (activeTasks.size >= PARALLEL_LIMIT) {
          await Promise.race(activeTasks);
        }
      }

      await Promise.all(allTasks);

      // FFmpeg may yield fewer chunks than estimated (e.g. lack of keyframes)
      // or even 0 chunks if the video is extremely short or corrupted.
      if (actualChunksYielded !== totalChunks) {
        totalChunks = actualChunksYielded;
        
        if (actualChunksYielded > 0) {
          // Re-trigger delivery queue in case it was waiting for chunks that will never arrive
          tryDeliverQueue();
          
          // Update any already inserted rows with the correct total
          await supabase.from('video_chunks')
            .update({ total_chunks: totalChunks })
            .eq('message_id', messageId);

          // Update local store so sender-side preview doesn't wait for non-existent chunks
          import('./useVideoChunks').then(m => {
            m.updateTotalChunksForSender(messageId, totalChunks);
          }).catch(() => {});
        }
      }

      while (nextDeliverIndex < totalChunks) {
        if (deliveryError) throw deliveryError;
        if (actualChunksYielded === 0) break; // Safety break if no chunks were ever produced
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      if (actualChunksYielded === 0) {
        throw new Error('Video processing failed: No chunks were produced.');
      }

      onStatusChange('Done');
      return true;
    } catch (err) {
      
      return false;
    }
  }, [user, partner]);

  return { processAndUpload, processAndUploadChunked, generateVideoThumbnailFromFile, getDecryptedBlob, getRecentCachedMedia, getCacheSize, clearCache, isProcessing, uploadProgress };
}
