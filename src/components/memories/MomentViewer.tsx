import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useMedia } from '../../hooks/useMedia';
import type { Database } from '../../integrations/supabase/types';
import ChunkedVideoPlayer from '../chat/ChunkedVideoPlayer';
import { useVideoChunks } from '../../hooks/useVideoChunks';
import { supabase } from '../../lib/supabase';

type MessageRow = Database['public']['Tables']['messages']['Row'];

export interface MomentItem extends MessageRow {
  decryptedUrl?: string;
  loading?: boolean;
}

export interface MomentGroup {
  id: string;
  title: string;
  badge: string;
  iconName: string;
  accentColor: string;
  items: MomentItem[];
  coverUrl?: string;
}

interface MomentViewerProps {
  moments: MomentGroup[];
  initialMomentIndex: number;
  partnerPublicKey: string;
  onClose: () => void;
}

// ── ChunkedVideoFetcher ──────────────────────────────────────────────────────
function ChunkedVideoFetcher({ messageId, thumbnailUrl, duration, partnerPublicKey, onEnded, isPaused, onTogglePause }: { messageId: string, thumbnailUrl?: string, duration?: number, partnerPublicKey: string, onEnded?: () => void, isPaused?: boolean, onTogglePause?: () => void }) {
  const { chunks, getChunksForMessage, loadExistingChunks } = useVideoChunks(messageId);

  useEffect(() => {
    const existingChunks = getChunksForMessage(messageId);
    if (existingChunks && existingChunks.some(c => c.isDecrypted && c.blobUrl)) {
      return;
    }

    if (!partnerPublicKey) return;

    let cancelled = false;
    const fetchAndLoad = async () => {
      const { data, error } = await supabase
        .from('video_chunks')
        .select('chunk_index, total_chunks, chunk_url, chunk_key, chunk_nonce, duration')
        .eq('message_id', messageId)
        .order('chunk_index', { ascending: true });

      if (cancelled) return;
      if (error) return;

      if (data && data.length > 0) {
        loadExistingChunks(messageId, data, partnerPublicKey);
      }
    };

    fetchAndLoad();
    return () => { cancelled = true; };
  }, [messageId, partnerPublicKey]);

  return (
    <div className="w-full h-full max-h-full cursor-pointer" onClick={onTogglePause}>
      <ChunkedVideoPlayer 
        chunks={chunks} 
        thumbnailUrl={thumbnailUrl} 
        duration={duration}
        autoPlay={!isPaused}
        onEnded={onEnded}
        className="w-full h-full max-h-full object-contain rounded-2xl shadow-2xl" 
      />
    </div>
  );
}

// ── Auto-advance timing ─────────────────────────────────────────────────────
const PHOTO_DURATION = 3000; // 3 seconds for photos

