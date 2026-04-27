/**
 * camera.worker.ts — Telegram-Style Recording Engine
 *
 * Runs 100% off the main thread in a Web Worker.
 * Architecture:
 *   Main Thread → raw VideoFrames (via MediaStreamTrackProcessor)
 *                 raw AudioData  (via MediaStreamTrackProcessor)
 *            ↓
 *   Worker → OffscreenCanvas (mirror + crop) → VideoEncoder (H.264, hardware-accel)
 *          → AudioEncoder (AAC/Opus) → mp4-muxer → MP4 ArrayBuffer → Main Thread
 *
 * Messages IN  (from main thread):
 *   { type: 'START', config: RecordingConfig }
 *   { type: 'VIDEO_FRAME', frame: VideoFrame }  — transferred, zero-copy
 *   { type: 'AUDIO_DATA', data: AudioData }      — transferred, zero-copy
 *   { type: 'STOP' }
 *
 * Messages OUT (to main thread):
 *   { type: 'READY' }                            — encoder initialized, ready to record
 *   { type: 'COMPLETE', buffer: ArrayBuffer }     — final MP4 file
 *   { type: 'ERROR', message: string }
 *   { type: 'FALLBACK' }                         — WebCodecs not supported
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RecordingConfig {
  /** Output canvas width (after crop & mirror) */
  outWidth: number;
  /** Output canvas height (after crop & mirror) */
  outHeight: number;
  /** Source crop: x offset in the raw camera frame */
  srcX: number;
  /** Source crop: y offset in the raw camera frame */
  srcY: number;
  /** Source crop: width to grab from the raw camera frame */
  srcW: number;
  /** Source crop: height to grab from the raw camera frame */
  srcH: number;
  /** Whether to mirror horizontally (front camera) */
  mirror: boolean;
  /** Target frame rate */
  fps: number;
  /** Target video bitrate in bits/sec */
  videoBitrate: number;
  /** Audio sample rate from getUserMedia */
  audioSampleRate: number;
  /** Audio channel count */
  audioChannelCount: number;
}

// ── State ─────────────────────────────────────────────────────────────────────

let muxer: InstanceType<typeof Muxer<ArrayBufferTarget>> | null = null;
let target: ArrayBufferTarget | null = null;
let videoEncoder: VideoEncoder | null = null;
let audioEncoder: AudioEncoder | null = null;
let offscreenCanvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let config: RecordingConfig | null = null;

// Timekeeping — both encoders must share the same epoch so A/V stays in sync
let firstVideoTimestampUs = -1;
let firstAudioTimestampUs = -1;

let videoFrameCount = 0;
let audioInitialized = false;
let isStopping = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function postError(msg: string) {
  self.postMessage({ type: 'ERROR', message: msg });
}

