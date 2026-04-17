/**
 * videoChunker.ts
 *
 * Uses FFmpeg WASM to split a video into fixed-duration standalone MP4 chunks
 * using the segment muxer with stream-copy (no re-encoding = near-instant).
 *
 * Also provides generateVideoThumbnail which extracts the first frame via
 * a hidden <video> + canvas element and returns a WebP Blob.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

export interface VideoChunk {
  file: File;
  index: number;
  durationSec: number;
}

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg();
  }
  if (!ffmpegLoaded) {
    await ffmpegInstance.load();
    ffmpegLoaded = true;
  }
  return ffmpegInstance;
}

/**
 * Splits a video file into chunks of `chunkDurationSec` seconds.
 * Uses FFmpeg segment muxer with stream-copy (no re-encoding).
 * Returns an array of File objects, one per chunk, in order.
 */
export async function splitVideoIntoChunks(
  file: File,
  chunkDurationSec: number = 15,
  onProgress?: (chunksDone: number, totalEstimate: number) => void
): Promise<VideoChunk[]> {
  const ffmpeg = await getFFmpeg();

  // Get video duration first so we can estimate total chunks
  const videoDuration = await getVideoDuration(file);
  const estimatedChunks = Math.ceil(videoDuration / chunkDurationSec);

  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp4';
  const inputName = `input_chunk.${ext}`;

  // Write input file to FFmpeg FS
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  // Use segment muxer with stream-copy
  // -reset_timestamps 1: each chunk starts at 0 (makes standalone playback work)
  // -segment_time: chunk duration in seconds
  // -f segment: use segment muxer
  // -c copy: stream copy (no re-encoding = instant)
  await ffmpeg.exec([
    '-i', inputName,
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-f', 'segment',
    '-segment_time', String(chunkDurationSec),
    '-reset_timestamps', '1',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart',
    '-segment_format', 'mp4',
    'chunk_%03d.mp4',
  ]);

  // Collect all chunks
  const chunks: VideoChunk[] = [];
  let index = 0;

  while (true) {
    const chunkName = `chunk_${String(index).padStart(3, '0')}.mp4`;
    try {
      const data = await ffmpeg.readFile(chunkName);
      const blob = new Blob([data as any], { type: 'video/mp4' });
      const chunkFile = new File([blob], chunkName, { type: 'video/mp4' });

      // Estimate chunk duration (last chunk may be shorter)
      const chunkDuration = Math.min(
        chunkDurationSec,
        videoDuration - index * chunkDurationSec
      );

      chunks.push({ file: chunkFile, index, durationSec: chunkDuration });

      // Clean up chunk from FS
      await ffmpeg.deleteFile(chunkName);

      onProgress?.(index + 1, estimatedChunks);
      index++;
    } catch {
      // No more chunks
      break;
    }
  }

  // Clean input
  try { await ffmpeg.deleteFile(inputName); } catch { /* ignore */ }

  return chunks;
}

/**
 * Streaming version: uses the FFmpeg segment muxer for accurate keyframe-aligned
 * splitting, then yields one chunk at a time for pipelined encrypt → upload → deliver.
 *
 * Why segment muxer instead of per-chunk -ss/-t?
 *   -ss with -c copy seeks to the NEAREST KEYFRAME, not the exact time.
 *   This creates 0.2-0.6s gaps/overlaps at every chunk boundary, causing
 *   visible "clips" in playback. The segment muxer handles keyframe alignment
 *   properly — chunks concatenated perfectly reproduce the original stream.
 */
export async function* splitVideoIntoChunksStreaming(
  file: File,
  chunkDurationSec: number = 15,
): AsyncGenerator<VideoChunk> {
  const ffmpeg = await getFFmpeg();

  const videoDuration = await getVideoDuration(file);
  const estimatedChunks = Math.ceil(videoDuration / chunkDurationSec);

  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp4';
  const inputName = `input_stream.${ext}`;

  // Write the input file once
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  console.log(`[VideoChunker] Splitting ${videoDuration.toFixed(1)}s video into ~${estimatedChunks} chunks (segment muxer, stream-copy)`);

  // Segment muxer: splits at keyframe boundaries with zero gaps.
  // -reset_timestamps 1: each chunk starts at 0 (standalone playback works).
  // -c copy: no re-encoding = near-instant + preserves audio.
  await ffmpeg.exec([
    '-i', inputName,
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-f', 'segment',
    '-segment_time', String(chunkDurationSec),
    '-reset_timestamps', '1',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart',
    '-segment_format', 'mp4',
    'stream_chunk_%03d.mp4',
  ]);

  // Read and yield chunks sequentially.
  // Caller can start encrypt+upload of chunk[i] while we read chunk[i+1].
  let index = 0;
  while (true) {
    const chunkName = `stream_chunk_${String(index).padStart(3, '0')}.mp4`;
    try {
      const data = await ffmpeg.readFile(chunkName);
      const blob = new Blob([data as any], { type: 'video/mp4' });
      const chunkFile = new File([blob], chunkName, { type: 'video/mp4' });

      const chunkDuration = Math.min(
        chunkDurationSec,
        videoDuration - index * chunkDurationSec
      );

      // Clean up immediately to free memory
      try { await ffmpeg.deleteFile(chunkName); } catch { /* ignore */ }

      console.log(`[VideoChunker] Yielding chunk ${index} (${chunkDuration.toFixed(1)}s, ${(blob.size / 1024).toFixed(0)} KB)`);
      yield { file: chunkFile, index, durationSec: chunkDuration };
      index++;
    } catch {
      // No more chunks — segment muxer wrote fewer files than estimated
      break;
    }
  }

  try { await ffmpeg.deleteFile(inputName); } catch { /* ignore */ }
  console.log(`[VideoChunker] Split complete — ${index} chunks yielded`);
}

/**
 * Gets the duration of a video file in seconds using the browser's
 * native video element (no FFmpeg needed, just metadata).
 */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const url = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(isFinite(video.duration) ? video.duration : 60);
      video.remove();
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(60); // fallback estimate
      video.remove();
    };

    video.src = url;
  });
}

/**
 * Generates a WebP thumbnail from the first frame of a video file.
 * Uses a hidden <video> element + canvas — no FFmpeg required.
 * Returns a Blob (WebP), or null on failure.
 */
export function generateVideoThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    const url = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    video.onloadedmetadata = () => {
      // Seek to 0.1s to avoid all-black first frame on some codecs
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        // Cap thumbnail to 480x270 (16:9) for fast transfer
        const MAX_W = 480;
        const MAX_H = 270;
        const ratio = Math.min(
          MAX_W / (video.videoWidth || MAX_W),
          MAX_H / (video.videoHeight || MAX_H)
        );
        canvas.width = Math.round((video.videoWidth || MAX_W) * ratio);
        canvas.height = Math.round((video.videoHeight || MAX_H) * ratio);

        const ctx = canvas.getContext('2d');
        if (!ctx) { cleanup(); resolve(null); return; }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => { cleanup(); resolve(blob); },
          'image/webp',
          0.75
        );
      } catch {
        cleanup();
        resolve(null);
      }
    };

    video.onerror = () => { cleanup(); resolve(null); };
    video.src = url;
  });
}
