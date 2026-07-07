/**
 * mediaCache.ts — Persistent IndexedDB Media Cache for AURA
 * 
 * PROBLEM:
 *   All media is encrypted (E2EE) and stored as "raw" on Cloudinary.
 *   Every view = fetch from Cloudinary → decrypt → display.
 *   Without persistent caching, the same 3 MB file gets downloaded 170+ times/month.
 *   This consumed 33 GB/month bandwidth on a 25-credit (25 GB) free plan.
 *
 * SOLUTION:
 *   Two-tier cache:
 *     L1: In-memory Map (instant, lost on refresh)        — existing in useMedia.ts
 *     L2: IndexedDB via idb-keyval (persistent, survives refresh/close)  — THIS FILE
 *     L3: Cloudinary fetch (network, costs bandwidth)     — last resort
 *
 *   Flow:  Check L1 → Check L2 → Fetch from Cloudinary → Store in L2 + L1
 *
 * DESIGN:
 *   - Uses idb-keyval for zero-boilerplate IndexedDB access
 *   - Separate stores for media blobs and metadata (avoids loading large blobs for cache management)
 *   - LRU eviction: when total cached bytes exceeds MAX_CACHE_BYTES, oldest-accessed entries are purged
 *   - Graceful degradation: if IndexedDB is unavailable (private browsing), silently falls back to L1-only
 *   - Cache keys are the Cloudinary URL (unique per file version)
 */

import { createStore, get, set, del, keys, getMany } from 'idb-keyval';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Maximum total cache size in bytes. Default: 500 MB */
const MAX_CACHE_BYTES = 500 * 1024 * 1024;

/** Maximum single item size to cache (skip gigantic videos). Default: 50 MB */
const MAX_ITEM_BYTES = 50 * 1024 * 1024;

/** Cache DB/store names */
const DB_NAME = 'aura-media-cache';
const BLOB_STORE_NAME = 'blobs';
const META_STORE_NAME = 'meta';

// ─── IndexedDB Stores ─────────────────────────────────────────────────────────

const blobStore = createStore(`${DB_NAME}-blobs`, BLOB_STORE_NAME);
const metaStore = createStore(`${DB_NAME}-meta`, META_STORE_NAME);

// ─── Types ────────────────────────────────────────────────────────────────────

interface CacheMeta {
  /** Cloudinary URL (cache key) */
  url: string;
  /** Size of the stored blob in bytes */
  sizeBytes: number;
  /** MIME type of the decrypted blob */
  mimeType: string;
  /** Timestamp (ms) when this entry was last accessed */
  lastAccessedAt: number;
  /** Timestamp (ms) when this entry was first cached */
  cachedAt: number;
}

// ─── Availability Check ───────────────────────────────────────────────────────

let _isAvailable: boolean | null = null;

/**
 * Check if IndexedDB is available and writable.
 * Caches the result after first check.
 */
