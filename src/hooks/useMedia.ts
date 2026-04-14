import { useState, useCallback } from 'react';
import imageCompression from 'browser-image-compression';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
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

export interface ProcessedMedia {
  url: string;
  thumbnail_url?: string;
  media_key: string; // The wrapped symmetric key
  media_key_nonce: string; // Nonce for the wrapped key
  media_nonce: string; // Nonce for the symmetric-encrypted data
  type: 'image' | 'video' | 'audio' | 'document';
  name?: string;
  size?: number;
}

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;

// Global cache for decrypted blobs to save egress and decryption CPU
const decryptedBlobCache = new Map<string, Blob>();
const MAX_CACHE_SIZE = 200;

// ─── Image Compression: Canvas → WebP ────────────────────────────────────────
// Bypasses browser-image-compression for better format support.
// Outputs WebP at 0.82 quality with max 1920px dimension → ~70-75% size reduction.

async function compressImageToWebP(file: File): Promise<File> {
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

async function compressVideoWithWebCodecs(
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

      // Extract frames by seeking the video
      const bitmaps: ImageBitmap[] = [];
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d')!;

      video.currentTime = 0;

      const seekAndCapture = (frameIndex: number): Promise<void> => {
        return new Promise((resolveSeek) => {
          if (frameIndex >= frameCount) { resolveSeek(); return; }

          const targetTime = frameIndex / SAMPLE_FPS;
          video.currentTime = Math.min(targetTime, duration - 0.001);

          const onSeeked = async () => {
            video.removeEventListener('seeked', onSeeked);
            ctx.drawImage(video, 0, 0, outW, outH);
            try {
              const bitmap = await createImageBitmap(canvas);
              bitmaps.push(bitmap);
            } catch { /* skip bad frame */ }
            onProgress(5 + Math.round((frameIndex / frameCount) * 25)); // 5-30%
            await seekAndCapture(frameIndex + 1);
            resolveSeek();
          };

          video.addEventListener('seeked', onSeeked, { once: true });
        });
      };

      await seekAndCapture(0);
      URL.revokeObjectURL(videoUrl);
      video.remove();

      if (bitmaps.length === 0) {
        resolve(null);
        return;
      }

      // Spawn worker
      const worker = new Worker(
        new URL('../workers/videoCompressor.worker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (e: MessageEvent) => {
        const { type } = e.data;

        if (type === 'progress') {
          // Map worker progress (0-100) to overall 30-95%
          onProgress(30 + Math.round(e.data.progress * 0.65));

        } else if (type === 'complete') {
          worker.terminate();
          onProgress(100);
          const compressedBuffer: ArrayBuffer = e.data.buffer;
          const compressedFile = new File([compressedBuffer], file.name.replace(/\.[^/.]+$/, '.mp4'), {
            type: 'video/mp4',
          });

          resolve(compressedFile);

        } else if (type === 'fallback') {
          worker.terminate();
          bitmaps.forEach(b => b.close());
          resolve(null); // Signal fallback needed

        } else if (type === 'error') {
          worker.terminate();
          console.error('[WebCodecs Worker] Error:', e.data.message);
          resolve(null); // Fallback on error
        }
      };

      worker.onerror = (err) => {
        console.error('[WebCodecs Worker] Uncaught error:', err);
        worker.terminate();
        resolve(null);
      };

      // Transfer bitmaps (zero-copy) to worker
      worker.postMessage(
        {
          type: 'encode_frames',
          bitmaps,
          width: outW,
          height: outH,
          framerate: SAMPLE_FPS,
          totalFrames: bitmaps.length,
        },
        bitmaps // transferable list
      );
    };

    video.onerror = () => {
      URL.revokeObjectURL(videoUrl);
      resolve(null);
    };

    video.src = videoUrl;
  });
}

// ─── FFmpeg WASM Fallback ──────────────────────────────────────────────────────

