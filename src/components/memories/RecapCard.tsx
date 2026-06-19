import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';
import type { Database } from '../../integrations/supabase/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];

export interface RecapItem extends MessageRow {
  decryptedUrl?: string;
  loading?: boolean;
}

// ─── Viewer ─────────────────────────────────────────────────────────────────
interface RecapViewerProps {
  items: RecapItem[];
  initialIndex: number;
  title: string;
  subtitle: string;
  iconName: string;
  onClose: () => void;
}

function RecapViewer({ items, initialIndex, title, subtitle, iconName, onClose }: RecapViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const current = items[currentIndex];

  const goNext = useCallback(() => setCurrentIndex(i => Math.min(i + 1, items.length - 1)), [items.length]);
  const goPrev = useCallback(() => setCurrentIndex(i => Math.max(i - 1, 0)), []);

  // Swipe support
  const touchStartX = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) diff > 0 ? goNext() : goPrev();
    touchStartX.current = null;
  };

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev, onClose]);

  if (!current) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-lg flex flex-col"
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 pt-6 pb-3 safe-top safe-pt">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[var(--gold)] text-xl">{iconName}</span>
          <div>
            <p className="font-serif italic text-base text-[var(--gold)] leading-tight">{title}</p>
            <p className="font-label text-[9px] uppercase tracking-[0.2em] text-[#998f81]">{subtitle}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all"
        >
          <span className="material-symbols-outlined text-xl">close</span>
        </button>
      </div>

      {/* Counter */}
      <div className="text-center pb-2">
        <span className="font-label text-[10px] uppercase tracking-widest text-white/40">
          {currentIndex + 1} / {items.length}
        </span>
      </div>

      {/* Main Media */}
      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-center w-full h-full px-4"
          >
            {current.decryptedUrl ? (
              current.type === 'video' ? (
                <video
                  src={current.decryptedUrl}
                  controls
                  autoPlay
                  playsInline
                  className="max-w-full max-h-full rounded-2xl object-contain"
                />
              ) : (
                <img
                  src={current.decryptedUrl}
                  alt=""
                  className="max-w-full max-h-full rounded-2xl object-contain"
                />
              )
            ) : (
              <div className="w-32 h-32 flex flex-col items-center justify-center gap-3 opacity-30">
                {current.loading
                  ? <div className="w-8 h-8 border-2 border-white/20 border-t-[var(--gold)] rounded-full animate-spin" />
                  : <span className="material-symbols-outlined text-4xl">lock</span>
                }
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Nav Arrows */}
        {currentIndex > 0 && (
          <button
            onClick={goPrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 backdrop-blur text-white/70 hover:text-white hover:bg-black/70 transition-all"
          >
            <span className="material-symbols-outlined text-2xl">chevron_left</span>
          </button>
        )}
        {currentIndex < items.length - 1 && (
          <button
            onClick={goNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 backdrop-blur text-white/70 hover:text-white hover:bg-black/70 transition-all"
          >
            <span className="material-symbols-outlined text-2xl">chevron_right</span>
          </button>
        )}
      </div>

      {/* Date stamp */}
      <div className="shrink-0 py-4 text-center safe-bottom">
        <span className="font-label text-[10px] uppercase tracking-widest text-white/30">
          {new Date(current.created_at).toLocaleDateString('en-US', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
          })}
        </span>
      </div>

      {/* Thumbnail filmstrip */}
      <div className="shrink-0 pb-8 px-4 safe-bottom">
        <div className="flex gap-2 overflow-x-auto no-scrollbar justify-center">
          {items.map((item, i) => (
            <button
              key={item.id}
              onClick={() => setCurrentIndex(i)}
              className={`shrink-0 w-10 h-10 rounded-lg overflow-hidden border-2 transition-all ${
                i === currentIndex
                  ? 'border-[var(--gold)] scale-110'
                  : 'border-white/10 opacity-50 hover:opacity-80'
              }`}
            >
              {item.decryptedUrl ? (
                item.type === 'video'
                  ? <video src={item.decryptedUrl} className="w-full h-full object-cover" />
                  : <img src={item.decryptedUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-white/5 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[12px] text-white/20">lock</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Media Type Bar ──────────────────────────────────────────────────────────
function MediaTypeBar({ items }: { items: RecapItem[] }) {
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    const t = item.type || 'image';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  const mediaTypes: { key: string; icon: string; label: string; color: string }[] = [
    { key: 'image',    icon: 'photo_camera',    label: 'Photos',   color: 'text-sky-400' },
    { key: 'gif',      icon: 'gif_box',         label: 'GIFs',     color: 'text-purple-400' },
    { key: 'video',    icon: 'videocam',         label: 'Videos',   color: 'text-rose-400' },
    { key: 'audio',    icon: 'mic',             label: 'Voice',    color: 'text-emerald-400' },
    { key: 'document', icon: 'description',     label: 'Docs',     color: 'text-amber-400' },
    { key: 'sticker',  icon: 'emoji_emotions',  label: 'Stickers', color: 'text-pink-400' },
  ];

  const present = mediaTypes.filter(mt => counts[mt.key] > 0);
  if (present.length === 0) return null;

  return (
    <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-3">
      {present.map((mt, idx) => (
        <span key={mt.key} className="flex items-center gap-1">
          {idx > 0 && <span className="text-white/10 mr-1 -ml-1">·</span>}
          <span className={`material-symbols-outlined text-[14px] ${mt.color}`}>{mt.icon}</span>
          <span className="font-label text-[10px] text-white/50 uppercase tracking-widest">
            {counts[mt.key]} {mt.label}
          </span>
        </span>
      ))}
    </div>
  );
}

// ─── Thumbnail Strip ─────────────────────────────────────────────────────────
function ThumbStrip({
  items,
  onThumbClick,
}: {
  items: RecapItem[];
  onThumbClick: (index: number) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 snap-x mt-4">
      {items.map((item, index) => (
        <motion.button
          key={item.id}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => onThumbClick(index)}
          className="relative shrink-0 w-28 h-36 lg:w-36 lg:h-48 rounded-2xl overflow-hidden bg-black/40 border border-white/5 snap-start shadow-xl cursor-pointer group/thumb"
        >
          {item.loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white/10 border-t-[var(--gold)] rounded-full animate-spin" />
            </div>
          ) : item.decryptedUrl ? (
            <>
              {((item.type as string) === 'image' || (item.type as string) === 'gif' || (item.type as string) === 'sticker') && (
                <img src={item.decryptedUrl} className="w-full h-full object-cover" alt="" />
              )}
              {item.type === 'video' && (
                <div className="w-full h-full relative">
                  <video src={item.decryptedUrl} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                    <span className="material-symbols-outlined text-white/70 text-2xl">play_circle</span>
                  </div>
                </div>
              )}
              {item.type === 'audio' && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-emerald-950/60 gap-2">
                  <span className="material-symbols-outlined text-3xl text-emerald-400">mic</span>
                  <span className="font-label text-[7px] uppercase tracking-widest text-emerald-400/60">Voice</span>
                </div>
              )}
              {item.type === 'document' && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-amber-950/60 gap-2">
                  <span className="material-symbols-outlined text-3xl text-amber-400">description</span>
                  <span className="font-label text-[7px] uppercase tracking-widest text-amber-400/60">Doc</span>
                </div>
              )}
              {/* Hover gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover/thumb:opacity-100 transition-opacity" />
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center opacity-20">
              <span className="material-symbols-outlined text-2xl mb-1">lock</span>
              <span className="font-label text-[8px] uppercase tracking-widest">Encrypted</span>
            </div>
          )}
        </motion.button>
      ))}
    </div>
  );
}

// ─── Main RecapCard ──────────────────────────────────────────────────────────
export interface RecapCardProps {
  /** Raw (encrypted) items from Supabase */
  items: RecapItem[];
  partnerPublicKey: string;
  /** Card header label — e.g. "April in Review" */
  title: string;
  /** Card sub-label — e.g. "Last Month" */
  badge: string;
  /** Material Symbol icon name for the card header */
  iconName: string;
  /** Subtle accent colour class for the glow / badge (Tailwind) */
  accentClass?: string;
  /** Subtitle shown inside the viewer */
  viewerSubtitle?: string;
}

export default function RecapCard({
  items: rawItems,
  partnerPublicKey,
  title,
  badge,
  iconName,
  accentClass = 'var(--gold)',
  viewerSubtitle,
}: RecapCardProps) {
  const { getDecryptedBlob } = useMedia();
  // Filter out invalid items (like text messages mistakenly fetched) right at initialization
  const validItems = useMemo(() => rawItems.filter(i => i.media_url), [rawItems]);
  const [items, setItems] = useState<RecapItem[]>(validItems);
  const generatedUrlsRef = useRef<Set<string>>(new Set());
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  
  // Track decryptions to prevent StrictMode duplicate decryptions
  const inFlightRef = useRef<Set<string>>(new Set());

  // Revoke blobs on unmount
  useEffect(() => () => {
    generatedUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
  }, []);

  const decryptItem = useCallback(async (item: RecapItem) => {
    const tag = `[RecapCard][${title}][${item.id?.slice(0,8)}]`;

    // Guard: skip if already done or missing fields
    if (!partnerPublicKey) {
      console.warn(`${tag} SKIP — partnerPublicKey is empty/null`);
      return;
    }
    if (!item.media_url) {
      console.warn(`${tag} SKIP — media_url is null`);
      return;
    }
    if (!item.media_key || !item.media_nonce) {
      console.warn(`${tag} SKIP — media_key or media_nonce missing`, { key: item.media_key, nonce: item.media_nonce });
      return;
    }
    if (item.decryptedUrl || inFlightRef.current.has(item.id)) {
      console.log(`${tag} SKIP — already decrypted or in-flight`);
      return;
    }

    inFlightRef.current.add(item.id);
    console.log(`${tag} START decrypt → url=${item.media_url?.slice(-30)} type=${item.type} senderPub=${item.sender_public_key?.slice(0,8) ?? 'null'}`);
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, loading: true } : i));
    try {
      const blob = await getDecryptedBlob(
        item.media_url,
        item.media_key,
        item.media_nonce,
        partnerPublicKey,
        item.sender_public_key
      );
      if (blob) {
        const url = URL.createObjectURL(blob);
        generatedUrlsRef.current.add(url);
        console.log(`${tag} SUCCESS → blob=${(blob.size/1024).toFixed(1)}KB mime=${blob.type}`);
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, decryptedUrl: url, loading: false } : i));
      } else {
        console.error(`${tag} FAILED — getDecryptedBlob returned null`);
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, loading: false } : i));
      }
    } catch (err) {
      console.error(`${tag} EXCEPTION`, err);
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, loading: false } : i));
      inFlightRef.current.delete(item.id);
    }
  }, [partnerPublicKey, getDecryptedBlob, title]);

  // Decrypt first 6 thumbs when items or partner key changes
  // NOTE: We depend on validItems NOT the items state, to avoid a
  // stale-closure bug where items are already decrypted but the effect
  // re-runs with the old state.
  useEffect(() => {
    console.log(`[RecapCard][${title}] decrypt-trigger — partnerKey=${partnerPublicKey?.slice(0,8) ?? 'MISSING'} items=${validItems.length}`);
    if (!partnerPublicKey || validItems.length === 0) return;
    // Decrypt the first 6 visible thumbnails
    validItems.slice(0, 6).forEach(item => decryptItem(item));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerPublicKey, validItems, title]);

  if (validItems.length === 0) return null;

  const handleThumbClick = (index: number) => {
    // Make sure the clicked item and neighbours are decrypted
    [index - 1, index, index + 1].forEach(i => {
      if (items[i]) decryptItem(items[i]);
    });
    setViewerIndex(index);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mb-6 overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-secondary)] border border-[rgba(var(--primary-rgb),_0.18)] p-6 shadow-2xl group"
      >
        {/* Decorative glow */}
        <div
          className="absolute -top-20 -right-20 w-44 h-44 blur-[70px] rounded-full opacity-60 group-hover:opacity-100 transition-all duration-1000"
          style={{ background: `${accentClass}22` }}
        />

        <div className="relative flex flex-col">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-serif italic text-xl text-[var(--gold)] flex items-center gap-2">
                <span className="material-symbols-outlined text-[var(--gold)] text-[22px]">{iconName}</span>
                {title}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest border border-[rgba(var(--primary-rgb),_0.3)] text-[var(--gold)] bg-[rgba(var(--primary-rgb),_0.08)]">
                  {badge}
                </span>
                <span className="font-label text-[9px] uppercase tracking-[0.18em] text-[#998f81]">
                  {rawItems.length} {rawItems.length === 1 ? 'memory' : 'memories'}
                </span>
              </div>

              {/* Media type count bar */}
              <MediaTypeBar items={rawItems} />
            </div>

            {/* See all → opens viewer at index 0 */}
            <button
              onClick={() => handleThumbClick(0)}
              className="shrink-0 flex flex-col items-center gap-1 p-2 rounded-xl text-[var(--gold)] hover:bg-[rgba(var(--primary-rgb),_0.08)] transition-all"
            >
              <span className="material-symbols-outlined text-[22px]">open_in_full</span>
              <span className="font-label text-[8px] uppercase tracking-widest">See all</span>
            </button>
          </div>

          {/* Thumbnail strip */}
          <ThumbStrip items={items} onThumbClick={handleThumbClick} />
        </div>
      </motion.div>

      {/* Full-screen Viewer */}
      <AnimatePresence>
        {viewerIndex !== null && (
          <RecapViewer
            items={items}
            initialIndex={viewerIndex}
            title={title}
            subtitle={viewerSubtitle ?? badge}
            iconName={iconName}
            onClose={() => setViewerIndex(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
