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
import { Heart, MessageSquare, Bookmark, Volume2, VolumeX, Lock, Star, Share2 } from 'lucide-react';

// Semaphore to limit parallel decryptions
class DecryptionSemaphore {
  private activeCount = 0;
  private maxParallel = 8;
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

export interface ReelItem extends MessageRow {
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
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [savedItems, setSavedItems] = useState<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const userId = user?.id;

  // Keyboard navigation for reels (ArrowUp / ArrowDown)
  useEffect(() => {
    if (!isActive || reels.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true')) {
        return;
      }
      
      const container = scrollContainerRef.current;
      if (!container) return;
      const clientHeight = container.clientHeight || window.innerHeight;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        container.scrollBy({ top: clientHeight, behavior: 'smooth' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        container.scrollBy({ top: -clientHeight, behavior: 'smooth' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, reels.length]);

  // Load favorites
  useEffect(() => {
    if (!userId) return;
    const loadFavorites = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('favorited_message_ids')
          .eq('id', userId)
          .single();
        if (data?.favorited_message_ids) {
          setFavorites(new Set(data.favorited_message_ids));
        }
      } catch (e) {
        // Fallback to localStorage
        const saved = localStorage.getItem('aura_favorites');
        if (saved) {
          try {
            setFavorites(new Set(JSON.parse(saved)));
          } catch {}
        }
      }
    };
    loadFavorites();
  }, [userId]);

  // Load saved items
  useEffect(() => {
    if (!userId) return;
    const loadSaved = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('saved_message_ids')
          .eq('id', userId)
          .single();
        if (data?.saved_message_ids) {
          setSavedItems(new Set(data.saved_message_ids));
        }
      } catch (e) {
        // Fallback to localStorage
        const saved = localStorage.getItem('aura_saved');
        if (saved) {
          try {
            setSavedItems(new Set(JSON.parse(saved)));
          } catch {}
        }
      }
    };
    loadSaved();
  }, [userId]);

