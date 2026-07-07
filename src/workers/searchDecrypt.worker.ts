/**
 * searchDecrypt.worker.ts — Off-thread batch decryption for chat search
 *
 * Moves ALL decryption work off the main thread so the UI stays
 * butter-smooth while scanning thousands of encrypted messages.
 *
 * Messages IN:
 *   { type: 'DECRYPT_BATCH', batch, userId, secretKeyB64, partnerPublicKeyB64, fallbackKeysB64, query }
 *
 * Messages OUT:
 *   { type: 'BATCH_RESULT', matches, allDecrypted }
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import nacl from 'tweetnacl';
import { decodeBase64, encodeUTF8 } from 'tweetnacl-util';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EncryptedRow {
  id: string;
  encrypted_content: string | null;
  nonce: string | null;
  sender_id: string;
  sender_public_key: string | null;
  is_deleted_for_everyone: boolean;
  created_at: string;
}

interface DecryptedMatch {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  is_mine: boolean;
}

interface DecryptedForCache {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  is_deleted: boolean;
}

// ─── Decryption ──────────────────────────────────────────────────────────────

function tryDecrypt(
  ciphertext: string,
  nonce: string,
  decryptionKey: Uint8Array,
  secretKey: Uint8Array,
  fallbackKeys: Uint8Array[],
): string {
  // Try primary key
  try {
    const result = nacl.box.open(
      decodeBase64(ciphertext),
      decodeBase64(nonce),
      decryptionKey,
      secretKey,
    );
    if (result) return encodeUTF8(result);
  } catch { /* continue to fallbacks */ }

  // Try each fallback key
  for (const fbKey of fallbackKeys) {
    try {
      const result = nacl.box.open(
        decodeBase64(ciphertext),
        decodeBase64(nonce),
        fbKey,
        secretKey,
      );
      if (result) return encodeUTF8(result);
    } catch { /* continue */ }
  }

  return '';
}

// ─── Message Handler ─────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent) => {
  const {
    type,
    batch,
    userId,
    secretKeyB64,
    partnerPublicKeyB64,
    fallbackKeysB64,
    query,
    requestId,
  } = e.data;

  if (type !== 'DECRYPT_BATCH') return;

  // Decode keys ONCE for the entire batch (avoid per-message overhead)
  const secretKey = decodeBase64(secretKeyB64);
  const partnerKey = decodeBase64(partnerPublicKeyB64);
  const fallbackKeys = (fallbackKeysB64 as string[]).map((k: string) => decodeBase64(k));
  const normalQ = (query as string).toLowerCase();

  const matches: DecryptedMatch[] = [];
  const allDecrypted: DecryptedForCache[] = [];

  for (const row of batch as EncryptedRow[]) {
    if (row.is_deleted_for_everyone) {
      allDecrypted.push({
        id: row.id,
        content: '',
        sender_id: row.sender_id,
        created_at: row.created_at,
        is_deleted: true,
      });
      continue;
    }

    if (!row.encrypted_content || !row.nonce) continue;

    const isMine = row.sender_id === userId;
    const decryptionKey = isMine
      ? partnerKey
      : (row.sender_public_key ? decodeBase64(row.sender_public_key) : partnerKey);

    const text = tryDecrypt(
      row.encrypted_content,
      row.nonce,
      decryptionKey,
      secretKey,
      fallbackKeys,
    );

    if (text) {
      allDecrypted.push({
        id: row.id,
        content: text,
        sender_id: row.sender_id,
        created_at: row.created_at,
        is_deleted: false,
      });

      if (text.toLowerCase().includes(normalQ)) {
        matches.push({
          id: row.id,
          content: text,
          sender_id: row.sender_id,
          created_at: row.created_at,
          is_mine: isMine,
        });
      }
    }
  }

  self.postMessage({ type: 'BATCH_RESULT', matches, allDecrypted, requestId });
};
