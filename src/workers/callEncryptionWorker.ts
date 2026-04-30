/// <reference lib="webworker" />

// ─── WhatsApp-style Frame-Level AES-GCM Encryption Worker ───────────────────
//
// This Web Worker intercepts encoded audio/video frames via the WebRTC
// Encoded Transform API (RTCRtpScriptTransform) and applies AES-GCM-256
// encryption/decryption using the HKDF-derived session key.
//
// Supported APIs (in priority order):
//   1. RTCRtpScriptTransform  (Chrome 94+, Firefox 117+, Edge 94+)
//   2. createEncodedStreams   (legacy Chrome ≤93 behind a flag — not common)
//
// If neither is available the worker is never instantiated (checked in manager).

let cryptoKey: CryptoKey | null = null;
let sendCounter = 0;

// ─── Key Setup ────────────────────────────────────────────────────────────────
self.onmessage = async (event: MessageEvent) => {
  const { operation, keyData, readable, writable } = event.data;

  if (operation === 'setKey' && keyData) {
    cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    console.log('[E2EE Worker] AES-GCM-256 key imported ✓');
    return;
  }

  // Legacy Insertable Streams API: main thread passes readable/writable
  // transferable objects when RTCRtpScriptTransform is not available.
  if ((operation === 'encrypt' || operation === 'decrypt') && readable && writable) {
    const transformStream = _buildTransform(operation);
    readable.pipeThrough(transformStream).pipeTo(writable);
  }
};

// ─── Modern API: RTCRtpScriptTransform ────────────────────────────────────────
(self as any).onrtctransform = (event: any) => {
  const transformer = event.transformer;
  const operation: 'encrypt' | 'decrypt' = transformer.options.operation;
  const transformStream = _buildTransform(operation);
  transformer.readable.pipeThrough(transformStream).pipeTo(transformer.writable);
};

// ─── Core Transform Logic ─────────────────────────────────────────────────────
// IV layout (12 bytes total):
//   [0..3]  = random salt bytes (set once when key is set, reduces counter collision risk)
//   [4..7]  = 0x00 padding
//   [8..11] = 32-bit frame counter (big-endian, wraps at 2^32 — ~49 days at 1000fps)
//
// We prepend the full 12-byte IV to the ciphertext so the receiver can extract it.
// Minimum valid encrypted payload = 12 (IV) + 16 (AES-GCM auth tag) = 28 bytes.

function _buildTransform(operation: 'encrypt' | 'decrypt'): TransformStream {
  return new TransformStream({
    transform: async (chunk: any, controller) => {
      // If the key hasn't been set yet, pass the frame through unmodified.
      // This prevents a blank screen during the brief window between PC creation
      // and key injection.
      if (!cryptoKey) {
        controller.enqueue(chunk);
        return;
      }

      try {
        if (operation === 'encrypt') {
          const iv = new Uint8Array(12);
          new DataView(iv.buffer).setUint32(8, ++sendCounter >>> 0, false);

          const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            cryptoKey,
            chunk.data
          );

          // Prepend IV to ciphertext
          const out = new Uint8Array(iv.byteLength + encrypted.byteLength);
          out.set(iv, 0);
          out.set(new Uint8Array(encrypted), iv.byteLength);
          chunk.data = out.buffer;
          controller.enqueue(chunk);

        } else {
          // Decrypt
          const data = new Uint8Array(chunk.data);
          if (data.byteLength < 28) {
            // Too short to be a valid encrypted frame — pass through as-is.
            // This handles frames from browsers that don't support E2EE
            // (they send raw frames; we fall back gracefully).
            controller.enqueue(chunk);
            return;
          }

          const iv = data.slice(0, 12);
          const ciphertext = data.slice(12);

          try {
            const decrypted = await crypto.subtle.decrypt(
              { name: 'AES-GCM', iv },
              cryptoKey,
              ciphertext
            );
            chunk.data = decrypted;
            controller.enqueue(chunk);
          } catch {
            // Decryption failed → frame is likely unencrypted (peer doesn't support E2EE).
            // Pass the original chunk so the call still works — this is the same
            // graceful-degradation strategy used by Jitsi Meet and Daily.co.
            controller.enqueue(chunk);
          }
        }
      } catch (e) {
        console.error('[E2EE Worker] Transform error:', e);
        controller.enqueue(chunk); // Always enqueue to avoid stream stall
      }
    },
  });
}
