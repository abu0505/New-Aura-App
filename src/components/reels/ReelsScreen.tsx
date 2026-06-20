import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import { useVideoChunks } from '../../hooks/useVideoChunks';
import { toast } from 'sonner';
import EncryptedImage from '../common/EncryptedImage';
import { buildReelQueue, filterDecryptableItems } from '../../utils/reelWeighting';
import { fetchDiverseMediaPool } from '../../utils/feedPool';
import { useGlobalMute } from '../../hooks/useGlobalMute';
import { getStoredKeyPair, encodeBase64 } from '../../lib/encryption';
import type { Database } from '../../integrations/supabase/types';

// Semaphore to limit parallel decryptions
class DecryptionSemaphore {
  private activeCount = 0;
  private maxParallel = 3;
  private queue: (() => void)[] = [];

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxParallel) {
      this.activeCount++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release() {
    this.activeCount--;
    if (this.queue.length > 0) {
      this.activeCount++;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const decryptionSemaphore = new DecryptionSemaphore();

type MessageRow = Database['public']['Tables']['messages']['Row'];

interface ReelItem extends MessageRow {
  decryptedUrl?: string;
  loading?: boolean;
}

// ─── Upload Modal migrated to UploadReelScreen ───────────────────────────────

// ─── Main Reels Screen ────────────────────────────────────────────────────────

interface ReelsScreenProps {
  isActive?: boolean;
}

export default function ReelsScreen({ isActive = true }: ReelsScreenProps) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const userId = user?.id;
  const partnerId = partner?.id;
  const partnerPublicKey = partner?.public_key || '';

  const seenVideoIds = useRef<string[]>([]);
  const seenImageIds = useRef<string[]>([]);

  // Fetch diverse media pool from 3 time buckets and apply weighted algorithm
  const fetchReels = useCallback(async () => {
    if (!userId || !partnerId) return;
    setLoading(true);
    try {
      const pool = await fetchDiverseMediaPool(userId, partnerId, {
        recentLimit: 40,
        middleLimit: 80,
        oldLimit: 80,
      });

      const decryptablePool = filterDecryptableItems(pool as ReelItem[]);
      console.log(`[ReelsScreen] Pool: ${pool.length} total → ${decryptablePool.length} decryptable`);

      // Apply weighted reservoir sampling algorithm
      const weighted = buildReelQueue(decryptablePool, 60);

      setReels(weighted);
    } catch (e) {
      console.error('[ReelsScreen] Error fetching reels:', e);
    } finally {
      setLoading(false);
    }
  }, [userId, partnerId]);

  const fetchMoreReels = useCallback(async () => {
    if (!userId || !partnerId || loadingMore) return;
    setLoadingMore(true);
    try {
      let excludeIds = [...seenVideoIds.current, ...seenImageIds.current];
      console.log(`[ReelsScreen] Fetching more reels... Excluded videos: ${seenVideoIds.current.length}, images: ${seenImageIds.current.length}`);

      let pool = await fetchDiverseMediaPool(
        userId,
        partnerId,
        {
          recentLimit: 20,
          middleLimit: 40,
          oldLimit: 40,
        },
        excludeIds
      );

      let fetchedVideos = pool.filter(p => p.type === 'video');
      let fetchedImages = pool.filter(p => p.type !== 'video');

      // Check if we ran out of unseen videos or images based on our 40/30 minimum bounds
      const minVideos = 12; // 40% of 30
      const minImages = 9;  // 30% of 30
      const needsVideoReset = fetchedVideos.length < minVideos && seenVideoIds.current.length > 0;
      const needsImageReset = fetchedImages.length < minImages && seenImageIds.current.length > 0;

      if (needsVideoReset || needsImageReset) {
        console.log(`[ReelsScreen] Scarcity detected: Resetting seen caches. Video reset: ${needsVideoReset}, Image reset: ${needsImageReset}`);

        if (needsVideoReset) {
          // Keep only a scaled fraction to avoid repeats on small/large libraries
          const keepCount = Math.min(30, Math.floor(seenVideoIds.current.length * 0.5));
          seenVideoIds.current = seenVideoIds.current.slice(-keepCount);
        }
        if (needsImageReset) {
          // Keep only a scaled fraction to avoid repeats
          const keepCount = Math.min(50, Math.floor(seenImageIds.current.length * 0.5));
          seenImageIds.current = seenImageIds.current.slice(-keepCount);
        }

        // Re-fetch with the newly cleared exclusions
        excludeIds = [...seenVideoIds.current, ...seenImageIds.current];
        pool = await fetchDiverseMediaPool(
          userId,
          partnerId,
          {
            recentLimit: 20,
            middleLimit: 40,
            oldLimit: 40,
          },
          excludeIds
        );
        fetchedVideos = pool.filter(p => p.type === 'video');
        fetchedImages = pool.filter(p => p.type !== 'video');
      }

      const decryptablePool = filterDecryptableItems(pool as ReelItem[]);
      const weighted = buildReelQueue(decryptablePool, 30);

      if (weighted.length > 0) {
        setReels(prev => {
          const fresh = weighted.filter(w => !prev.some(p => p.id === w.id));
          return [...prev, ...fresh];
        });
      }
    } catch (e) {
      console.error('[ReelsScreen] Error fetching more reels:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [userId, partnerId, loadingMore]);

  useEffect(() => {
    fetchReels();
  }, [fetchReels]);

  // Mark the active reel as seen progressively as the user views it
  useEffect(() => {
    if (reels.length === 0 || activeIndex < 0 || activeIndex >= reels.length) return;
    const activeReel = reels[activeIndex];
    if (!activeReel) return;

    if (activeReel.type === 'video') {
      if (!seenVideoIds.current.includes(activeReel.id)) {
        seenVideoIds.current.push(activeReel.id);
        console.log(`[ReelsScreen] Marked video seen: ${activeReel.id}`);
      }
    } else {
      if (!seenImageIds.current.includes(activeReel.id)) {
        seenImageIds.current.push(activeReel.id);
        console.log(`[ReelsScreen] Marked image seen: ${activeReel.id}`);
      }
    }
  }, [activeIndex, reels]);

  // Handle slide change
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const clientHeight = e.currentTarget.clientHeight;
    const newIndex = Math.round(scrollTop / clientHeight);
    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < reels.length) {
      setActiveIndex(newIndex);

      // Load more when 5 reels away from bottom
      if (newIndex >= reels.length - 5 && !loadingMore) {
        fetchMoreReels();
      }
    }
  };

  return (
    <div className="h-full w-full bg-black relative select-none overflow-hidden">
      {loading ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black">
          <div className="w-8 h-8 border-2 border-[var(--gold)]/20 border-t-[var(--gold)] rounded-full animate-spin"></div>
          <p className="text-xs font-label uppercase tracking-widest text-white/40">Loading Reels...</p>
        </div>
      ) : reels.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white/50 bg-black">
          <span className="material-symbols-outlined text-5xl mb-4 text-[var(--gold)]">movie</span>
          <p className="font-serif italic text-lg text-white">No Reels Available</p>
          <p className="text-xs text-white/40 mt-1 max-w-[240px]">
            Share media in chat or upload a dedicated reel below.
          </p>
          <button
            onClick={() => document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'upload-reel' }))}
            className="mt-6 px-5 py-2.5 rounded-2xl text-xs font-bold uppercase tracking-widest bg-gradient-to-r from-[#c9a96e] to-[#f0c27f] text-[#13131b]"
          >
            Upload First Reel
          </button>
        </div>
      ) : (
        <div
          onScroll={handleScroll}
          className="h-full w-full overflow-y-scroll snap-y snap-mandatory scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {reels.map((item, idx) => {
            const isVisible = Math.abs(idx - activeIndex) <= 5;
            const isNearby = Math.abs(idx - activeIndex) <= 2;

            if (!isVisible) {
              return (
                <div
                  key={item.id}
                  className="h-full w-full snap-start relative bg-black flex items-center justify-center lg:py-6"
                  style={{ height: '100dvh' }}
                />
              );
            }

            return (
              <ReelCard
                key={item.id}
                item={item}
                isActive={idx === activeIndex && isActive}
                isNearby={isNearby}
                partnerPublicKey={partnerPublicKey}
              />
            );
          })}
        </div>
      )}

      {/* Upload flow migrated to dedicated screen */}
    </div>
  );
}

