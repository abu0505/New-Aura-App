/**
 * backgroundUpload.ts — TypeScript bridge for the native BackgroundUpload Capacitor plugin.
 *
 * This module wraps the Android-native WorkManager-backed upload system,
 * providing a clean API for the React hooks (useMedia, useChat) to use.
 *
 * On web (non-Capacitor), all methods are no-ops that return false,
 * so the existing fetch()-based upload path is used instead.
 *
 * Architecture:
 *   useMedia.ts / useChat.ts
 *     → isNativeUploadAvailable() ? backgroundUpload() : fetch()
 *     → BackgroundUpload plugin → WorkManager → survives app kill
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase } from './supabase';

// ── Plugin Interface ──────────────────────────────────────────────────────

interface EnqueueUploadOptions {
  taskId: string;
  encryptedBase64: string;
  cloudinaryPreset: string;
  cloudinaryCloudName: string;
  uploadType: 'raw' | 'image';
  supabaseUrl: string;
  supabaseKey: string;
  supabaseAccessToken: string;
  dbPayload: string;  // JSON string of the messages row
  fileName: string;
}

interface EnqueueChunkedOptions {
  messageId: string;
  totalChunks: number;
  chunkIndex: number;
  chunk: string;  // Base64-encoded encrypted chunk data
  cloudinaryPreset: string;
  cloudinaryCloudName: string;
  supabaseUrl: string;
  supabaseKey: string;
  supabaseAccessToken: string;
  packedKey: string;
  baseNonce: string;
  duration: number;
  senderId: string;
  receiverId: string;
}

interface EnqueueTextOptions {
  taskId: string;
  supabaseUrl: string;
  supabaseKey: string;
  supabaseAccessToken: string;
  dbPayload: string;  // JSON string of the messages row
  triggerPush: boolean;
}

interface QueueStatus {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  total: number;
}

interface BackgroundUploadPlugin {
  enqueueUpload(options: EnqueueUploadOptions): Promise<{ taskId: string; enqueued: boolean }>;
  enqueueChunkedUpload(options: EnqueueChunkedOptions): Promise<{ messageId: string; chunkIndex: number; enqueued: boolean }>;
  enqueueTextMessage(options: EnqueueTextOptions): Promise<{ taskId: string; enqueued: boolean }>;
  getQueueStatus(): Promise<QueueStatus>;
  getUploadStatusForMessage(options: { messageId: string }): Promise<{
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    total: number;
    isCompleted: boolean;
  }>;
  cancelUpload(options: { taskId: string }): Promise<{ cancelled: boolean }>;
  retryFailed(): Promise<{ pruned: boolean }>;
}

// ── Plugin Registration ───────────────────────────────────────────────────

const BackgroundUpload = registerPlugin<BackgroundUploadPlugin>('BackgroundUpload');

// ── Helper: Check if native background upload is available ────────────────

/**
 * Returns true if we're running on a native platform (Android)
 * where the BackgroundUpload plugin is available.
 */
export function isNativeUploadAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

// ── Helper: Get fresh Supabase credentials ────────────────────────────────

async function getSupabaseCredentials(): Promise<{
  url: string;
  key: string;
  accessToken: string;
} | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    return {
      url: import.meta.env.VITE_SUPABASE_URL,
      key: import.meta.env.VITE_SUPABASE_ANON_KEY,
      accessToken: session.access_token,
    };
  } catch {
    return null;
  }
}

// ── Helper: Convert Uint8Array to base64 string ───────────────────────────

function uint8ArrayToBase64(data: Uint8Array): string {
  // Use chunked approach to avoid call stack overflow on large arrays
  const CHUNK_SIZE = 0x8000; // 32KB
  let result = '';
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.subarray(i, Math.min(i + CHUNK_SIZE, data.length));
    result += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(result);
}

// ── Public API: Enqueue Media Upload ──────────────────────────────────────

/**
 * Enqueue an encrypted media file for background upload to Cloudinary + Supabase.
 *
 * @param encryptedData - The NaCl-encrypted media bytes
 * @param dbPayload - The messages row to insert (with __CLOUDINARY_URL_PLACEHOLDER__ for URL)
 * @param fileName - Original filename for Cloudinary
 * @param uploadType - 'raw' for encrypted files, 'image' for thumbnails
 * @returns taskId if enqueued successfully, null if native upload not available
 */
