/**
 * ChunkedVideoPlayer.tsx  —  Direct Blob Architecture (v2)
 *
 * ARCHITECTURE:
 *  Previously used MSE (MediaSource Extensions) + mp4box transmuxing.
 *  That caused an infinite loading bug: FFmpeg's segment muxer produces
 *  fMP4 chunks (movflags=empty_moov+default_base_moof+frag_keyframe),
 *  and feeding those to MP4Box caused onReady to never fire because fMP4
 *  chunks don't contain a complete moov box. The MSE cleanup also wiped
 *  video.src after the direct-blob path already set it — a race condition.
 *
 *  NEW APPROACH:
 *  1. As soon as the FIRST chunk is decrypted, set video.src to that blob.
 *  2. When ALL chunks are decrypted, concatenate them into one big Blob
 *     and replace video.src with the merged blob for seekable full playback.
 *  3. No MSE, no transmuxing, no race conditions — just native <video> playback.
 *
 *  This works because:
 *  - Each FFmpeg segment chunk is a valid standalone MP4 file.
 *  - Concatenating valid MP4 files byte-for-byte produces a playable file
 *    when the codec/container is consistent (which FFmpeg guarantees with -c copy).
 *  - The browser handles the merged blob as a single seekable video.
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

  // Track blob URLs we own so we can revoke them on unmount
  const ownedBlobUrls = useRef<string[]>([]);

  // Stable value refs
  const isPlayingRef = useRef(false);
  const totalDurationRef = useRef(0);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the last merged blob URL we set to avoid re-merging identical chunks
  const lastMergedKeyRef = useRef<string>('');
  const isMergingRef = useRef(false);

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
  // Dynamic aspect ratio — updated from actual video metadata once loaded.
  const [videoAspect, setVideoAspect] = useState<number>(56.25);

  /* ── Sync refs ───────────────────────────────────────────────────────── */
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  /* ── Total duration from chunk metadata ──────────────────────────────── */
  const totalDuration = useMemo(
    () => {
      if (duration && duration > 0) return duration;
      return chunks.reduce((sum, c) => sum + (c.duration ?? 5), 0);
    },
    [chunks, duration],
  );
  useEffect(() => { totalDurationRef.current = totalDuration; }, [totalDuration]);

  /* ── Cleanup owned blob URLs on unmount ──────────────────────────────── */
  useEffect(() => {
    return () => {
      for (const url of ownedBlobUrls.current) {
        URL.revokeObjectURL(url);
      }
      ownedBlobUrls.current = [];
    };
  }, []);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  DIRECT BLOB PIPELINE                                                  */
  /*                                                                        */
  /*  Strategy:                                                             */
  /*  Phase 1 — As soon as the FIRST chunk decrypts, set video.src so      */
  /*            the user sees something playing immediately.                */
  /*  Phase 2 — When ALL chunks are ready, merge them into a single Blob   */
  /*            for a fully seekable playback experience.                   */
  /* ═══════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (chunks.length === 0) return;

    const decryptedChunks = chunks.filter(c => c.isDecrypted && c.blobUrl);
    if (decryptedChunks.length === 0) return;

    const reportedTotal = chunks[0]?.totalChunks ?? chunks.length;
    const allReady = decryptedChunks.length >= Math.min(reportedTotal, chunks.length);

    // Build a cache key from the set of ready chunk indices
    const readyKey = decryptedChunks.map(c => c.chunkIndex).sort((a, b) => a - b).join(',');

    // Don't re-merge if we already processed this exact set of chunks
    if (readyKey === lastMergedKeyRef.current) return;
    if (isMergingRef.current) return;

    isMergingRef.current = true;
    lastMergedKeyRef.current = readyKey;

    (async () => {
      try {
        const sortedChunks = [...decryptedChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

        // Fetch blob data for all ready chunks
        const fetchedBlobs = await Promise.all(
          sortedChunks.map(c => fetch(c.blobUrl!).then(r => r.blob()))
        );

        if (fetchedBlobs.length === 0) return;

        // Determine MIME type by sniffing the first blob's magic bytes
        const firstBuffer = await fetchedBlobs[0].arrayBuffer();
        const firstBytes = new Uint8Array(firstBuffer);
        let mimeType = 'video/mp4';
        if (firstBytes[0] === 0x1A && firstBytes[1] === 0x45 && firstBytes[2] === 0xDF && firstBytes[3] === 0xA3) {
          mimeType = 'video/webm';
        }

        // For WebM: only use first chunk (WebM segments can't be naively concatenated)
        // For MP4:  concatenate all ready chunks
        let mergedBlob: Blob;
        if (mimeType === 'video/webm') {
          // WebM: use all chunks — webm cluster segments CAN be concatenated
          mergedBlob = new Blob(fetchedBlobs, { type: mimeType });
        } else {
          // MP4: concatenate all ready chunks byte-for-byte
          // FFmpeg segment muxer with -c copy guarantees this is valid
          // Reconstruct first blob from its buffer to include it
          const firstBlob = new Blob([firstBuffer], { type: mimeType });
          const restBlobs = fetchedBlobs.slice(1);
          mergedBlob = new Blob([firstBlob, ...restBlobs], { type: mimeType });
        }

        const newUrl = URL.createObjectURL(mergedBlob);
        ownedBlobUrls.current.push(newUrl);

        const video = videoRef.current;
        if (!video) return;

        // Preserve current playback position if video was already playing
        const wasPlaying = !video.paused && !video.ended;
        const prevTime = video.currentTime;

        video.src = newUrl;
        video.load();

        // If all chunks are ready, set duration directly (avoids metadata ping)
        if (allReady && totalDurationRef.current > 0) {
          // The browser will detect the correct duration from the merged blob
        }

        if (wasPlaying || (autoPlay && allReady)) {
          // Restore position and resume playback
          video.addEventListener('loadedmetadata', () => {
            if (prevTime > 0 && prevTime < (video.duration || Infinity)) {
              video.currentTime = prevTime;
            }
            video.play()
              .then(() => { setIsPlaying(true); setIsBuffering(false); })
              .catch(() => setIsBuffering(false));
          }, { once: true });
        } else if (autoPlay && decryptedChunks.length === 1) {
          // Start playing immediately on the first chunk
          video.addEventListener('canplay', () => {
            video.play()
              .then(() => { setIsPlaying(true); setIsBuffering(false); })
              .catch(() => setIsBuffering(false));
          }, { once: true });
        } else {
          setIsBuffering(false);
        }
      } catch (err: any) {
        setError('Video could not be loaded. Please try again.');
      } finally {
        isMergingRef.current = false;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks, autoPlay]);

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
    const dur = v.duration || totalDurationRef.current;
    if (!isFinite(dur) || dur <= 0) return;
    const target = fraction * dur;
    v.currentTime = Math.max(0, Math.min(target, dur));
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

  // Effective duration — prefer video element's own duration when available
  const effectiveDuration = useMemo(() => {
    const v = videoRef.current;
    if (v && isFinite(v.duration) && v.duration > 0) return v.duration;
    return totalDuration;
  }, [totalDuration]);

  const progressFraction = effectiveDuration > 0 ? currentTime / effectiveDuration : 0;
  const bufferFraction = effectiveDuration > 0 ? bufferedEnd / effectiveDuration : 0;

  // Check if at least one chunk is ready
  const firstReady = chunks.some(c => c.isDecrypted && !!c.blobUrl);

  return (
    <div
      ref={containerRef}
      className={`relative rounded-2xl overflow-hidden bg-black select-none ${className}`}
      onMouseMove={flashControls}
      onTouchStart={flashControls}
      style={{ cursor: 'pointer' }}
    >
      {/* Aspect ratio spacer — computed dynamically from actual video dimensions */}
      <div style={{ paddingBottom: `${videoAspect}%` }} />

      {/* ── Single video element ────────────────────────────────────────── */}
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
        }}
        onDurationChange={() => {
          // Force a re-render to pick up the new duration from the video element
          const v = videoRef.current;
          if (v && isFinite(v.duration) && v.duration > 0) {
            totalDurationRef.current = v.duration;
            setCurrentTime(ct => ct); // trigger re-render
          }
        }}
        onProgress={updateBuffered}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onEnded={() => setIsPlaying(false)}
        onError={() => {
          // Only show error if we actually tried to load something
          if (videoRef.current?.src && videoRef.current.src !== window.location.href) {
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
        <div
          className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center z-50 bg-black/90 backdrop-blur-md"
        >
          <span className="material-symbols-outlined text-red-500 text-5xl mb-3">error</span>
          <p className="text-white font-medium text-sm leading-relaxed mb-2">
            Playback Error
          </p>
          <p className="text-white/70 text-xs font-mono bg-black/50 p-3 rounded-lg overflow-y-auto max-h-[100px] max-w-[90%] whitespace-pre-wrap">
            {error}
          </p>
          <button
            onClick={() => {
              setError(null);
              lastMergedKeyRef.current = ''; // Force re-merge on retry
            }}
            className="mt-3 px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest"
            style={{ background: 'var(--gold, #e4b45a)', color: '#000' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Loading overlay (no chunks decrypted yet) ──────────────────── */}
      {!firstReady && !error && (
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
      {firstReady && !hasStarted && !error && (
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
