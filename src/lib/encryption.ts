import nacl from 'tweetnacl';
import {
  encodeBase64,
  decodeBase64,
  encodeUTF8,
  decodeUTF8,
} from 'tweetnacl-util';
import { supabase } from './supabase';

const SECRET_KEY_STORAGE_KEY = 'aura_secret_key';
const PUBLIC_KEY_STORAGE_KEY = 'aura_public_key';
const KEY_OWNER_STORAGE_KEY = 'aura_key_owner';

export type EncryptionState = 
  | 'initializing' 
  | 'ready' 
  | 'pin_setup_required' 
  | 'pin_unlock_required' 
  | 'error';

// ===== Key Derivation =====

/**
 * Derives a 32-byte key from a PIN using PBKDF2 with 600,000 iterations.
 * This makes brute-forcing a 6-digit PIN computationally expensive.
 */
export async function deriveKeyFromPin(pin: string, salt: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 600_000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return new Uint8Array(derivedBits);
}

/**
 * Legacy derivation — only used for migration from old SHA-512 backups.
 * Will be removed once all users have migrated to PBKDF2.
 */
export async function deriveKeyFromPinLegacy(pin: string, salt: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-512', data);
  return new Uint8Array(hashBuffer).slice(0, 32);
}

export function generateSalt(): string {
  const bytes = nacl.randomBytes(16);
  return encodeBase64(bytes);
}

// ===== IndexedDB helper for Service Worker access =====
function syncToIndexedDB(secretKeyBase64: string, publicKeyBase64: string) {
  const request = indexedDB.open('AuraDB', 1);
  
  request.onupgradeneeded = (event) => {
    const db = (event.target as IDBOpenDBRequest).result;
    if (!db.objectStoreNames.contains('keys')) {
      db.createObjectStore('keys');
    }
  };

  request.onsuccess = (event) => {
    const db = (event.target as IDBOpenDBRequest).result;
    try {
      const tx = db.transaction('keys', 'readwrite');
      const store = tx.objectStore('keys');
      store.put(secretKeyBase64, 'aura_secret_key');
      store.put(publicKeyBase64, 'aura_public_key');
    } catch (e) {
      console.error('Failed to sync keys to IndexedDB', e);
    }
  };
}

// ===== Key Management =====

export function generateKeyPair(): nacl.BoxKeyPair {
  return nacl.box.keyPair();
}

export function getStoredKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } | null {
  const storedSecret = localStorage.getItem(SECRET_KEY_STORAGE_KEY);
  const storedPublic = localStorage.getItem(PUBLIC_KEY_STORAGE_KEY);

  if (!storedSecret || !storedPublic) return null;

  try {
    return {
      secretKey: decodeBase64(storedSecret),
      publicKey: decodeBase64(storedPublic),
    };
  } catch (e) {
    console.error('Failed to decode stored keys', e);
    return null;
  }
}

export function storeKeyPair(keyPair: nacl.BoxKeyPair, userId?: string): void {
  const secretKeyStr = encodeBase64(keyPair.secretKey);
  const publicKeyStr = encodeBase64(keyPair.publicKey);
  
  localStorage.setItem(SECRET_KEY_STORAGE_KEY, secretKeyStr);
  localStorage.setItem(PUBLIC_KEY_STORAGE_KEY, publicKeyStr);
  if (userId) {
    localStorage.setItem(KEY_OWNER_STORAGE_KEY, userId);
  }
  
  // Sync to IndexedDB for Service Worker access
  syncToIndexedDB(secretKeyStr, publicKeyStr);
}

/**
 * Clears all locally stored encryption keys.
 * Must be called on sign-out to prevent the next user from inheriting stale keys.
 */
export function clearStoredKeys(): void {
  localStorage.removeItem(SECRET_KEY_STORAGE_KEY);
  localStorage.removeItem(PUBLIC_KEY_STORAGE_KEY);
  localStorage.removeItem(KEY_OWNER_STORAGE_KEY);
}

/**
 * Backs up the secret key to Supabase, encrypted with a PIN-derived key.
 */
export async function backupKeys(userId: string, pin: string): Promise<void> {
  const keyPair = getStoredKeyPair();
  if (!keyPair) throw new Error('No keys to backup');

  const salt = generateSalt();
  const derivedKey = await deriveKeyFromPin(pin, salt);
  
  // Encrypt secret key with PIN-derived key
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encryptedSecretKey = nacl.secretbox(keyPair.secretKey, nonce, derivedKey);

  const backupString = encodeBase64(nonce) + ':' + encodeBase64(encryptedSecretKey);

  const { error } = await supabase
    .from('profiles')
    .update({ 
      backup_secret_key: backupString,
      key_derivation_salt: salt,
      public_key: encodeBase64(keyPair.publicKey)
    })
    .eq('id', userId);

  if (error) {
    console.error('Backup keys failed:', error);
    throw new Error(error.message);
  }
}

