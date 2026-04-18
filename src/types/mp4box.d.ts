/**
 * Type declarations for the `mp4box` npm package.
 * Only the subset of the API used by our MSE transmuxer is declared here.
 */

declare module 'mp4box' {
  export interface TrackInfo {
    id: number;
    codec: string;
    type: string;
    nb_samples: number;
    timescale: number;
    duration: number;
    bitrate: number;
    language: string;
    video?: { width: number; height: number };
    audio?: { sample_rate: number; channel_count: number; sample_size: number };
  }

  export interface FileInfo {
    duration: number;
    timescale: number;
    isFragmented: boolean;
    isProgressive: boolean;
    hasIOD: boolean;
    brands: string[];
    tracks: TrackInfo[];
    mime?: string;
  }

  export interface SegmentOptions {
    nbSamples?: number;
    rapAlignement?: boolean;
  }

  export interface InitSegmentResult {
    id: number;
    user: unknown;
    buffer: ArrayBuffer;
  }

  export interface ISOFile {
    onReady: ((info: FileInfo) => void) | null;
    onSegment: ((id: number, user: unknown, buffer: ArrayBuffer, sampleNum: number, isLast: boolean) => void) | null;
    onError: ((e: string) => void) | null;
    appendBuffer(buffer: ArrayBuffer & { fileStart?: number }): number;
    start(): void;
    flush(): void;
    setSegmentOptions(trackId: number, user: unknown, options?: SegmentOptions): void;
    initializeSegmentation(): InitSegmentResult[];
  }

  export function createFile(): ISOFile;
}
