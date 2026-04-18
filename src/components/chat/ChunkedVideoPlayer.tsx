/**
 * ChunkedVideoPlayer.tsx  —  MSE (MediaSource Extensions) Architecture
 *
 * Achieves YouTube/Netflix-level seamless playback of chunked, encrypted videos.
 *
 * How it works:
 *  1. A single <video> element is backed by a MediaSource object.
 *  2. Two SourceBuffers (video + audio) operate in "sequence" mode.
 *  3. As each encrypted chunk is decrypted (blob URL becomes available),
 *     it is transmuxed from standard MP4 → fragmented MP4 (fMP4) via mp4box.js.
 *  4. The fMP4 init segment (first chunk only) + media segments are appended
 *     to the SourceBuffers sequentially.
 *  5. The browser treats this as ONE continuous stream:
 *       – Single unified timeline (no visible splits in the progress bar)
 *       – Gapless audio across chunk boundaries
 *       – Native seeking across the full duration
 *  6. When all chunks are appended, `mediaSource.endOfStream()` finalises
 *     the duration and lets the browser optimise its internal buffers.
 *
 * Architecture name: MSE Transmux Pipeline
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { transmuxToFMP4 } from '../../utils/mp4Transmuxer';
import type { ReceivedChunk } from '../../hooks/useVideoChunks';

/* ── Types ───────────────────────────────────────────────────────────────── */

interface ChunkedVideoPlayerProps {
  chunks: ReceivedChunk[];
  thumbnailUrl?: string | null;
  className?: string;
  /** If true, start playing immediately without waiting for a click. */
  autoPlay?: boolean;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function fmt(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Append data to a SourceBuffer and wait for the updateend event.
 * Automatically retries if the SB is currently updating.
 */
function appendToSB(sb: SourceBuffer, data: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (sb.updating) {
      // SB is busy — wait for current op to finish, then retry
      const onRetry = () => {
        sb.removeEventListener('updateend', onRetry);
        appendToSB(sb, data).then(resolve).catch(reject);
      };
      sb.addEventListener('updateend', onRetry);
      return;
    }

    const cleanup = () => {
      sb.removeEventListener('updateend', onEnd);
      sb.removeEventListener('error', onErr);
    };
    const onEnd = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('SourceBuffer append error')); };

    sb.addEventListener('updateend', onEnd);
    sb.addEventListener('error', onErr);