async function isAvailable(): Promise<boolean> {
  if (_isAvailable !== null) return _isAvailable;
  try {
    const testKey = '__aura_idb_test__';
    await set(testKey, 1, metaStore);
    await del(testKey, metaStore);
    _isAvailable = true;
  } catch {
    console.warn('[mediaCache] IndexedDB not available — falling back to memory-only cache');
    _isAvailable = false;
  }
  return _isAvailable;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve a cached blob from IndexedDB.
 * Updates lastAccessedAt on hit (for LRU).
 * Returns null on miss or if IndexedDB unavailable.
 */
export async function getCachedBlob(url: string): Promise<Blob | null> {
  try {
    if (!(await isAvailable())) return null;
    
    const blob = await get<Blob>(url, blobStore);
    if (!blob) return null;

    // Update access time (fire-and-forget, don't block)
    const meta = await get<CacheMeta>(url, metaStore);
    if (meta) {
      meta.lastAccessedAt = Date.now();
      set(url, meta, metaStore).catch(() => {});
    }

    return blob;
  } catch {
    return null;
  }
}

/**
 * Store a decrypted blob in IndexedDB.
 * Skips items that are too large (> MAX_ITEM_BYTES).
 * Triggers LRU eviction if cache exceeds MAX_CACHE_BYTES.
 */
export async function setCachedBlob(url: string, blob: Blob): Promise<void> {
  try {
    if (!(await isAvailable())) return;

    // Skip oversized items
    if (blob.size > MAX_ITEM_BYTES) return;

    // Don't re-cache if already cached with same size
    const existing = await get<CacheMeta>(url, metaStore);
    if (existing && existing.sizeBytes === blob.size) {
      // Just update access time
      existing.lastAccessedAt = Date.now();
      await set(url, existing, metaStore);
      return;
    }

    const meta: CacheMeta = {
      url,
      sizeBytes: blob.size,
      mimeType: blob.type || 'application/octet-stream',
      lastAccessedAt: Date.now(),
      cachedAt: Date.now(),
    };

    // Write blob and meta
    await set(url, blob, blobStore);
    await set(url, meta, metaStore);

    // Trigger eviction check in background
    evictIfNeeded().catch(() => {});
  } catch (err) {
    // Quota exceeded or write failure — silently ignore
    console.warn('[mediaCache] Failed to cache blob:', (err as Error).message);
  }
}

/**
 * Remove a specific entry from the cache.
 */
export async function removeCachedBlob(url: string): Promise<void> {
  try {
    if (!(await isAvailable())) return;
    await Promise.all([
      del(url, blobStore),
      del(url, metaStore),
    ]);
  } catch {}
}

/**
 * Clear the entire media cache.
 */
export async function clearMediaCache(): Promise<void> {
  try {
    if (!(await isAvailable())) return;

    const allKeys = await keys(metaStore);
    await Promise.all([
      ...allKeys.map(k => del(k, blobStore)),
      ...allKeys.map(k => del(k, metaStore)),
    ]);
  } catch {}
}

/**
 * Get cache statistics (total size, item count).
 */
export async function getCacheStats(): Promise<{ totalBytes: number; itemCount: number }> {
  try {
    if (!(await isAvailable())) return { totalBytes: 0, itemCount: 0 };

    const allKeys = await keys(metaStore);
    if (allKeys.length === 0) return { totalBytes: 0, itemCount: 0 };

    const allMeta = await getMany<CacheMeta>(allKeys as IDBValidKey[], metaStore);
    let totalBytes = 0;
    let itemCount = 0;

    for (const meta of allMeta) {
      if (meta) {
        totalBytes += meta.sizeBytes;
        itemCount++;
      }
    }

    return { totalBytes, itemCount };
  } catch {
    return { totalBytes: 0, itemCount: 0 };
  }
}

// ─── LRU Eviction ─────────────────────────────────────────────────────────────

let _evicting = false;

async function evictIfNeeded(): Promise<void> {
  if (_evicting) return;
  _evicting = true;
  try {
    const allKeys = await keys(metaStore);
    if (allKeys.length === 0) { _evicting = false; return; }

    const allMeta = await getMany<CacheMeta>(allKeys as IDBValidKey[], metaStore);
    
    // Build list of valid entries
    const entries: CacheMeta[] = [];
    let totalBytes = 0;
    
    for (const meta of allMeta) {
      if (meta) {
        entries.push(meta);
        totalBytes += meta.sizeBytes;
      }
    }

    if (totalBytes <= MAX_CACHE_BYTES) { _evicting = false; return; }

    // Sort by lastAccessedAt ascending (oldest first)
    entries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    // Evict oldest until under limit
    let bytesToFree = totalBytes - MAX_CACHE_BYTES;
    const toDelete: string[] = [];

    for (const entry of entries) {
      if (bytesToFree <= 0) break;
      toDelete.push(entry.url);
      bytesToFree -= entry.sizeBytes;
    }

    // Delete in parallel
    await Promise.all(
      toDelete.flatMap(url => [del(url, blobStore), del(url, metaStore)])
    );

    if (toDelete.length > 0) {
      console.log(`[mediaCache] Evicted ${toDelete.length} items to free space`);
    }
  } catch (err) {
    console.warn('[mediaCache] Eviction error:', err);
  } finally {
    _evicting = false;
  }
}
