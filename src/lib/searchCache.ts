/**
 * searchCache.ts — IndexedDB-backed decrypted message cache
 *
 * Provides instant local search by caching decrypted message content.
 * Once a message is decrypted during chat or search, it's stored here
 * so subsequent searches skip network + decryption entirely.
 *
 * Schema:
 *   Store: 'messages'
 *   Key:   'id' (message UUID)
 *   Index: 'by_conversation' on 'conversation_key' (sorted user-pair)
 */

const DB_NAME = 'AuraSearchCache';
const DB_VERSION = 1;
const STORE_NAME = 'messages';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CachedMessage {
  id: string;
  conversation_key: string; // "min(userA,userB)_max(userA,userB)"
  content: string;          // decrypted plaintext (lowercase stored for fast search)
  content_original: string; // original casing for display
  sender_id: string;
  created_at: string;
  is_deleted: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generates a stable conversation key from two user IDs */
export function makeConversationKey(userA: string, userB: string): string {
  return userA < userB ? `${userA}_${userB}` : `${userB}_${userA}`;
}

// Singleton DB connection — reuse across all calls
let cachedDB: IDBDatabase | null = null;

function getDB(): Promise<IDBDatabase> {
  if (cachedDB) return Promise.resolve(cachedDB);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by_conversation', 'conversation_key');
      }
    };

    request.onsuccess = () => {
      cachedDB = request.result;
      // Handle unexpected close (e.g. browser clearing storage)
      cachedDB.onclose = () => { cachedDB = null; };
      resolve(cachedDB);
    };

    request.onerror = () => reject(request.error);
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Bulk-insert decrypted messages into the cache.
 * Uses put() so duplicates are silently overwritten.
 */
export async function cacheDecryptedMessages(messages: CachedMessage[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const msg of messages) {
        store.put(msg);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB may be unavailable (private browsing, etc.) — silently fail
  }
}

/**
 * Search the local cache for messages matching a query string.
 * Returns results sorted newest-first.
 * This is the fast path — no network, no decryption.
 */
export async function searchLocalCache(
  query: string,
  userId: string,
  partnerId: string,
): Promise<CachedMessage[]> {
  try {
    const db = await getDB();
    const convKey = makeConversationKey(userId, partnerId);
    const normalQ = query.toLowerCase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_conversation');
      const request = index.openCursor(IDBKeyRange.only(convKey));
      const results: CachedMessage[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const msg = cursor.value as CachedMessage;
          if (!msg.is_deleted && msg.content.includes(normalQ)) {
            results.push(msg);
          }
          cursor.continue();
        } else {
          // Sort newest first
          results.sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return []; // Graceful fallback
  }
}

/**
 * Get all cached message IDs for a conversation.
 * Used to skip already-cached messages during DB scan.
 */
export async function getCachedIds(
  userId: string,
  partnerId: string,
): Promise<Set<string>> {
  try {
    const db = await getDB();
    const convKey = makeConversationKey(userId, partnerId);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_conversation');
      const request = index.getAllKeys(IDBKeyRange.only(convKey));

      request.onsuccess = () => {
        resolve(new Set(request.result as string[]));
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return new Set();
  }
}

/**
 * Clear the entire search cache (e.g. on logout).
 */
export async function clearSearchCache(): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Silently fail
  }
}
