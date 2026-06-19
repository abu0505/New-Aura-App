import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import { toast } from 'sonner';
import EncryptedImage from '../common/EncryptedImage';
import type { Database } from '../../integrations/supabase/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];

interface ReelItem extends MessageRow {
  decryptedUrl?: string;
  loading?: boolean;
}

export default function ReelsScreen() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);

  // Fetch random images/videos from chat history
  const fetchReels = useCallback(async () => {
    if (!user || !partner) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or('type.eq.image,type.eq.video')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partner.id}),and(sender_id.eq.${partner.id},receiver_id.eq.${user.id})`)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;

      // Shuffle items randomly to simulate reels
      const items = (data as ReelItem[]) || [];
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      setReels(shuffled);
    } catch (e) {
      console.error('Error fetching reels:', e);
    } finally {
      setLoading(false);
    }
  }, [user, partner]);

  useEffect(() => {
    fetchReels();
  }, [fetchReels]);

  // Handle slide change
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const clientHeight = e.currentTarget.clientHeight;
    const newIndex = Math.round(scrollTop / clientHeight);
    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < reels.length) {
      setActiveIndex(newIndex);
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
            Once you share images or videos in chat, they will show up here as Reels.
          </p>
        </div>
      ) : (
        <div 
          onScroll={handleScroll}
          className="h-full w-full overflow-y-scroll snap-y snap-mandatory scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {reels.map((item, idx) => (
            <ReelCard 
              key={item.id} 
              item={item} 
              isActive={idx === activeIndex} 
              partnerPublicKey={partner?.public_key || ''} 
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ReelCardProps {
  item: ReelItem;
  isActive: boolean;
  partnerPublicKey: string;
}

function ReelCard({ item, isActive, partnerPublicKey }: ReelCardProps) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();

  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [showHeartBurst, setShowHeartBurst] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastTapRef = useRef<number>(0);
  const decryptedUrlRef = useRef<string | null>(null);
  // Guard against StrictMode double-invoke and repeated decryption
  const hasDecryptedRef = useRef(false);
  const getDecryptedBlobRef = useRef(getDecryptedBlob);
  // Keep ref current so the decrypt closure always uses the latest version
  useEffect(() => { getDecryptedBlobRef.current = getDecryptedBlob; }, [getDecryptedBlob]);

  const tag = `[ReelCard][${item.id?.slice(0,8)}]`;

  // Play/pause active video
  useEffect(() => {
    if (videoRef.current) {
      if (isActive && decryptedUrl) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.pause();
      }
    }
  }, [isActive, decryptedUrl]);

  // Clean up Object URL on unmount or item change
  useEffect(() => {
    setDecryptedUrl(null);
    setLoading(false);
    hasDecryptedRef.current = false;
    return () => {
      if (decryptedUrlRef.current) {
        URL.revokeObjectURL(decryptedUrlRef.current);
        decryptedUrlRef.current = null;
      }
    };
  }, [item.id, item.media_url]);

  // Decrypt media when this reel becomes active
  // NOTE: decryptedUrl intentionally NOT in dep array — it causes the effect
  // to re-run after setting the URL, which cancels the in-progress work.
  useEffect(() => {
    if (!isActive) return;
    if (hasDecryptedRef.current) {
      console.log(`${tag} SKIP — already decrypted`);
      return;
    }
    if (!partnerPublicKey || !item.media_url || !item.media_key || !item.media_nonce) {
      console.warn(`${tag} SKIP — missing fields`, { partnerPublicKey: !!partnerPublicKey, url: !!item.media_url });
      return;
    }

    let active = true;
    hasDecryptedRef.current = true;
    console.log(`${tag} ACTIVE → starting decrypt type=${item.type} url=...${item.media_url?.slice(-30)}`);

    const decrypt = async () => {
      setLoading(true);
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
          console.log(`${tag} SUCCESS → ${(blob.size/1024).toFixed(1)}KB mime=${blob.type}`);
          setDecryptedUrl(url);
        } else if (!blob) {
          console.error(`${tag} FAILED — getDecryptedBlob returned null`);
          hasDecryptedRef.current = false; // allow retry
        }
      } catch (e) {
        console.error(`${tag} EXCEPTION`, e);
        hasDecryptedRef.current = false; // allow retry
      } finally {
        if (active) setLoading(false);
      }
    };

    decrypt();

    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, item.id, item.media_url, item.media_key, item.media_nonce, partnerPublicKey]);

  // Double tap to like
  const handleDoubleTap = () => {
    const now = Date.now();
    const DOUBLE_PRESS_DELAY = 300;
    if (now - lastTapRef.current < DOUBLE_PRESS_DELAY) {
      setIsLiked(true);
      setShowHeartBurst(true);
      setTimeout(() => setShowHeartBurst(false), 800);
      navigator.vibrate?.([10, 30]);
    }
    lastTapRef.current = now;
  };

  const handleShareReel = () => {
    toast.success(`Reel shared with ${partner?.display_name || 'your partner'}!`);
  };

  const isMine = item.sender_id === user?.id;
  const senderName = isMine ? 'You' : (partner?.display_name || 'Partner');
  const avatarUrl = isMine ? user?.user_metadata?.avatar_url : partner?.avatar_url;
  const avatarKey = isMine ? user?.user_metadata?.avatar_key : partner?.avatar_key;
  const avatarNonce = isMine ? user?.user_metadata?.avatar_nonce : partner?.avatar_nonce;
  const placeholder = `https://ui-avatars.com/api/?name=${senderName}&background=c9a96e&color=13131b`;

  return (
    <div 
      onClick={handleDoubleTap}
      className="h-full w-full snap-start relative bg-black flex items-center justify-center"
      style={{ height: '100dvh' }}
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
              muted={false}
            />
          ) : (
            <img 
              src={decryptedUrl} 
              alt="Reel Media" 
              className="w-full h-full object-cover animate-ken-burns"
            />
          )
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-white/20">
            <span className="material-symbols-outlined text-4xl">lock</span>
            <span className="text-[10px] uppercase tracking-widest">Secure Memory</span>
          </div>
        )}
      </div>

      {/* Dark overlay for text readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />

      {/* Slide Details (Left Bottom) */}
      <div className="absolute bottom-28 left-4 right-16 z-20 flex flex-col gap-2 pointer-events-none">
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
          <span className="text-xs font-bold text-white tracking-wide">
            {senderName}
          </span>
          <span className="text-[10px] text-white/40">•</span>
          <span className="text-[10px] text-white/40">
            {new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        </div>
        <p className="text-xs text-white/80 leading-relaxed font-sans line-clamp-3">
          {item.type === 'video' ? 'Shared Video Reel' : 'Shared Photo Moment'}
        </p>
      </div>

      {/* Action Controls (Right Bottom) */}
      <div className="absolute bottom-28 right-4 z-20 flex flex-col items-center gap-6">
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

        {/* Comment/Note Placeholder */}
        <button 
          onClick={(e) => { e.stopPropagation(); toast.info("Add a message in Chat to reply!"); }} 
          className="flex flex-col items-center gap-1.5"
        >
          <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10 text-white">
            <span className="material-symbols-outlined text-2xl">chat_bubble</span>
          </div>
          <span className="text-[10px] text-white/80 font-bold uppercase tracking-wider">Note</span>
        </button>

        {/* Share to Partner */}
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

      {/* Giant Double-Tap Heart Overlay */}
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
  );
}
