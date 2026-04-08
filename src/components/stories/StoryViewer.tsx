import { motion, AnimatePresence } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { Story } from '../../hooks/useStories';

interface StoryViewerProps {
  isOpen: boolean;
  onClose: () => void;
  stories: Story[];
  initialStoryId: string | null;
  partnerPublicKey: string | null;
}

export default function StoryViewer({
  isOpen,
  onClose,
  stories,
  initialStoryId,
  partnerPublicKey
}: StoryViewerProps) {
  const { getDecryptedBlob } = useMedia();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const activeStory = stories[currentIndex] || null;

  // Sync index with initial ID
  useEffect(() => {
    if (isOpen && initialStoryId) {
      const idx = stories.findIndex(s => s.id === initialStoryId);
      if (idx !== -1) setCurrentIndex(idx);
    }
  }, [isOpen, initialStoryId, stories]);

  const handleNext = useCallback(() => {
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      onClose();
    }
  }, [currentIndex, stories.length, onClose]);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [currentIndex]);

  useEffect(() => {
    if (isOpen && activeStory?.media_url && activeStory.media_key && activeStory.media_nonce && partnerPublicKey) {
      setLoading(true);
      getDecryptedBlob(activeStory.media_url, activeStory.media_key, activeStory.media_nonce, partnerPublicKey)
        .then(blob => {
          if (blob) {
            setDecryptedUrl(URL.createObjectURL(blob));
          }
          setLoading(false);
        });
    } else {
      setDecryptedUrl(null);
      setLoading(false);
    }

    return () => {
      if (decryptedUrl) URL.revokeObjectURL(decryptedUrl);
    };
  }, [isOpen, activeStory?.id, partnerPublicKey]);

  if (!isOpen || !activeStory) return null;

  const timestamp = new Date(activeStory.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[130] bg-[var(--bg-primary)] font-sans text-[#e4e1ed] overflow-hidden"
      >
        {/* Playback Background Image/Text/Video */}
        <div className="absolute inset-0 z-0 bg-[var(--bg-primary)] flex items-center justify-center">
          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-2 border-[rgba(var(--primary-rgb),_0.3)] border-t-[var(--gold)] rounded-full animate-spin"></div>
              <p className="font-label text-[10px] uppercase tracking-widest text-[rgba(var(--primary-rgb),_0.6)]">Decrypting Memory...</p>
            </div>
          ) : (decryptedUrl && activeStory.media_url) ? (
            <>
              {(activeStory.media_url.includes('video') || (activeStory.media_nonce && activeStory.media_nonce.length > 50)) ? ( // Simple heuristic if type missing
                <video 
                  ref={videoRef}
                  src={decryptedUrl} 
                  autoPlay 
                  onEnded={handleNext}
                  className="w-full h-full object-contain" 
                />
              ) : (
                <img 
                  src={decryptedUrl} 
                  alt="Decrypted Story" 
                  className="w-full h-full object-contain" 
                />
              )}
            </>
          ) : (
            <div className="px-12 text-center max-w-xl">
              <h1 className="text-3xl md:text-5xl font-serif italic text-[var(--gold)] drop-shadow-2xl leading-tight">
                {activeStory.decrypted_content || 'A silent moment...'}
              </h1>
            </div>
          )}
          
          {/* Interaction Tap Zones */}
          <div className="absolute inset-0 flex z-10">
            <div className="w-1/3 h-full cursor-pointer" onClick={(e) => { e.stopPropagation(); handlePrev(); }}></div>
            <div className="w-2/3 h-full cursor-pointer" onClick={(e) => { e.stopPropagation(); handleNext(); }}></div>
          </div>
          
          {/* Overlays */}
          <div className="absolute bottom-0 left-0 w-full h-1/3 bg-gradient-to-t from-black/80 to-transparent pointer-events-none z-0"></div>
        </div>

        {/* Top Navigation Frame */}
        <header className="absolute top-0 left-0 w-full z-20 flex justify-between items-center px-6 py-4 pt-10 bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-[rgba(var(--primary-rgb),_0.3)] overflow-hidden shadow-xl">
               <img 
                src={activeStory.is_mine ? "https://ui-avatars.com/api/?name=You&background=c9a96e&color=13131b" : "https://ui-avatars.com/api/?name=Partner&background=c9a96e&color=13131b"} 
                alt="Avatar" 
                className="w-full h-full object-cover" 
              />
            </div>
            <div className="flex flex-col">
              <span className="text-[var(--gold)] font-serif italic text-sm tracking-wide drop-shadow-md">
                {activeStory.is_mine ? 'Your Story' : 'Partner'}
              </span>
              <span className="text-white/60 text-[10px] uppercase tracking-widest font-bold drop-shadow-md">{timestamp}</span>
            </div>
          </div>

          {/* Progress Indicators Container */}
          <div className="absolute top-4 left-6 right-6 flex gap-1.5 px-1">
            {stories.map((s, idx) => (
              <div key={s.id} className="h-[2px] flex-1 bg-white/20 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: idx < currentIndex ? "100%" : "0%" }}
                  animate={{ width: idx === currentIndex ? "100%" : (idx < currentIndex ? "100%" : "0%") }}
                  transition={{ 
                    duration: idx === currentIndex ? (decryptedUrl && activeStory.media_url?.includes('video') ? 15 : 5) : 0, 
                    ease: "linear" 
                  }}
                  onAnimationComplete={() => idx === currentIndex && handleNext()}
                  className="h-full bg-[var(--gold)] rounded-full shadow-[0_0_8px_rgba(var(--primary-rgb),0.5)]"
                />
              </div>
            ))}
          </div>

          <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-[var(--gold)] bg-black/20 backdrop-blur-md rounded-full p-2 hover:bg-black/40 transition-all active:scale-95">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {/* Caption Overlay */}
        {decryptedUrl && activeStory.decrypted_content && (
          <div className="absolute bottom-16 left-0 w-full px-8 text-center z-10 pointer-events-none">
            <p className="text-white text-lg font-serif italic drop-shadow-lg leading-relaxed max-w-lg mx-auto bg-black/20 backdrop-blur-sm p-4 rounded-3xl border border-white/5">
              {activeStory.decrypted_content}
            </p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