// ─── Reel Card ────────────────────────────────────────────────────────────────

interface ReelCardProps {
  item: ReelItem;
  isActive: boolean;
  isNearby: boolean;
  partnerPublicKey: string;
}

const ReelCard = memo(function ReelCard({ item, isActive, isNearby, partnerPublicKey }: ReelCardProps) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();

  // Detect chunked video: type=video but no media_url (data lives in video_chunks table)
  const isChunkedVideo = item.type === 'video' && !item.media_url;

  // Hook for chunked video assembly — only activated for chunked videos
  const { chunks: videoChunks, loadExistingChunks } = useVideoChunks(isChunkedVideo ? item.id : undefined);

  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [decryptionFailed, setDecryptionFailed] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [showHeartBurst, setShowHeartBurst] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isHeldPaused, setIsHeldPaused] = useState(false);
  const [showStatusIcon, setShowStatusIcon] = useState<'play' | 'pause' | null>(null);
  const { isMuted, toggleMute } = useGlobalMute();

  const videoRef = useRef<HTMLVideoElement>(null);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressActiveRef = useRef(false);
  const ignoreNextClickRef = useRef(false);
  const decryptedUrlRef = useRef<string | null>(null);
  const hasDecryptedRef = useRef(false);
  const getDecryptedBlobRef = useRef(getDecryptedBlob);
  const retryCountRef = useRef(0);

  useEffect(() => { getDecryptedBlobRef.current = getDecryptedBlob; }, [getDecryptedBlob]);

  const tag = `[ReelCard][${item.id?.slice(0,8)}]`;

  // ── Chunked video: pick up blobUrl from useVideoChunks store ──
  useEffect(() => {
    if (!isChunkedVideo || !videoChunks?.length) return;
    const chunk = videoChunks[0];
    if (chunk?.blobUrl && chunk.isDecrypted) {
      console.log(`${tag} Chunked video blob ready`);
      setDecryptedUrl(chunk.blobUrl);
      setLoading(false);
      hasDecryptedRef.current = true;
    }
  }, [isChunkedVideo, videoChunks, tag]);

  // Play/pause active video
  useEffect(() => {
    if (videoRef.current) {
      if (isActive && decryptedUrl) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {});
        setIsPaused(false);
        setIsHeldPaused(false);
      } else {
        videoRef.current.pause();
        setIsPaused(true);
      }
    }
  }, [isActive, decryptedUrl]);

  // Clean up Object URL on unmount or item change
  useEffect(() => {
    setDecryptedUrl(null);
    setLoading(false);
    setDecryptionFailed(false);
    hasDecryptedRef.current = false;
    retryCountRef.current = 0;
    return () => {
      // Only revoke non-chunked URLs (chunked URLs are managed by videoStore)
      if (decryptedUrlRef.current && !isChunkedVideo) {
        URL.revokeObjectURL(decryptedUrlRef.current);
        decryptedUrlRef.current = null;
      }
    };
  }, [item.id, item.media_url, isChunkedVideo]);

  // ── Decrypt/load media when active or nearby ──
  useEffect(() => {
    if (!isActive && !isNearby) return;
    if (hasDecryptedRef.current) return;
    if (!partnerPublicKey) return;

    // ── Path A: Chunked video — fetch chunks from DB, decrypt & assemble ──
    if (isChunkedVideo) {
      if (!item.media_key || !item.media_nonce) {
        console.warn(`${tag} SKIP chunked video — missing media_key/nonce`);
        setDecryptionFailed(true);
        return;
      }

      let active = true;
      hasDecryptedRef.current = true;
      setLoading(true);
      console.log(`${tag} ACTIVE/NEARBY → loading chunked video`);

      (async () => {
        try {
          const { data, error } = await supabase
            .from('video_chunks')
            .select('chunk_index, total_chunks, chunk_url, chunk_key, chunk_nonce, duration')
            .eq('message_id', item.id)
            .order('chunk_index', { ascending: true });

          if (error) throw error;
          if (!data || data.length === 0) {
            console.warn(`${tag} No chunks found in DB`);
            if (active) setDecryptionFailed(true);
            return;
          }

          console.log(`${tag} Found ${data.length} chunks, loading...`);
          await loadExistingChunks(item.id, data, partnerPublicKey);
          // The useEffect watching videoChunks will pick up the blobUrl
        } catch (e) {
          console.error(`${tag} Chunked video load error`, e);
          if (active) {
            hasDecryptedRef.current = false;
            setDecryptionFailed(true);
            setLoading(false);
          }
        }
      })();

      return () => { active = false; };
    }

    // ── Path B: Regular media — download media_url and decrypt ──
    if (!item.media_url || !item.media_key || !item.media_nonce) {
      console.warn(`${tag} SKIP — missing fields`);
      return;
    }

    let active = true;
    hasDecryptedRef.current = true;
    console.log(`${tag} ACTIVE/NEARBY → decrypt type=${item.type}`);

    const decrypt = async () => {
      setLoading(true);
      setDecryptionFailed(false);

      await decryptionSemaphore.acquire();

      try {
        const blob = await getDecryptedBlobRef.current(
          item.media_url!,
          item.media_key!,
          item.media_nonce!,
          partnerPublicKey,
          item.sender_public_key
        );
        if (blob && active) {
          const url = URL.createObjectURL(blob);
          decryptedUrlRef.current = url;
          setDecryptedUrl(url);
          setDecryptionFailed(false);
        } else if (!blob) {
          throw new Error('Decryption resulted in null blob');
        }
      } catch (e) {
        console.error(`${tag} EXCEPTION`, e);
        if (active) {
          if (retryCountRef.current < 1) {
            retryCountRef.current += 1;
            console.log(`${tag} Retrying decryption in 2 seconds...`);
            setTimeout(() => {
              if (active) decrypt();
            }, 2000);
          } else {
            setDecryptionFailed(true);
          }
        }
      } finally {
        decryptionSemaphore.release();
        if (active) setLoading(false);
      }
    };

    decrypt();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, isNearby, item.id, item.media_url, item.media_key, item.media_nonce, partnerPublicKey, isChunkedVideo]);

  // Single/Double Tap & Long Press handlers
  const handleTap = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('a') || target.closest('.no-pause-trigger')) {
      return;
    }

    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }

    if (clickTimeoutRef.current) {
      // Double tap detected (Like)
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      setIsLiked(true);
      setShowHeartBurst(true);
      setTimeout(() => setShowHeartBurst(false), 800);
      navigator.vibrate?.([10, 30]);
    } else {
      // Start single tap timer
      clickTimeoutRef.current = setTimeout(() => {
        clickTimeoutRef.current = null;
        if (item.type === 'video' && videoRef.current) {
          if (videoRef.current.paused) {
            videoRef.current.play().catch(() => {});
            setIsPaused(false);
            setShowStatusIcon('play');
            setTimeout(() => setShowStatusIcon(null), 500);
          } else {
            videoRef.current.pause();
            setIsPaused(true);
            setShowStatusIcon('pause');
            setTimeout(() => setShowStatusIcon(null), 500);
          }
        }
      }, 250);
    }
  };

  const handlePressStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (item.type !== 'video') return;

    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('a') || target.closest('.no-pause-trigger')) {
      return;
    }

    isLongPressActiveRef.current = false;

    // Timer for long press (350ms)
    holdTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
        setIsHeldPaused(true);
        isLongPressActiveRef.current = true;
        navigator.vibrate?.(50);
      }
    }, 350);
  };

  const handlePressEnd = (e: React.MouseEvent | React.TouchEvent) => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    if (isLongPressActiveRef.current) {
      if (videoRef.current && isHeldPaused) {
        videoRef.current.play().catch(() => {});
        setIsHeldPaused(false);
      }
      isLongPressActiveRef.current = false;
      ignoreNextClickRef.current = true;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handlePressCancel = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (isLongPressActiveRef.current) {
      if (videoRef.current && isHeldPaused) {
        videoRef.current.play().catch(() => {});
        setIsHeldPaused(false);
      }
      isLongPressActiveRef.current = false;
    }
  };

  const handleShareReel = async () => {
    if (!user || !partner) return;
    const toastId = toast.loading('Sharing reel to chat...');
    try {
      const myKeyPair = getStoredKeyPair();
      if (!myKeyPair) throw new Error('Encryption key missing');
      const myPublicKeyStr = encodeBase64(myKeyPair.publicKey);

      const newMessageId = crypto.randomUUID();
      const isChunked = item.type === 'video' && !item.media_url;

      // 1. Insert message
      const { error: msgError } = await supabase.from('messages').insert({
        id: newMessageId,
        sender_id: user.id,
        receiver_id: partner.id,
        encrypted_content: '',
        nonce: '',
        type: item.type,
        media_url: isChunked ? null : item.media_url,
        media_key: item.media_key,
        media_nonce: item.media_nonce,
        thumbnail_url: item.thumbnail_url || null,
        sender_public_key: myPublicKeyStr,
        is_reel_upload: false,
      } as any);

      if (msgError) throw msgError;

      // 2. If chunked video, duplicate chunks
      if (isChunked) {
        const { data: chunksData, error: fetchError } = await supabase
          .from('video_chunks')
          .select('*')
          .eq('message_id', item.id);

        if (fetchError) throw fetchError;

        if (chunksData && chunksData.length > 0) {
          const newChunks = chunksData.map(chunk => ({
            message_id: newMessageId,
            chunk_index: chunk.chunk_index,
            total_chunks: chunk.total_chunks,
            chunk_url: chunk.chunk_url,
            chunk_key: chunk.chunk_key,
            chunk_nonce: chunk.chunk_nonce,
            duration: chunk.duration,
            sender_id: user.id,
            receiver_id: partner.id,
          }));

          const { error: chunkError } = await supabase
            .from('video_chunks')
            .insert(newChunks);

          if (chunkError) throw chunkError;
        }
      }

      toast.success('Reel shared to chat! 💬', { id: toastId });
    } catch (err: any) {
      console.error('Error sharing reel:', err);
      toast.error(err.message || 'Failed to share reel', { id: toastId });
    }
  };

  if (decryptionFailed) return null;

  const isMine = item.sender_id === user?.id;
  const senderName = isMine ? 'You' : (partner?.display_name || 'Partner');
  const avatarUrl = isMine ? user?.user_metadata?.avatar_url : partner?.avatar_url;
  const avatarKey = isMine ? user?.user_metadata?.avatar_key : partner?.avatar_key;
  const avatarNonce = isMine ? user?.user_metadata?.avatar_nonce : partner?.avatar_nonce;
  const placeholder = `https://ui-avatars.com/api/?name=${senderName}&background=c9a96e&color=13131b`;

  return (
    <div
      className="h-full w-full snap-start relative bg-black flex items-center justify-center lg:py-6"
      style={{ height: '100dvh' }}
    >
      <div
        onClick={handleTap}
        onMouseDown={handlePressStart}
        onMouseUp={handlePressEnd}
        onMouseLeave={handlePressCancel}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
        onTouchCancel={handlePressCancel}
        className="relative w-full h-full lg:max-w-[420px] lg:h-[90dvh] lg:rounded-3xl lg:overflow-hidden lg:border lg:border-white/10 lg:shadow-[0_24px_64px_rgba(0,0,0,0.8)] lg:bg-[#0c0c14] flex items-center justify-center cursor-pointer select-none"
      >
        {/* Media Rendering */}
        <div className="absolute inset-0 w-full h-full flex items-center justify-center">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
              <span className="text-xs text-white/40 tracking-wider">Decrypting Reel...</span>
            </div>
          ) : decryptedUrl ? (
            item.type === 'video' ? (
              <video
                ref={videoRef}
                src={decryptedUrl}
                className="w-full h-full object-cover"
                loop
                playsInline
                muted={isMuted}
              />
            ) : (
              <img
                src={decryptedUrl}
                alt="Reel Media"
                className="w-full h-full object-cover"
              />
            )
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 text-white/20">
              <span className="material-symbols-outlined text-4xl">lock</span>
              <span className="text-[10px] uppercase tracking-widest">Secure Memory</span>
            </div>
          )}
        </div>

        {/* Play overlay when paused (but not when held) */}
        {isPaused && !isHeldPaused && !showStatusIcon && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white"
            >
              <span className="material-symbols-outlined text-4xl">play_arrow</span>
            </motion.div>
          </div>
        )}

        {/* Play/Pause status flash overlay */}
        <AnimatePresence>
          {showStatusIcon && (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1.2, opacity: 0.8 }}
              exit={{ scale: 1.5, opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none"
            >
              <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-4xl">
                  {showStatusIcon === 'play' ? 'play_arrow' : 'pause'}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dark overlays for UI readability only (leaving center media colors untouched) */}
        <div className="absolute top-0 left-0 right-0 h-28 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 h-44 bg-gradient-to-t from-black/75 to-transparent pointer-events-none" />

        {/* Top Left Mute Button */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleMute(); }}
          className="absolute top-5 left-4 z-20 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10 text-white active:scale-75 transition-all hover:bg-black/60"
          title={isMuted ? "Unmute" : "Mute"}
        >
          <span className="material-symbols-outlined text-[20px]">
            {isMuted ? 'volume_off' : 'volume_up'}
          </span>
        </button>

        {/* Reel Upload Badge (shown if this was a dedicated upload, shifted to left-16 to avoid mute button) */}
        {item.is_reel_upload && (
          <div className="absolute top-5 left-16 z-20 flex items-center gap-1.5 bg-[var(--gold)]/20 backdrop-blur-md border border-[var(--gold)]/30 px-2.5 py-1 rounded-full pointer-events-none">
            <span className="material-symbols-outlined text-[12px] text-[var(--gold)]">star</span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--gold)]">Featured Reel</span>
          </div>
        )}

        {/* Slide Details (Left Bottom - Spans full width) */}
        <div className="absolute bottom-28 lg:bottom-8 left-4 right-4 z-20 flex flex-col gap-2 pointer-events-none">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full border border-white/20 overflow-hidden bg-white/5 flex items-center justify-center flex-shrink-0">
              <EncryptedImage
                url={avatarUrl || null}
                encryptionKey={avatarKey ? (typeof avatarKey === 'string' ? avatarKey : JSON.stringify(avatarKey)) : null}
                nonce={avatarNonce ? (typeof avatarNonce === 'string' ? avatarNonce : JSON.stringify(avatarNonce)) : null}
                alt={senderName}
                className="w-full h-full object-cover rounded-full"
                placeholder={placeholder}
              />
            </div>
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-white tracking-wide">{senderName}</span>
                <span className="text-[10px] text-white/40">•</span>
                <span className="text-[10px] text-white/40">
                  {new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                </span>
              </div>
            </div>
          </div>
          <p className="text-xs text-white/80 leading-relaxed font-sans line-clamp-3 pl-1">
            {item.type === 'video' ? '🎬 Video Reel' : '📸 Photo Memory'}
          </p>
        </div>

        {/* Action Controls (Right Middle-High, pushed up above slide details) */}
        <div className="absolute bottom-[240px] lg:bottom-[170px] right-4 z-20 flex flex-col items-center gap-6 no-pause-trigger">
          {/* Like */}
          <button
            onClick={(e) => { e.stopPropagation(); setIsLiked(!isLiked); }}
            className="flex flex-col items-center gap-1.5"
          >
            <div className={`w-12 h-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10 active:scale-75 transition-transform ${isLiked ? 'text-rose-500' : 'text-white'}`}>
              <span className={`material-symbols-outlined text-2xl ${isLiked ? 'fill-current' : ''}`}>favorite</span>
            </div>
            <span className="text-[10px] text-white/80 font-bold uppercase tracking-wider">{isLiked ? 'Liked' : 'Like'}</span>
          </button>

          {/* Comment */}
          <button
            onClick={(e) => { e.stopPropagation(); toast.info('Add a message in Chat to reply!'); }}
            className="flex flex-col items-center gap-1.5"
          >
            <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10 text-white">
              <span className="material-symbols-outlined text-2xl">chat_bubble</span>
            </div>
            <span className="text-[10px] text-white/80 font-bold uppercase tracking-wider">Note</span>
          </button>

          {/* Share */}
          <button
            onClick={(e) => { e.stopPropagation(); handleShareReel(); }}
            className="flex flex-col items-center gap-1.5"
          >
            <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10 text-white rotate-[-15deg] translate-y-[-1px]">
              <span className="material-symbols-outlined text-2xl">send</span>
            </div>
            <span className="text-[10px] text-white/80 font-bold uppercase tracking-wider">Share</span>
          </button>
        </div>

        {/* Double-Tap Heart Burst */}
        <AnimatePresence>
          {showHeartBurst && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: [0.5, 1.2, 1], opacity: [0, 0.9, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="absolute z-30 pointer-events-none text-rose-500"
            >
              <span className="material-symbols-outlined text-8xl fill-current drop-shadow-2xl">favorite</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});
