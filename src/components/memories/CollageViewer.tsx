import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import CustomScrapbookLayout from './CustomScrapbookLayout';
import type { CollageLayoutConfig } from './CollageBuilder';

export interface CollageCard {
  id: string;
  type: 'scrapbook' | 'polaroid' | 'gallery' | 'custom';
  images: Array<{ id: string; decryptedUrl: string }>;
  layoutConfig?: CollageLayoutConfig; // only for type === 'custom'
}

interface CollageViewerProps {
  cards: CollageCard[];
  initialCardIndex: number;
  onClose: () => void;
}

// ── Scrapbook Collage Layout ─────────────────────────────────────────────────
function ScrapbookLayout({
  images,
  onImageClick,
}: {
  images: Array<{ id: string; decryptedUrl: string }>;
  onImageClick: (i: number) => void;
}) {
  return (
    <div 
      className="w-full h-full border border-[#9a8656]/20 rounded-[2.8rem] relative overflow-hidden"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(50, 1fr)',
        gridTemplateRows: 'repeat(50, 1fr)',
      }}
    >
      {/* 1. Top Left Square */}
      {images[0] && (
        <div 
          onClick={() => onImageClick(0)}
          style={{
            gridColumn: '3 / 27',
            gridRow: '5 / 26',
            backgroundColor: '#ffffff',
            boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
            border: '1px solid rgba(0,0,0,0.05)',
            borderRadius: '0.2rem',
            padding: '0.4rem pb-5',
          }}
          className="z-10 cursor-zoom-in hover:scale-[1.03] hover:z-30 transition-all duration-300 overflow-hidden flex flex-col"
        >
          <div className="w-full h-full overflow-hidden bg-black/5 rounded-[0.1rem]">
            <img src={images[0].decryptedUrl} className="w-full h-full object-cover brightness-[98%] contrast-[102%]" alt="" />
          </div>
        </div>
      )}

      {/* 2. Top Right Rectangle */}
      {images[1] && (
        <div 
          onClick={() => onImageClick(1)}
          style={{
            gridColumn: '23 / 50',
            gridRow: '7 / 19',
            backgroundColor: '#ffffff',
            boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
            border: '1px solid rgba(0,0,0,0.05)',
            borderRadius: '0.2rem',
            padding: '0.4rem pb-5',
          }}
          className="z-10 cursor-zoom-in hover:scale-[1.03] hover:z-30 transition-all duration-300 overflow-hidden flex flex-col"
        >
          <div className="w-full h-full overflow-hidden bg-black/5 rounded-[0.1rem]">
            <img src={images[1].decryptedUrl} className="w-full h-full object-cover brightness-[98%] contrast-[102%]" alt="" />
          </div>
        </div>
      )}

      {/* 3. Middle Right Rectangle */}
      {images[2] && (
        <div 
          onClick={() => onImageClick(2)}
          style={{
            gridColumn: '28 / 48',
            gridRow: '16 / 45',
            backgroundColor: '#ffffff',
            boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
            border: '1px solid rgba(0,0,0,0.05)',
            borderRadius: '0.2rem',
            padding: '0.4rem pb-5',
          }}
          className="z-10 cursor-zoom-in hover:scale-[1.03] hover:z-30 transition-all duration-300 overflow-hidden flex flex-col"
        >
          <div className="w-full h-full overflow-hidden bg-black/5 rounded-[0.1rem]">
            <img src={images[2].decryptedUrl} className="w-full h-full object-cover brightness-[98%] contrast-[102%]" alt="" />
          </div>
        </div>
      )}

      {/* 4. Left Middle Square */}
      {images[3] && (
        <div 
          onClick={() => onImageClick(3)}
          style={{
            gridColumn: '5 / 25',
            gridRow: '23 / 38',
            backgroundColor: '#ffffff',
            boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
            border: '1px solid rgba(0,0,0,0.05)',
            borderRadius: '0.2rem',
            padding: '0.4rem pb-5',
          }}
          className="z-10 cursor-zoom-in hover:scale-[1.03] hover:z-30 transition-all duration-300 overflow-hidden flex flex-col"
        >
          <div className="w-full h-full overflow-hidden bg-black/5 rounded-[0.1rem]">
            <img src={images[3].decryptedUrl} className="w-full h-full object-cover brightness-[98%] contrast-[102%]" alt="" />
          </div>
        </div>
      )}

      {/* 5. Bottom Connecting Rectangle */}
      {images[4] && (
        <div 
          onClick={() => onImageClick(4)}
          style={{
            gridColumn: '9 / 42',
            gridRow: '34 / 47',
            backgroundColor: '#ffffff',
            boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
            border: '1px solid rgba(0,0,0,0.05)',
            borderRadius: '0.2rem',
            padding: '0.4rem pb-5',
          }}
          className="z-10 cursor-zoom-in hover:scale-[1.03] hover:z-30 transition-all duration-300 overflow-hidden flex flex-col"
        >
          <div className="w-full h-full overflow-hidden bg-black/5 rounded-[0.1rem]">
            <img src={images[4].decryptedUrl} className="w-full h-full object-cover brightness-[98%] contrast-[102%]" alt="" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Polaroid Collage Layout ──────────────────────────────────────────────────
function PolaroidLayout({
  images,
  onImageClick,
}: {
  images: Array<{ id: string; decryptedUrl: string }>;
  onImageClick: (i: number) => void;
}) {
  return (
    <div className="relative w-full h-full">
      <div className="absolute inset-0 bg-gradient-to-tr from-[#0b0b0f] to-[#1f1f2e] opacity-40 pointer-events-none" />
      {images[0] && (
        <div
          onClick={() => onImageClick(0)}
          className="absolute left-[4%] top-[10%] w-[42%] bg-[#fefefe] p-1.5 pb-5 shadow-2xl border border-black/10 rotate-[-13deg] z-10 cursor-zoom-in hover:rotate-[-5deg] hover:scale-105 hover:z-30 transition-all duration-300"
        >
          <div className="w-full aspect-square overflow-hidden bg-black/5">
            <img src={images[0].decryptedUrl} className="w-full h-full object-cover brightness-[95%] contrast-[105%]" alt="" />
          </div>
        </div>
      )}
      {images[1] && (
        <div
          onClick={() => onImageClick(1)}
          className="absolute right-[4%] top-[8%] w-[42%] bg-[#fefefe] p-1.5 pb-5 shadow-2xl border border-black/10 rotate-[15deg] z-10 cursor-zoom-in hover:rotate-[6deg] hover:scale-105 hover:z-30 transition-all duration-300"
        >
          <div className="w-full aspect-square overflow-hidden bg-black/5">
            <img src={images[1].decryptedUrl} className="w-full h-full object-cover brightness-[95%] contrast-[105%]" alt="" />
          </div>
        </div>
      )}
      {images[2] && (
        <div
          onClick={() => onImageClick(2)}
          className="absolute left-[18%] top-[22%] w-[46%] bg-[#fefefe] p-1.5 pb-5 shadow-2xl border border-black/10 rotate-[-4deg] z-20 cursor-zoom-in hover:scale-105 hover:rotate-0 hover:z-30 transition-all duration-300"
        >
          <div className="w-full aspect-square overflow-hidden bg-black/5">
            <img src={images[2].decryptedUrl} className="w-full h-full object-cover" alt="" />
          </div>
        </div>
      )}
      {images[3] && (
        <div
          onClick={() => onImageClick(3)}
          className="absolute right-[16%] bottom-[8%] w-[44%] bg-[#fefefe] p-1.5 pb-5 shadow-2xl border border-black/10 rotate-[6deg] z-25 cursor-zoom-in hover:scale-105 hover:rotate-0 hover:z-30 transition-all duration-300"
        >
          <div className="w-full aspect-square overflow-hidden bg-black/5">
            <img src={images[3].decryptedUrl} className="w-full h-full object-cover" alt="" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Victorian Gallery Layout ─────────────────────────────────────────────────
function VictorianLayout({
  images,
  onImageClick,
}: {
  images: Array<{ id: string; decryptedUrl: string }>;
  onImageClick: (i: number) => void;
}) {
  return (
    <div className="relative w-full h-full">
      <div className="absolute inset-0 bg-gradient-to-b from-[#251313] via-transparent to-[#0a0404] opacity-60 pointer-events-none" />
      {images[0] && (
        <div
          onClick={() => onImageClick(0)}
          className="absolute left-[3%] top-[4%] w-[40%] aspect-[3/4] rounded-[70px] overflow-hidden p-1.5 bg-gradient-to-br from-[#d4af37] via-[#aa7c11] to-[#f3e5ab] shadow-2xl border border-black/20 cursor-zoom-in hover:scale-105 hover:z-30 transition-transform duration-300 z-10"
        >
          <div className="w-full h-full rounded-[63px] overflow-hidden">
            <img src={images[0].decryptedUrl} className="w-full h-full object-cover brightness-[90%]" alt="" />
          </div>
        </div>
      )}
      {images[1] && (
        <div
          onClick={() => onImageClick(1)}
          className="absolute right-[3%] top-[4%] w-[45%] aspect-square p-2 bg-gradient-to-tr from-[#d4af37] via-[#aa7c11] to-[#f3e5ab] shadow-2xl border border-black/20 cursor-zoom-in hover:scale-105 hover:z-30 transition-transform duration-300 z-10"
        >
          <div className="w-full h-full overflow-hidden border-2 border-[#543b09]">
            <img src={images[1].decryptedUrl} className="w-full h-full object-cover brightness-[90%]" alt="" />
          </div>
        </div>
      )}
      {images[2] && (
        <div
          onClick={() => onImageClick(2)}
          className="absolute left-[20%] bottom-[12%] w-[50%] aspect-square p-2.5 bg-gradient-to-r from-[#e5c158] via-[#aa7c11] to-[#d4af37] shadow-2xl border border-black/20 z-20 cursor-zoom-in hover:scale-[1.04] hover:z-30 transition-transform duration-300"
        >
          <div className="w-full h-full overflow-hidden border-2 border-[#543b09]">
            <img src={images[2].decryptedUrl} className="w-full h-full object-cover" alt="" />
          </div>
        </div>
      )}
      {images[3] && (
        <div
          onClick={() => onImageClick(3)}
          className="absolute right-[4%] bottom-[4%] w-[36%] aspect-square rounded-full p-1 bg-gradient-to-br from-[#f3e5ab] via-[#aa7c11] to-[#d4af37] shadow-2xl border border-black/20 z-25 cursor-zoom-in hover:scale-105 hover:z-30 transition-transform duration-300"
        >
          <div className="w-full h-full rounded-full overflow-hidden border border-[#543b09]">
            <img src={images[3].decryptedUrl} className="w-full h-full object-cover" alt="" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Card Cover Preview (mini preview for side panels) ───────────────────────
function CardCoverPreview({ card }: { card: CollageCard }) {
  const first = card.images[0];
  if (!first) return <div className="w-full h-full bg-white/5 rounded-xl" />;

  const bg =
    card.type === 'custom' && card.layoutConfig?.bgColor
      ? card.layoutConfig.bgColor
      : card.type === 'scrapbook'
      ? '#f4f0e6'
      : card.type === 'polaroid'
      ? '#1a1a24'
      : '#1d1414';

  return (
    <div className="w-full h-full rounded-xl overflow-hidden" style={{ background: bg }}>
      <img src={first.decryptedUrl} className="w-full h-full object-cover opacity-60" alt="" />
    </div>
  );
}

// ── Image Zoom Viewer (clean full-screen, no text) ───────────────────────────
function ImageZoomViewer({
  images,
  initialIndex,
  onClose,
}: {
  images: Array<{ id: string; decryptedUrl: string }>;
  initialIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(initialIndex);
  const touchStartX = useRef<number | null>(null);

  const prev = useCallback(() => setIdx(i => Math.max(0, i - 1)), []);
  const next = useCallback(() => setIdx(i => Math.min(images.length - 1, i + 1)), [images.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [next, prev, onClose]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) diff > 0 ? next() : prev();
    touchStartX.current = null;
  };

  const content = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[400] bg-black flex items-center justify-center select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-11 h-11 rounded-full bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
      >
        <span className="material-symbols-outlined text-xl">close</span>
      </button>

      {/* Left Arrow */}
      {idx > 0 && (
        <button
          onClick={prev}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
        >
          <span className="material-symbols-outlined text-3xl">chevron_left</span>
        </button>
      )}

      {/* Image */}
      <AnimatePresence mode="wait">
        <motion.img
          key={idx}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.18 }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          onDragEnd={(_, info) => {
            if (info.offset.x < -50) next();
            else if (info.offset.x > 50) prev();
          }}
          src={images[idx]?.decryptedUrl}
          className="max-w-full max-h-screen object-contain cursor-grab active:cursor-grabbing select-none"
          alt=""
        />
      </AnimatePresence>

      {/* Right Arrow */}
      {idx < images.length - 1 && (
        <button
          onClick={next}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
        >
          <span className="material-symbols-outlined text-3xl">chevron_right</span>
        </button>
      )}

      {/* Dot Indicators */}
      {images.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all ${
                i === idx ? 'bg-white scale-125' : 'bg-white/30'
              }`}
            />
          ))}
        </div>
      )}
    </motion.div>
  );

  return createPortal(content, document.body);
}

// ── CollageViewer (main) ─────────────────────────────────────────────────────
export default function CollageViewer({ cards, initialCardIndex, onClose }: CollageViewerProps) {
  const [cardIdx, setCardIdx] = useState(initialCardIndex);
  const [zoomImgIdx, setZoomImgIdx] = useState<number | null>(null);

  const card = cards[cardIdx];
  const prevCard = cardIdx > 0 ? cards[cardIdx - 1] : null;
  const nextCard = cardIdx < cards.length - 1 ? cards[cardIdx + 1] : null;

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && nextCard) setCardIdx(i => i + 1);
      if (e.key === 'ArrowLeft' && prevCard) setCardIdx(i => i - 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, nextCard, prevCard]);

  const cardBg =
    card.type === 'custom' && card.layoutConfig?.bgColor
      ? card.layoutConfig.bgColor
      : card.type === 'scrapbook'
      ? '#f4f0e6'
      : card.type === 'polaroid'
      ? '#14141d'
      : '#1d1414';

  const cardBorder =
    card.type === 'scrapbook'
      ? '1px solid #e8dfc7'
      : card.type === 'polaroid'
      ? '1px solid rgba(255,255,255,0.06)'
      : card.type === 'custom' && card.layoutConfig?.bgColor
      ? (['#14141d', '#1e1212', '#121e16'].includes(card.layoutConfig.bgColor)
        ? '1px solid rgba(255,255,255,0.08)'
        : '1px solid #e8dfc7')
      : '1px solid #2f1f1f';

  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0 && nextCard) setCardIdx(i => i + 1);
      else if (diff < 0 && prevCard) setCardIdx(i => i - 1);
    }
    touchStartX.current = null;
  };

  const content = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] bg-black flex items-center justify-center select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Close Button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-30 w-11 h-11 rounded-full bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
      >
        <span className="material-symbols-outlined text-xl">close</span>
      </button>

      {/* Previous Card (left side preview - desktop only) */}
      {prevCard && (
        <button
          onClick={() => setCardIdx(i => i - 1)}
          className="absolute left-0 top-0 bottom-0 w-16 md:w-24 flex flex-col items-center justify-center z-20 group/prev hidden md:flex"
        >
          <div className="w-12 h-20 md:w-20 md:h-32 rounded-xl overflow-hidden border border-white/10 opacity-30 group-hover/prev:opacity-70 transition-all shadow-xl">
            <CardCoverPreview card={prevCard} />
          </div>
        </button>
      )}

      {/* Main Collage Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={cardIdx}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ type: 'spring', damping: 28, stiffness: 220 }}
          className="relative w-[85vw] max-w-[460px] aspect-[3/4] rounded-[2rem] md:rounded-[2.8rem] shadow-2xl overflow-hidden flex flex-col"
          style={{ background: cardBg, border: cardBorder }}
        >
          {/* Type-specific collage layout */}
          {card.type === 'scrapbook' && (
            <ScrapbookLayout images={card.images} onImageClick={i => setZoomImgIdx(i)} />
          )}
          {card.type === 'polaroid' && (
            <PolaroidLayout images={card.images} onImageClick={i => setZoomImgIdx(i)} />
          )}
          {card.type === 'gallery' && (
            <VictorianLayout images={card.images} onImageClick={i => setZoomImgIdx(i)} />
          )}
          {card.type === 'custom' && card.layoutConfig && (
            <CustomScrapbookLayout
              config={card.layoutConfig}
              images={card.images}
              onImageClick={i => setZoomImgIdx(i)}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Next Card (right side preview - desktop only) */}
      {nextCard && (
        <button
          onClick={() => setCardIdx(i => i + 1)}
          className="absolute right-0 top-0 bottom-0 w-16 md:w-24 flex flex-col items-center justify-center z-20 group/next hidden md:flex"
        >
          <div className="w-12 h-20 md:w-20 md:h-32 rounded-xl overflow-hidden border border-white/10 opacity-30 group-hover/next:opacity-70 transition-all shadow-xl">
            <CardCoverPreview card={nextCard} />
          </div>
        </button>
      )}

      {/* Card Dot Indicators (bottom) */}
      {cards.length > 1 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-2 z-30">
          {cards.map((_, i) => (
            <button
              key={i}
              onClick={() => setCardIdx(i)}
              className={`rounded-full transition-all duration-300 ${
                i === cardIdx
                  ? 'w-5 h-1.5 bg-[var(--gold)]'
                  : 'w-1.5 h-1.5 bg-white/30 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </motion.div>
  );

  return (
    <>
      {createPortal(content, document.body)}
      {zoomImgIdx !== null && (
        <ImageZoomViewer
          images={card.images}
          initialIndex={zoomImgIdx}
          onClose={() => setZoomImgIdx(null)}
        />
      )}
    </>
  );
}