    try {
      sb.appendBuffer(data);
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════ */

function hasMoof(buffer: ArrayBuffer): boolean {
  const view = new DataView(buffer);
  let offset = 0;
  while (offset < view.byteLength) {
    if (offset + 8 > view.byteLength) break;
    const size = view.getUint32(offset);
    if (size === 0) break; // until EOF
    if (size < 8) break; // invalid box
    const type = view.getUint32(offset + 4);
    if (type === 0x6D6F6F66) return true; // 'moof'
    offset += size;
  }
  return false;
}

export default function ChunkedVideoPlayer({
  chunks,
  thumbnailUrl,
  className = '',
  autoPlay = false,
}: ChunkedVideoPlayerProps) {
  /* ── Refs ────────────────────────────────────────────────────────────── */
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // MSE internals
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const videoSBRef = useRef<SourceBuffer | null>(null);
  const audioSBRef = useRef<SourceBuffer | null>(null);
  const isWebmStreamRef = useRef(false);
  const nextChunkRef = useRef(0);
  const isProcessingRef = useRef(false);
  const endOfStreamCalled = useRef(false);

  // Stable value refs
  const chunksRef = useRef(chunks);
  const isPlayingRef = useRef(false);
  const totalDurationRef = useRef(0);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── State ───────────────────────────────────────────────────────────── */
  const [mseOpen, setMseOpen] = useState(false);
  const [hasStarted, setHasStarted] = useState(autoPlay);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [isBuffering, setIsBuffering] = useState(autoPlay); // show spinner immediately if autoPlay
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [volume] = useState(1);
  const [error, setError] = useState<string | null>(null);

  /* ── Sync refs ───────────────────────────────────────────────────────── */
  useEffect(() => { chunksRef.current = chunks; }, [chunks]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  /* ── Total duration from chunk metadata ──────────────────────────────── */
  const totalDuration = useMemo(
    () => chunks.reduce((sum, c) => sum + (c.duration ?? 8), 0),
    [chunks],
  );
  useEffect(() => { totalDurationRef.current = totalDuration; }, [totalDuration]);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  MSE SETUP — create MediaSource and attach to <video>                 */
  /* ═══════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (typeof MediaSource === 'undefined') {
      setError('MediaSource API not available in this browser');
      return;
    }

    const ms = new MediaSource();
    mediaSourceRef.current = ms;
    const url = URL.createObjectURL(ms);

    ms.addEventListener('sourceopen', () => {
      setMseOpen(true);
    });

    const video = videoRef.current;
    if (video) {
      video.src = url;
    }

    return () => {
      URL.revokeObjectURL(url);
      try {
        if (ms.readyState === 'open') ms.endOfStream();
      } catch { /* cleanup best-effort */ }
      mediaSourceRef.current = null;
      videoSBRef.current = null;
      audioSBRef.current = null;
      isWebmStreamRef.current = false;
      nextChunkRef.current = 0;
      endOfStreamCalled.current = false;
      setError(null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  CHUNK PROCESSING — transmux & append as chunks become available       */
  /* ═══════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (!mseOpen) return;

    const processChunks = async () => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      const ms = mediaSourceRef.current;
      if (!ms || ms.readyState !== 'open') {
        isProcessingRef.current = false;
        return;
      }

      try {
        while (nextChunkRef.current < chunksRef.current.length) {
          const idx = nextChunkRef.current;
          const chunk = chunksRef.current[idx];

          // Wait until this chunk is decrypted
          if (!chunk.isDecrypted || !chunk.blobUrl) break;

          // 1. Fetch the decrypted blob → raw ArrayBuffer
          const resp = await fetch(chunk.blobUrl);
          const rawData = await resp.arrayBuffer();

          if (idx === 0) {
            if (rawData.byteLength >= 4) {
              const view = new DataView(rawData);
              if (view.getUint32(0) === 0x1A45DFA3) {
                isWebmStreamRef.current = true;
              }
            }
          }

          if (isWebmStreamRef.current) {
            if (idx === 0) {
              let mime = 'video/webm; codecs="vp9,opus"';
              if (!MediaSource.isTypeSupported(mime)) {
                mime = 'video/webm; codecs="vp8,opus"';
                if (!MediaSource.isTypeSupported(mime)) {
                   mime = 'video/webm';
                }
              }
              const sb = ms.addSourceBuffer(mime);
              sb.mode = 'sequence';
              videoSBRef.current = sb;

              try {
                if (ms.readyState === 'open') {
                  ms.duration = totalDurationRef.current;
                }
              } catch (e) {
              }
            }

            if (ms.readyState !== 'open') break;

            if (videoSBRef.current) {
              await appendToSB(videoSBRef.current, rawData);
            }
          } else {
            const isFMP4 = hasMoof(rawData);

            if (isFMP4) {
              // ── Append raw chunk directly (it is natively an fMP4) ───

              if (idx === 0) {
                let mimeLine = 'video/mp4';
                try {
                  const result = await transmuxToFMP4(rawData);
                  const videoTrack = result.tracks.find(t => t.type === 'video');
                  const audioTrack = result.tracks.find(t => t.type === 'audio');
                  
                  const codecs = [];
                  if (videoTrack?.codec) codecs.push(videoTrack.codec);
                  if (audioTrack?.codec) codecs.push(audioTrack.codec);
                  
                  if (codecs.length > 0) {
                    mimeLine = `video/mp4; codecs="${codecs.join(', ')}"`;
                  }
                } catch (e) {
                }

                if (ms.readyState !== 'open') break;

                if (MediaSource.isTypeSupported(mimeLine)) {
                  const sb = ms.addSourceBuffer(mimeLine);
                  sb.mode = 'sequence';
                  videoSBRef.current = sb;
                } else {
                  const sb = ms.addSourceBuffer('video/mp4');
                  sb.mode = 'sequence';
                  videoSBRef.current = sb;
                }

                try {
                  if (ms.readyState === 'open') {
                    ms.duration = totalDurationRef.current;
                  }
                } catch (e) { }
              }

              if (videoSBRef.current) {
                try {
                   await appendToSB(videoSBRef.current, rawData);
                } catch (e) {
                }
              }
            } else {
              // ── Legacy chunk logic: Transmux standard MP4 to fMP4 ───
              const result = await transmuxToFMP4(rawData);
              const videoTrack = result.tracks.find(t => t.type === 'video');
              const audioTrack = result.tracks.find(t => t.type === 'audio');

              if (ms.readyState !== 'open') break;

              if (idx === 0) {
                if (videoTrack) {
                  const mime = `video/mp4; codecs="${videoTrack.codec}"`;
                  if (MediaSource.isTypeSupported(mime)) {
                    const sb = ms.addSourceBuffer(mime);
                    sb.mode = 'sequence';
                    videoSBRef.current = sb;
                    try {
                      await appendToSB(sb, videoTrack.initSegment);
                    } catch (e) {
                    }
                  }
                }

                if (audioTrack) {
                  const mime = `audio/mp4; codecs="${audioTrack.codec}"`;
                  if (MediaSource.isTypeSupported(mime)) {
                    const sb = ms.addSourceBuffer(mime);
                    sb.mode = 'sequence';
                    audioSBRef.current = sb;
                    try {
                       await appendToSB(sb, audioTrack.initSegment);
                    } catch (e) {
                    }
                  }
                }

                try {
                  if (ms.readyState === 'open') {
                    ms.duration = totalDurationRef.current;
                  }
                } catch (e) { }
              }

              if (ms.readyState !== 'open') break;

              if (videoTrack && videoSBRef.current) {
                for (const seg of videoTrack.mediaSegments) {
                  try {
                    await appendToSB(videoSBRef.current, seg);
                  } catch (e) {
                  }
                }
              }
              if (audioTrack && audioSBRef.current) {
                for (const seg of audioTrack.mediaSegments) {
                  try {
                    await appendToSB(audioSBRef.current, seg);
                  } catch (e) {
                  }
                }
              }
            }
          }

          nextChunkRef.current = idx + 1;

          // Auto-play immediately after the first chunk is ready
          if (idx === 0 && autoPlay && videoRef.current) {
            videoRef.current
              .play()
              .then(() => {
                setIsPlaying(true);
                setIsBuffering(false);
              })
              .catch(() => {
                // Autoplay blocked — let user click
                setIsBuffering(false);
              });
          }
        }

        // ── All chunks appended → finalise stream ──────────────────────
        if (
          nextChunkRef.current >= chunksRef.current.length &&
          !endOfStreamCalled.current
        ) {
          try {
            // Wait for any pending SB updates
            const waitSB = (sb: SourceBuffer) =>
              new Promise<void>(resolve => {
                if (!sb.updating) { resolve(); return; }
                sb.addEventListener('updateend', () => resolve(), { once: true });
              });

            if (videoSBRef.current) await waitSB(videoSBRef.current);
            if (audioSBRef.current) await waitSB(audioSBRef.current);

            if (ms.readyState === 'open') {
              ms.endOfStream();
              endOfStreamCalled.current = true;
            }
          } catch (e) {
          }
        }
      } catch (err: any) {
        setError(err.message || String(err));
      } finally {
        isProcessingRef.current = false;
      }
    };

    // Run immediately + poll as backup (catches races where chunks change mid-process)
    processChunks();
    const interval = setInterval(processChunks, 500);
    return () => clearInterval(interval);
  }, [mseOpen, chunks, autoPlay]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Volume sync ────────────────────────────────────────────────────── */
  useEffect(() => {
    const v = videoRef.current;
    if (v) { v.volume = volume; v.muted = isMuted; }
  }, [volume, isMuted]);

  /* ── Fullscreen listener ────────────────────────────────────────────── */
  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  /* ── Cleanup ────────────────────────────────────────────────────────── */
  useEffect(() => () => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
  }, []);

  /* ── Read buffered range from the <video> element ───────────────────── */
  const updateBuffered = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.buffered.length) return;
    setBufferedEnd(v.buffered.end(v.buffered.length - 1));
  }, []);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  PLAYER CONTROLS                                                       */
  /* ═══════════════════════════════════════════════════════════════════════ */

  const togglePlay = useCallback(() => {
    if (error) return;
    const v = videoRef.current;
    if (!v) return;

    if (!hasStarted) setHasStarted(true);

    if (isPlayingRef.current) {
      v.pause();
      setIsPlaying(false);
    } else {
      // If video ended, restart from the beginning
      if (v.ended) {
        v.currentTime = 0;
      }
      v.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [hasStarted, error]);

  const seekTo = useCallback((fraction: number) => {
    const v = videoRef.current;
    if (!v) return;
    const target = fraction * totalDurationRef.current;
    v.currentTime = Math.max(0, Math.min(target, totalDurationRef.current));
    setCurrentTime(v.currentTime);
  }, []);

  const getFraction = useCallback((clientX: number) => {
    const bar = progressRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handleProgressDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      seekTo(getFraction(e.clientX));

      const onMove = (ev: MouseEvent) => seekTo(getFraction(ev.clientX));
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [seekTo, getFraction],
  );

  const handleProgressTouch = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      const touch = e.touches[0];
      if (touch) seekTo(getFraction(touch.clientX));
    },
    [seekTo, getFraction],
  );

  const toggleFS = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      c.requestFullscreen().catch(() => {});
    }
  }, []);

  const flashControls = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (isPlayingRef.current) setShowControls(false);
    }, 3000);
  }, []);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*                               RENDER                                   */
  /* ═══════════════════════════════════════════════════════════════════════ */

  const progressFraction = totalDuration > 0 ? currentTime / totalDuration : 0;
  const bufferFraction = totalDuration > 0 ? bufferedEnd / totalDuration : 0;

  // Check if at least one chunk is ready (for the loading overlay)
  const firstReady = chunks.some(c => c.isDecrypted && !!c.blobUrl);

  return (
    <div
      ref={containerRef}
      className={`relative rounded-2xl overflow-hidden bg-black select-none ${className}`}
      onMouseMove={flashControls}
      onTouchStart={flashControls}
      style={{ cursor: 'pointer' }}
    >
      {/* Aspect ratio spacer */}
      <div style={{ paddingBottom: '56.25%' }} />

      {/* ── Single video element (always rendered for MSE attachment) ────── */}
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        onTimeUpdate={() => {
          setCurrentTime(videoRef.current?.currentTime ?? 0);
          updateBuffered();
        }}
        onProgress={updateBuffered}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onEnded={() => setIsPlaying(false)}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          zIndex: 2,
        }}
      />

      {/* ── Error Overlay ────────────────────────────────────────────────── */}
      {error && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center z-50 bg-black/90 backdrop-blur-md"
        >
          <span className="material-symbols-outlined text-red-500 text-5xl mb-3">error</span>
          <p className="text-white font-medium text-sm leading-relaxed mb-2" style={{ wordBreak: 'break-word' }}>
            Playback Error
          </p>
          <p className="text-white/70 text-xs font-mono bg-black/50 p-3 rounded-lg overflow-y-auto max-h-[100px] max-w-[90%] whitespace-pre-wrap">
            {error}
          </p>
        </div>
      )}

      {/* ── Loading overlay (no chunks decrypted yet) ──────────────────── */}
      {!firstReady && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2"
          style={{ zIndex: 20, background: 'rgba(0,0,0,0.8)' }}
        >
          {thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-40"
            />
          )}
          <div
            className="relative w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--gold)', borderTopColor: 'transparent' }}
          />
          <span
            className="relative text-[10px] font-semibold"
            style={{ color: 'var(--gold-light)' }}
          >
            Buffering…
          </span>
        </div>
      )}

      {/* ── Poster / play button (before first play, after chunks ready) ── */}
      {firstReady && !hasStarted && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
        >
          {thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-black/30" />
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative z-10 w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center"
          >
            <span
              className="material-symbols-outlined text-white text-4xl"
              style={{ marginLeft: 4 }}
            >
              play_arrow
            </span>
          </motion.div>
        </div>
      )}

      {/* ── Click-to-play/pause surface ────────────────────────────────── */}
      {hasStarted && (
        <div
          className="absolute inset-0"
          style={{ zIndex: 5 }}
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
        />
      )}

      {/* ── Buffering spinner ──────────────────────────────────────────── */}
      <AnimatePresence>
        {isBuffering && hasStarted && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ zIndex: 8 }}
          >
            <div
              className="w-10 h-10 rounded-full border-[3px] border-t-transparent animate-spin"
              style={{
                borderColor: 'rgba(255,255,255,0.7)',
                borderTopColor: 'transparent',
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Paused icon (center) ───────────────────────────────────────── */}
      <AnimatePresence>
        {hasStarted && !isPlaying && !isBuffering && (
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ zIndex: 7 }}
          >
            <div className="w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
              <span
                className="material-symbols-outlined text-white text-3xl"
                style={{ marginLeft: 3 }}
              >
                play_arrow
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Controls overlay ───────────────────────────────────────────── */}
      {hasStarted && (
        <motion.div
          animate={{ opacity: showControls || !isPlaying ? 1 : 0 }}
          transition={{ duration: 0.25 }}
          className="absolute bottom-0 left-0 right-0"
          style={{
            zIndex: 30,
            background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
            padding: '2rem 0.75rem 0.5rem',
            pointerEvents: showControls || !isPlaying ? 'auto' : 'none',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Progress bar ──────────────────────────────────────────── */}
          <div
            ref={progressRef}
            className="relative w-full h-[3px] rounded-full mb-2 cursor-pointer group hover:h-[5px] transition-all"
            style={{ background: 'rgba(255,255,255,0.15)' }}
            onMouseDown={handleProgressDown}
            onTouchMove={handleProgressTouch}
          >
            {/* Continuous buffer bar (single unbroken range) */}
            <div
              className="absolute top-0 h-full rounded-full"
              style={{
                width: `${bufferFraction * 100}%`,
                background: 'rgba(255,255,255,0.3)',
              }}
            />

            {/* Played progress (gold accent) */}
            <div
              className="absolute top-0 h-full rounded-full"
              style={{
                width: `${progressFraction * 100}%`,
                background: 'var(--gold, #e4b45a)',
                transition: 'width 0.1s linear',
              }}
            />

            {/* Scrubber dot (visible on hover) */}
            <div
              className="absolute top-1/2 w-3.5 h-3.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{
                left: `${progressFraction * 100}%`,
                transform: 'translate(-50%, -50%)',
                background: 'var(--gold, #e4b45a)',
                boxShadow: '0 0 6px rgba(0,0,0,0.5)',
              }}
            />
          </div>

          {/* ── Bottom controls row ───────────────────────────────────── */}
          <div className="flex items-center gap-2">
            {/* Play / Pause */}
            <button
              onClick={(e) => { e.stopPropagation(); togglePlay(); }}
              className="text-white/90 hover:text-white transition-colors p-1"
            >
              <span className="material-symbols-outlined text-xl">
                {isPlaying ? 'pause' : 'play_arrow'}
              </span>
            </button>

            {/* Time display */}
            <span className="text-white/75 text-[11px] font-medium tabular-nums whitespace-nowrap select-none">
              {fmt(currentTime)} / {fmt(totalDuration)}
            </span>

            <div className="flex-1" />

            {/* Volume */}
            <button
              onClick={(e) => { e.stopPropagation(); setIsMuted(m => !m); }}
              className="text-white/75 hover:text-white transition-colors p-1"
            >
              <span className="material-symbols-outlined text-lg">
                {isMuted || volume === 0
                  ? 'volume_off'
                  : volume < 0.5
                    ? 'volume_down'
                    : 'volume_up'}
              </span>
            </button>

            {/* Fullscreen */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleFS(); }}
              className="text-white/75 hover:text-white transition-colors p-1"
            >
              <span className="material-symbols-outlined text-lg">
                {isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
              </span>
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