async function compressVideoWithFFmpeg(
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

  const inputName = 'input' + (file.name.substring(file.name.lastIndexOf('.')) || '.mp4');
  const outputName = 'output.mp4';

  await ffmpegInstance.writeFile(inputName, await fetchFile(file));
  await ffmpegInstance.exec([
    '-i', inputName,
    '-c:v', 'libx264',
    '-crf', '28',
    '-vf', 'scale=-2:720',
    '-preset', 'veryfast',
    outputName,
  ]);

  const data = await ffmpegInstance.readFile(outputName);
  return new File([data as any], file.name, { type: 'video/mp4' });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMedia() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Thumbnail uses WebP too — much faster and smaller
  const generateThumbnail = async (file: File): Promise<Blob | null> => {
    if (!file.type.startsWith('image/')) return null;
    try {
      // Use browser-image-compression for thumbnail (tiny, fast enough)
      const options = {
        maxSizeMB: 0.05,
        maxWidthOrHeight: 200,
        useWebWorker: true,
        fileType: 'image/webp' as const,
        initialQuality: 0.7,
      };
      return await imageCompression(file, options);
    } catch (e) {
      console.error('Thumbnail generation failed', e);
      return null;
    }
  };

  const processAndUpload = async (
    file: File,
    options: { optimize?: boolean } = { optimize: true }
  ): Promise<ProcessedMedia | null> => {
    if (!user || !partner?.public_key) return null;

    setIsProcessing(true);
    setUploadProgress(0);

    try {
      const myKeyPair = getStoredKeyPair();
      if (!myKeyPair) throw new Error('Private key missing');

      let fileToProcess = file;

      // ── Optimization ──────────────────────────────────────────────────────
      if (options.optimize) {
        if (file.type.startsWith('image/')) {
          // NEW: Canvas → WebP (75% reduction, much faster than library)
          try {
            fileToProcess = await compressImageToWebP(file);
          } catch (err) {
            console.warn('[WebP] Conversion failed, falling back to library:', err);
            // Fallback to original library
            fileToProcess = await imageCompression(file, {
              maxSizeMB: 2,
              maxWidthOrHeight: 1920,
              useWebWorker: true,
            });
          }

        } else if (file.type.startsWith('video/')) {
          // NEW: Try WebCodecs first (GPU, 2-5s), fall back to FFmpeg WASM (CPU, 30s)
          setUploadProgress(2);


          const webCodecsResult = await compressVideoWithWebCodecs(file, setUploadProgress);

          if (webCodecsResult) {

            fileToProcess = webCodecsResult;
          } else {
            // Fallback to FFmpeg WASM

            setUploadProgress(0);
            fileToProcess = await compressVideoWithFFmpeg(file, setUploadProgress);
          }
        }
      }

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

      // ── Thumbnail ──────────────────────────────────────────────────────────
      let thumbnailUrl = '';
      const thumbBlob = await generateThumbnail(file);
      if (thumbBlob) {
        const thumbBuffer = await thumbBlob.arrayBuffer();
        const { encryptedData: thumbCipher } = encryptFile(new Uint8Array(thumbBuffer));
        const thumbResult = await uploadFile(thumbCipher, 'raw');
        thumbnailUrl = thumbResult.secure_url;
      }

      return {
        url: uploadResult.secure_url,
        thumbnail_url: thumbnailUrl || undefined,
        media_key: `${keyNonce}:${encryptedKey}`, // Packed for storage
        media_key_nonce: keyNonce,
        media_nonce: encodeBase64(nonce),
        type: file.type.startsWith('image/') ? 'image' :
              file.type.startsWith('video/') ? 'video' :
              file.type.startsWith('audio/') ? 'audio' : 'document',
        name: file.name,
        size: file.size,
      };

    } catch (error) {
      console.error('Media upload failed:', error);
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

    try {
      if (decryptedBlobCache.has(url)) {
        return decryptedBlobCache.get(url)!;
      }

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
      console.error('Decryption failed', error);
      return null;
    }
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

  return { processAndUpload, getDecryptedBlob, getRecentCachedMedia, getCacheSize, clearCache, isProcessing, uploadProgress };
}