// ── Main message handler ──────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data;

  // ── Feature detection (runs on first message) ──────────────────────────────
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    self.postMessage({ type: 'FALLBACK' });
    return;
  }

  try {
    switch (type) {

      // ── START ───────────────────────────────────────────────────────────────
      case 'START': {
        config = e.data.config as RecordingConfig;
        const { outWidth, outHeight, fps, videoBitrate, audioSampleRate, audioChannelCount } = config;

        // Reset state for a new recording
        firstVideoTimestampUs = -1;
        firstAudioTimestampUs = -1;
        videoFrameCount = 0;
        audioInitialized = false;
        isStopping = false;

        // ── mp4-muxer setup ──────────────────────────────────────────────────
        target = new ArrayBufferTarget();
        muxer = new Muxer({
          target,
          video: { codec: 'avc', width: outWidth, height: outHeight },
          audio: { codec: 'aac', sampleRate: audioSampleRate, numberOfChannels: audioChannelCount },
          // fastStart 'in-memory' = write moov box at front after finalize (seekable, standard MP4)
          fastStart: 'in-memory',
        });

        // ── VideoEncoder setup ───────────────────────────────────────────────
        // Try H.264 High Profile first (hardware-accelerated on most mobile chips).
        // Fall back to Baseline Profile if High is not supported.
        const highProfile: VideoEncoderConfig = {
          codec: 'avc1.640034',   // H.264 High Profile, Level 5.2
          width: outWidth,
          height: outHeight,
          bitrate: videoBitrate,
          framerate: fps,
          latencyMode: 'realtime',            // Low-latency: encode each frame as it arrives
          hardwareAcceleration: 'prefer-hardware',
        };
        const baselineProfile: VideoEncoderConfig = {
          codec: 'avc1.42003e',   // H.264 Baseline Profile, Level 6.2
          width: outWidth,
          height: outHeight,
          bitrate: videoBitrate,
          framerate: fps,
          latencyMode: 'realtime',
          hardwareAcceleration: 'prefer-software',
        };

        let videoConfig: VideoEncoderConfig | null = null;
        try {
          if ((await VideoEncoder.isConfigSupported(highProfile)).supported) {
            videoConfig = highProfile;
          } else if ((await VideoEncoder.isConfigSupported(baselineProfile)).supported) {
            videoConfig = baselineProfile;
          }
        } catch { /* ignore */ }

        if (!videoConfig) {
          self.postMessage({ type: 'FALLBACK' });
          return;
        }

        videoEncoder = new VideoEncoder({
          output: (chunk, meta) => {
            muxer!.addVideoChunk(chunk, meta ?? undefined);
          },
          error: (err) => postError(`VideoEncoder error: ${err.message}`),
        });
        videoEncoder.configure(videoConfig);

        // ── AudioEncoder setup ───────────────────────────────────────────────
        const audioConfig: AudioEncoderConfig = {
          codec: 'mp4a.40.2',     // AAC-LC — widest hardware support on Android/iOS
          sampleRate: audioSampleRate,
          numberOfChannels: audioChannelCount,
          bitrate: 128_000,       // 128 kbps — excellent quality for voice/ambient audio
        };

        let audioConfigSupported = false;
        try {
          audioConfigSupported = (await AudioEncoder.isConfigSupported(audioConfig)).supported ?? false;
        } catch { /* ignore */ }

        if (audioConfigSupported) {
          audioEncoder = new AudioEncoder({
            output: (chunk, meta) => {
              muxer!.addAudioChunk(chunk, meta ?? undefined);
            },
            error: (err) => postError(`AudioEncoder error: ${err.message}`),
          });
          audioEncoder.configure(audioConfig);
          audioInitialized = true;
        }

        // ── OffscreenCanvas setup ────────────────────────────────────────────
        offscreenCanvas = new OffscreenCanvas(outWidth, outHeight);
        ctx = offscreenCanvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;

        // Set mirror transform ONCE on the context — never reset it in the loop.
        // This is a single GPU state call for the entire recording session.
        if (config.mirror) {
          ctx.setTransform(-1, 0, 0, 1, outWidth, 0);
        }

        self.postMessage({ type: 'READY' });
        break;
      }

      // ── VIDEO_FRAME ─────────────────────────────────────────────────────────
      case 'VIDEO_FRAME': {
        const frame: VideoFrame = e.data.frame;
        if (!videoEncoder || !config || !ctx || !offscreenCanvas || isStopping) {
          frame.close();
          return;
        }

        // Back-pressure guard: if encoder queue is building up, drop frames gracefully
        if (videoEncoder.encodeQueueSize > 5) {
          frame.close();
          return;
        }

        // Anchor the first frame timestamp to establish the recording epoch
        if (firstVideoTimestampUs < 0) firstVideoTimestampUs = frame.timestamp;
        const normalizedTs = frame.timestamp - firstVideoTimestampUs;

        // Draw the raw camera frame onto OffscreenCanvas with crop + (optional) mirror
        // The transform was set ONCE in START — no save/restore overhead per frame
        ctx.drawImage(
          frame,
          config.srcX, config.srcY, config.srcW, config.srcH,
          0, 0, config.outWidth, config.outHeight
        );

        // Critical memory management: close the raw frame immediately after drawing.
        // VideoFrame holds a GPU texture reference — not closing causes VRAM exhaustion.
        frame.close();

        // Extract the processed frame from OffscreenCanvas and send it to the encoder
        const processedFrame = new VideoFrame(offscreenCanvas, {
          timestamp: normalizedTs,
          // Key frame every 2 seconds — balances seek performance vs. file size
          alpha: 'discard',
        });

        videoEncoder.encode(processedFrame, {
          keyFrame: videoFrameCount % (config.fps * 2) === 0,
        });
        processedFrame.close();
        videoFrameCount++;
        break;
      }

      // ── AUDIO_DATA ──────────────────────────────────────────────────────────
      case 'AUDIO_DATA': {
        const data: AudioData = e.data.data;
        if (!audioEncoder || !audioInitialized || isStopping) {
          data.close();
          return;
        }

        // Normalize audio timestamps to the same epoch as video
        if (firstAudioTimestampUs < 0) {
          // If video has started, sync to video epoch; else use own epoch
          firstAudioTimestampUs = firstVideoTimestampUs >= 0 ? firstVideoTimestampUs : data.timestamp;
        }

        const normalizedTs = Math.max(0, data.timestamp - firstAudioTimestampUs);

        // Clone with corrected timestamp before closing the original
        const format = data.format;
        if (!format) {
          data.close();
          return;
        }

        const syncedData = new AudioData({
          format: format,
          sampleRate: data.sampleRate,
          numberOfFrames: data.numberOfFrames,
          numberOfChannels: data.numberOfChannels,
          timestamp: normalizedTs,
          data: (() => {
            // Copy PCM bytes out of the AudioData (it will be closed after this)
            const options = { planeIndex: 0 };
            const buf = new ArrayBuffer(data.allocationSize(options));
            data.copyTo(buf, options);
            return buf;
          })(),
        });

        data.close();
        audioEncoder.encode(syncedData);
        syncedData.close();
        break;
      }

      // ── STOP ────────────────────────────────────────────────────────────────
      case 'STOP': {
        if (isStopping) return; // Already stopping — ignore duplicate STOP
        isStopping = true;

        if (!videoEncoder || !muxer) {
          postError('Cannot stop: encoder not initialized.');
          return;
        }

        // Flush encoders — wait for all pending frames to finish encoding
        await videoEncoder.flush();
        videoEncoder.close();

        if (audioEncoder && audioInitialized) {
          await audioEncoder.flush();
          audioEncoder.close();
        }

        // Finalize the MP4 container — writes moov box + all metadata
        muxer.finalize();

        // Transfer the buffer back to main thread (zero-copy via Transferable)
        const buffer = target!.buffer;
        self.postMessage({ type: 'COMPLETE', buffer }, [buffer]);

        // Clean up all state
        muxer = null;
        target = null;
        videoEncoder = null;
        audioEncoder = null;
        offscreenCanvas = null;
        ctx = null;
        config = null;
        break;
      }
    }
  } catch (err: any) {
    postError(err?.message ?? 'Unknown worker error');
  }
};
