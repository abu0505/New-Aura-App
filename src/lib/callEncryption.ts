import nacl from 'tweetnacl';

// We need to derive a 256-bit AES-GCM key from the NaCl shared secret.
export async function deriveCallSessionKey(partnerPublicKey: Uint8Array, mySecretKey: Uint8Array): Promise<Uint8Array> {
  // NaCl shared secret (32 bytes)
  const sharedSecret = nacl.box.before(partnerPublicKey, mySecretKey);
  
  // We use Web Crypto API to derive an AES-GCM key using HKDF or SHA-256
  // For simplicity and to ensure standard 256-bit AES key, we hash the shared secret.
  // We create a fresh Uint8Array to ensure it's not backed by a SharedArrayBuffer.
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(sharedSecret));
  
  return new Uint8Array(hash);
}
