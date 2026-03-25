import { motion, AnimatePresence } from 'framer-motion';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface MediaViewerProps {
  url: string;
  type: 'image' | 'video';
  onClose: () => void;
}

export default function MediaViewer({ url, type, onClose }: MediaViewerProps) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const content = (
    <AnimatePresence>
      <motion.div
        key="media-viewer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.97)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={onClose}
      >
        {/* Top Controls: Download + Close */}
        <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', display: 'flex', gap: '0.75rem', zIndex: 10000 }}>
          <a
            href={url}
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

        {/* Viewer Content */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.25 }}
          style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => e.stopPropagation()}
        >
          {type === 'image' ? (
            <TransformWrapper
              initialScale={1}
              minScale={0.5}
              maxScale={6}
              centerOnInit
              panning={{ velocityDisabled: true }}
            >
              <TransformComponent
                wrapperStyle={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                contentStyle={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <img
                  src={url}
                  alt="Secure Media"
                  style={{ maxWidth: '95vw', maxHeight: '90vh', objectFit: 'contain', userSelect: 'none' }}
                  draggable={false}
                />
              </TransformComponent>
            </TransformWrapper>
          ) : (
            <video
              src={url}
              controls
              autoPlay
              style={{ maxWidth: '95vw', maxHeight: '90vh', borderRadius: '0.75rem', background: 'black', boxShadow: '0 25px 60px rgba(0,0,0,0.8)' }}
            />
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
