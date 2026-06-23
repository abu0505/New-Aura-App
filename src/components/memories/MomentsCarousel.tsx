import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';
import MomentViewer, { type MomentGroup } from './MomentViewer';
import { supabase } from '../../lib/supabase';

import { useVideoChunks } from '../../hooks/useVideoChunks';

interface MomentsCarouselProps {
  moments: MomentGroup[];
  partnerPublicKey: string;
  className?: string;
}

export default function MomentsCarousel({ moments, partnerPublicKey, className = '' }: MomentsCarouselProps) {
  const { getDecryptedBlob } = useMedia();
  const { loadExistingChunks, getChunksForMessage } = useVideoChunks();
  const [coverUrls, setCoverUrls] = useState<Map<string, string>>(new Map());
  const coverUrlsRef = useRef<Map<string, string>>(new Map()); // sync ref to avoid stale closure
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const generatedUrlsRef = useRef<Set<string>>(new Set());
  const [scrollPos, setScrollPos] = useState(0);
  const [maxScroll, setMaxScroll] = useState(0);


  // Cleanup on unmount
  useEffect(() => {
    return () => {
      generatedUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  // Decrypt cover images for each moment
  const decryptCover = useCallback(async (moment: MomentGroup) => {
    if (coverUrlsRef.current.has(moment.id)) return;
    let coverItem = moment.items[0];
    if (!coverItem) return;

    const isChunked = coverItem.type === 'video' && !coverItem.media_url;
    let decryptUrl = isChunked ? (coverItem as any).thumbnail_url : coverItem.media_url;

    // If chunked video but thumbnail_url not in RPC data, fetch it directly
    if (isChunked && !decryptUrl) {
      try {
        const { data } = await supabase
          .from('messages')
          .select('thumbnail_url, media_key, media_nonce, sender_public_key')
          .eq('id', coverItem.id)
          .single();
        if (data?.thumbnail_url) {
          decryptUrl = data.thumbnail_url;
          // Merge fetched data back
          coverItem = { ...coverItem, ...data };
        }
      } catch { /* silent */ }
    }

    if (!decryptUrl || !coverItem.media_key || !coverItem.media_nonce || !partnerPublicKey) {
      coverUrlsRef.current.set(moment.id, '__failed__');
      setCoverUrls(prev => new Map(prev).set(moment.id, '__failed__'));
      return;
    }

    // Mark as in-progress
    coverUrlsRef.current.set(moment.id, '__loading__');

    try {
      const blob = await getDecryptedBlob(
        decryptUrl,
        coverItem.media_key,
        coverItem.media_nonce,
        partnerPublicKey,
        coverItem.sender_public_key,
        undefined,
        isChunked ? 'image' : coverItem.type
      );
      if (blob) {
        const url = URL.createObjectURL(blob);
        generatedUrlsRef.current.add(url);
        coverUrlsRef.current.set(moment.id, url);
        setCoverUrls(prev => new Map(prev).set(moment.id, url));
      } else {
        coverUrlsRef.current.set(moment.id, '__failed__');
        setCoverUrls(prev => new Map(prev).set(moment.id, '__failed__'));
      }
    } catch {
      coverUrlsRef.current.set(moment.id, '__failed__');
      setCoverUrls(prev => new Map(prev).set(moment.id, '__failed__'));
    }
  }, [partnerPublicKey, getDecryptedBlob]);

  // Preload first item video if it is a video post
  const preloadFirstItemVideo = useCallback(async (moment: MomentGroup) => {
    const firstItem = moment.items[0];
    if (!firstItem || firstItem.type !== 'video') return;

    const isChunked = !firstItem.media_url;

    if (isChunked) {
      // Check if it is already loaded/decrypted
      const existingChunks = getChunksForMessage(firstItem.id);
      if (existingChunks && existingChunks.some(c => c.isDecrypted && c.blobUrl)) {
        return;
      }

      try {
        const { data, error } = await supabase
          .from('video_chunks')
          .select('message_id, chunk_index, total_chunks, chunk_url, chunk_key, chunk_nonce, duration')
          .eq('message_id', firstItem.id)
          .order('chunk_index', { ascending: true });

        if (!error && data && data.length > 0 && partnerPublicKey) {
          // Preload/decrypt chunks in the background
          loadExistingChunks(firstItem.id, data, partnerPublicKey);
        }
      } catch (err) {
        console.error('[MomentsCarousel] Background chunk preload error:', err);
      }
    } else {
      // Standard video: decrypt and store in global decryptedBlobCache
      if (!firstItem.media_url || !firstItem.media_key || !firstItem.media_nonce || !partnerPublicKey) return;
      try {
        await getDecryptedBlob(
          firstItem.media_url,
          firstItem.media_key,
          firstItem.media_nonce,
          partnerPublicKey,
          firstItem.sender_public_key,
          undefined,
          'video'
        );
      } catch (err) {
        console.error('[MomentsCarousel] Background standard video preload error:', err);
      }
    }
  }, [partnerPublicKey, getDecryptedBlob, loadExistingChunks, getChunksForMessage]);

  useEffect(() => {
    moments.forEach(m => {
      decryptCover(m);
      preloadFirstItemVideo(m);
    });
  }, [moments, decryptCover, preloadFirstItemVideo]);

  // Track scroll for arrow visibility
  const updateScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setScrollPos(scrollLeft);
      setMaxScroll(scrollWidth - clientWidth);
    }
  };

  useEffect(() => {
    updateScroll();
    window.addEventListener('resize', updateScroll);
    return () => window.removeEventListener('resize', updateScroll);
  }, [moments]);

  const scrollBy = (dir: number) => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: dir * 400, behavior: 'smooth' });
    }
  };

  if (moments.length === 0) return null;

  return (
    <div className={`relative w-full select-none group/carousel ${className}`}>
      {/* Title */}
      <div className="flex items-center justify-between mb-4 sm:px-0">
        <div>
          <h2 className="font-serif italic text-2xl text-[var(--gold)]">Moments</h2>
          <p className="text-xs font-label uppercase tracking-widest text-white/40">Shared memories, curated daily</p>
        </div>
      </div>

      {/* Outer container */}
      <div className="relative">
        {/* Left Arrow */}
        <AnimatePresence>
          {scrollPos > 10 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => scrollBy(-1)}
              className="absolute left-6 top-1/2 -translate-y-1/2 z-30 w-10 h-10 bg-transparent hover:bg-white/5 border border-white/5 text-white rounded-full flex items-center justify-center backdrop-blur-sm transition-colors opacity-0 group-hover/carousel:opacity-100 hidden md:flex"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back_ios_new</span>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Right Arrow */}
        <AnimatePresence>
          {scrollPos < maxScroll - 10 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => scrollBy(1)}
              className="absolute right-6 top-1/2 -translate-y-1/2 z-30 w-10 h-10 bg-transparent hover:bg-white/5 border border-white/5 text-white rounded-full flex items-center justify-center backdrop-blur-sm transition-colors opacity-0 group-hover/carousel:opacity-100 hidden md:flex"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_forward_ios</span>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Carousel track */}
        <div
          ref={scrollRef}
          onScroll={updateScroll}
          className="flex gap-4 overflow-x-auto pb-4 pt-1 no-scrollbar snap-x snap-mandatory"
          style={{ scrollbarWidth: 'none' }}
        >
          {moments.filter(m => coverUrls.get(m.id) !== '__failed__').map((moment, idx) => {
            const coverUrl = coverUrls.get(moment.id);
            return (
              <motion.div
                key={moment.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                onClick={() => setViewerIndex(idx)}
                className="flex-shrink-0 w-[280px] sm:w-[320px] h-[180px] sm:h-[200px] rounded-2xl border border-white/10 overflow-hidden relative cursor-pointer snap-start group/card hover:border-[var(--gold)]/30 transition-all duration-300 shadow-xl"
              >
                {/* Background image & blur placeholder */}
                <div className="absolute inset-0 bg-[var(--bg-elevated)] transition-transform duration-700 group-hover/card:scale-105">
                  {coverUrl ? (
                    <>
                      <img
                        src={coverUrl}
                        alt={moment.title}
                        className="w-full h-full object-cover"
                      />
                      {moment.items[0]?.type === 'video' && (
                        <div className="absolute inset-0 flex items-center justify-center z-20">
                          <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                            <span className="material-symbols-outlined text-white text-2xl ml-1">play_arrow</span>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center opacity-25">
                      <span className="material-symbols-outlined animate-pulse text-3xl">image</span>
                    </div>
                  )}
                  {/* Subtle dark overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/20" />
                </div>

                {/* Content */}
                <div className="absolute inset-0 p-5 flex flex-col justify-end z-10">


                  {/* Title & metadata */}
                  <div>
                    <h3 className="font-serif italic text-lg sm:text-xl text-white leading-snug drop-shadow-md mb-1 group-hover/card:text-[var(--gold)] transition-colors">
                      {moment.title}
                    </h3>
                    <p className="text-[10px] text-white/60 font-medium">
                      {new Date(moment.items[0]?.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Fullscreen moments viewer */}
      {viewerIndex !== null && (
        <MomentViewer
          moments={moments}
          initialMomentIndex={viewerIndex}
          partnerPublicKey={partnerPublicKey}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}