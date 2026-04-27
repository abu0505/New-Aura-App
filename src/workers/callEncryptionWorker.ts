/// <reference lib="webworker" />

let cryptoKey: CryptoKey | null = null;
let isEncrypting = false;
let isDecrypting = false;

// We need a counter for IV/Nonce to prevent replay attacks
let sendCounter = 0;

self.onmessage = async (event: MessageEvent) => {
  const { operation, keyData } = event.data;
  
  if (operation === 'setKey' && keyData) {
    // keyData is a Uint8Array containing the AES-GCM key derived from NaCl shared secret
    cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }
  
  // RTCRtpScriptTransform passes the stream via event.data.readable and event.data.writable
  if (event.data.readable && event.data.writable) {
    const stream = event.data;
    const transformStream = new TransformStream({
      transform: async (chunk: any, controller) => {
        if (!cryptoKey) {
          controller.enqueue(chunk);
          return;
        }

        try {
          if (operation === 'encrypt') {
            isEncrypting = true;
            // Create IV from counter
            const iv = new Uint8Array(12);
            new DataView(iv.buffer).setUint32(8, ++sendCounter, false);
            
            // Encrypt the frame data
            const encryptedData = await crypto.subtle.encrypt(
              { name: 'AES-GCM', iv },
              cryptoKey,
              chunk.data
            );
            
            // Append IV to the encrypted payload
            const payload = new Uint8Array(iv.length + encryptedData.byteLength);
            payload.set(iv, 0);
            payload.set(new Uint8Array(encryptedData), iv.length);
            
            chunk.data = payload.buffer;
            controller.enqueue(chunk);
          } else if (operation === 'decrypt') {
            isDecrypting = true;
            const data = new Uint8Array(chunk.data);
            
            // Minimum size: 12 bytes IV + 16 bytes auth tag
            if (data.byteLength < 28) {
              controller.enqueue(chunk);
              return;
            }

            const iv = data.slice(0, 12);
            const encryptedData = data.slice(12);
            
            try {
              const decryptedData = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                cryptoKey,
                encryptedData
              );
              chunk.data = decryptedData;
              controller.enqueue(chunk);
            } catch (e) {
              // Decryption failed, drop the frame
              console.error('Frame decryption failed:', e);
            }
          }
        } catch (e) {
          console.error('Transform error:', e);
          controller.enqueue(chunk);
        }
      }
    });

    // Pipe the streams
    stream.readable.pipeThrough(transformStream).pipeTo(stream.writable);
  }
};
