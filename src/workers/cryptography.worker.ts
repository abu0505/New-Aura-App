import { decryptMessageWithFallback, decodeBase64 } from '../lib/encryption';
import type { Database } from '../integrations/supabase/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];

export interface DecryptRowRequest {
  id: string;
  row: MessageRow;
  mySecretKey: Uint8Array;
  partnerKey: string | null;
  keyHistory?: string[];
  userId?: string;
}

export interface DecryptRowResult {
  id: string;
  originalId: string;
  decrypted_content: string;
  is_mine: boolean;
  decryption_error: boolean;
}

self.onmessage = async (e: MessageEvent<{ type: string; payload: DecryptRowRequest[] }>) => {
  const { type, payload } = e.data;

  if (type === 'decrypt_batch') {
    const results: DecryptRowResult[] = payload.map(req => {
      const { row, mySecretKey, partnerKey, keyHistory, userId, id } = req;
      const isMine = row.sender_id === userId;
      let decryptedText = '';
      let decryptionError = false;

      if (row.is_deleted_for_everyone) {
        decryptedText = 'This message was deleted';
      } else if (partnerKey && row.encrypted_content && row.nonce) {
        try {
          const decryptionKey = isMine
            ? partnerKey
            : (row.sender_public_key || partnerKey);

          const fallbackKeys = (keyHistory || [])
            .filter(k => k !== decryptionKey)
            .map(k => decodeBase64(k));

          const result = decryptMessageWithFallback(
            row.encrypted_content,
            row.nonce,
            decodeBase64(decryptionKey),
            mySecretKey,
            fallbackKeys
          );
          decryptedText = result;
        } catch (err) {
          decryptedText = '⚠️ Could not decrypt this message';
          decryptionError = true;
        }
      } else if (partnerKey) {
        decryptedText = ''; // No content to decrypt (e.g. media without caption)
      } else {
        decryptedText = '[Awaiting Keys]';
      }

      return {
        id,
        originalId: row.id,
        decrypted_content: decryptedText,
        is_mine: isMine,
        decryption_error: decryptionError,
      };
    });

    self.postMessage({ type: 'batch_complete', results });
  }
};
