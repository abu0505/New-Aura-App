import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import { useVideoChunks } from '../../hooks/useVideoChunks';
import { useGlobalMute } from '../../hooks/useGlobalMute';
import { useStreak } from '../../contexts/StreakContext';
import { useCall } from '../../contexts/CallContext';
import { LastSeenStatus } from '../chat/LastSeenStatus';
import StoryCircles from './StoryCircles';
import OnThisDayCard from '../memories/OnThisDayCard';
import MomentsCarousel from '../memories/MomentsCarousel';
import type { MomentGroup } from '../memories/MomentViewer';
import EncryptedImage from '../common/EncryptedImage';
import { buildReelQueue, filterDecryptableItems } from '../../utils/reelWeighting';
import { fetchDiverseMediaPool } from '../../utils/feedPool';
import { getPrefetchedFeed, clearPrefetchedFeed } from '../../contexts/AppLockContext';
import type { Database } from '../../integrations/supabase/types';
import { getStoredKeyPair, encodeBase64 } from '../../lib/encryption';
import { toast } from 'sonner';

type MessageRow = Database['public']['Tables']['messages']['Row'];

interface FeedPostItem extends MessageRow {
  decryptedUrl?: string;
  decrypted_content?: string;
  loading?: boolean;
}

import type { Tab } from '../../types';

interface HomeScreenProps {
  onTabChange: (tab: Tab) => void;
  partner?: any;
}