  // Favorite toggle
  const toggleFavorite = useCallback(async (id: string) => {
    if (!userId) return;
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        navigator.vibrate?.(10);
      }
      const arr = Array.from(next);
      localStorage.setItem('aura_favorites', JSON.stringify(arr));
      supabase
        .from('profiles')
        .update({ favorited_message_ids: arr })
        .eq('id', userId)
        .then();
      return next;
    });
  }, [userId]);

  // Saved toggle
  const toggleSaved = useCallback(async (id: string) => {
    if (!userId) return;
    setSavedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        toast.success('Removed from saved items!');
      } else {
        next.add(id);
        navigator.vibrate?.(10);
        toast.success('Saved to profile! 🔖');
      }
      const arr = Array.from(next);
      localStorage.setItem('aura_saved', JSON.stringify(arr));
      supabase
        .from('profiles')
        .update({ saved_message_ids: arr })
        .eq('id', userId)
        .then();
      return next;
    });
  }, [userId]);
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
      }
    } else {
      if (!seenImageIds.current.includes(activeReel.id)) {
        seenImageIds.current.push(activeReel.id);
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
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full w-full overflow-y-scroll snap-y snap-mandatory scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {reels.map((item, idx) => {
            const isVisible = Math.abs(idx - activeIndex) <= 5;
            const isNearby = Math.abs(idx - activeIndex) <= 4;

            if (!isVisible) {
              return (
                <div
                  key={item.id}
                  className="h-full w-full snap-start relative bg-black flex items-center justify-center lg:py-6"
                  style={{ height: '100dvh', scrollSnapStop: 'always' }}
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
                isLiked={favorites.has(item.id)}
                onLikeToggle={() => toggleFavorite(item.id)}
                isSaved={savedItems.has(item.id)}
                onSaveToggle={() => toggleSaved(item.id)}
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

const getAspectClass = (fileName: string | null) => {
  if (!fileName) return 'w-full h-full';
  if (fileName.startsWith('aspect_ratio:')) {
    const ratio = fileName.replace('aspect_ratio:', '');
    switch (ratio) {
      case '1:1':
        return 'w-full aspect-square max-h-full max-w-full';
      case '9:16':
        return 'w-full aspect-[9/16] max-h-full max-w-full';
      case '2:3':
        return 'w-full aspect-[2/3] max-h-full max-w-full';
      case '4:5':
        return 'w-full aspect-[4/5] max-h-full max-w-full';
      case '16:9':
        return 'w-full aspect-[16/9] max-h-full max-w-full';
      case '21:9':
        return 'w-full aspect-[21/9] max-h-full max-w-full';
      default:
        return 'w-full h-full';
    }
  }
  return 'w-full h-full';
};

interface ReelCardProps {
  item: ReelItem;

  isActive: boolean;
  isNearby: boolean;
  partnerPublicKey: string;
  isLiked: boolean;
  onLikeToggle: () => void;
  isSaved: boolean;
  onSaveToggle: () => void;
}

export const ReelCard = memo(function ReelCard({ item, isActive, isNearby, partnerPublicKey, isLiked, onLikeToggle, isSaved, onSaveToggle }: ReelCardProps) {
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
      setDecryptedUrl(chunk.blobUrl);
      setLoading(false);
      hasDecryptedRef.current = true;
    }
  }, [isChunkedVideo, videoChunks]);

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
        setDecryptionFailed(true);
        return;
      }

      let active = true;
      hasDecryptedRef.current = true;
      setLoading(true);

      (async () => {
        try {
          const { data, error } = await supabase
            .from('video_chunks')
            .select('chunk_index, total_chunks, chunk_url, chunk_key, chunk_nonce, duration')
            .eq('message_id', item.id)
            .order('chunk_index', { ascending: true });

          if (error) throw error;
          if (!data || data.length === 0) {
            if (active) setDecryptionFailed(true);
            return;
          }

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
      return;
    }

    let active = true;
    hasDecryptedRef.current = true;

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
      if (!isLiked) {
        onLikeToggle();
      }
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
      className="h-full w-full snap-start relative bg-black flex items-center justify-center lg:py-[0.4rem]"
      style={{ height: '100dvh', scrollSnapStop: 'always' }}
    >
      <div className="relative w-full h-full lg:w-[420px] lg:h-full flex items-center justify-center overflow-visible">
        <div
          onClick={handleTap}
          onMouseDown={handlePressStart}
          onMouseUp={handlePressEnd}
          onMouseLeave={handlePressCancel}
          onTouchStart={handlePressStart}
          onTouchEnd={handlePressEnd}
          onTouchCancel={handlePressCancel}
          className="relative w-full h-full lg:rounded-3xl lg:overflow-hidden lg:border lg:border-white/10 lg:shadow-[0_24px_64px_rgba(0,0,0,0.8)] lg:bg-[#0c0c14] flex items-center justify-center cursor-pointer select-none"
        >
          {/* Media Rendering */}
          <div className="absolute inset-0 w-full h-full flex items-center justify-center">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-2">
                <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                <span className="text-xs text-white/40 tracking-wider">Decrypting Reel...</span>
              </div>
            ) : decryptedUrl ? (
              <div className={`relative overflow-hidden flex items-center justify-center ${getAspectClass(item.file_name)}`}>
                {item.type === 'video' ? (
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
                )}
              </div>
            ) : (

              <div className="flex flex-col items-center justify-center gap-2 text-white/20">
                <Lock className="w-8 h-8 animate-pulse" />
                <span className="text-[10px] uppercase tracking-widest font-bold">Secure Memory</span>
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
          <div className="absolute bottom-0 left-0 right-0 h-44 bg-gradient-to-t from-black/75 to-transparent pointer-events-none lg:hidden" />

          {/* Top Left Mute Button */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleMute(); }}
            className="absolute top-5 left-4 z-20 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10 text-white active:scale-75 transition-all hover:bg-black/60"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="w-5 h-5 text-white" /> : <Volume2 className="w-5 h-5 text-white" />}
          </button>

          {/* Reel Upload Badge (shown if this was a dedicated upload, shifted to left-16 to avoid mute button) */}
          {item.is_reel_upload && (
            <div className="absolute top-5 left-16 z-20 flex items-center gap-1.5 bg-[var(--gold)]/20 backdrop-blur-md border border-[var(--gold)]/30 px-2.5 py-1 rounded-full pointer-events-none">
              <Star className="w-3.5 h-3.5 fill-[var(--gold)] text-[var(--gold)]" />
              <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--gold)]">Featured Reel</span>
            </div>
          )}

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

        {/* Slide Details (Left Bottom - Spans full width, outside on desktop) */}
        <div className="absolute bottom-24 left-4 right-4 z-20 flex flex-col gap-2 pointer-events-none lg:absolute lg:bottom-6 lg:-left-[280px] lg:right-auto lg:w-[250px]">
          <div className="flex items-center gap-3">
            <div 
              className={`w-10 h-10 rounded-full border border-white/20 overflow-hidden bg-white/5 flex items-center justify-center flex-shrink-0 ${!isMine ? 'pointer-events-auto cursor-pointer active:scale-95 hover:opacity-85 transition-all' : ''}`}
              onClick={(e) => {
                if (!isMine) {
                  e.stopPropagation();
                  document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                  document.dispatchEvent(new CustomEvent('view-partner-profile'));
                }
              }}
            >
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
              <span 
                className={`text-sm font-bold text-white tracking-wide ${!isMine ? 'pointer-events-auto cursor-pointer hover:underline' : ''}`}
                onClick={(e) => {
                  if (!isMine) {
                    e.stopPropagation();
                    document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                    document.dispatchEvent(new CustomEvent('view-partner-profile'));
                  }
                }}
              >
                {senderName}
              </span>
              <span className="text-[10px] text-white/45 mt-0.5">
                {new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
              </span>
            </div>
          </div>
          <p className="text-xs text-white/80 leading-relaxed font-sans line-clamp-3 pl-1">
            {item.type === 'video' ? '🎬 Video Reel' : '📸 Photo Memory'}
          </p>
        </div>

        {/* Action Controls (Right Middle-High, pushed up above slide details, outside on desktop) */}
        <div className="absolute bottom-[240px] right-3 z-20 flex flex-col items-center gap-6 no-pause-trigger lg:absolute lg:bottom-6 lg:-right-[72px] lg:left-auto">
          {/* Like */}
          <button
            onClick={(e) => { e.stopPropagation(); onLikeToggle(); }}
            className="flex flex-col items-center gap-1.5 group"
          >
            <div className={`w-12 h-12 bg-transparent border-none flex items-center justify-center filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] lg:rounded-full lg:bg-black/40 lg:backdrop-blur-md lg:border lg:border-white/10 lg:drop-shadow-none group-hover:bg-black/60 group-hover:scale-105 group-hover:border-white/20 active:scale-95 transition-all duration-200 ${isLiked ? 'text-rose-500 lg:shadow-[0_0_12px_rgba(244,63,94,0.2)]' : 'text-white'}`}>
              <Heart className={`w-[28px] h-[28px] transition-all duration-300 ${isLiked ? 'fill-rose-500 stroke-rose-500 scale-110' : 'stroke-current'}`} />
            </div>
            <span className="hidden lg:block text-[10px] text-white/80 font-bold uppercase tracking-wider group-hover:text-white transition-colors duration-200">{isLiked ? 'Liked' : 'Like'}</span>
          </button>

          {/* Comment */}
          <button
            onClick={(e) => { e.stopPropagation(); toast.info('Add a message in Chat to reply!'); }}
            className="flex flex-col items-center gap-1.5 group"
          >
            <div className="w-12 h-12 bg-transparent border-none flex items-center justify-center filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] lg:rounded-full lg:bg-black/40 lg:backdrop-blur-md lg:border lg:border-white/10 lg:drop-shadow-none text-white group-hover:bg-black/60 group-hover:scale-105 group-hover:border-white/20 active:scale-95 transition-all duration-200">
              <MessageSquare className="w-[28px] h-[28px] stroke-white" />
            </div>
            <span className="hidden lg:block text-[10px] text-white/80 font-bold uppercase tracking-wider group-hover:text-white transition-colors duration-200">Note</span>
          </button>

          {/* Share */}
          <button
            onClick={(e) => { e.stopPropagation(); handleShareReel(); }}
            className="flex flex-col items-center gap-1.5 group"
          >
            <div className="w-12 h-12 bg-transparent border-none flex items-center justify-center filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] lg:rounded-full lg:bg-black/40 lg:backdrop-blur-md lg:border lg:border-white/10 lg:drop-shadow-none text-white group-hover:bg-black/60 group-hover:scale-105 group-hover:border-white/20 active:scale-95 transition-all duration-200">
              <Share2 className="w-[26px] h-[26px] stroke-white" />
            </div>
            <span className="hidden lg:block text-[10px] text-white/80 font-bold uppercase tracking-wider group-hover:text-white transition-colors duration-200">Share</span>
          </button>

          {/* Save */}
          <button
            onClick={(e) => { e.stopPropagation(); onSaveToggle(); }}
            className="flex flex-col items-center gap-1.5 group"
          >
            <div className={`w-12 h-12 bg-transparent border-none flex items-center justify-center filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] lg:rounded-full lg:bg-black/40 lg:backdrop-blur-md lg:border lg:border-white/10 lg:drop-shadow-none group-hover:bg-black/60 group-hover:scale-105 group-hover:border-white/20 active:scale-95 transition-all duration-200 ${isSaved ? 'text-[var(--gold)] lg:shadow-[0_0_12px_rgba(201,169,110,0.2)]' : 'text-white'}`}>
              <Bookmark className={`w-[28px] h-[28px] transition-all duration-300 ${isSaved ? 'fill-[var(--gold)] stroke-[var(--gold)] scale-110' : 'stroke-current'}`} />
            </div>
            <span className="hidden lg:block text-[10px] text-white/80 font-bold uppercase tracking-wider group-hover:text-white transition-colors duration-200">{isSaved ? 'Saved' : 'Save'}</span>
          </button>
        </div>
      </div>
    </div>
  );
});