/**
 * Restores the secret key from Supabase using the user's PIN.
 * Tries PBKDF2 first, then falls back to legacy SHA-512 for seamless migration.
 * On successful legacy restore, silently re-encrypts with PBKDF2.
 */
export async function restoreKeys(userId: string, pin: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('backup_secret_key, key_derivation_salt, public_key')
    .eq('id', userId)
    .single();

  if (error || !data?.backup_secret_key || !data?.key_derivation_salt) return false;

  try {
    const salt = data.key_derivation_salt;
    const [nonceStr, encryptedStr] = data.backup_secret_key.split(':');
    
    // Try PBKDF2 first (new secure derivation)
    let decryptedSecret: Uint8Array | null = null;
    let usedLegacy = false;

    const derivedKey = await deriveKeyFromPin(pin, salt);
    decryptedSecret = nacl.secretbox.open(
      decodeBase64(encryptedStr),
      decodeBase64(nonceStr),
      derivedKey
    );

    if (!decryptedSecret) {
      // Fallback: try legacy SHA-512 derivation
      const legacyKey = await deriveKeyFromPinLegacy(pin, salt);
      decryptedSecret = nacl.secretbox.open(
        decodeBase64(encryptedStr),
        decodeBase64(nonceStr),
        legacyKey
      );
      usedLegacy = true;
    }

    if (!decryptedSecret) return false;

    const pair = nacl.box.keyPair.fromSecretKey(decryptedSecret);
    storeKeyPair(pair, userId);

    // If restored from legacy, silently re-encrypt backup with PBKDF2
    if (usedLegacy) {
      console.log('[Encryption] Migrating backup from SHA-512 to PBKDF2...');
      await backupKeys(userId, pin);
    }

    return true;
  } catch (e) {
    console.error('Restore failed', e);
    return false;
  }
}

/**
 * Ensures the public key stored in Supabase matches the local key pair.
 * GUARDED: Only updates if the remote key differs from local.
 * Also maintains key_history for decryption resilience.
 */
export async function syncPublicKey(userId: string): Promise<void> {
  const keyPair = getStoredKeyPair();
  if (!keyPair) return;

  const localPublicKey = encodeBase64(keyPair.publicKey);

  // GUARD: Only update if the remote key is different from local
  const { data } = await supabase
    .from('profiles')
    .select('public_key, key_history')
    .eq('id', userId)
    .single();

  if (data?.public_key === localPublicKey) return; // Already in sync

  // Key is changing — update Supabase AND append to key_history
  const history = (data?.key_history as any[]) || [];
  // Only append if this key isn't already in history
  if (!history.some((h: any) => h.public_key === localPublicKey)) {
    history.push({ public_key: localPublicKey, created_at: new Date().toISOString() });
  }

  await supabase
    .from('profiles')
    .update({ public_key: localPublicKey, key_history: history })
    .eq('id', userId);
}

export async function checkEncryptionStatus(userId: string): Promise<EncryptionState> {
  // 1. Check local storage
  const localKeys = getStoredKeyPair();
  const storedOwner = localStorage.getItem(KEY_OWNER_STORAGE_KEY);

  if (localKeys) {
    // GUARD: Verify these keys actually belong to the current user.
    // If a different user logged in on the same browser, the old keys will be stale.
    if (storedOwner && storedOwner !== userId) {
      console.warn('[Encryption] Local keys belong to a different user — clearing stale keys.');
      clearStoredKeys();
      // Fall through to backup check below
    } else {
      // Tag ownership if not already set (legacy migration)
      if (!storedOwner) {
        localStorage.setItem(KEY_OWNER_STORAGE_KEY, userId);
      }

      // CRITICAL: Sync local public key to Supabase on every session start.
      // This ensures the partner always has the correct public key for decryption.
      await syncPublicKey(userId);
      
      // Also ensure IndexedDB has the keys for the Service Worker
      syncToIndexedDB(
        encodeBase64(localKeys.secretKey),
        encodeBase64(localKeys.publicKey)
      );
      
      return 'ready';
    }
  }

  // 2. Check Supabase backup
  const { data, error } = await supabase
    .from('profiles')
    .select('backup_secret_key, public_key')
    .eq('id', userId)
    .single();

  if (error) return 'error';

  if (data?.backup_secret_key) return 'pin_unlock_required';
  return 'pin_setup_required';
}


// ===== Message Encryption (Asymmetric — box) =====