export async function enqueueMediaUpload(
  encryptedData: Uint8Array,
  dbPayload: Record<string, any>,
  fileName: string = 'encrypted_file.raw',
  uploadType: 'raw' | 'image' = 'raw'
): Promise<string | null> {
  if (!isNativeUploadAvailable()) return null;

  const creds = await getSupabaseCredentials();
  if (!creds) return null;

  const taskId = dbPayload.id || crypto.randomUUID();

  try {
    // Use placeholder URL in payload — worker will replace with actual Cloudinary URL
    const payloadWithPlaceholder = {
      ...dbPayload,
      media_url: '__CLOUDINARY_URL_PLACEHOLDER__',
    };

    const result = await BackgroundUpload.enqueueUpload({
      taskId,
      encryptedBase64: uint8ArrayToBase64(encryptedData),
      cloudinaryPreset: import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET,
      cloudinaryCloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME,
      uploadType,
      supabaseUrl: creds.url,
      supabaseKey: creds.key,
      supabaseAccessToken: creds.accessToken,
      dbPayload: JSON.stringify(payloadWithPlaceholder),
      fileName,
    });

    console.log(`[BackgroundUpload] Media upload enqueued: ${result.taskId}`);
    return result.taskId;
  } catch (err) {
    console.error('[BackgroundUpload] Failed to enqueue media upload:', err);
    return null;
  }
}

// ── Public API: Enqueue Chunked Video Upload ──────────────────────────────

/**
 * Enqueue all encrypted video chunks for background upload.
 *
 * @param encryptedChunks - Array of encrypted chunk Uint8Arrays
 * @param messageId - The message UUID
 * @param totalChunks - Total number of chunks
 * @param packedKey - The packed encryption key string
 * @param baseNonce - Base nonce (base64)
 * @param duration - Video duration in seconds
 * @param senderId - Sender user ID
 * @param receiverId - Receiver user ID
 * @returns true if all chunks were enqueued
 */
export async function enqueueChunkedUpload(
  encryptedChunks: Uint8Array[],
  messageId: string,
  totalChunks: number,
  packedKey: string,
  baseNonce: string,
  duration: number,
  senderId: string,
  receiverId: string,
): Promise<boolean> {
  if (!isNativeUploadAvailable()) return false;

  const creds = await getSupabaseCredentials();
  if (!creds) return false;

  try {
    console.log(`[BackgroundUpload] Enqueuing ${totalChunks} chunks one-by-one to avoid bridge limits...`);
    
    for (let i = 0; i < totalChunks; i++) {
      const chunkBase64 = uint8ArrayToBase64(encryptedChunks[i]);
      
      const result = await BackgroundUpload.enqueueChunkedUpload({
        messageId,
        totalChunks,
        chunkIndex: i,
        chunk: chunkBase64,
        cloudinaryPreset: import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET,
        cloudinaryCloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME,
        supabaseUrl: creds.url,
        supabaseKey: creds.key,
        supabaseAccessToken: creds.accessToken,
        packedKey,
        baseNonce,
        duration,
        senderId,
        receiverId,
      });
      
      console.log(`[BackgroundUpload] Chunk ${i + 1}/${totalChunks} enqueued:`, result.enqueued);
    }

    return true;
  } catch (err) {
    console.error('[BackgroundUpload] Failed to enqueue chunked upload:', err);
    return false;
  }
}

export async function getUploadStatusForMessage(messageId: string): Promise<{
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  total: number;
  isCompleted: boolean;
} | null> {
  if (!isNativeUploadAvailable()) return null;
  try {
    return await BackgroundUpload.getUploadStatusForMessage({ messageId });
  } catch {
    return null;
  }
}

// ── Public API: Enqueue Text Message ──────────────────────────────────────

/**
 * Enqueue a text message DB insert for background execution.
 *
 * @param dbPayload - The full messages row object
 * @param triggerPush - Whether to trigger push notification
 * @returns taskId if enqueued, null if not available
 */
export async function enqueueTextMessage(
  dbPayload: Record<string, any>,
  triggerPush: boolean = true
): Promise<string | null> {
  if (!isNativeUploadAvailable()) return null;

  const creds = await getSupabaseCredentials();
  if (!creds) return null;

  const taskId = dbPayload.id || crypto.randomUUID();

  try {
    const result = await BackgroundUpload.enqueueTextMessage({
      taskId,
      supabaseUrl: creds.url,
      supabaseKey: creds.key,
      supabaseAccessToken: creds.accessToken,
      dbPayload: JSON.stringify(dbPayload),
      triggerPush,
    });

    console.log(`[BackgroundUpload] Text message enqueued: ${result.taskId}`);
    return result.taskId;
  } catch (err) {
    console.error('[BackgroundUpload] Failed to enqueue text message:', err);
    return null;
  }
}

// ── Public API: Queue Status ──────────────────────────────────────────────

export async function getUploadQueueStatus(): Promise<QueueStatus | null> {
  if (!isNativeUploadAvailable()) return null;
  try {
    return await BackgroundUpload.getQueueStatus();
  } catch {
    return null;
  }
}

// ── Public API: Cancel Upload ─────────────────────────────────────────────

export async function cancelBackgroundUpload(taskId: string): Promise<boolean> {
  if (!isNativeUploadAvailable()) return false;
  try {
    await BackgroundUpload.cancelUpload({ taskId });
    return true;
  } catch {
    return false;
  }
}

export default BackgroundUpload;
