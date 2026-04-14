/**
 * videoCompressor.worker.ts
 *
 * Runs entirely off the main thread in a Web Worker.
 * Uses the WebCodecs API (VideoEncoder) with mp4-muxer to compress
 * video frames using hardware acceleration (GPU).
 *
 * Main thread sends ImageBitmap frames (transferable, zero-copy).
 * Worker encodes them to H.264 and muxes into an in-memory MP4.
 *
 * Messages IN  (from main thread):
 *   { type: 'encode_frames', bitmaps: ImageBitmap[], width, height, framerate, totalFrames }
 *
 * Messages OUT (to main thread):
 *   { type: 'progress', progress: number }         -- 0-100
 *   { type: 'complete', buffer: ArrayBuffer }       -- compressed MP4
 *   { type: 'fallback' }                            -- VideoEncoder not supported
 *   { type: 'error', message: string }              -- something went wrong
 */

/// <reference lib="webworker" />

// Correctly type self as a DedicatedWorkerGlobalScope so postMessage transfer works
declare const self: DedicatedWorkerGlobalScope;

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

// Target quality settings
const TARGET_BITRATE = 2_000_000; // 2 Mbps — good quality, ~70% reduction vs raw

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data;

  if (type !== 'encode_frames') return;

  // ── Feature detection ──────────────────────────────────────────────────────
  if (typeof VideoEncoder === 'undefined') {
    self.postMessage({ type: 'fallback' });
    return;
  }

  const {
    bitmaps,
    width,
    height,
    framerate,
    totalFrames,
  } = e.data as {
    bitmaps: ImageBitmap[];
    width: number;
    height: number;
    framerate: number;
    totalFrames: number;
  };

  try {
    const compressedBuffer = await encodeFrames(bitmaps, width, height, framerate, totalFrames);
    // Only post if we got a real result (non-empty ArrayBuffer means success)
    if (compressedBuffer.byteLength > 0) {
      self.postMessage({ type: 'complete', buffer: compressedBuffer }, [compressedBuffer]);
    } else {
      self.postMessage({ type: 'fallback' });
    }
  } catch (err: any) {
    console.error('[VideoWorker] Compression failed:', err);
    self.postMessage({ type: 'error', message: err?.message || 'Unknown error' });
  }
};

// ─── Core Encoder ─────────────────────────────────────────────────────────────

async function encodeFrames(
  bitmaps: ImageBitmap[],
  outWidth: number,
  outHeight: number,
  framerate: number,
  totalFrames: number,
): Promise<ArrayBuffer> {
  // ── 1. Set up mp4-muxer ──────────────────────────────────────────────────
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: outWidth,
      height: outHeight,
    },
    fastStart: 'in-memory',
  });

  // ── 2. Choose codec config with hardware preference ───────────────────────
  // Try High Profile H.264 first (better quality), fallback to Baseline
  const highProfileConfig: VideoEncoderConfig = {
    codec: 'avc1.4d0034',           // H.264 High Profile Level 5.2
    width: outWidth,
    height: outHeight,
    bitrate: TARGET_BITRATE,
    framerate,
    latencyMode: 'quality',
    hardwareAcceleration: 'prefer-hardware',
  };

  const baselineConfig: VideoEncoderConfig = {
    codec: 'avc1.42003e',           // H.264 Baseline Level 6.2
    width: outWidth,
    height: outHeight,
    bitrate: TARGET_BITRATE,
    framerate,
    latencyMode: 'quality',
    hardwareAcceleration: 'prefer-software',
  };

  let finalConfig: VideoEncoderConfig | null = null;

  try {
    const { supported: highSupported } = await VideoEncoder.isConfigSupported(highProfileConfig);
    if (highSupported) {
      finalConfig = highProfileConfig;
    } else {
      const { supported: baseSupported } = await VideoEncoder.isConfigSupported(baselineConfig);
      if (baseSupported) {
        finalConfig = baselineConfig;
      }
    }
  } catch {
    // isConfigSupported threw — likely unsupported environment
  }

  if (!finalConfig) {
    // Neither config is supported — signal fallback to main thread
    bitmaps.forEach(b => b.close());
    self.postMessage({ type: 'fallback' });
    return new ArrayBuffer(0);
  }

  // ── 3. Set up VideoEncoder ────────────────────────────────────────────────
  let encodedCount = 0;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta ?? undefined);
      encodedCount++;
      const progress = Math.round((encodedCount / totalFrames) * 95);
      self.postMessage({ type: 'progress', progress });
    },
    error: (err) => {
      throw new Error(`VideoEncoder error: ${err.message}`);
    },
  });

  encoder.configure(finalConfig);

  // ── 4. Encode all frames ───────────────────────────────────────────────────
  const frameDurationUs = Math.round(1_000_000 / framerate); // microseconds per frame

  for (let i = 0; i < bitmaps.length; i++) {
    const bitmap = bitmaps[i];
    const timestamp = i * frameDurationUs;

    // VideoFrame accepts ImageBitmap directly — no canvas resize needed
    // (resize was already applied in the main thread before transfer)
    const frame = new VideoFrame(bitmap, {
      timestamp,
      duration: frameDurationUs,
    });

    // Insert a keyframe every 2 seconds so seeking works in the output
    encoder.encode(frame, { keyFrame: i % (framerate * 2) === 0 });

    frame.close();
    bitmap.close(); // Free memory immediately
  }

  // ── 5. Flush + Finalize ────────────────────────────────────────────────────
  await encoder.flush();
  encoder.close();
  muxer.finalize();

  self.postMessage({ type: 'progress', progress: 100 });

  return target.buffer;
}
