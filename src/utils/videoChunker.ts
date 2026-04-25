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

  const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() || 'mp4' : 'mp4';
  const isWebm = file.type.includes('webm') || ext === 'webm';
  const outExt = isWebm ? 'webm' : 'mp4';
  const segmentFormat = isWebm ? 'webm' : 'mp4';
  
  const cleanFileName = `input_chunk.${ext}`;
  const cleanFile = new File([file], cleanFileName, { type: file.type });
  const inputName = `/workerfs/${cleanFileName}`;

  // MOUNT file instead of writing it to RAM (solves OOM crashes on large files)
  try { await ffmpeg.createDir('/workerfs'); } catch { /* ignore if exists */ }
  await ffmpeg.mount('WORKERFS' as any, { files: [cleanFile] }, '/workerfs');

  const segmentOptions = isWebm 
    ? [] 
    : ['-segment_format_options', 'movflags=empty_moov+default_base_moof+frag_keyframe:use_editlist=0'];

  // Use segment muxer with stream-copy
  await ffmpeg.exec([
    '-fflags', '+genpts',
    '-i', inputName,
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-f', 'segment',
    '-segment_time', String(chunkDurationSec),
    '-reset_timestamps', '1',
    '-avoid_negative_ts', 'make_zero',
    '-segment_format', segmentFormat,
    ...segmentOptions,
    `chunk_%03d.${outExt}`,
  ]);

  // Collect all chunks
  const chunks: VideoChunk[] = [];
  let index = 0;

  while (true) {
    const chunkName = `chunk_${String(index).padStart(3, '0')}.${outExt}`;
    try {
      const data = await ffmpeg.readFile(chunkName);
      const mime = isWebm ? 'video/webm' : 'video/mp4';
      const blob = new Blob([data as any], { type: mime });
      const chunkFile = new File([blob], chunkName, { type: mime });

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

  // Unmount instead of delete
  try { await ffmpeg.unmount('/workerfs'); } catch { /* ignore */ }

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

  const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() || 'mp4' : 'mp4';
  const isWebm = file.type.includes('webm') || ext === 'webm';
  const outExt = isWebm ? 'webm' : 'mp4';
  const segmentFormat = isWebm ? 'webm' : 'mp4';

  const cleanFileName = `input_stream.${ext}`;
  const cleanFile = new File([file], cleanFileName, { type: file.type });
  const inputName = `/workerfs/${cleanFileName}`;

  // MOUNT file natively to worker bypassing RAM completely
  try { await ffmpeg.createDir('/workerfs'); } catch { /* ignore if exists */ }
  await ffmpeg.mount('WORKERFS' as any, { files: [cleanFile] }, '/workerfs');

  const segmentOptions = isWebm 
    ? [] 
    : ['-segment_format_options', 'movflags=empty_moov+default_base_moof+frag_keyframe:use_editlist=0'];

  await ffmpeg.exec([
    '-fflags', '+genpts',
    '-i', inputName,
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-f', 'segment',
    '-segment_time', String(chunkDurationSec),
    '-reset_timestamps', '1',
    '-avoid_negative_ts', 'make_zero',
    '-segment_format', segmentFormat,
    ...segmentOptions,
    `stream_chunk_%03d.${outExt}`,
  ]);

  // Read and yield chunks sequentially.
  // Caller can start encrypt+upload of chunk[i] while we read chunk[i+1].
  let index = 0;
  while (true) {
    const chunkName = `stream_chunk_${String(index).padStart(3, '0')}.${outExt}`;
    try {
      const data = await ffmpeg.readFile(chunkName);
      const mime = isWebm ? 'video/webm' : 'video/mp4';
      const blob = new Blob([data as any], { type: mime });
      const chunkFile = new File([blob], chunkName, { type: mime });

      const chunkDuration = Math.min(
        chunkDurationSec,
        videoDuration - index * chunkDurationSec
      );

      // Clean up immediately to free memory
      try { await ffmpeg.deleteFile(chunkName); } catch { /* ignore */ }

      yield { file: chunkFile, index, durationSec: chunkDuration };
      index++;
    } catch {
      // No more chunks — segment muxer wrote fewer files than estimated
      break;
    }
  }

  try { await ffmpeg.unmount('/workerfs'); } catch { /* ignore */ }
}

export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const url = URL.createObjectURL(file);

    let resolved = false;
    const safeResolve = (duration: number) => {
      if (resolved) return;
      resolved = true;
      URL.revokeObjectURL(url);
      video.remove();
      resolve(duration);
    };

    const timeout = setTimeout(() => {
      safeResolve(60); // fallback estimate
    }, 2000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      safeResolve(isFinite(video.duration) ? video.duration : 60);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      safeResolve(60); // fallback estimate
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

    let resolved = false;
    const safeResolve = (blob: Blob | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(blob);
    };

    const timeout = setTimeout(() => {
      safeResolve(null);
    }, 3000);

    video.onloadedmetadata = () => {
      // Seek to 0.1s to avoid all-black first frame on some codecs
      // For WebMs without cues, this might hang, which is why we have the timeout
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      try {
        clearTimeout(timeout);
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
        if (!ctx) { safeResolve(null); return; }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => safeResolve(blob),
          'image/webp',
          0.75
        );
      } catch {
        safeResolve(null);
      }
    };

    video.onerror = () => {
      clearTimeout(timeout);
      safeResolve(null);
    };

    video.src = url;
  });
}
