/// <reference lib="webworker" />

let cryptoKey: CryptoKey | null = null;
let sendCounter = 0;

self.onmessage = async (event: MessageEvent) => {
  const { operation, keyData } = event.data;
  
  if (operation === 'setKey' && keyData) {
    cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }
};

(self as any).onrtctransform = (event: any) => {
  const transformer = event.transformer;
  const operation = transformer.options.operation;

  const transformStream = new TransformStream({
    transform: async (chunk: any, controller) => {
      if (!cryptoKey) {
        controller.enqueue(chunk);
        return;
      }

      try {
        if (operation === 'encrypt') {
          const iv = new Uint8Array(12);
          new DataView(iv.buffer).setUint32(8, ++sendCounter, false);
          
          const encryptedData = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            cryptoKey,
            chunk.data
          );
          
          const payload = new Uint8Array(iv.length + encryptedData.byteLength);
          payload.set(iv, 0);
          payload.set(new Uint8Array(encryptedData), iv.length);
          
          chunk.data = payload.buffer;
          controller.enqueue(chunk);
        } else if (operation === 'decrypt') {
          const data = new Uint8Array(chunk.data);
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
            // Decryption failed. This usually means the frame wasn't encrypted 
            // by the sender (e.g. their browser didn't support E2EE).
            // Pass the original chunk to the decoder.
            controller.enqueue(chunk);
          }
        }
      } catch (e) {
        console.error('Transform error:', e);
        controller.enqueue(chunk);
      }
    }
  });

  transformer.readable.pipeThrough(transformStream).pipeTo(transformer.writable);
};