export default function HomeScreen({ onTabChange, partner: livePartner }: HomeScreenProps) {
  const { user } = useAuth();
  const { partner: dbPartner } = usePartner();
  const partner = livePartner || dbPartner;
  const { getDecryptedBlob } = useMedia();
  const { streakCount, streakAtRisk, longestStreak } = useStreak();
  const { initiateCall } = useCall();
  const isNative = Capacitor.isNativePlatform();

  const [feedItems, setFeedItems] = useState<FeedPostItem[]>([]);
  const [throwbacks, setThrowbacks] = useState<FeedPostItem[]>([]);
  const [lastWeekRecap, setLastWeekRecap] = useState<FeedPostItem[]>([]);
  const [lastMonthRecap, setLastMonthRecap] = useState<FeedPostItem[]>([]);
  const [randomRecap, setRandomRecap] = useState<FeedPostItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [savedItems, setSavedItems] = useState<Set<string>>(new Set());
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: string } | null>(null);

  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const seenVideoIds = useRef<string[]>([]);
  const seenImageIds = useRef<string[]>([]);
  const lastMarkedIndexRef = useRef(-1);

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

  // Load saved items
  useEffect(() => {
    if (!user) return;
    const loadSaved = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('saved_message_ids')
          .eq('id', user.id)
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

  // Saved toggle
  const toggleSaved = async (id: string) => {
    if (!user) return;
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
        .eq('id', user.id)
        .then();
      return next;
    });
  };

  const userId = user?.id;
  const partnerId = partner?.id;

  // Fetch feed items using weighted algorithm
  // We fetch a larger pool then apply weighted reservoir sampling so
  // reel uploads and old/video content appear more often in the home feed.
  const fetchFeed = useCallback(async (page = 1) => {
    if (!userId || !partnerId) return;
    if (page === 1) setLoading(true);

    try {
      if (page === 1) {
        let pool: FeedPostItem[] = [];

        // Check if we have pre-fetched data from AppLockContext
        const prefetchedPromise = getPrefetchedFeed();
        if (prefetchedPromise) {
          const data = await prefetchedPromise;
          pool = (data as FeedPostItem[]) || [];
          clearPrefetchedFeed(); // Clear so it doesn't get consumed again on manual refresh
        }

        // Fallback if prefetch wasn't started or returned empty
        if (pool.length === 0) {
          const data = await fetchDiverseMediaPool(userId, partnerId, {
            recentLimit: 30,
            middleLimit: 60,
            oldLimit: 60,
          });
          pool = (data as FeedPostItem[]) || [];
        }

        const decryptablePool = filterDecryptableItems(pool);
        // Apply same weighted algorithm as reels — reel uploads + old/video content surface higher
        const weighted = buildReelQueue(decryptablePool, 30);

        // Reset seen refs on page 1 load/refresh to allow clean paging
        seenVideoIds.current = [];
        seenImageIds.current = [];
        lastMarkedIndexRef.current = -1;

        setFeedItems(weighted);
        hasMoreRef.current = weighted.length > 0;
      } else {
        // Subsequent pages: stratified random sampling excluding already loaded IDs
        let excludeIds = [...seenVideoIds.current, ...seenImageIds.current];

        let pool = await fetchDiverseMediaPool(
          userId,
          partnerId,
          {
            recentLimit: 15,
            middleLimit: 30,
            oldLimit: 30,
          },
          excludeIds
        );

        let fetchedVideos = pool.filter(p => p.type === 'video');
        let fetchedImages = pool.filter(p => p.type !== 'video');

        // Check if we ran out of unseen videos or images based on our 40/30 minimum bounds
        const minVideos = 6;  // 40% of 15
        const minImages = 5;  // 30% of 15
        const needsVideoReset = fetchedVideos.length < minVideos && seenVideoIds.current.length > 0;
        const needsImageReset = fetchedImages.length < minImages && seenImageIds.current.length > 0;

        if (needsVideoReset || needsImageReset) {

          if (needsVideoReset) {
            const keepCount = Math.min(30, Math.floor(seenVideoIds.current.length * 0.5));
            seenVideoIds.current = seenVideoIds.current.slice(-keepCount);
          }
          if (needsImageReset) {
            const keepCount = Math.min(50, Math.floor(seenImageIds.current.length * 0.5));
            seenImageIds.current = seenImageIds.current.slice(-keepCount);
          }

          excludeIds = [...seenVideoIds.current, ...seenImageIds.current];
          pool = await fetchDiverseMediaPool(
            userId,
            partnerId,
            {
              recentLimit: 15,
              middleLimit: 30,
              oldLimit: 30,
            },
            excludeIds
          );
          fetchedVideos = pool.filter(p => p.type === 'video');
          fetchedImages = pool.filter(p => p.type !== 'video');
        }

        const decryptableItems = filterDecryptableItems(pool as FeedPostItem[]);
        const weighted = buildReelQueue(decryptableItems, 15);

        if (weighted.length > 0) {
          setFeedItems(prev => {
            const fresh = weighted.filter(item => !prev.some(p => p.id === item.id));
            return [...prev, ...fresh];
          });
        }
        hasMoreRef.current = weighted.length > 0;
      }
    } catch (e) {
      console.error('Error fetching feed:', e);
    } finally {
      setLoading(false);
      loadingMoreRef.current = false;
    }
  }, [userId, partnerId]);

  // Fetch Throwbacks and Recaps
  const fetchAuxiliaryData = useCallback(async () => {
    if (!userId || !partnerId) return;
    try {
      const now = new Date();
      const month = now.getMonth() + 1;
      const day = now.getDate();

      // Throwbacks
      supabase.rpc('get_throwbacks', {
        u_id: userId,
        p_id: partnerId,
        current_month: month,
        current_day: day,
        limit_count: 10
      }).then(({ data }) => {
        if (data) setThrowbacks(data as FeedPostItem[]);
      });

      // Recaps
      supabase.rpc('get_last_week_recap', { u_id: userId, p_id: partnerId, limit_count: 10 }).then(({ data }) => {
        if (data) setLastWeekRecap(data as FeedPostItem[]);
      });
      supabase.rpc('get_last_month_recap', { u_id: userId, p_id: partnerId, limit_count: 10 }).then(({ data }) => {
        if (data) setLastMonthRecap(data as FeedPostItem[]);
      });
      supabase.rpc('get_random_shuffle_recap', { u_id: userId, p_id: partnerId, limit_count: 10 }).then(({ data }) => {
        if (data) setRandomRecap(data as FeedPostItem[]);
      });
    } catch (e) {
      console.error('Error fetching recaps/throwbacks:', e);
    }
  }, [userId, partnerId]);

  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    fetchFeed(1);
    fetchAuxiliaryData();
  }, [fetchFeed, fetchAuxiliaryData]);

  // Mark the first loaded feed item as seen on initial load
  useEffect(() => {
    if (feedItems.length > 0 && lastMarkedIndexRef.current === -1) {
      const firstItem = feedItems[0];
      if (firstItem) {
        if (firstItem.type === 'video') {
          if (!seenVideoIds.current.includes(firstItem.id)) seenVideoIds.current.push(firstItem.id);
        } else {
          if (!seenImageIds.current.includes(firstItem.id)) seenImageIds.current.push(firstItem.id);
        }
        lastMarkedIndexRef.current = 0;
      }
    }
  }, [feedItems]);

  // Infinite Scroll Sentinel & Progressive Seen Tracking
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;

    // Estimate current visible index based on average post card height (~500px)
    const visibleIndex = Math.floor(target.scrollTop / 500);
    if (visibleIndex > lastMarkedIndexRef.current && visibleIndex < feedItems.length) {
      for (let i = lastMarkedIndexRef.current + 1; i <= visibleIndex; i++) {
        const item = feedItems[i];
        if (item) {
          if (item.type === 'video') {
            if (!seenVideoIds.current.includes(item.id)) {
              seenVideoIds.current.push(item.id);
            }
          } else {
            if (!seenImageIds.current.includes(item.id)) {
              seenImageIds.current.push(item.id);
            }
          }
        }
      }
      lastMarkedIndexRef.current = visibleIndex;
    }

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
      <header className={`sticky top-0 z-30 bg-[var(--bg-primary)]/80 backdrop-blur-md px-4 py-2 grid grid-cols-3 items-center border-b border-white/5 ${isNative ? 'safe-top' : ''}`}>
        {/* Left Side: Upload Reel Button */}
        <div className="flex justify-start">
          <button 
            onClick={() => onTabChange('upload-reel')} 
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
            title="Upload Reel"
          >
            <span className="material-symbols-outlined text-[24px]">add</span>
          </button>
        </div>

        {/* Center: Brand name */}
        <div className="flex justify-center">
          <h1 className="font-serif italic text-2xl tracking-[0.1em] text-gradient-gold">AURA</h1>
        </div>

        {/* Right Side: Quick Action buttons (Explore/Chat on Mobile) */}
        <div className="flex justify-end items-center gap-3">
          <button 
            onClick={() => onTabChange('explore')} 
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white/70 active:scale-95 transition-transform lg:hidden"
          >
            <span className="material-symbols-outlined text-[22px]">search</span>
          </button>
          <button 
            onClick={() => onTabChange('chat')} 
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white/70 active:scale-95 transition-transform lg:hidden"
          >
            <span className="material-symbols-outlined text-[22px]">forum</span>
          </button>
        </div>
      </header>

      {/* Main Grid Wrapper (Desktop Split View vs Mobile Stacking) */}
      <div className="w-full lg:max-w-6xl lg:mx-auto lg:px-6 lg:py-8 lg:grid lg:grid-cols-[minmax(0,_1fr)_320px] lg:gap-8 items-start">
        
        {/* Left Column: Feed Content */}
        <div className="space-y-6 lg:space-y-8">
          {/* Stories horizontal row */}
          <StoryCircles />

          {/* Auxiliary Collections (Throwbacks & Recaps) */}
          <div className="px-4 py-6 space-y-6 lg:px-0 lg:py-0">
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
          <div className="px-4 pb-12 space-y-8 lg:px-0 lg:pb-0">
            <h2 className="font-serif italic text-xl text-[var(--gold)] px-2 lg:px-0">Recent Shared Feed</h2>
            
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
                    isSaved={savedItems.has(item.id)}
                    onSaveToggle={() => toggleSaved(item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Desktop Sidebar (Hidden on Mobile) */}
        <aside className="hidden lg:flex flex-col gap-6 sticky top-24">
          
          {/* Partner Status Card */}
          {partner && (
            <div className="bg-[var(--bg-secondary)] border border-white/5 rounded-3xl p-6 flex flex-col items-center text-center relative overflow-hidden shadow-xl">
              <div 
                className="relative mb-4 cursor-pointer hover:opacity-85 active:scale-95 transition-all"
                onClick={() => {
                  document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                  document.dispatchEvent(new CustomEvent('view-partner-profile'));
                }}
              >
                <div className={`w-20 h-20 rounded-full p-1 border-2 ${partner.is_online ? 'border-emerald-500/70 shadow-[0_0_12px_rgba(16,185,129,0.3)]' : 'border-white/10'} overflow-hidden`}>
                  <EncryptedImage 
                    url={partner.avatar_url}
                    encryptionKey={partner.avatar_key}
                    nonce={partner.avatar_nonce}
                    alt={partner.display_name || 'Partner'}
                    className="w-full h-full object-cover rounded-full"
                    placeholder={`https://ui-avatars.com/api/?name=${partner.display_name || 'Partner'}&background=c9a96e&color=13131b`}
                  />
                </div>
                {partner.is_online && (
                  <div className="absolute bottom-0 right-1 w-4 h-4 bg-emerald-500 border-2 border-[var(--bg-secondary)] rounded-full animate-pulse"></div>
                )}
              </div>
              <h3 
                className="font-serif italic text-lg text-white mb-0.5 cursor-pointer hover:underline"
                onClick={() => {
                  document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                  document.dispatchEvent(new CustomEvent('view-partner-profile'));
                }}
              >
                {partner.display_name || 'Your Partner'}
              </h3>
              <p className="text-[10px] font-label uppercase tracking-widest text-white/40 flex items-center gap-1.5 justify-center">
                <LastSeenStatus isOnline={partner.is_online} lastSeen={partner.last_seen} />
              </p>
              {partner.status_message && (
                <p className="text-xs text-white/60 italic mt-3 px-4 border-t border-white/5 pt-3 w-full">
                  "{partner.status_message}"
                </p>
              )}
            </div>
          )}

          {/* Streak Card */}
          <div className="bg-[var(--bg-secondary)] border border-white/5 rounded-3xl p-6 flex flex-col items-center text-center shadow-xl">
            <div className="text-4xl mb-2 animate-bounce">🔥</div>
            <span className="text-2xl font-bold text-[var(--gold)] tracking-wide">{streakCount} Days</span>
            <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider mt-1">Current Streak</span>
            <div className="w-full h-px bg-white/5 my-4"></div>
            <div className="flex justify-between w-full text-xs text-white/50 px-2">
              <span>Longest: {longestStreak} days</span>
              {streakAtRisk && <span className="text-orange-400 font-bold">At Risk! ⏳</span>}
            </div>
          </div>

          {/* Quick Actions Card */}
          <div className="bg-[var(--bg-secondary)] border border-white/5 rounded-3xl p-6 flex flex-col gap-3 shadow-xl">
            <h4 className="text-[10px] uppercase font-bold text-white/40 tracking-widest mb-1 px-1">Quick Actions</h4>
            
            <button 
              onClick={() => onTabChange('chat')}
              className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 active:scale-98 transition-all px-4 py-3 rounded-2xl text-xs font-semibold text-white/90 border border-white/5"
            >
              <span className="flex items-center gap-3">
                <span className="material-symbols-outlined text-lg text-[var(--gold)]">forum</span>
                Open Chat
              </span>
              <span className="material-symbols-outlined text-sm text-white/30">chevron_right</span>
            </button>

            {partner && (
              <>
                <button 
                  onClick={() => initiateCall(false)}
                  className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 active:scale-98 transition-all px-4 py-3 rounded-2xl text-xs font-semibold text-white/90 border border-white/5"
                >
                  <span className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-lg text-emerald-400">call</span>
                    Voice Call
                  </span>
                  <span className="material-symbols-outlined text-sm text-white/30">chevron_right</span>
                </button>

                <button 
                  onClick={() => initiateCall(true)}
                  className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 active:scale-98 transition-all px-4 py-3 rounded-2xl text-xs font-semibold text-white/90 border border-white/5"
                >
                  <span className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-lg text-sky-400">videocam</span>
                    Video Call
                  </span>
                  <span className="material-symbols-outlined text-sm text-white/30">chevron_right</span>
                </button>
              </>
            )}
          </div>
        </aside>
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
  isSaved: boolean;
  onSaveToggle: () => void;
}

