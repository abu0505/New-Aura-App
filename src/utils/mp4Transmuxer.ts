/**
 * mp4Transmuxer.ts
 *
 * Converts standard (non-fragmented) MP4 files into fragmented MP4 (fMP4)
 * segments suitable for the MediaSource Extensions (MSE) API.
 *
 * Each regular MP4 chunk (ftyp + moov + mdat) becomes:
 *  - An init segment   (ftyp + moov with mvex) — needed once per track
 *  - Media segments     (moof + mdat pairs)     — appendable to SourceBuffer
 *
 * This enables true gapless playback: all chunks feed into a single
 * MediaSource / SourceBuffer pair, so the browser sees one continuous stream
 * with a unified timeline — no visible splits, no audio micro-gaps.
 */

import * as MP4Box from 'mp4box';
import type { FileInfo } from 'mp4box';

/* ── Public types ────────────────────────────────────────────────────────── */

export interface TrackData {
  id: number;
  type: 'video' | 'audio';
  codec: string;
  initSegment: ArrayBuffer;
  mediaSegments: ArrayBuffer[];
}

export interface TransmuxResult {
  tracks: TrackData[];
  /** Duration of this chunk in seconds. */
  duration: number;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Infer track type from the codec string (more reliable than mp4box's type field). */
function getTrackType(codec: string): 'video' | 'audio' | 'other' {
  const c = codec.toLowerCase();
  if (
    c.startsWith('avc') ||
    c.startsWith('hev') ||
    c.startsWith('hvc') ||
    c.startsWith('vp0') ||
    c.startsWith('av01') ||
    c.startsWith('mp4v')
  ) {
    return 'video';
  }
  if (
    c.startsWith('mp4a') ||
    c.startsWith('ac-') ||
    c.startsWith('ec-') ||
    c.startsWith('opus') ||
    c.startsWith('flac')
  ) {
    return 'audio';
  }
  return 'other';
}

/* ── Main transmux function ──────────────────────────────────────────────── */

/**
 * Transmux a standard MP4 `ArrayBuffer` into fragmented MP4 segments.
 *
 * Returns per-track init segments and media segments that can be directly
 * fed into MSE `SourceBuffer.appendBuffer()`.
 */
export function transmuxToFMP4(mp4Data: ArrayBuffer): Promise<TransmuxResult> {
  return new Promise((resolve, reject) => {
    try {
      const file = MP4Box.createFile();
      const trackSegments = new Map<number, ArrayBuffer[]>();
      const initSegments = new Map<number, ArrayBuffer>();
      let fileInfo: FileInfo | null = null;

      // ── onSegment fires (synchronously) for each media segment after start() ──
      file.onSegment = (
        id: number,
        _user: unknown,
        buffer: ArrayBuffer,
      ) => {
        const segs = trackSegments.get(id);
        if (segs) segs.push(buffer.slice(0)); // clone to decouple from mp4box internals
      };

      // ── onReady fires (synchronously) inside appendBuffer when moov is parsed ──
      file.onReady = (info: FileInfo) => {
        fileInfo = info;

        // Configure segmentation for every track
        for (const track of info.tracks) {
          trackSegments.set(track.id, []);
          // nbSamples: pack all samples of the chunk into a single media segment
          file.setSegmentOptions(track.id, null, { nbSamples: 100000 });
        }

        // Generate init segments (ftyp + moov with mvex) — one per track
        const initSegs = file.initializeSegmentation();
        for (const seg of initSegs) {
          initSegments.set(seg.id, seg.buffer);
        }

        // Start processing → triggers onSegment synchronously for buffered data
        file.start();
      };

      file.onError = (e: string) => {
        reject(new Error(`MP4Box transmux error: ${e}`));
      };

      // Feed the entire chunk (clone to avoid mutating caller's buffer)
      const buf = mp4Data.slice(0);
      (buf as any).fileStart = 0; // mp4box protocol: byte offset in the virtual file
      file.appendBuffer(buf as any);
      file.flush();

      // ── All callbacks above fire synchronously, so we have the result now ──
      if (!fileInfo) {
        reject(new Error('MP4Box: failed to parse MP4 data (onReady never fired)'));
        return;
      }

      const info = fileInfo as FileInfo;
      const tracks: TrackData[] = [];

      for (const track of info.tracks) {
        const type = getTrackType(track.codec);
        if (type === 'other') continue; // skip subtitle / metadata tracks

        tracks.push({
          id: track.id,
          type,
          codec: track.codec,
          initSegment: initSegments.get(track.id) || new ArrayBuffer(0),
          mediaSegments: trackSegments.get(track.id) || [],
        });
      }

      const duration = info.duration / info.timescale;
      resolve({ tracks, duration });
    } catch (err) {
      reject(err);
    }
  });
}
