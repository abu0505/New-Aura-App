/**
 * ChunkedVideoPlayer.tsx  —  v4: MSE Streaming Architecture
 *
 * ARCHITECTURE:
 *   The useVideoChunks hook handles all complexity:
 *     1. Per-block encryption: each 5MB block has its own derived nonce
 *     2. Receiver downloads + decrypts blocks as they arrive (realtime)
 *     3. Blocks are appended to a SourceBuffer in strict order via MSE
 *     4. A MediaSource blob URL is passed here for <video> playback
 *     5. Video starts playing when first block(s) are buffered (YouTube-style)
 *
 *   This player receives the MSE blobUrl from chunks[0].blobUrl and
 *   manages play/pause/seek/fullscreen UI on top.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ReceivedChunk } from '../../hooks/useVideoChunks';

/* ── Types ───────────────────────────────────────────────────────────────── */

interface ChunkedVideoPlayerProps {
  chunks: ReceivedChunk[];
  thumbnailUrl?: string | null;
  className?: string;
  /** If true, start playing immediately without waiting for a click. */
  autoPlay?: boolean;
  /** Total video duration in seconds. If provided, overrides the sum of chunk durations. */
  duration?: number;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function fmt(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ═══════════════════════════════════════════════════════════════════════════ */

export default function ChunkedVideoPlayer({
  chunks,
  thumbnailUrl,
  className = '',
  autoPlay = false,
  duration,
}: ChunkedVideoPlayerProps) {
  /* ── Refs ────────────────────────────────────────────────────────────── */
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const isPlayingRef = useRef(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── State ───────────────────────────────────────────────────────────── */
  const [hasStarted, setHasStarted] = useState(autoPlay);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [isBuffering, setIsBuffering] = useState(autoPlay);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [volume] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [videoAspect, setVideoAspect] = useState<number>(56.25);
  const [videoDuration, setVideoDuration] = useState(0);

  /* ── Sync refs ───────────────────────────────────────────────────────── */
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  /* ── Determine video URL + streaming progress ───────────────────────── */
  const videoUrl = useMemo(() => {
    const readyChunk = chunks.find(c => c.blobUrl);
    return readyChunk?.blobUrl ?? null;
  }, [chunks]);

  const isReady = !!videoUrl;

  /** 0-100: how much has been appended to the SourceBuffer */
  const bufferedPercent = useMemo(() => {
    return chunks[0]?.bufferedPercent ?? 0;
  }, [chunks]);

  /** True once all blocks have been appended (endOfStream called) */
  const isFullyBuffered = bufferedPercent >= 100;

  /* ── Total duration ──────────────────────────────────────────────────── */
  const totalDuration = useMemo(() => {
    if (duration && duration > 0) return duration;
    // From video element (most accurate once loaded)
    if (videoDuration > 0) return videoDuration;
    // From chunk metadata
    const chunkDur = chunks.find(c => c.duration)?.duration;
    if (chunkDur && chunkDur > 0) return chunkDur;
    return 0;
  }, [duration, videoDuration, chunks]);

  /* ── Set video source when URL becomes available ─────────────────────── */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    // Only update if the src actually changed
    if (video.src === videoUrl) return;

    console.log('[ChunkedVideoPlayer] Setting video.src to MSE/blob URL');
    video.src = videoUrl;
    // Do NOT call video.load() for blob: URLs (both regular blobs and MSE mediasource
    // URLs are accessed via blob: scheme). Calling load() on an MSE src resets the
    // MediaSource state machine and breaks playback. For plain blobs, the browser
    // also handles it correctly without an explicit load() call.
    if (!videoUrl.startsWith('blob:')) video.load();

    if (autoPlay) {
      const tryPlay = () => {
        console.log('[ChunkedVideoPlayer] canplay fired — attempting autoplay');
        video.play()
          .then(() => { console.log('[ChunkedVideoPlayer] autoplay started ✓'); setIsPlaying(true); setIsBuffering(false); })
          .catch((e) => { console.warn('[ChunkedVideoPlayer] autoplay blocked:', e); setIsBuffering(false); });
      };
      // canplay fires earlier than canplaythrough — good for streaming
      video.addEventListener('canplay', tryPlay, { once: true });
    } else {
      setIsBuffering(false);
    }
  }, [videoUrl, autoPlay]);

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
    const dur = v.duration || totalDuration;
    if (!isFinite(dur) || dur <= 0) return;
    const target = fraction * dur;
    v.currentTime = Math.max(0, Math.min(target, dur));
    setCurrentTime(v.currentTime);
  }, [totalDuration]);

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

  const effectiveDuration = totalDuration;
  const progressFraction = effectiveDuration > 0 ? currentTime / effectiveDuration : 0;
  const bufferFraction = effectiveDuration > 0 ? bufferedEnd / effectiveDuration : 0;

  return (
    <div
      ref={containerRef}
      className={`relative rounded-2xl overflow-hidden bg-black select-none ${className}`}
      onMouseMove={flashControls}
      onTouchStart={flashControls}
      style={{ cursor: 'pointer' }}
    >
      {/* Aspect ratio spacer */}
      <div style={{ paddingBottom: `${videoAspect}%` }} />

      {/* ── Video element ────────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        onTimeUpdate={() => {
          const v = videoRef.current;
          setCurrentTime(v?.currentTime ?? 0);
          updateBuffered();
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (v && v.videoWidth > 0 && v.videoHeight > 0) {
            setVideoAspect((v.videoHeight / v.videoWidth) * 100);
          }
          if (v && isFinite(v.duration) && v.duration > 0) {
            setVideoDuration(v.duration);
          }
        }}
        onDurationChange={() => {
          const v = videoRef.current;
          if (v && isFinite(v.duration) && v.duration > 0) {
            setVideoDuration(v.duration);
          }
        }}
        onProgress={updateBuffered}
        onWaiting={() => {
          console.log('[ChunkedVideoPlayer] buffering...');
          setIsBuffering(true);
        }}
        onPlaying={() => {
          console.log('[ChunkedVideoPlayer] playing ✓');
          setIsBuffering(false);
        }}
        onEnded={() => {
          console.log('[ChunkedVideoPlayer] ended');
          setIsPlaying(false);
        }}
        onError={() => {
          const v = videoRef.current;
          if (v?.src && v.src !== window.location.href) {
            const code = v.error?.code;
            const msg = v.error?.message;
            console.error('[ChunkedVideoPlayer] video error code=' + code + ' msg=' + msg);
            setError('Video could not be played. The format may not be supported.');
          }
        }}
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
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center z-50 bg-black/90 backdrop-blur-md">
          <span className="material-symbols-outlined text-red-500 text-5xl mb-3">error</span>
          <p className="text-white font-medium text-sm leading-relaxed mb-2">Playback Error</p>
          <p className="text-white/70 text-xs font-mono bg-black/50 p-3 rounded-lg overflow-y-auto max-h-[100px] max-w-[90%] whitespace-pre-wrap">
            {error}
          </p>
          <button
            onClick={() => setError(null)}
            className="mt-3 px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest"
            style={{ background: 'var(--gold, #e4b45a)', color: '#000' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Streaming progress overlay (while blocks are still downloading) ── */}
      {isReady && !isFullyBuffered && !error && (
        <div
          className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-full"
          style={{
            zIndex: 25,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(6px)',
            pointerEvents: 'none',
          }}
        >
          <div
            className="w-3 h-3 rounded-full border border-t-transparent animate-spin"
            style={{ borderColor: 'var(--gold, #e4b45a)', borderTopColor: 'transparent' }}
          />
          <span
            className="text-[10px] font-semibold tabular-nums"
            style={{ color: 'var(--gold-light, #f5d48a)' }}
          >
            {bufferedPercent}%
          </span>
        </div>
      )}

      {/* ── Loading overlay (video URL not yet available) ─────────────────── */}
      {!isReady && !error && (
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
            Assembling video…
          </span>
        </div>
      )}

      {/* ── Poster / play button (before first play) ─────────────────── */}
      {isReady && !hasStarted && !error && (
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
      {hasStarted && !error && (
        <div
          className="absolute inset-0"
          style={{ zIndex: 5 }}
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
        />
      )}

      {/* ── Buffering spinner ──────────────────────────────────────────── */}
      <AnimatePresence>
        {isBuffering && hasStarted && !error && (
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
        {hasStarted && !isPlaying && !isBuffering && !error && (
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
      {hasStarted && !error && (
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
            {/* Buffer bar */}
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

            {/* Scrubber dot */}
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
              {fmt(currentTime)} / {fmt(effectiveDuration)}
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
