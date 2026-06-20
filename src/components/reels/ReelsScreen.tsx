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

// ─── Upload Modal ────────────────────────────────────────────────────────────

interface UploadModalProps {
  onClose: () => void;
  onUploaded: () => void;
}

function UploadReelModal({ onClose, onUploaded }: UploadModalProps) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { processAndUpload } = useMedia();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [caption, setCaption] = useState('');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isValid = file.type.startsWith('image/') || file.type.startsWith('video/');
    if (!isValid) { toast.error('Only images and videos are supported.'); return; }
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleUpload = async () => {
    if (!selectedFile || !user || !partner) return;
    setUploading(true);
    setUploadProgress(10);

    try {
      setUploadProgress(30);
      const processed = await processAndUpload(selectedFile);
      if (!processed) throw new Error('Upload failed');

      setUploadProgress(80);

      // Insert as a message with is_reel_upload = true
      // Caption stored in encrypted_content (empty string if none)
      const { error } = await supabase.from('messages').insert({
        sender_id: user.id,
        receiver_id: partner.id,
        encrypted_content: caption || '',
        nonce: '',
        type: processed.type as any,
        media_url: processed.url,
        media_key: processed.media_key,
        media_nonce: processed.media_nonce,
        thumbnail_url: processed.thumbnail_url || null,
        sender_public_key: null,
        is_reel_upload: true,
      } as any);

      if (error) throw error;
      setUploadProgress(100);
      toast.success('🎬 Reel uploaded! It\'ll show more often in your feed.');
      onUploaded();
      onClose();
    } catch (e: any) {
      console.error('[UploadReelModal] Upload error:', e);
      toast.error(e?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-end sm:items-center justify-center p-0 pb-[96px] sm:p-4 sm:pb-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 260 }}
        className="w-full sm:max-w-md bg-[#0f0f1a] border border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl max-h-[calc(100vh-120px)] sm:max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#c9a96e] to-[#f0c27f] flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px] text-black">movie</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Upload Reel</h2>
              <p className="text-[10px] text-white/40">Higher priority in your feed</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/60">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
          {/* File Picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {!previewUrl ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-48 rounded-2xl border-2 border-dashed border-white/10 hover:border-[var(--gold)]/40 flex flex-col items-center justify-center gap-3 bg-white/[0.02] transition-all active:scale-[0.98] group"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#c9a96e]/20 to-[#f0c27f]/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-3xl text-[var(--gold)]">add_photo_alternate</span>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white/80">Choose Photo or Video</p>
                <p className="text-[10px] text-white/30 mt-0.5">Tap to browse your device</p>
              </div>
            </button>
          ) : (
            <div className="relative rounded-2xl overflow-hidden aspect-[9/16] max-h-64 bg-black group">
              {selectedFile?.type.startsWith('video/') ? (
                <video src={previewUrl} className="w-full h-full object-cover" muted playsInline />
              ) : (
                <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/40" />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white/80 border border-white/10"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
              </button>
              {/* File type badge */}
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-full">
                <span className="material-symbols-outlined text-[14px] text-[var(--gold)]">
                  {selectedFile?.type.startsWith('video/') ? 'movie' : 'image'}
                </span>
                <span className="text-[10px] text-white/70 font-medium">
                  {selectedFile?.type.startsWith('video/') ? 'Video Reel' : 'Photo Reel'}
                </span>
              </div>
            </div>
          )}

          {/* Caption */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/30">Caption (Optional)</label>
            <input
              type="text"
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="Add a caption to your reel..."
              maxLength={120}
              className="w-full bg-white/5 border border-white/8 rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:border-[var(--gold)]/40 transition-colors"
            />
          </div>

          {/* Priority Info Card */}
          <div className="flex items-start gap-3 bg-[var(--gold)]/5 border border-[var(--gold)]/15 rounded-xl p-3">
            <span className="material-symbols-outlined text-[18px] text-[var(--gold)] mt-0.5 flex-shrink-0">star</span>
            <p className="text-[11px] text-white/50 leading-relaxed">
              Reels uploaded here get <span className="text-[var(--gold)] font-semibold">priority placement</span> in your feed — appearing 2–3× more often than regular chat photos.
            </p>
          </div>

          {/* Upload Button */}
          {uploading ? (
            <div className="space-y-2">
              <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-[#c9a96e] to-[#f0c27f] rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: `${uploadProgress}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              <p className="text-center text-[11px] text-white/40">Uploading your reel... {uploadProgress}%</p>
            </div>
          ) : (
            <button
              onClick={handleUpload}
              disabled={!selectedFile}
              className="w-full py-3.5 rounded-2xl font-bold text-sm tracking-wide transition-all active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: selectedFile
                  ? 'linear-gradient(135deg, #c9a96e 0%, #f0c27f 50%, #c9a96e 100%)'
                  : 'rgba(255,255,255,0.05)',
                color: selectedFile ? '#13131b' : '#ffffff40',
              }}
            >
              <span className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[18px]">upload</span>
                Upload Reel
              </span>
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

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
  const [showUploadModal, setShowUploadModal] = useState(false);

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
            onClick={() => setShowUploadModal(true)}
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

      {/* Upload Reel FAB */}
      {!loading && (
        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 300 }}
          onClick={() => setShowUploadModal(true)}
          className="absolute bottom-28 right-4 z-20 w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl border border-white/10"
          style={{
            background: 'linear-gradient(135deg, #c9a96e 0%, #f0c27f 50%, #c9a96e 100%)',
          }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          title="Upload Reel"
        >
          <span className="material-symbols-outlined text-2xl text-[#13131b] font-bold">add</span>
        </motion.button>
      )}

      {/* Upload Modal */}
      <AnimatePresence>
        {showUploadModal && (
          <UploadReelModal
            onClose={() => setShowUploadModal(false)}
            onUploaded={fetchReels}
          />
        )}
      </AnimatePresence>
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

  const handleShareReel = () => {
    toast.success(`Reel shared with ${partner?.display_name || 'your partner'}!`);
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

        {/* Reel Upload Badge (shown if this was a dedicated upload) */}
        {item.is_reel_upload && (
          <div className="absolute top-5 left-4 z-20 flex items-center gap-1.5 bg-[var(--gold)]/20 backdrop-blur-md border border-[var(--gold)]/30 px-2.5 py-1 rounded-full pointer-events-none">
            <span className="material-symbols-outlined text-[12px] text-[var(--gold)]">star</span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--gold)]">Featured Reel</span>
          </div>
        )}

        {/* Slide Details (Left Bottom) */}
        <div className="absolute bottom-28 lg:bottom-8 left-4 right-16 z-20 flex flex-col gap-2 pointer-events-none">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full border border-white/20 overflow-hidden bg-white/5 flex items-center justify-center">
              <EncryptedImage
                url={avatarUrl || null}
                encryptionKey={avatarKey ? (typeof avatarKey === 'string' ? avatarKey : JSON.stringify(avatarKey)) : null}
                nonce={avatarNonce ? (typeof avatarNonce === 'string' ? avatarNonce : JSON.stringify(avatarNonce)) : null}
                alt={senderName}
                className="w-full h-full object-cover rounded-full"
                placeholder={placeholder}
              />
            </div>
            <span className="text-xs font-bold text-white tracking-wide">{senderName}</span>
            <span className="text-[10px] text-white/40">•</span>
            <span className="text-[10px] text-white/40">
              {new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
            </span>
          </div>
          <p className="text-xs text-white/80 leading-relaxed font-sans line-clamp-3">
            {item.type === 'video' ? '🎬 Video Reel' : '📸 Photo Memory'}
          </p>
        </div>

        {/* Action Controls (Right Bottom) */}
        <div className="absolute bottom-28 lg:bottom-8 right-4 z-20 flex flex-col items-center gap-6 no-pause-trigger">
          {/* Mute/Unmute Toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleMute(); }}
            className="flex flex-col items-center gap-1.5"
          >
            <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10 text-white active:scale-75 transition-transform">
              <span className="material-symbols-outlined text-2xl">
                {isMuted ? 'volume_off' : 'volume_up'}
              </span>
            </div>
            <span className="text-[10px] text-white/80 font-bold uppercase tracking-wider">{isMuted ? 'Muted' : 'Mute'}</span>
          </button>

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