export default function MomentViewer({ moments, initialMomentIndex, partnerPublicKey, onClose }: MomentViewerProps) {
  const { getDecryptedBlob } = useMedia();
  const [currentMomentIdx, setCurrentMomentIdx] = useState(initialMomentIndex);
  const [currentItemIdx, setCurrentItemIdx] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [decryptedItems, setDecryptedItems] = useState<Map<string, MomentItem[]>>(new Map());
  const generatedUrlsRef = useRef<Set<string>>(new Set());
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const moment = moments[currentMomentIdx];
  const items = decryptedItems.get(moment.id) || moment.items;
  const currentItem = items[currentItemIdx];
  const prevMoment = currentMomentIdx > 0 ? moments[currentMomentIdx - 1] : null;
  const nextMoment = currentMomentIdx < moments.length - 1 ? moments[currentMomentIdx + 1] : null;

  // ── Decrypt items for visible moments ──────────────────────────────────────
  const decryptItem = useCallback(async (itemArg: MomentItem, momentId: string) => {
    let item = itemArg;
    const isChunked = item.type === 'video' && !item.media_url;
    let decryptUrl = isChunked ? (item as any).thumbnail_url : item.media_url;

    // If chunked video but no thumbnail in RPC result, fetch full row directly
    if (isChunked && !decryptUrl) {
      try {
        const { data } = await supabase
          .from('messages')
          .select('thumbnail_url, media_key, media_nonce, sender_public_key')
          .eq('id', item.id)
          .single();
        if (data?.thumbnail_url) {
          decryptUrl = data.thumbnail_url;
          item = { ...item, ...data };
        }
      } catch { /* silent */ }
    }

    if (item.decryptedUrl || !partnerPublicKey || !decryptUrl || !item.media_key || !item.media_nonce) {
      if (isChunked && !item.decryptedUrl) {
        // Chunked video with no thumbnail — mark as done (will use ChunkedVideoFetcher)
        setDecryptedItems(prev => {
          const next = new Map(prev);
          const list = [...(next.get(momentId) || [])];
          const idx = list.findIndex(i => i.id === item.id);
          if (idx !== -1) list[idx] = { ...list[idx], loading: false };
          next.set(momentId, list);
          return next;
        });
      }
      return;
    }

    setDecryptedItems(prev => {
      const next = new Map(prev);
      const list = [...(next.get(momentId) || [])];
      const idx = list.findIndex(i => i.id === item.id);
      if (idx !== -1) list[idx] = { ...list[idx], loading: true };
      next.set(momentId, list);
      return next;
    });

    try {
      const blob = await getDecryptedBlob(
        decryptUrl,
        item.media_key,
        item.media_nonce,
        partnerPublicKey,
        item.sender_public_key,
        undefined,
        isChunked ? 'image' : item.type
      );
      if (blob) {
        const url = URL.createObjectURL(blob);
        generatedUrlsRef.current.add(url);
        setDecryptedItems(prev => {
          const next = new Map(prev);
          const list = [...(next.get(momentId) || [])];
          const idx = list.findIndex(i => i.id === item.id);
          if (idx !== -1) list[idx] = { ...list[idx], decryptedUrl: url, loading: false };
          next.set(momentId, list);
          return next;
        });
      } else {
        setDecryptedItems(prev => {
          const next = new Map(prev);
          const list = [...(next.get(momentId) || [])];
          const idx = list.findIndex(i => i.id === item.id);
          if (idx !== -1) list[idx] = { ...list[idx], loading: false };
          next.set(momentId, list);
          return next;
        });
      }
    } catch {
      setDecryptedItems(prev => {
        const next = new Map(prev);
        const list = [...(next.get(momentId) || [])];
        const idx = list.findIndex(i => i.id === item.id);
        if (idx !== -1) list[idx] = { ...list[idx], loading: false };
        next.set(momentId, list);
        return next;
      });
    }
  }, [partnerPublicKey, getDecryptedBlob]);

  // Initialize items and decrypt on moment change
  useEffect(() => {
    const m = moments[currentMomentIdx];
    if (!decryptedItems.has(m.id)) {
      setDecryptedItems(prev => {
        const next = new Map(prev);
        next.set(m.id, [...m.items]);
        return next;
      });
    }
    // Decrypt all items for current moment
    m.items.forEach(item => decryptItem(item, m.id));
    
    // Pre-decrypt adjacent moments
    if (currentMomentIdx > 0) {
      const prev = moments[currentMomentIdx - 1];
      if (!decryptedItems.has(prev.id)) {
        setDecryptedItems(p => {
          const next = new Map(p);
          next.set(prev.id, [...prev.items]);
          return next;
        });
      }
      prev.items.slice(0, 3).forEach(item => decryptItem(item, prev.id));
    }
    if (currentMomentIdx < moments.length - 1) {
      const nxt = moments[currentMomentIdx + 1];
      if (!decryptedItems.has(nxt.id)) {
        setDecryptedItems(p => {
          const next = new Map(p);
          next.set(nxt.id, [...nxt.items]);
          return next;
        });
      }
      nxt.items.slice(0, 3).forEach(item => decryptItem(item, nxt.id));
    }
  }, [currentMomentIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-advance logic ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isPaused) return;
    const isChunked = currentItem?.type === 'video' && !currentItem?.media_url;
    if (!currentItem?.decryptedUrl && !isChunked) return;

    if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);

    if (currentItem.type === 'video') {
      // For videos, advance happens via onEnded event
      return;
    }

    // For photos, auto-advance after 3 seconds
    autoAdvanceTimerRef.current = setTimeout(() => {
      advanceToNext();
    }, PHOTO_DURATION);

    return () => {
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    };
  }, [currentItemIdx, currentMomentIdx, isPaused, currentItem?.decryptedUrl, currentItem?.type, currentItem?.media_url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      generatedUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    };
  }, []);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const advanceToNext = () => {
    if (currentItemIdx < items.length - 1) {
      setCurrentItemIdx(prev => prev + 1);
    } else if (currentMomentIdx < moments.length - 1) {
      // Move to next moment
      setCurrentMomentIdx(prev => prev + 1);
      setCurrentItemIdx(0);
    }
  };

  const goToPrev = () => {
    if (currentItemIdx > 0) {
      setCurrentItemIdx(prev => prev - 1);
    } else if (currentMomentIdx > 0) {
      setCurrentMomentIdx(prev => prev - 1);
      const prevItems = decryptedItems.get(moments[currentMomentIdx - 1].id) || moments[currentMomentIdx - 1].items;
      setCurrentItemIdx(prevItems.length - 1);
    }
  };

  const switchToMoment = (idx: number) => {
    setCurrentMomentIdx(idx);
    setCurrentItemIdx(0);
  };

  const handleVideoEnded = () => {
    if (!isPaused) {
      advanceToNext();
    }
  };

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') advanceToNext();
      if (e.key === 'ArrowLeft') goToPrev();
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') { e.preventDefault(); setIsPaused(p => !p); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentItemIdx, currentMomentIdx, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Swipe support
  const touchStartX = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) diff > 0 ? advanceToNext() : goToPrev();
    touchStartX.current = null;
  };

  // ── Progress bar computation ───────────────────────────────────────────────
  const progressSegments = items.map((_, i) => {
    if (i < currentItemIdx) return 1; // completed
    if (i === currentItemIdx) return -1; // active (animating)
    return 0; // upcoming
  });

  const content = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] bg-black flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Top Bar: Close + Moment Title ── */}
      <div className="shrink-0 flex items-center gap-3 px-4 pt-5 pb-2 safe-top safe-pt z-10">
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 text-white/80 hover:bg-white/20 transition-all"
        >
          <span className="material-symbols-outlined text-xl">close</span>
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-serif italic text-sm text-[var(--gold)] truncate">{moment.title}</p>
        </div>
      </div>

      {/* ── Progress Bar (segment per item) ── */}
      <div className="shrink-0 flex gap-1 px-4 pb-2">
        {progressSegments.map((status, i) => (
          <div key={i} className="flex-1 h-[3px] rounded-full overflow-hidden bg-white/15">
            {status === 1 && (
              <div className="w-full h-full bg-white/80 rounded-full" />
            )}
            {status === -1 && (
              <motion.div
                className="h-full bg-white/80 rounded-full"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{
                  duration: currentItem?.type === 'video' ? (currentItem?.duration || 10) : PHOTO_DURATION / 1000,
                  ease: 'linear',
                }}
                key={`progress-${currentItemIdx}-${currentMomentIdx}`}
              />
            )}
          </div>
        ))}
      </div>

      {/* ── Thumbnail Bar ── */}
      <div className="shrink-0 px-4 pb-3">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {items.map((item, i) => {
            const isChunked = item.type === 'video' && !item.media_url;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentItemIdx(i)}
                className={`shrink-0 w-8 h-8 rounded-lg overflow-hidden border-2 transition-all ${
                  i === currentItemIdx
                    ? 'border-[var(--gold)] scale-110 shadow-lg'
                    : 'border-white/10 opacity-40 hover:opacity-70'
                }`}
              >
                {item.decryptedUrl || isChunked ? (
                  isChunked ? (
                    item.decryptedUrl ? <img src={item.decryptedUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-black flex items-center justify-center"><span className="material-symbols-outlined text-[10px] text-white/50">play_arrow</span></div>
                  ) : item.type === 'video' ? (
                    <video src={item.decryptedUrl} className="w-full h-full object-cover" />
                  ) : (
                    <img src={item.decryptedUrl} alt="" className="w-full h-full object-cover" />
                  )
                ) : (
                  <div className="w-full h-full bg-white/5 flex items-center justify-center">
                    {item.loading
                      ? <div className="w-3 h-3 border border-white/20 border-t-[var(--gold)] rounded-full animate-spin" />
                      : <span className="material-symbols-outlined text-[10px] text-white/20">lock</span>
                    }
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main Content Area ── */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {/* Previous Moment (side preview) */}
        {prevMoment && (
          <button
            onClick={() => switchToMoment(currentMomentIdx - 1)}
            className="absolute left-0 top-0 bottom-0 w-16 md:w-24 flex flex-col items-center justify-center z-20 group/prev"
          >
            <div className="w-12 h-20 md:w-20 md:h-32 rounded-xl overflow-hidden border border-white/10 opacity-30 group-hover/prev:opacity-60 transition-all shadow-xl">
              {(() => {
                const prevItems = decryptedItems.get(prevMoment.id) || prevMoment.items;
                const cover = prevItems.find(i => i.decryptedUrl);
                return cover?.decryptedUrl ? (
                  <img src={cover.decryptedUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-white/5" />
                );
              })()}
            </div>
            <span className="text-[8px] text-white/30 mt-1.5 font-label uppercase tracking-wider hidden md:block">Previous</span>
            <span className="text-[7px] text-white/20 font-serif italic hidden md:block truncate max-w-[80px]">{prevMoment.title}</span>
          </button>
        )}

        {/* Main Media */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${currentMomentIdx}-${currentItemIdx}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-center w-full h-full px-16 md:px-28"
          >
            {currentItem?.decryptedUrl || (currentItem?.type === 'video' && !currentItem?.media_url) ? (
              (currentItem.type === 'video' && !currentItem.media_url) ? (
                <ChunkedVideoFetcher
                  messageId={currentItem.id}
                  thumbnailUrl={currentItem.decryptedUrl}
                  duration={currentItem.duration || 0}
                  partnerPublicKey={partnerPublicKey}
                  onEnded={handleVideoEnded}
                  isPaused={isPaused}
                  onTogglePause={() => setIsPaused(p => !p)}
                />
              ) : currentItem.type === 'video' ? (
                <video
                  ref={videoRef}
                  key={currentItem.id}
                  src={currentItem.decryptedUrl}
                  controls={false}
                  autoPlay={!isPaused}
                  playsInline
                  onEnded={handleVideoEnded}
                  className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl cursor-pointer"
                  onClick={() => setIsPaused(p => !p)}
                />
              ) : (
                <img
                  src={currentItem.decryptedUrl}
                  alt=""
                  className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl"
                />
              )
            ) : (
              <div className="w-40 h-40 flex flex-col items-center justify-center gap-3 opacity-30">
                {currentItem?.loading
                  ? <div className="w-8 h-8 border-2 border-white/20 border-t-[var(--gold)] rounded-full animate-spin" />
                  : <span className="material-symbols-outlined text-4xl">lock</span>
                }
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Next Moment (side preview) */}
        {nextMoment && (
          <button
            onClick={() => switchToMoment(currentMomentIdx + 1)}
            className="absolute right-0 top-0 bottom-0 w-16 md:w-24 flex flex-col items-center justify-center z-20 group/next"
          >
            <div className="w-12 h-20 md:w-20 md:h-32 rounded-xl overflow-hidden border border-white/10 opacity-30 group-hover/next:opacity-60 transition-all shadow-xl">
              {(() => {
                const nextItems = decryptedItems.get(nextMoment.id) || nextMoment.items;
                const cover = nextItems.find(i => i.decryptedUrl);
                return cover?.decryptedUrl ? (
                  <img src={cover.decryptedUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-white/5" />
                );
              })()}
            </div>
            <span className="text-[8px] text-white/30 mt-1.5 font-label uppercase tracking-wider hidden md:block">Up next</span>
            <span className="text-[7px] text-white/20 font-serif italic hidden md:block truncate max-w-[80px]">{nextMoment.title}</span>
          </button>
        )}
      </div>

      {/* ── Bottom Controls: Pause/Play ── */}
      <div className="shrink-0 flex items-center justify-center py-4 safe-bottom">
        <button
          onClick={() => {
            setIsPaused(p => {
              const next = !p;
              if (videoRef.current) {
                next ? videoRef.current.pause() : videoRef.current.play();
              }
              return next;
            });
          }}
          className="p-3 rounded-full bg-white/10 backdrop-blur-md text-white/80 hover:bg-white/20 transition-all"
        >
          <span className="material-symbols-outlined text-2xl">
            {isPaused ? 'play_arrow' : 'pause'}
          </span>
        </button>
      </div>

      {/* Date stamp */}
      <div className="shrink-0 pb-4 text-center safe-bottom">
        {currentItem && (
          <span className="font-label text-[10px] uppercase tracking-widest text-white/30">
            {new Date(currentItem.created_at).toLocaleDateString('en-US', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
            })}
          </span>
        )}
      </div>
    </motion.div>
  );

  return createPortal(content, document.body);
}