function FeedPost({ item, partnerPublicKey, getDecryptedBlob, isLiked, onLikeToggle, isSaved, onSaveToggle }: FeedPostProps) {
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

  const { isMuted, toggleMute } = useGlobalMute();
  const [isPaused, setIsPaused] = useState(false);
  const [showStatusIcon, setShowStatusIcon] = useState<'play' | 'pause' | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleVideoTap = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {});
      setIsPaused(false);
      setShowStatusIcon('play');
      setTimeout(() => setShowStatusIcon(null), 500);
    } else {
      video.pause();
      setIsPaused(true);
      setShowStatusIcon('pause');
      setTimeout(() => setShowStatusIcon(null), 500);
    }
  };

  const handleSharePost = async () => {
    if (!user || !partner) return;
    const toastId = toast.loading('Sharing post to chat...');
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

      toast.success('Post shared to chat! 💬', { id: toastId });
    } catch (err: any) {
      console.error('Error sharing post:', err);
      toast.error(err.message || 'Failed to share post', { id: toastId });
    }
  };

  // Play/pause video when active in viewport
  useEffect(() => {
    if (item.type !== 'video' || !decryptedUrl) return;

    const observer = new IntersectionObserver(([entry]) => {
      const video = videoRef.current;
      if (!video) return;

      if (entry.isIntersecting) {
        if (!isPaused) {
          video.play().catch(() => {});
        }
      } else {
        video.pause();
      }
    }, {
      threshold: 0.5
    });

    if (postRef.current) {
      observer.observe(postRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [item.type, decryptedUrl, isPaused]);

  // Detect chunked video: type=video but no media_url
  const isChunkedVideo = item.type === 'video' && !item.media_url;

  // Hook for chunked video assembly
  const { chunks: videoChunks, loadExistingChunks } = useVideoChunks(isChunkedVideo ? item.id : undefined);

  // Pick up blobUrl from useVideoChunks store when chunked video is ready
  useEffect(() => {
    if (!isChunkedVideo || !videoChunks?.length) return;
    const chunk = videoChunks[0];
    if (chunk?.blobUrl && chunk.isDecrypted) {
      setDecryptedUrl(chunk.blobUrl);
      setLoading(false);
      hasDecryptedRef.current = true;
    }
  }, [isChunkedVideo, videoChunks]);

  // Clean up Object URL on unmount or item change
  useEffect(() => {
    setDecryptedUrl(null);
    setLoading(false);
    hasDecryptedRef.current = false;
    return () => {
      if (decryptedUrlRef.current && !isChunkedVideo) {
        URL.revokeObjectURL(decryptedUrlRef.current);
        decryptedUrlRef.current = null;
      }
    };
  }, [item.id, item.media_url, isChunkedVideo]);

  // Handle decryption on viewport entry
  useEffect(() => {
    let active = true;

    // Chunked video path
    if (isChunkedVideo) {
      if (!partnerPublicKey || !item.media_key || !item.media_nonce) {
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
            // useEffect watching videoChunks will pick up the blobUrl
          } catch (e) {
            console.error(`${tag} Chunked video load error`, e);
            if (active) {
              hasDecryptedRef.current = false;
              setDecryptionFailed(true);
              setLoading(false);
            }
          }
        })();

        observer.disconnect();
      }, { rootMargin: '600px' });

      if (postRef.current) observer.observe(postRef.current);
      return () => { active = false; observer.disconnect(); };
    }

    // Regular media path
    if (!partnerPublicKey || !item.media_url || !item.media_key || !item.media_nonce) {
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
    }, { rootMargin: '600px' });

    if (postRef.current) {
      observer.observe(postRef.current);
    }

    return () => {
      active = false;
      observer.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.media_url, item.media_key, item.media_nonce, partnerPublicKey, getDecryptedBlob, isChunkedVideo]);

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
      className="bg-[var(--bg-secondary)] border border-white/5 rounded-3xl overflow-hidden shadow-xl aspect-[9/16] w-full flex flex-col"
    >
      {/* Post Header */}
      <div className="p-4 flex items-center justify-between flex-none">
        <div className="flex items-center gap-3">
          <div 
            className={`w-9 h-9 rounded-full overflow-hidden border border-white/10 ${!isMine ? 'cursor-pointer hover:opacity-85 active:scale-95 transition-all' : ''}`}
            onClick={() => {
              if (!isMine) {
                document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                document.dispatchEvent(new CustomEvent('view-partner-profile'));
              }
            }}
          >
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
            <h4 
              className={`text-xs font-bold text-white/90 ${!isMine ? 'cursor-pointer hover:underline' : ''}`}
              onClick={() => {
                if (!isMine) {
                  document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                  document.dispatchEvent(new CustomEvent('view-partner-profile'));
                }
              }}
            >
              {senderName}
            </h4>
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
      <div className="relative flex-1 w-full bg-black/40 flex items-center justify-center overflow-hidden border-y border-white/5">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 border-2 border-[var(--gold)]/20 border-t-[var(--gold)] rounded-full animate-spin"></div>
            <span className="text-[10px] uppercase tracking-widest text-white/30">Decrypting...</span>
          </div>
        ) : decryptedUrl ? (
          item.type === 'video' ? (
            <div 
              className="relative w-full h-full cursor-pointer flex items-center justify-center"
              onClick={handleVideoTap}
            >
              <video 
                ref={videoRef}
                src={decryptedUrl} 
                className="w-full h-full object-cover" 
                loop
                playsInline
                preload="metadata"
                muted={isMuted}
              />
              
              {/* Play overlay when paused */}
              {isPaused && !showStatusIcon && (
                <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white"
                  >
                    <span className="material-symbols-outlined text-2xl">play_arrow</span>
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
                    <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center text-white">
                      <span className="material-symbols-outlined text-2xl">
                        {showStatusIcon === 'play' ? 'play_arrow' : 'pause'}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Floating Mute Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute();
                }}
                className="absolute bottom-3 right-3 z-30 w-9 h-9 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center border border-white/10 text-white active:scale-90 transition-transform"
              >
                <span className="material-symbols-outlined text-lg">
                  {isMuted ? 'volume_off' : 'volume_up'}
                </span>
              </button>
            </div>
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
      <div className="p-4 flex items-center justify-between flex-none">
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
          <button 
            onClick={handleSharePost}
            className="flex items-center justify-center transition-all active:scale-75 text-white/60 hover:text-white cursor-pointer rotate-[-15deg] translate-y-[-1px]"
            title="Share to chat"
          >
            <span className="material-symbols-outlined text-2xl">
              send
            </span>
          </button>
        </div>
        <button 
          onClick={onSaveToggle}
          className={`flex items-center justify-center transition-all active:scale-75 ${isSaved ? 'text-[var(--gold)]' : 'text-white/60 hover:text-white'}`}
          title="Save post"
        >
          <span className={`material-symbols-outlined text-2xl ${isSaved ? 'fill-current' : ''}`}>
            bookmark
          </span>
        </button>
      </div>
    </div>
  );
}