export function encryptMessage(
  message: string,
  recipientPublicKey: Uint8Array,
  senderSecretKey: Uint8Array
): { ciphertext: string; nonce: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageUint8 = decodeUTF8(message);
  const encrypted = nacl.box(messageUint8, nonce, recipientPublicKey, senderSecretKey);

  if (!encrypted) {
    throw new Error('Encryption failed');
  }

  return {
    ciphertext: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

export function decryptMessage(
  ciphertext: string,
  nonce: string,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array
): string {
  const decrypted = nacl.box.open(
    decodeBase64(ciphertext),
    decodeBase64(nonce),
    senderPublicKey,
    recipientSecretKey
  );

  if (!decrypted) {
    throw new Error('Decryption failed — invalid keys or corrupted data');
  }

  return encodeUTF8(decrypted);
}

/**
 * Attempts decryption with the given senderPublicKey.
 * If that fails and fallback keys are provided, tries each one.
 * Returns the decrypted text or throws if all fail.
 */
export function decryptMessageWithFallback(
  ciphertext: string,
  nonce: string,
  primarySenderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
  fallbackPublicKeys?: Uint8Array[]
): string {
  // Try primary key first
  try {
    return decryptMessage(ciphertext, nonce, primarySenderPublicKey, recipientSecretKey);
  } catch {
    // Primary failed — try fallbacks
  }

  if (fallbackPublicKeys) {
    for (const fbKey of fallbackPublicKeys) {
      try {
        return decryptMessage(ciphertext, nonce, fbKey, recipientSecretKey);
      } catch {
        continue;
      }
    }
  }

  throw new Error('Decryption failed — no matching key found');
}

// ===== File Encryption (Symmetric — secretbox) =====

export function encryptFile(
  fileData: Uint8Array
): { encryptedData: Uint8Array; fileKey: Uint8Array; nonce: Uint8Array } {
  const fileKey = nacl.randomBytes(nacl.secretbox.keyLength);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encryptedData = nacl.secretbox(fileData, nonce, fileKey);

  return { encryptedData, fileKey, nonce };
}

export function decryptFile(
  encryptedData: Uint8Array,
  fileKey: Uint8Array,
  nonce: Uint8Array
): Uint8Array {
  const decrypted = nacl.secretbox.open(encryptedData, nonce, fileKey);

  if (!decrypted) {
    throw new Error('File decryption failed');
  }

  return decrypted;
}

// ===== Key Wrapping (Encrypt file key with recipient's public key) =====

export function encryptFileKey(
  fileKey: Uint8Array,
  recipientPublicKey: Uint8Array,
  senderSecretKey: Uint8Array
): { encryptedKey: string; nonce: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(fileKey, nonce, recipientPublicKey, senderSecretKey);

  if (!encrypted) {
    throw new Error('File key encryption failed');
  }

  return {
    encryptedKey: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

export function decryptFileKey(
  encryptedKey: string,
  nonce: string,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array
): Uint8Array {
  const decrypted = nacl.box.open(
    decodeBase64(encryptedKey),
    decodeBase64(nonce),
    senderPublicKey,
    recipientSecretKey
  );

  if (!decrypted) {
    throw new Error('File key decryption failed');
  }

  return decrypted;
}

/**
 * Attempts file key decryption with the given senderPublicKey.
 * If that fails and fallback keys are provided, tries each one.
 */
export function decryptFileKeyWithFallback(
  encryptedKey: string,
  nonce: string,
  primarySenderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
  fallbackPublicKeys?: Uint8Array[]
): Uint8Array {
  try {
    return decryptFileKey(encryptedKey, nonce, primarySenderPublicKey, recipientSecretKey);
  } catch {
    // Primary failed
  }

  if (fallbackPublicKeys) {
    for (const fbKey of fallbackPublicKeys) {
      try {
        return decryptFileKey(encryptedKey, nonce, fbKey, recipientSecretKey);
      } catch {
        continue;
      }
    }
  }

  throw new Error('File key decryption failed — no matching key found');
}

// ===== Utility: Get partner's public key =====

export async function getPartnerPublicKey(partnerId: string): Promise<Uint8Array> {
  const { data, error } = await supabase
    .from('profiles')
    .select('public_key')
    .eq('id', partnerId)
    .single();

  if (error || !data?.public_key) {
    throw new Error('Could not retrieve partner public key');
  }

  return decodeBase64(data.public_key);
}

/**
 * Gets the partner's key history — all public keys they have ever used.
 * Used for fallback decryption when a message was encrypted with an old key.
 */
export async function getPartnerKeyHistory(partnerId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('key_history')
    .eq('id', partnerId)
    .single();

  if (error || !data?.key_history) return [];

  return (data.key_history as any[]).map((h: any) => h.public_key).filter(Boolean);
}

// ===== Utility: Get key fingerprint for verification =====

export function getKeyFingerprint(publicKey: Uint8Array): string {
  const hash = nacl.hash(publicKey);
  const hex = Array.from(hash.slice(0, 16))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  // Format as groups of 4 for readability
  return hex.match(/.{1,4}/g)?.join(' ') || hex;
}

// ===== Re-exports for convenience =====
export { encodeBase64, decodeBase64 } from 'tweetnacl-util';
