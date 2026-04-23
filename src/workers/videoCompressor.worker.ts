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
declare const self: DedicatedWorkerGlobalScope;
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const TARGET_BITRATE = 2_000_000;

let muxer: any = null;
let encoder: VideoEncoder | null = null;
let target: ArrayBufferTarget | null = null;
let encodedCount = 0;
let expectedTotalFrames = 0;
let frameDurationUs = 0;
let framerate = 30;

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data;

  // Feature detection
  if (typeof VideoEncoder === 'undefined') {
    self.postMessage({ type: 'fallback' });
    return;
  }

  try {
    if (type === 'init') {
      const { outWidth, outHeight, fps, totalFrames } = e.data;
      expectedTotalFrames = totalFrames;
      framerate = fps;
      encodedCount = 0;
      frameDurationUs = Math.round(1_000_000 / framerate);

      target = new ArrayBufferTarget();
      muxer = new Muxer({
        target,
        video: { codec: 'avc', width: outWidth, height: outHeight },
        fastStart: 'in-memory',
      });

      const highProfileConfig: VideoEncoderConfig = {
        codec: 'avc1.4d0034',
        width: outWidth, height: outHeight,
        bitrate: TARGET_BITRATE, framerate, latencyMode: 'quality', hardwareAcceleration: 'prefer-hardware',
      };
      const baselineConfig: VideoEncoderConfig = {
        codec: 'avc1.42003e',
        width: outWidth, height: outHeight,
        bitrate: TARGET_BITRATE, framerate, latencyMode: 'quality', hardwareAcceleration: 'prefer-software',
      };

      let finalConfig: VideoEncoderConfig | null = null;
      try {
        if ((await VideoEncoder.isConfigSupported(highProfileConfig)).supported) finalConfig = highProfileConfig;
        else if ((await VideoEncoder.isConfigSupported(baselineConfig)).supported) finalConfig = baselineConfig;
      } catch {}

      if (!finalConfig) {
        self.postMessage({ type: 'fallback' });
        return;
      }

      encoder = new VideoEncoder({
        output: (chunk, meta) => {
          muxer.addVideoChunk(chunk, meta ?? undefined);
          encodedCount++;
          // Report hardware progress on mux
          self.postMessage({ type: 'progress', progress: Math.round((encodedCount / expectedTotalFrames) * 95) });
        },
        error: (err) => {
          
          self.postMessage({ type: 'error', message: err.message });
        },
      });

      encoder.configure(finalConfig);
      self.postMessage({ type: 'init_done' });
    } 
    else if (type === 'frame') {
      if (!encoder) return;
      const { bitmap, frameIndex } = e.data;
      const timestamp = frameIndex * frameDurationUs;

      const frame = new VideoFrame(bitmap, { timestamp, duration: frameDurationUs });
      encoder.encode(frame, { keyFrame: frameIndex % (framerate * 2) === 0 });
      
      frame.close();
      bitmap.close();
    }
    else if (type === 'flush') {
      if (!encoder) return;
      await encoder.flush();
      encoder.close();
      muxer.finalize();
      
      self.postMessage({ type: 'progress', progress: 100 });
      self.postMessage({ type: 'complete', buffer: target!.buffer }, [target!.buffer]);
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err?.message || 'Worker Error' });
  }
};
