/**
 * ChunkedVideoPlayer.tsx  —  Robust MSE Architecture (v3)
 *
 * ARCHITECTURE:
 *  - Uses MediaSource Extensions (MSE) directly without external transmuxers.
 *  - FFmpeg chunks natively include `moov`+`moof` headers (fMP4/WebM).
 *  - Appended via `SourceBuffer.mode = 'sequence'` so their timestamps
 *    (which all start at 0) are automatically offset by the browser to play seamlessly.
 *  - Native <video> element playback handles seamless chunk-to-chunk transitions!
 *  - Fallback to Direct Blob Concatenation if MSE is unsupported (e.g. iOS Safari).
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ReceivedChunk } from '../../hooks/useVideoChunks';

/* ── Types ───────────────────────────────────────────────────────────────── */

interface ChunkedVideoPlayerProps {
  chunks: ReceivedChunk[];
  thumbnailUrl?: string | null;
  className?: string;
  autoPlay?: boolean;
  duration?: number;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function fmt(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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

  /* ── MSE specific Refs ────────────────────────────────────────────────── */
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const nextChunkRef = useRef<number>(0);
  const isAppendingRef = useRef<boolean>(false);
  const isMseSupported = typeof MediaSource !== 'undefined';
  const mseEndedRef = useRef<boolean>(false);

  /* ── State ───────────────────────────────────────────────────────────── */
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dynamic Aspect Ratio based on video metadata
  const [videoAspect, setVideoAspect] = useState<string>('56.25%'); // 16:9 Default

  /* ── Timers & Derived ────────────────────────────────────────────────── */
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Calculate total expected duration
  const totalDuration = useMemo(() => {
    if (duration && duration > 0) return duration;
    if (chunks.length > 0 && chunks[0].totalChunks) {
      const estimatedAvg = chunks.find(c => c.duration && c.duration > 0)?.duration || 15;
      return chunks[0].totalChunks * estimatedAvg;
    }
    return chunks.reduce((sum, c) => sum + (c.duration ?? 5), 0);
  }, [chunks, duration]);

  const totalDurationRef = useRef(totalDuration);
  useEffect(() => { totalDurationRef.current = totalDuration; }, [totalDuration]);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  PLAYER CONTROLS LOGIC                                                 */
  /* ═══════════════════════════════════════════════════════════════════════ */
  const updateBuffered = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.buffered.length) return;
    setBufferedEnd(v.buffered.end(v.buffered.length - 1));
  }, []);

  const handleTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
    updateBuffered();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const time = parseFloat(e.target.value);
    v.currentTime = time;
    setCurrentTime(time);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // Unmute on explicit user interaction if it was muted
      if (isMuted) setIsMuted(false);
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (val === 0) setIsMuted(true);
    else if (isMuted) setIsMuted(false);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (isPlaying) {
      controlsTimerRef.current = setTimeout(() => setShowControls(false), 2500);
    }
  };

  useEffect(() => { resetControlsTimeout(); }, [isPlaying]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) { v.volume = volume; v.muted = isMuted; }
  }, [volume, isMuted]);

  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  useEffect(() => () => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
  }, []);


  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  CORE MSE LOGIC                                                        */
  /* ═══════════════════════════════════════════════════════════════════════ */

  // 1. Initialize MediaSource once
  useEffect(() => {
    if (!isMseSupported) return;

    const ms = new MediaSource();
    mediaSourceRef.current = ms;
    const url = URL.createObjectURL(ms);

    if (videoRef.current) {
      videoRef.current.src = url;
    }

    // Cleanup MediaSource on unmount
    return () => {
      try {
        if (ms.readyState === 'open') ms.endOfStream();
      } catch { /* ignore */ }
      if (videoRef.current) videoRef.current.src = '';
      URL.revokeObjectURL(url);
      mediaSourceRef.current = null;
      sourceBufferRef.current = null;
      nextChunkRef.current = 0;
      isAppendingRef.current = false;
      mseEndedRef.current = false;
    };
  }, [isMseSupported]);

  // 2. Append Chunks as they arrive
  useEffect(() => {
    if (!isMseSupported) return;

    const processChunks = async () => {
      const ms = mediaSourceRef.current;
      if (!ms || ms.readyState !== 'open') return;

      if (isAppendingRef.current) return; // Prevent concurrent appends

      while (nextChunkRef.current < chunks.length) {
        const chunk = chunks[nextChunkRef.current];
        if (!chunk.isDecrypted || !chunk.blobUrl) break;

        isAppendingRef.current = true;
        try {
          // Fetch raw chunk bytes
          const res = await fetch(chunk.blobUrl);
          const buf = await res.arrayBuffer();

          // Initialize SourceBuffer on the first chunk
          if (nextChunkRef.current === 0 && !sourceBufferRef.current) {
            const firstBytes = new Uint8Array(buf);
            
            // Check for WebM magic bytes (0x1A 0x45 0xDF 0xA3)
            const isWebm = (firstBytes[0] === 0x1A && firstBytes[1] === 0x45 && firstBytes[2] === 0xDF && firstBytes[3] === 0xA3);
            
            // Determine best MIME type based on support
            let mime = isWebm ? 'video/webm; codecs="vp9,opus"' : 'video/mp4; codecs="avc1.640028,mp4a.40.2"';
            
            if (!MediaSource.isTypeSupported(mime)) {
              // Fallback 1: Broad codecs
              mime = isWebm ? 'video/webm; codecs="vp8,vorbis"' : 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
              if (!MediaSource.isTypeSupported(mime)) {
                // Fallback 2: No codecs specified (Chrome/Edge handles this well)
                mime = isWebm ? 'video/webm' : 'video/mp4';
              }
            }

            const sb = ms.addSourceBuffer(mime);
            // sequence mode automatically offsets timestamps of disjoint chunks!
            sb.mode = 'sequence';
            sourceBufferRef.current = sb;

            if (autoPlay && videoRef.current) {
               videoRef.current.play()
                 .then(() => setIsPlaying(true))
                 .catch(() => {});
            }
          }

          const sb = sourceBufferRef.current;
          if (!sb) throw new Error("SourceBuffer not initialized");

          if (sb.updating) {
            await new Promise(resolve => sb.addEventListener('updateend', resolve, { once: true }));
          }

          sb.appendBuffer(buf);
          await new Promise(resolve => sb.addEventListener('updateend', resolve, { once: true }));

          // Successfully appended! Move to next
          nextChunkRef.current++;
          updateBuffered();
          setIsBuffering(false);
          setError(null);
        } catch (e) {
          console.error("MSE Append Error:", e);
          setError("Failed to stream video. Retrying...");
          break; // Stop loop on failure, let next effect tick retry
        } finally {
          isAppendingRef.current = false;
        }
      }

      // Check if all chunks are fully appended
      const reportedTotal = chunks[0]?.totalChunks ?? chunks.length;
      if (
        nextChunkRef.current > 0 && 
        nextChunkRef.current >= reportedTotal && 
        ms.readyState === 'open' &&
        !mseEndedRef.current
      ) {
        ms.endOfStream();
        mseEndedRef.current = true;
      }
    };

    // Use a small timeout to let React render cycle finish before intensive parsing
    const timer = setTimeout(processChunks, 10);
    return () => clearTimeout(timer);
  }, [chunks, isMseSupported, autoPlay, updateBuffered]);


  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  DIRECT BLOB FALLBACK (For iOS Safari without MSE)                     */
  /* ═══════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (isMseSupported) return;

    // Only run fallback when ALL chunks are decrypted
    const decryptedChunks = chunks.filter(c => c.isDecrypted && c.blobUrl);
    const reportedTotal = chunks[0]?.totalChunks ?? chunks.length;
    const allReady = decryptedChunks.length > 0 && decryptedChunks.length >= reportedTotal;

    if (!allReady) return;

    (async () => {
      try {
        const sortedChunks = [...decryptedChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
        const fetchedBlobs = await Promise.all(sortedChunks.map(c => fetch(c.blobUrl!).then(r => r.blob())));
        const mimeType = fetchedBlobs[0]?.type || 'video/mp4';
        
        let mergedBlob: Blob;
        if (mimeType.includes('webm')) {
          mergedBlob = new Blob(fetchedBlobs, { type: mimeType });
        } else {
          // MP4 byte-concat fallback (usually only plays first chunk, but better than nothing on iOS)
          const firstBuffer = await fetchedBlobs[0].arrayBuffer();
          const firstBlob = new Blob([firstBuffer], { type: mimeType });
          const restBlobs = fetchedBlobs.slice(1);
          mergedBlob = new Blob([firstBlob, ...restBlobs], { type: mimeType });
        }

        const url = URL.createObjectURL(mergedBlob);
        if (videoRef.current) {
          videoRef.current.src = url;
          videoRef.current.load();
          setIsBuffering(false);
          if (autoPlay) {
            videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
          }
        }
      } catch (e) {
        console.error("Direct Blob Merge Failed:", e);
      }
    })();
  }, [chunks, isMseSupported, autoPlay]);


  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  RENDER                                                                */
  /* ═══════════════════════════════════════════════════════════════════════ */

  const reportedTotal = chunks[0]?.totalChunks ?? chunks.length;
  const decryptedCount = chunks.filter(c => c.isDecrypted && c.blobUrl).length;
  const isComplete = decryptedCount > 0 && decryptedCount >= reportedTotal;
  const progressPercent = reportedTotal > 0 ? (decryptedCount / reportedTotal) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={`relative group bg-black rounded-xl overflow-hidden flex flex-col items-center justify-center ${className}`}
      onMouseMove={resetControlsTimeout}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onClick={togglePlay}
    >
      {/* Container to enforce dynamic aspect ratio padding */}
      <div className="w-full relative" style={{ paddingBottom: videoAspect }}>
        {/* Thumbnail Layer */}
        <AnimatePresence>
          {thumbnailUrl && (!isPlaying || isBuffering) && (
            <motion.div
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 w-full h-full bg-black"
            >
              <img
                src={thumbnailUrl}
                alt="Video Thumbnail"
                className="w-full h-full object-contain filter blur-sm opacity-60"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Video Element */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain z-20"
          playsInline
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => { setIsPlaying(true); setIsBuffering(false); }}
          onPause={() => setIsPlaying(false)}
          onEnded={() => { setIsPlaying(false); setShowControls(true); }}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => setIsBuffering(false)}
          onError={(e) => {
             console.error("Video element error:", e);
             setIsBuffering(false);
             if (!error) setError("Error playing video stream.");
          }}
          onLoadedMetadata={() => {
            const v = videoRef.current;
            if (v && v.videoWidth && v.videoHeight) {
              const ratio = (v.videoHeight / v.videoWidth) * 100;
              setVideoAspect(`${ratio}%`);
            }
          }}
        />

        {/* Loading Spinner / Error */}
        <AnimatePresence>
          {error ? (
            <motion.div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
               <div className="text-white text-center bg-red-500/20 px-4 py-2 rounded-lg border border-red-500/30 text-sm">
                 <span className="material-symbols-outlined block text-2xl mb-1 text-red-400">error</span>
                 {error}
               </div>
            </motion.div>
          ) : isBuffering && !isComplete ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm"
            >
              <div className="w-12 h-12 rounded-full border-4 border-white/20 border-t-primary animate-spin mb-3 shadow-lg" />
              <div className="bg-black/50 px-3 py-1 rounded-full text-white/90 text-xs font-medium backdrop-blur-md border border-white/10">
                Decrypting ({decryptedCount}/{reportedTotal})
              </div>
              <div className="w-32 h-1.5 bg-white/20 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Controls Overlay */}
        <AnimatePresence>
          {showControls && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-x-0 bottom-0 z-40 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-12 pb-3 px-4 flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Progress Bar */}
              <div className="relative w-full h-1.5 bg-white/20 rounded-full mb-3 cursor-pointer group"
                onClick={e => {
                   const rect = e.currentTarget.getBoundingClientRect();
                   const clickPos = (e.clientX - rect.left) / rect.width;
                   const v = videoRef.current;
                   if (v) {
                     const newTime = clickPos * (v.duration || totalDurationRef.current);
                     v.currentTime = newTime;
                     setCurrentTime(newTime);
                   }
                }}
              >
                {/* Buffered range */}
                <div
                  className="absolute top-0 left-0 h-full bg-white/40 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (bufferedEnd / totalDurationRef.current) * 100)}%` }}
                />
                {/* Current time */}
                <div
                  className="absolute top-0 left-0 h-full bg-primary rounded-full transition-all group-hover:bg-primary-light"
                  style={{ width: `${Math.min(100, (currentTime / totalDurationRef.current) * 100)}%` }}
                />
                {/* Native Range Input for dragging */}
                <input
                  type="range"
                  min={0}
                  max={totalDurationRef.current || 100}
                  step="0.1"
                  value={currentTime}
                  onChange={handleSeek}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>

              {/* Bottom Row */}
              <div className="flex items-center justify-between text-white/90">
                <div className="flex items-center gap-4">
                  <button onClick={togglePlay} className="hover:text-white transition-colors hover:scale-110 active:scale-95">
                    <span className="material-symbols-outlined text-[28px] drop-shadow-md">
                      {isPlaying ? 'pause_circle' : 'play_circle'}
                    </span>
                  </button>

                  <div className="text-[13px] font-medium tracking-wide drop-shadow-md font-mono">
                    {fmt(currentTime)} <span className="text-white/50 mx-1">/</span> {fmt(totalDurationRef.current)}
                  </div>

                  <div className="hidden md:flex items-center gap-2 group/vol">
                    <button onClick={() => {
                        setIsMuted(!isMuted);
                        if (isMuted && volume === 0) setVolume(1);
                    }} className="hover:text-white transition-colors">
                      <span className="material-symbols-outlined text-[20px]">
                        {isMuted || volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}
                      </span>
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-16 accent-white opacity-0 group-hover/vol:opacity-100 transition-opacity"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {!isComplete && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-primary/20 border border-primary/30">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      <span className="text-[10px] uppercase tracking-wider font-bold text-primary-light">Live Sync</span>
                    </div>
                  )}
                  <button onClick={toggleFullscreen} className="hover:text-white transition-colors">
                    <span className="material-symbols-outlined text-[20px] drop-shadow-md">
                      {isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
                    </span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
