import imageCompression from 'browser-image-compression';
import type { OptimizationResult } from '../types';

// ===== Image Optimization (browser-image-compression) =====

export async function optimizeImage(
  file: File,
  onProgress?: (p: number) => void
): Promise<OptimizationResult> {
  const originalSize = file.size;

  const options = {
    maxSizeMB: 2,
    maxWidthOrHeight: 2560,
    useWebWorker: true,
    fileType: 'image/webp' as const,
    initialQuality: 0.92,
    alwaysKeepResolution: true,
    onProgress: onProgress ? (progress: number) => onProgress(progress) : undefined,
  };

  const optimizedFile = await imageCompression(file, options);

  return {
    optimizedFile: new File([optimizedFile], file.name.replace(/\.[^.]+$/, '.webp'), {
      type: 'image/webp',
    }),
    originalSize,
    optimizedSize: optimizedFile.size,
  };
}

// ===== Video Optimization (ffmpeg.wasm) =====

let ffmpegInstance: any = null;
let ffmpegLoading = false;

async function loadFFmpeg(onLoadProgress?: (msg: string) => void): Promise<any> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (ffmpegLoading) {
    // Wait for existing load to complete
    while (ffmpegLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return ffmpegInstance;
  }

  ffmpegLoading = true;
  onLoadProgress?.('Preparing video engine... (first time only)');

  try {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');

    const ffmpeg = new FFmpeg();

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegInstance = ffmpeg;
    ffmpegLoading = false;
    return ffmpeg;
  } catch (error) {
    ffmpegLoading = false;
    throw new Error('Failed to load video engine');
  }
}

export async function optimizeVideo(
  file: File,
  onProgress?: (p: number) => void,
  onLoadProgress?: (msg: string) => void
): Promise<OptimizationResult> {
  const originalSize = file.size;

  try {
    const ffmpeg = await loadFFmpeg(onLoadProgress);
    const { fetchFile } = await import('@ffmpeg/util');

    ffmpeg.on('progress', ({ progress }: { progress: number }) => {
      onProgress?.(Math.round(progress * 100));
    });

    await ffmpeg.writeFile('input.mp4', await fetchFile(file));

    await ffmpeg.exec([
      '-i', 'input.mp4',
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'fast',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      'output.mp4',
    ]);

    const data = await ffmpeg.readFile('output.mp4');
    const optimizedFile = new File(
      [data],
      file.name.replace(/\.[^.]+$/, '.mp4'),
      { type: 'video/mp4' }
    );

    // Cleanup
    await ffmpeg.deleteFile('input.mp4');
    await ffmpeg.deleteFile('output.mp4');

    return {
      optimizedFile,
      originalSize,
      optimizedSize: optimizedFile.size,
    };
  } catch (error) {
    // Graceful fallback: return original file
    
    return {
      optimizedFile: file,
      originalSize,
      optimizedSize: originalSize,
    };
  }
}

// ===== Helpers =====

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function estimateOptimizedSize(file: File): string {
  const type = file.type;

  if (type.startsWith('image/')) {
    // Most images compress to 1-3 MB with our settings
    const estimated = Math.min(file.size * 0.15, 3 * 1024 * 1024);
    return `~${formatBytes(Math.max(estimated, 200 * 1024))}`;
  }

  if (type.startsWith('video/')) {
    // CRF 23 typically achieves 5-10x compression
    const estimated = file.size * 0.15;
    return `~${formatBytes(Math.max(estimated, 1 * 1024 * 1024))}`;
  }

  return formatBytes(file.size);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}
