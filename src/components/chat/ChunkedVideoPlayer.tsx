/**
 * ChunkedVideoPlayer.tsx
 *
 * Seamless playback of chunked videos using a dual-video-element architecture.
 *
 * How it works:
 *  1. Two <video> elements (A & B) are stacked on top of each other.
 *  2. While video A plays chunk N, video B silently preloads chunk N+1.
 *  3. ~150 ms before chunk N ends, video B starts playing and z-index swaps
 *     so there is ZERO gap/stutter/black-screen at the boundary.
 *  4. A custom controls bar shows the TOTAL duration across all chunks,
 *     a YouTube-style buffer indicator, and standard play/pause/volume/fullscreen.
 *
 * Key result:
 *  - The user sees one continuous video with its full duration (e.g. 36s).
 *  - No black screen, no micro-stutter, no glitch at chunk boundaries.
 *  - Nobody can tell the video is chunked.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ReceivedChunk } from '../../hooks/useVideoChunks';

interface ChunkedVideoPlayerProps {
  chunks: ReceivedChunk[];
  thumbnailUrl?: string | null;
  className?: string;
  /** If true, start playing immediately without waiting for a click. */
  autoPlay?: boolean;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function fmt(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Threshold (seconds) before a chunk's end at which we pre-start the next chunk. */
const PRE_START_THRESHOLD = 0.15;

/* ═══════════════════════════════════════════════════════════════════════════ */

export default function ChunkedVideoPlayer({
  chunks,
  thumbnailUrl,
  className = '',
  autoPlay = false,
}: ChunkedVideoPlayerProps) {
  /* ── Refs ──────────────────────────────────────────────────────────────── */
  const containerRef = useRef<HTMLDivElement>(null);
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  /* ── State ─────────────────────────────────────────────────────────────── */
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const [chunkIdx, setChunkIdx] = useState(0);
  const [hasStarted, setHasStarted] = useState(autoPlay);
  const [isPlaying, setIsPlaying] = useState(false);
  const [globalTime, setGlobalTime] = useState(0);
  const [volume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  /* ── Timers ────────────────────────────────────────────────────────────── */
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferPoll = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Flag to prevent the pre-start swap from firing more than once per chunk.
   * Gets reset each time chunkIdx changes.
   */
  const swapFiredRef = useRef(false);
  useEffect(() => { swapFiredRef.current = false; }, [chunkIdx]);

  /* ── Stable refs for latest values inside callbacks ────────────────────── */
  const chunksRef = useRef(chunks);
  const chunkIdxRef = useRef(chunkIdx);
  const activeSlotRef = useRef(activeSlot);
  const isPlayingRef = useRef(isPlaying);

  useEffect(() => { chunksRef.current = chunks; }, [chunks]);
  useEffect(() => { chunkIdxRef.current = chunkIdx; }, [chunkIdx]);
  useEffect(() => { activeSlotRef.current = activeSlot; }, [activeSlot]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  /* ── Durations ─────────────────────────────────────────────────────────── */
  const [realDurations, setRealDurations] = useState<Record<number, number>>({});

  const chunkDurations = useMemo(
    () => chunks.map((c, i) => realDurations[i] ?? c.duration ?? 15),
    [chunks, realDurations],
  );

  const chunkStarts = useMemo(() => {
    const starts: number[] = [];
    let t = 0;
    for (const d of chunkDurations) { starts.push(t); t += d; }
    return starts;
  }, [chunkDurations]);

  const totalDuration = useMemo(
    () => chunkDurations.reduce((a, b) => a + b, 0),
    [chunkDurations],
  );

  /* ── Buffer segments for the YouTube-style indicator ───────────────────── */
  const bufferSegments = useMemo(() => {
    if (totalDuration === 0) return [];
    return chunks.map((c, i) => ({
      start: chunkStarts[i] / totalDuration,
      end: (chunkStarts[i] + chunkDurations[i]) / totalDuration,
      loaded: c.isDecrypted && !!c.blobUrl,
    }));
  }, [chunks, chunkStarts, chunkDurations, totalDuration]);

  /* ── Helpers ───────────────────────────────────────────────────────────── */
  const vid = useCallback(
    (slot: 0 | 1) => (slot === 0 ? videoARef.current : videoBRef.current),
    [],
  );

  const activeVid = useCallback(() => vid(activeSlotRef.current), [vid]);
  const preloadVid = useCallback(
    () => vid(activeSlotRef.current === 0 ? 1 : 0),
    [vid],
  );

  /** Load a chunk's blob into a video element (skips if already loaded). */
  const loadChunk = useCallback(
    (v: HTMLVideoElement, chunk: ReceivedChunk) => {
      if (!chunk.blobUrl) return;
      if (v.getAttribute('data-src') === chunk.blobUrl) return;
      v.setAttribute('data-src', chunk.blobUrl);
      v.src = chunk.blobUrl;
      v.load();
    },
    [],
  );

  /* ── Init: load first chunk into slot A ────────────────────────────────── */
  useEffect(() => {
    const c = chunks[0];
    const v = vid(0);
    if (v && c?.blobUrl) loadChunk(v, c);
  }, [chunks, vid, loadChunk]);

  /* ── Auto-play: start as soon as first chunk is loaded ─────────────────── */
  useEffect(() => {
    if (!autoPlay || hasStarted === false) return;
    const c = chunks[0];
    const v = vid(0);
    if (v && c?.blobUrl) {
      v.oncanplay = () => {
        v.oncanplay = null;
        v.play().then(() => setIsPlaying(true)).catch(() => {});
      };
    }
  }, [autoPlay, hasStarted, chunks, vid]);

  /* ── Preload next chunk into the inactive slot ─────────────────────────── */
  useEffect(() => {
    const next = chunks[chunkIdx + 1];
    const pv = preloadVid();
    if (pv && next?.blobUrl) loadChunk(pv, next);
  }, [chunkIdx, chunks, activeSlot, preloadVid, loadChunk]);

  /* ── Sync volume to both elements ──────────────────────────────────────── */
  useEffect(() => {
    [videoARef.current, videoBRef.current].forEach((v) => {
      if (v) { v.volume = volume; v.muted = isMuted; }
    });
  }, [volume, isMuted]);

  /* ── Record real duration on loadedmetadata ─────────────────────────────── */
  const onMeta = useCallback(
    (slot: 0 | 1) => {
      const v = vid(slot);
      if (!v || !isFinite(v.duration)) return;
      const idx =
        slot === activeSlotRef.current
          ? chunkIdxRef.current
          : chunkIdxRef.current + 1;
      if (idx < 0 || idx >= chunksRef.current.length) return;
      setRealDurations((prev) => ({ ...prev, [idx]: v.duration }));
    },
    [vid],
  );

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  CORE: Pre-start the next chunk BEFORE the current one ends.          */
  /*                                                                       */
  /*  Instead of waiting for `onEnded` (which causes a micro-gap while     */
  /*  the browser initializes the new video), we detect in `timeupdate`    */
  /*  that the active video is within ~150ms of its end. At that moment:   */
  /*    1. Start playing the preloaded video (already decoded at time 0)   */
  /*    2. Swap z-index so the new video is immediately visible            */
  /*  Result: the new chunk's audio/video stream is ALREADY flowing when   */
  /*  the visual swap happens → zero stutter.                              */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /** Perform the seamless swap to the next chunk. */
  const doSwap = useCallback((nextIdx: number) => {
    const pv = preloadVid();
    if (!pv) return;
    pv.currentTime = 0;
    pv.play().catch(() => {});
    setActiveSlot((s) => (s === 0 ? 1 : 0));
    setChunkIdx(nextIdx);
    setIsBuffering(false);
    if (bufferPoll.current) {
      clearInterval(bufferPoll.current);
      bufferPoll.current = null;
    }
    console.log(`[ChunkedPlayer] Seamless swap → chunk ${nextIdx}`);
  }, [preloadVid]);

  /* ── Time update → global time + pre-start logic ───────────────────────── */
  const onTimeUpdate = useCallback(
    (slot: 0 | 1) => {
      if (slot !== activeSlotRef.current) return;
      const v = vid(slot);
      if (!v) return;

      // Update global time
      setGlobalTime((chunkStarts[chunkIdxRef.current] ?? 0) + v.currentTime);

      // ── Pre-start check ─────────────────────────────────────────────────
      // When we're within PRE_START_THRESHOLD of the end of this chunk,
      // start playing the preloaded next chunk so there's zero gap.
      if (swapFiredRef.current) return; // already swapped for this chunk
      if (!isFinite(v.duration) || v.duration === 0) return;

      const remaining = v.duration - v.currentTime;
      if (remaining > PRE_START_THRESHOLD) return;

      const nextIdx = chunkIdxRef.current + 1;
      const allC = chunksRef.current;
      if (nextIdx >= allC.length) return; // last chunk, let onEnded handle completion

      const next = allC[nextIdx];
      const pv = preloadVid();
      if (next?.blobUrl && pv && pv.readyState >= 2) {
        swapFiredRef.current = true;
        doSwap(nextIdx);
      }
    },
    [vid, chunkStarts, preloadVid, doSwap],
  );

  /* ── Chunk ended (fallback) ────────────────────────────────────────────── */
  // If the pre-start didn't fire (e.g. preload video wasn't ready in time),
  // this is the safety-net that handles the swap, possibly with a brief buffer.
  const onEnded = useCallback(
    (slot: 0 | 1) => {
      if (slot !== activeSlotRef.current) return;
      if (swapFiredRef.current) return; // pre-start already handled it

      const nextIdx = chunkIdxRef.current + 1;
      const allC = chunksRef.current;

      if (nextIdx >= allC.length) {
        // All chunks played — video complete
        setIsPlaying(false);
        return;
      }

      const next = allC[nextIdx];
      const pv = preloadVid();

      if (next?.blobUrl && pv && pv.readyState >= 2) {
        doSwap(nextIdx);
      } else {
        // Next chunk not ready yet → show spinner, poll until ready
        setIsBuffering(true);
        console.log(`[ChunkedPlayer] Waiting for chunk ${nextIdx} to load…`);
        if (bufferPoll.current) clearInterval(bufferPoll.current);
        bufferPoll.current = setInterval(() => {
          const latestNext = chunksRef.current[chunkIdxRef.current + 1];
          const pv2 = preloadVid();
          if (latestNext?.blobUrl && pv2) {
            if (pv2.getAttribute('data-src') !== latestNext.blobUrl) {
              loadChunk(pv2, latestNext);
            }
            if (pv2.readyState >= 2) {
              doSwap(chunkIdxRef.current + 1);
            } else {
              pv2.oncanplay = () => {
                pv2.oncanplay = null;
                doSwap(chunkIdxRef.current + 1);
              };
              if (bufferPoll.current) {
                clearInterval(bufferPoll.current);
                bufferPoll.current = null;
              }
            }
          }
        }, 300);
      }
    },
    [preloadVid, loadChunk, doSwap],
  );

  /* ── Play / Pause ──────────────────────────────────────────────────────── */
  const togglePlay = useCallback(() => {
    const v = activeVid();
    if (!v) return;

    if (!hasStarted) setHasStarted(true);

    if (isPlayingRef.current) {
      v.pause();
      setIsPlaying(false);
    } else {
      // If the entire video was completed, restart from chunk 0
      if (
        chunkIdxRef.current >= chunksRef.current.length - 1 &&
        v.ended
      ) {
        const c0 = chunksRef.current[0];
        if (c0?.blobUrl) {
          loadChunk(v, c0);
          v.oncanplay = () => {
            v.oncanplay = null;
            v.currentTime = 0;
            v.play().catch(() => {});
          };
          setChunkIdx(0);
          setGlobalTime(0);
        }
        setIsPlaying(true);
        return;
      }
      v.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [activeVid, hasStarted, loadChunk]);

  /* ── Seek ───────────────────────────────────────────────────────────────── */
  const seekTo = useCallback(
    (fraction: number) => {
      const target = fraction * totalDuration;

      // Find which chunk this time falls into
      let targetIdx = 0;
      for (let i = 0; i < chunkStarts.length; i++) {
        if (target >= chunkStarts[i]) targetIdx = i;
      }
      const localT = target - chunkStarts[targetIdx];
      const chunk = chunksRef.current[targetIdx];
      if (!chunk?.blobUrl) return; // chunk not loaded

      const v = activeVid();
      if (!v) return;

      if (targetIdx === chunkIdxRef.current) {
        // Same chunk — just seek within it
        v.currentTime = Math.min(localT, v.duration || localT);
      } else {
        // Different chunk — load it and seek
        swapFiredRef.current = false; // allow pre-start for the new chunk
        loadChunk(v, chunk);
        v.oncanplay = () => {
          v.oncanplay = null;
          v.currentTime = Math.min(localT, v.duration || localT);
          if (isPlayingRef.current) v.play().catch(() => {});
        };
        setChunkIdx(targetIdx);
      }
      setGlobalTime(target);
    },
    [totalDuration, chunkStarts, activeVid, loadChunk],
  );

  /* ── Progress bar interaction (click + drag) ────────────────────────────── */
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

  /* ── Fullscreen ────────────────────────────────────────────────────────── */
  const toggleFS = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      c.requestFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  /* ── Controls auto-hide ────────────────────────────────────────────────── */
  const flashControls = useCallback(() => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (isPlayingRef.current) setShowControls(false);
    }, 3000);
  }, []);

  /* ── Cleanup ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
      if (bufferPoll.current) clearInterval(bufferPoll.current);
    };
  }, []);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*                               RENDER                                  */
  /* ═══════════════════════════════════════════════════════════════════════ */

  // First chunk not ready yet — show loading placeholder
  const firstReady = chunks.find((c) => c.isDecrypted && c.blobUrl);
  if (!firstReady) {
    return (
      <div
        className={`relative rounded-2xl overflow-hidden bg-black ${className}`}
        style={{ aspectRatio: '16/9', minHeight: 135 }}
      >
        {thumbnailUrl && (
          <img src={thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50">
          <div
            className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--gold)', borderTopColor: 'transparent' }}
          />
          <span className="text-[10px] font-semibold" style={{ color: 'var(--gold-light)' }}>
            Buffering…
          </span>
        </div>
      </div>
    );
  }

  const progressFraction = totalDuration > 0 ? globalTime / totalDuration : 0;

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

      {/* ── Video A ────────────────────────────────────────────────────────── */}
      <video
        ref={videoARef}
        playsInline
        preload="auto"
        onTimeUpdate={() => onTimeUpdate(0)}
        onEnded={() => onEnded(0)}
        onLoadedMetadata={() => onMeta(0)}
        onWaiting={() => activeSlot === 0 && setIsBuffering(true)}
        onPlaying={() => activeSlot === 0 && setIsBuffering(false)}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'contain',
          zIndex: activeSlot === 0 ? 2 : 1,
        }}
      />

      {/* ── Video B ────────────────────────────────────────────────────────── */}
      <video
        ref={videoBRef}
        playsInline
        preload="auto"
        onTimeUpdate={() => onTimeUpdate(1)}
        onEnded={() => onEnded(1)}
        onLoadedMetadata={() => onMeta(1)}
        onWaiting={() => activeSlot === 1 && setIsBuffering(true)}
        onPlaying={() => activeSlot === 1 && setIsBuffering(false)}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'contain',
          zIndex: activeSlot === 1 ? 2 : 1,
        }}
      />

      {/* ── Poster / initial play button (before first play) ──────────────── */}
      {!hasStarted && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
        >
          {thumbnailUrl && (
            <img src={thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
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

      {/* ── Click-to-play/pause surface (after first play) ────────────────── */}
      {hasStarted && (
        <div
          className="absolute inset-0"
          style={{ zIndex: 5 }}
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
        />
      )}

      {/* ── Buffering spinner ──────────────────────────────────────────────── */}
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
              style={{ borderColor: 'rgba(255,255,255,0.7)', borderTopColor: 'transparent' }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Center play icon when paused ──────────────────────────────────── */}
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
              <span className="material-symbols-outlined text-white text-3xl" style={{ marginLeft: 3 }}>play_arrow</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Controls overlay ───────────────────────────────────────────────── */}
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
          {/* ── Progress bar ────────────────────────────────────────────── */}
          <div
            ref={progressRef}
            className="relative w-full h-[3px] rounded-full mb-2 cursor-pointer group hover:h-[5px] transition-all"
            style={{ background: 'rgba(255,255,255,0.15)' }}
            onMouseDown={handleProgressDown}
            onTouchMove={handleProgressTouch}
          >
            {/* Buffer segments (YouTube-style light white/gray line) */}
            {bufferSegments.map((seg, i) =>
              seg.loaded ? (
                <div
                  key={i}
                  className="absolute top-0 h-full rounded-full"
                  style={{
                    left: `${seg.start * 100}%`,
                    width: `${(seg.end - seg.start) * 100}%`,
                    background: 'rgba(255,255,255,0.3)',
                  }}
                />
              ) : null,
            )}

            {/* Played progress (accent / gold) */}
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

          {/* ── Bottom controls row ─────────────────────────────────────── */}
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
              {fmt(globalTime)} / {fmt(totalDuration)}
            </span>

            <div className="flex-1" />

            {/* Volume */}
            <button
              onClick={(e) => { e.stopPropagation(); setIsMuted((m) => !m); }}
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
