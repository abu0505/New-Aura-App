import { motion, AnimatePresence } from 'framer-motion';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ChunkedVideoPlayer from './ChunkedVideoPlayer';

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
  
  const currentMedia = allMedia ? allMedia[currentIndex] : { id: messageId, url: initialUrl, type: initialType };

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
            <video
              src={currentMedia.url}
              controls
              autoPlay
              playsInline
              style={{ 
                maxWidth: '99%', 
                maxHeight: '99%', 
                objectFit: 'contain', 
                borderRadius: '.5rem', 
                background: 'black', 
                boxShadow: '0 25px 60px rgba(0,0,0,0.8)' 
              }}
            />
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}

