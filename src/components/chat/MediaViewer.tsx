import { motion, AnimatePresence } from 'framer-motion';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ChunkedVideoPlayer from './ChunkedVideoPlayer';
import { toast } from 'sonner';

interface MediaItem {
  id: string;
  url: string;
  type: 'image' | 'video' | 'gif';
}

interface MediaViewerProps {
  url: string;
  type: 'image' | 'video' | 'chunked_video' | 'gif';
  onClose: () => void;
  allMedia?: MediaItem[];
  initialIndex?: number;
  chunks?: any[];
  thumbnailUrl?: string;
  duration?: number;
  messageId?: string;
  showViewInChat?: boolean;
}

export default function MediaViewer({ url: initialUrl, type: initialType, onClose, allMedia, initialIndex = 0, chunks, thumbnailUrl, duration, messageId, showViewInChat = false }: MediaViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [direction, setDirection] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  // ── Inline video player state ─────────────────────────────────────────────
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoBuffered, setVideoBuffered] = useState(0); // 0-100 percent
  const videoRef = useRef<HTMLVideoElement>(null);
  const retryCountRef = useRef(0);
  
  const currentMedia = allMedia ? allMedia[currentIndex] : { id: messageId, url: initialUrl, type: initialType };

  // Reset video state whenever the current media changes
  useEffect(() => {
    setVideoLoading(true);
    setVideoError(null);
    setVideoBuffered(0);
    retryCountRef.current = 0;
  }, [currentMedia.url]);

  const handleVideoProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.buffered.length) return;
    const bufferedEnd = v.buffered.end(v.buffered.length - 1);
    const total = v.duration || 1;
    setVideoBuffered(Math.round((bufferedEnd / total) * 100));
  }, []);

  const handleVideoCanPlay = useCallback(() => {
    setVideoLoading(false);
    setVideoError(null);
  }, []);

  const handleVideoError = useCallback(() => {
    // Try once more silently before showing the error UI
    if (retryCountRef.current < 1 && videoRef.current) {
      retryCountRef.current += 1;
      const src = videoRef.current.src;
      videoRef.current.src = '';
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.src = src;
          videoRef.current.load();
        }
      }, 400);
      return;
    }
    setVideoLoading(false);
    setVideoError('Could not play this video. The format may not be supported by your browser.');
  }, []);

  const retryVideo = useCallback(() => {
    if (!videoRef.current) return;
    retryCountRef.current = 0;
    setVideoError(null);
    setVideoLoading(true);
    videoRef.current.load();
  }, []);

  // Lock body scroll while viewer is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleNext = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (allMedia && currentIndex < allMedia.length - 1) {
      setDirection(1);
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (allMedia && currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const distance = touchStartX - touchEndX;

    if (distance > 50) {
      handleNext();
    } else if (distance < -50) {
      handlePrev();
    }
    setTouchStartX(null);
  };

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 50 : -50,
      opacity: 0,
      scale: 0.95
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
      scale: 1
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 50 : -50,
      opacity: 0,
      scale: 0.95
    })
  };

  const content = (
    <AnimatePresence mode="wait">
      <motion.div
        key="media-viewer-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.98)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={onClose}
      >
        {/* Top left info */}
        <div style={{ position: 'absolute', top: '1.5rem', left: '1.5rem', zIndex: 10000 }}>
          {allMedia && allMedia.length > 1 && (
            <div className="px-4 py-2 bg-white/10 backdrop-blur-md rounded-full text-primary font-bold text-xs uppercase tracking-widest border border-white/5">
              {currentIndex + 1} / {allMedia.length}
            </div>
          )}
        </div>

        <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', display: 'flex', gap: '0.75rem', zIndex: 10000 }}>
          {showViewInChat && currentMedia.id && (
            <button
              title="View in Chat"
              onClick={(e) => {
                e.stopPropagation();
                const jumpId = currentMedia.id;
                if (jumpId) {
                  document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'chat' }));
                  setTimeout(() => {
                    document.dispatchEvent(new CustomEvent('jump-to-message', { detail: { messageId: jumpId } }));
                  }, 100);
                  onClose();
                }
              }}
              className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-[#e4e1ed] backdrop-blur-md transition-colors cursor-pointer flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-2xl">forum</span>
            </button>
          )}
          {(currentMedia.type === 'image' || currentMedia.type === 'gif') && (
            <button
              title="Copy Image"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  const response = await fetch(currentMedia.url);
                  let blob = await response.blob();

                  if (blob.type !== 'image/png') {
                    const image = new Image();
                    image.crossOrigin = 'anonymous';
                    const objectUrl = URL.createObjectURL(blob);
                    
                    await new Promise((resolve, reject) => {
                      image.onload = resolve;
                      image.onerror = reject;
                      image.src = objectUrl;
                    });

                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(image, 0, 0);

                    blob = await new Promise<Blob>((resolve, reject) => {
                      canvas.toBlob((b) => {
                        if (b) resolve(b);
                        else reject(new Error('Canvas to Blob failed'));
                      }, 'image/png');
                    });
                    
                    URL.revokeObjectURL(objectUrl);
                  }

                  await navigator.clipboard.write([
                    new ClipboardItem({
                      [blob.type]: blob
                    })
                  ]);
                  toast.success("Image copied to clipboard");
                } catch (err) {
                  console.error('Failed to copy image', err);
                  toast.error("Failed to copy image");
                }
              }}
              className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-[#e4e1ed] backdrop-blur-md transition-colors cursor-pointer flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-2xl">content_copy</span>
            </button>
          )}
          <a
            href={currentMedia.url}
            download
            onClick={(e) => e.stopPropagation()}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-[#e4e1ed] backdrop-blur-md transition-colors cursor-pointer flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-2xl">download</span>
          </a>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-[#e4e1ed] backdrop-blur-md transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-2xl font-bold">close</span>
          </button>
        </div>

        {/* Navigation Arrows */}
        {allMedia && allMedia.length > 1 && (
          <div className="hidden md:block">
            {currentIndex > 0 && (
              <button 
                onClick={handlePrev}
                className="absolute left-4 z-[10001] p-4 bg-white/5 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-sm top-1/2 -translate-y-1/2"
              >
                <span className="material-symbols-outlined text-3xl">chevron_left</span>
              </button>
            )}
            {currentIndex < allMedia.length - 1 && (
              <button 
                onClick={handleNext}
                className="absolute right-4 z-[10001] p-4 bg-white/5 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-sm top-1/2 -translate-y-1/2"
              >
                <span className="material-symbols-outlined text-3xl">chevron_right</span>
              </button>
            )}
          </div>
        )}

        {/* Viewer Content */}
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={currentMedia.url}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
          {currentMedia.type === 'image' || currentMedia.type === 'gif' ? (
            <TransformWrapper
              initialScale={1}
              minScale={0.5}
              maxScale={6}
              centerOnInit
              centerZoomedOut
            >
              <TransformComponent
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <img
                  src={currentMedia.url}
                  alt="Secure Media"
                  style={{ 
                    maxWidth: '99%', 
                    maxHeight: '99%', 
                    objectFit: 'contain', 
                    userSelect: 'none',
                    borderRadius: '.5rem',
                    boxShadow: '0 25px 60px rgba(0,0,0,0.8)'
                  }}
                  draggable={false}
                />
              </TransformComponent>
            </TransformWrapper>
          ) : currentMedia.type === 'chunked_video' ? (
            <div className="w-full h-full flex items-center justify-center p-1">
              <ChunkedVideoPlayer 
                chunks={chunks!} 
                thumbnailUrl={thumbnailUrl} 
                duration={duration}
                autoPlay
                className="w-full h-full max-h-full object-contain rounded-lg shadow-[0_25px_60px_rgba(0,0,0,0.8)]" 
              />
            </div>
          ) : (
            /* ── Smart video player with loading + error states ── */
            <div
              className="relative flex items-center justify-center"
              style={{ maxWidth: '99%', maxHeight: '99%' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Actual video element */}
              <video
                ref={videoRef}
                src={currentMedia.url}
                controls
                autoPlay
                playsInline
                preload="auto"
                onCanPlay={handleVideoCanPlay}
                onProgress={handleVideoProgress}
                onError={handleVideoError}
                style={{
                  maxWidth: '99vw',
                  maxHeight: '90vh',
                  objectFit: 'contain',
                  borderRadius: '.5rem',
                  background: 'black',
                  boxShadow: '0 25px 60px rgba(0,0,0,0.8)',
                  // Keep element in DOM even during loading so it buffers
                  opacity: videoError ? 0 : 1,
                  display: 'block',
                }}
              />

              {/* Loading overlay — shown while buffering, disappears once canplay fires */}
              <AnimatePresence>
                {videoLoading && !videoError && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg"
                    style={{ background: 'rgba(0,0,0,0.85)', minWidth: 220, minHeight: 140 }}
                  >
                    {/* Spinner */}
                    <div
                      className="w-10 h-10 rounded-full border-[3px] border-t-transparent animate-spin"
                      style={{ borderColor: 'var(--gold, #e4b45a)', borderTopColor: 'transparent' }}
                    />
                    {/* Buffer progress bar */}
                    {videoBuffered > 0 && (
                      <div className="w-36 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.15)' }}>
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: 'var(--gold, #e4b45a)' }}
                          animate={{ width: `${videoBuffered}%` }}
                          transition={{ ease: 'linear', duration: 0.3 }}
                        />
                      </div>
                    )}
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--gold-light, #f5d48a)' }}>
                      {videoBuffered > 0 ? `Buffering ${videoBuffered}%…` : 'Loading video…'}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Error overlay */}
              <AnimatePresence>
                {videoError && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg p-6 text-center"
                    style={{ background: 'rgba(0,0,0,0.92)', minWidth: 220, minHeight: 140 }}
                  >
                    <span className="material-symbols-outlined text-red-400 text-4xl">videocam_off</span>
                    <p className="text-white/80 text-sm font-medium leading-snug max-w-[240px]">
                      Video could not be played.
                    </p>
                    <p className="text-white/40 text-xs max-w-[240px]">
                      {videoError}
                    </p>
                    <button
                      onClick={retryVideo}
                      className="mt-1 px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all active:scale-95"
                      style={{ background: 'var(--gold, #e4b45a)', color: '#000' }}
                    >
                      Retry
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}

