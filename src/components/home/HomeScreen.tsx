import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import StoryCircles from './StoryCircles';
import OnThisDayCard from '../memories/OnThisDayCard';
import MomentsCarousel from '../memories/MomentsCarousel';
import type { MomentGroup } from '../memories/MomentViewer';
import EncryptedImage from '../common/EncryptedImage';
import type { Database } from '../../integrations/supabase/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];

interface FeedPostItem extends MessageRow {
  decryptedUrl?: string;
  decrypted_content?: string;
  loading?: boolean;
}

interface HomeScreenProps {
  onTabChange: (tab: 'home' | 'reels' | 'chat' | 'explore' | 'profile') => void;
}

export default function HomeScreen({ onTabChange }: HomeScreenProps) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();
  const isNative = Capacitor.isNativePlatform();

  const [feedItems, setFeedItems] = useState<FeedPostItem[]>([]);
  const [throwbacks, setThrowbacks] = useState<FeedPostItem[]>([]);
  const [lastWeekRecap, setLastWeekRecap] = useState<FeedPostItem[]>([]);
  const [lastMonthRecap, setLastMonthRecap] = useState<FeedPostItem[]>([]);
  const [randomRecap, setRandomRecap] = useState<FeedPostItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: string } | null>(null);

  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);

  // Load favorites
  useEffect(() => {
    if (!user) return;
    const loadFavorites = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('favorited_message_ids')
          .eq('id', user.id)
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
  }, [user]);

  // Favorite toggle
  const toggleFavorite = async (id: string) => {
    if (!user) return;
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
        .eq('id', user.id)
        .then();
      return next;
    });
  };

  // Fetch feed items
  const fetchFeed = useCallback(async (page = 1) => {
    if (!user || !partner) return;
    if (page === 1) setLoading(true);

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or('type.eq.image,type.eq.video')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partner.id}),and(sender_id.eq.${partner.id},receiver_id.eq.${user.id})`)
        .order('created_at', { ascending: false })
        .range((page - 1) * 6, page * 6 - 1);

      if (error) throw error;

      const items = (data as FeedPostItem[]) || [];
      if (page === 1) {
        setFeedItems(items);
      } else {
        setFeedItems(prev => {
          const fresh = items.filter(item => !prev.some(p => p.id === item.id));
          return [...prev, ...fresh];
        });
      }
      hasMoreRef.current = items.length === 6;
    } catch (e) {
      console.error('Error fetching feed:', e);
    } finally {
      setLoading(false);
      loadingMoreRef.current = false;
    }
  }, [user, partner]);

  // Fetch Throwbacks and Recaps
  const fetchAuxiliaryData = useCallback(async () => {
    if (!user || !partner) return;
    try {
      const now = new Date();
      const month = now.getMonth() + 1;
      const day = now.getDate();

      // Throwbacks
      supabase.rpc('get_throwbacks', {
        u_id: user.id,
        p_id: partner.id,
        current_month: month,
        current_day: day,
        limit_count: 10
      }).then(({ data }) => {
        if (data) setThrowbacks(data as FeedPostItem[]);
      });

      // Recaps
      supabase.rpc('get_last_week_recap', { u_id: user.id, p_id: partner.id, limit_count: 10 }).then(({ data }) => {
        if (data) setLastWeekRecap(data as FeedPostItem[]);
      });
      supabase.rpc('get_last_month_recap', { u_id: user.id, p_id: partner.id, limit_count: 10 }).then(({ data }) => {
        if (data) setLastMonthRecap(data as FeedPostItem[]);
      });
      supabase.rpc('get_random_shuffle_recap', { u_id: user.id, p_id: partner.id, limit_count: 10 }).then(({ data }) => {
        if (data) setRandomRecap(data as FeedPostItem[]);
      });
    } catch (e) {
      console.error('Error fetching recaps/throwbacks:', e);
    }
  }, [user, partner]);

  useEffect(() => {
    fetchFeed(1);
    fetchAuxiliaryData();
  }, [fetchFeed, fetchAuxiliaryData]);

  // Infinite Scroll Sentinel
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 100) {
      if (hasMoreRef.current && !loadingMoreRef.current) {
        loadingMoreRef.current = true;
        pageRef.current += 1;
        fetchFeed(pageRef.current);
      }
    }
  };

  const handleOpenMedia = (url: string, type: string) => {
    setSelectedMedia({ url, type });
  };

  return (
    <div 
      onScroll={handleScroll}
      className="h-full w-full bg-[var(--bg-primary)] overflow-y-auto social-feed-scroll pb-24"
    >
      {/* Top Bar Header */}
      <header className={`sticky top-0 z-30 bg-[var(--bg-primary)]/80 backdrop-blur-md px-4 py-2 flex items-center justify-between border-b border-white/5 ${isNative ? 'safe-top' : ''}`}>
        <h1 className="font-serif italic text-2xl tracking-[0.1em] text-gradient-gold">AURA</h1>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onTabChange('explore')} 
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white/70 active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[22px]">search</span>
          </button>
          <button 
            onClick={() => onTabChange('chat')} 
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white/70 active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[22px]">forum</span>
          </button>
        </div>
      </header>

      {/* Stories horizontal row */}
      <StoryCircles />

      {/* Auxiliary Collections (Throwbacks & Recaps) */}
      <div className="px-4 py-6 space-y-6">
        {throwbacks.length > 0 && partner?.public_key && (
          <OnThisDayCard 
            throwbacks={throwbacks} 
            partnerPublicKey={partner.public_key} 
            onOpenMedia={handleOpenMedia} 
          />
        )}

        {partner?.public_key && (() => {
          const momentGroups: MomentGroup[] = [];
          if (randomRecap.length > 0) {
            momentGroups.push({
              id: 'random-shuffle',
              title: 'Daily Shuffle',
              badge: 'Random Shuffle',
              iconName: 'shuffle',
              accentColor: '#fb7185',
              items: randomRecap,
            });
          }
          if (lastWeekRecap.length > 0) {
            momentGroups.push({
              id: 'last-week',
              title: "This Week's Memories",
              badge: 'Last 7 Days',
              iconName: 'date_range',
              accentColor: '#a78bfa',
              items: lastWeekRecap,
            });
          }
          if (lastMonthRecap.length > 0) {
            const now = new Date();
            const lastMonthName = new Date(now.getFullYear(), now.getMonth() - 1, 1)
              .toLocaleDateString('en-US', { month: 'long' });
            momentGroups.push({
              id: 'last-month',
              title: `${lastMonthName} in Review`,
              badge: 'Last Month',
              iconName: 'calendar_month',
              accentColor: '#60a5fa',
              items: lastMonthRecap,
            });
          }
          if (momentGroups.length === 0) return null;
          return (
            <MomentsCarousel
              moments={momentGroups}
              partnerPublicKey={partner.public_key}
            />
          );
        })()}
      </div>

      {/* Vertical Feed */}
      <div className="px-4 pb-12 space-y-8">
        <h2 className="font-serif italic text-xl text-[var(--gold)] px-2">Recent Shared Feed</h2>
        
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-2 border-[var(--gold)]/20 border-t-[var(--gold)] rounded-full animate-spin"></div>
            <p className="text-xs font-label uppercase tracking-widest text-white/30">Loading your memories...</p>
          </div>
        ) : feedItems.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-white/5 rounded-3xl p-6 bg-white/[0.01]">
            <span className="material-symbols-outlined text-4xl text-white/20 mb-3">camera_roll</span>
            <p className="text-sm font-medium text-white/50">No photos or videos shared yet</p>
            <p className="text-xs text-white/30 mt-1">Send media in chat to see them in your shared feed.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {feedItems.map((item) => (
              <FeedPost 
                key={item.id} 
                item={item} 
                partnerPublicKey={partner?.public_key || ''} 
                getDecryptedBlob={getDecryptedBlob}
                isLiked={favorites.has(item.id)}
                onLikeToggle={() => toggleFavorite(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Fullscreen Video/Photo Viewer */}
      <AnimatePresence>
        {selectedMedia && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          >
            <button 
              onClick={() => setSelectedMedia(null)}
              className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            {selectedMedia.type === 'video' ? (
              <video src={selectedMedia.url} controls autoPlay className="max-w-full max-h-full rounded-2xl" />
            ) : (
              <img src={selectedMedia.url} alt="" className="max-w-full max-h-full rounded-2xl object-contain" />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface FeedPostProps {
  item: FeedPostItem;
  partnerPublicKey: string;
  getDecryptedBlob: any;
  isLiked: boolean;
  onLikeToggle: () => void;
}

function FeedPost({ item, partnerPublicKey, getDecryptedBlob, isLiked, onLikeToggle }: FeedPostProps) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [decryptionFailed, setDecryptionFailed] = useState(false);
  const postRef = useRef<HTMLDivElement>(null);
  const decryptedUrlRef = useRef<string | null>(null);
  // Guard: prevent double decrypt from StrictMode double-invoke
  const hasDecryptedRef = useRef(false);
  const tag = `[FeedPost][${item.id?.slice(0,8)}]`;

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

  // Handle decryption on viewport entry
  // NOTE: decryptedUrl intentionally NOT in dep array — it causes observer
  // teardown/recreate on every state change, preventing decryption from completing.
  useEffect(() => {
    let active = true;

    if (!partnerPublicKey || !item.media_url || !item.media_key || !item.media_nonce) {
      console.warn(`${tag} SKIP observer — missing fields`);
      setDecryptionFailed(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || !active) return;
      if (hasDecryptedRef.current) {
        observer.disconnect();
        return;
      }

      hasDecryptedRef.current = true;
      console.log(`${tag} VISIBLE → starting decrypt type=${item.type}`);

      const decrypt = async () => {
        setLoading(true);
        try {
          const blob = await getDecryptedBlob(
            item.media_url!,
            item.media_key!,
            item.media_nonce!,
            partnerPublicKey,
            item.sender_public_key
          );
          if (blob && active) {
            const url = URL.createObjectURL(blob);
            decryptedUrlRef.current = url;
            console.log(`${tag} SUCCESS → ${(blob.size/1024).toFixed(1)}KB`);
            setDecryptedUrl(url);
            observer.disconnect();
          } else if (!blob) {
            console.error(`${tag} FAILED — null blob`);
            hasDecryptedRef.current = false;
            setDecryptionFailed(true);
          }
        } catch (e) {
          console.error(`${tag} EXCEPTION`, e);
          hasDecryptedRef.current = false;
          setDecryptionFailed(true);
        } finally {
          if (active) setLoading(false);
        }
      };
      decrypt();
    }, { rootMargin: '200px' });

    if (postRef.current) {
      observer.observe(postRef.current);
    }

    return () => {
      active = false;
      observer.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.media_url, item.media_key, item.media_nonce, partnerPublicKey, getDecryptedBlob]);

  // Determine sender info
  const isMine = item.sender_id === user?.id;
  const senderName = isMine ? 'You' : (partner?.display_name || 'Partner');
  const avatarUrl = isMine ? user?.user_metadata?.avatar_url : partner?.avatar_url;
  const avatarKey = isMine ? user?.user_metadata?.avatar_key : partner?.avatar_key;
  const avatarNonce = isMine ? user?.user_metadata?.avatar_nonce : partner?.avatar_nonce;
  const placeholder = `https://ui-avatars.com/api/?name=${senderName}&background=c9a96e&color=13131b`;

  if (decryptionFailed) return null;

  return (
    <div 
      ref={postRef}
      className="bg-[var(--bg-secondary)] border border-white/5 rounded-3xl overflow-hidden shadow-xl"
    >
      {/* Post Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full overflow-hidden border border-white/10">
            <EncryptedImage 
              url={avatarUrl} 
              encryptionKey={avatarKey ? (typeof avatarKey === 'string' ? avatarKey : JSON.stringify(avatarKey)) : null}
              nonce={avatarNonce ? (typeof avatarNonce === 'string' ? avatarNonce : JSON.stringify(avatarNonce)) : null}
              alt={senderName} 
              className="w-full h-full object-cover" 
              placeholder={placeholder}
            />
          </div>
          <div>
            <h4 className="text-xs font-bold text-white/90">{senderName}</h4>
            <p className="text-[10px] text-white/40">
              {new Date(item.created_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
          </div>
        </div>
        <span className="material-symbols-outlined text-white/30 text-lg">more_horiz</span>
      </div>

      {/* Post Media Container */}
      <div className="relative aspect-square w-full bg-black/40 flex items-center justify-center overflow-hidden border-y border-white/5">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 border-2 border-[var(--gold)]/20 border-t-[var(--gold)] rounded-full animate-spin"></div>
            <span className="text-[10px] uppercase tracking-widest text-white/30">Decrypting...</span>
          </div>
        ) : decryptedUrl ? (
          item.type === 'video' ? (
            <video 
              src={decryptedUrl} 
              className="w-full h-full object-cover" 
              controls
              playsInline
              preload="metadata"
            />
          ) : (
            <img 
              src={decryptedUrl} 
              alt="Post media" 
              className="w-full h-full object-cover"
            />
          )
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-white/20">
            <span className="material-symbols-outlined text-3xl">lock</span>
            <span className="text-[9px] uppercase tracking-widest">Securely Encrypted</span>
          </div>
        )}
      </div>

      {/* Post Actions Bar */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={onLikeToggle}
            className={`flex items-center justify-center transition-all active:scale-75 ${isLiked ? 'text-rose-500 animate-heart-burst' : 'text-white/60 hover:text-white'}`}
          >
            <span className={`material-symbols-outlined text-2xl ${isLiked ? 'fill-current' : ''}`}>
              favorite
            </span>
          </button>
          <span className="material-symbols-outlined text-2xl text-white/60 hover:text-white cursor-pointer">
            chat_bubble
          </span>
          <span className="material-symbols-outlined text-2xl text-white/60 hover:text-white cursor-pointer rotate-[-15deg] translate-y-[-1px]">
            send
          </span>
        </div>
        <span className="material-symbols-outlined text-2xl text-white/60 hover:text-white cursor-pointer">
          bookmark
        </span>
      </div>
    </div>
  );
}
