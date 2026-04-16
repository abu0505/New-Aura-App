/**
 * imageDenoiseWorker.js
 * 
 * Runs pixel-wise temporal averaging entirely off the main UI thread.
 * Accepts N frame buffers, outputs a single averaged frame.
 * Uses Transferable ArrayBuffers (zero-copy) for max performance.
 */

self.onmessage = function (e) {
  const { frames, width, height } = e.data;

  if (!frames || frames.length === 0) {
    self.postMessage({ error: 'No frames provided' });
    return;
  }

  const pixelCount = frames[0].length; // width * height * 4 (RGBA)
  const frameCount = frames.length;
  const averaged = new Uint8ClampedArray(pixelCount);

  // Pixel-wise average across all frames
  // Alpha channel (every 4th byte) is kept from the first frame (always 255)
  for (let i = 0; i < pixelCount; i++) {
    if ((i & 3) === 3) {
      // Alpha channel — just copy from first frame, no averaging needed
      averaged[i] = frames[0][i];
      continue;
    }
    let sum = 0;
    for (let f = 0; f < frameCount; f++) {
      sum += frames[f][i];
    }
    averaged[i] = (sum / frameCount + 0.5) | 0; // fast Math.round via bitwise OR
  }

  // Transfer buffer back (zero-copy — no memory duplication)
  self.postMessage({ averaged }, [averaged.buffer]);
};
