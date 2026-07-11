import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import { useVideoChunks } from '../../hooks/useVideoChunks';
import { useGlobalMute } from '../../hooks/useGlobalMute';
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
import { useChat } from '../../hooks/useChat';
import { useStreak } from '../../contexts/StreakContext';
import { useCall } from '../../contexts/CallContext';
import { NOTE_COLORS } from '../../hooks/useNotes';
import type { NoteColor, ChecklistItem } from '../../hooks/useNotes';
import { Plus, Search, MessageCircle, Heart, MessageSquare, Send, Bookmark, Volume2, VolumeX, Lock, Maximize2, Minimize2, Phone, Video, Trophy, Flame, Camera, Zap, Coffee } from 'lucide-react';

type MessageRow = Database['public']['Tables']['messages']['Row'];

interface FeedPostItem extends MessageRow {
  decryptedUrl?: string;
  decrypted_content?: string;
  loading?: boolean;
  failed?: boolean;
}

// ── Central Feed Decryption Queue (Memories-style) ─────────────────────────────
// Manages 8 parallel decryptions with look-ahead so posts are ready before scroll.
const MAX_FEED_CONCURRENT = 8;
const FEED_LOOK_AHEAD = 20;
const feedProcessingIds = new Set<string>();
const feedDecryptionQueue: string[] = [];

async function processFeedQueue(
  feedItemsRef: React.MutableRefObject<FeedPostItem[]>,
  setFeedItems: React.Dispatch<React.SetStateAction<FeedPostItem[]>>,
  getDecryptedBlob: any,
  partnerPublicKey: string
): Promise<void> {
  if (feedProcessingIds.size >= MAX_FEED_CONCURRENT) return;
  if (feedDecryptionQueue.length === 0) return;

  const nextId = feedDecryptionQueue.find(id => !feedProcessingIds.has(id));
  if (!nextId) return;

  const item = feedItemsRef.current.find(m => m.id === nextId);
  if (!item || item.decryptedUrl || item.loading || item.failed) {
    const idx = feedDecryptionQueue.indexOf(nextId);
    if (idx !== -1) feedDecryptionQueue.splice(idx, 1);
    processFeedQueue(feedItemsRef, setFeedItems, getDecryptedBlob, partnerPublicKey);
    return;
  }

  // Skip chunked videos — they use a different loading path
  const isChunked = item.type === 'video' && !item.media_url;
  if (isChunked || !item.media_url || !item.media_key || !item.media_nonce) {
    const idx = feedDecryptionQueue.indexOf(nextId);
    if (idx !== -1) feedDecryptionQueue.splice(idx, 1);
    processFeedQueue(feedItemsRef, setFeedItems, getDecryptedBlob, partnerPublicKey);
    return;
  }

  feedProcessingIds.add(nextId);
  setFeedItems(prev => prev.map(m => m.id === nextId ? { ...m, loading: true } : m));

  try {
    const blob = await getDecryptedBlob(
      item.media_url!,
      item.media_key!,
      item.media_nonce!,
      partnerPublicKey,
      item.sender_public_key
    );
    if (blob) {
      const url = URL.createObjectURL(blob);
      setFeedItems(prev => prev.map(m => m.id === nextId ? { ...m, decryptedUrl: url, loading: false } : m));
    } else {
      setFeedItems(prev => prev.map(m => m.id === nextId ? { ...m, loading: false, failed: true } : m));
    }
  } catch {
    setFeedItems(prev => prev.map(m => m.id === nextId ? { ...m, loading: false, failed: true } : m));
  } finally {
    feedProcessingIds.delete(nextId);
    const idx = feedDecryptionQueue.indexOf(nextId);
    if (idx !== -1) feedDecryptionQueue.splice(idx, 1);
    processFeedQueue(feedItemsRef, setFeedItems, getDecryptedBlob, partnerPublicKey);
  }
}

import type { Tab } from '../../types';

// Helper to strip HTML tags for plain text card previews
const getPlainText = (html: string) => {
  if (!html) return '';
  let text = html
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, ' • ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<h1>/gi, '\n')
    .replace(/<\/h1>/gi, '\n')
    .replace(/<h2>/gi, '\n')
    .replace(/<\/h2>/gi, '\n')
    .replace(/<h3>/gi, '\n')
    .replace(/<\/h3>/gi, '\n');
  
  text = text.replace(/<[^>]*>/g, '');
  
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
};

interface HomeScreenProps {
  onTabChange: (tab: Tab) => void;
  partner?: any;
}

export default function HomeScreen({ onTabChange, partner: livePartner }: HomeScreenProps) {
  const { user } = useAuth();
  const { partner: dbPartner } = usePartner();
  const partner = livePartner || dbPartner;
  const { getDecryptedBlob } = useMedia();
  const isNative = Capacitor.isNativePlatform();

  const [isMobileGrid, setIsMobileGrid] = useState(() => {
    return typeof window !== 'undefined' ? window.innerWidth < 768 : false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobileGrid(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const userId = user?.id;
  const partnerId = partner?.id;

  // Direct chat widget state for sending nudges
  const {
    sendMessage: sendChatMessage
  } = useChat(
    partner?.id,
    partner?.public_key,
    partner?.key_history?.map((h: any) => h.public_key)
  );

  const { streakCount, longestStreak, streakAtRisk, mySnappedToday, partnerSnappedToday } = useStreak();
  const { initiateCall } = useCall();
  const [totalMediaCount, setTotalMediaCount] = useState<number | null>(null);
  const [sharedNotes, setSharedNotes] = useState<any[]>([]);

  // Fetch total media shared in the vault
  useEffect(() => {
    if (!userId || !partnerId) return;
    supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .or(`sender_id.eq.${userId},sender_id.eq.${partnerId}`)
      .in('type', ['image', 'video'])
      .then(({ count }) => {
        if (count !== null) setTotalMediaCount(count);
      });
  }, [userId, partnerId]);

  // Fetch dashboard notes
  useEffect(() => {
    if (!userId) return;
    const fetchNotes = async () => {
      try {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .eq('couple_id', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
          .eq('is_trashed', false)
          .order('is_pinned', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(2);
        if (!error && data) {
          setSharedNotes(data);
        }
      } catch (err) {
        console.error('Error fetching dashboard notes:', err);
      }
    };
    fetchNotes();

    const channel = supabase
      .channel('dashboard-notes-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes', filter: 'couple_id=eq.aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        () => {
          fetchNotes();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const sendNudge = async (nudgeText: string) => {
    if (!partner?.id) return;
    const toastId = toast.loading(`Sending "${nudgeText}"...`);
    try {
      await sendChatMessage(nudgeText);
      toast.success('Sent to chat! 💖', { id: toastId });
    } catch (error) {
      console.error('Failed to send nudge:', error);
      toast.error('Failed to send nudge', { id: toastId });
    }
  };

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

  // ── Central feed decryption queue refs ────────────────────────────────────
  const feedItemsRef = useRef<FeedPostItem[]>([]);
  const [visibleFeedIds, setVisibleFeedIds] = useState<Set<string>>(new Set());
  const feedObserverRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => { feedItemsRef.current = feedItems; }, [feedItems]);

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
          } catch { }
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
          } catch { }
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

  // ── Kick off central decryption queue whenever feed items or visibility change ──
  useEffect(() => {
    const partnerKey = partner?.public_key;
    if (!partnerKey || feedItems.length === 0) return;

    const undecrypted = feedItems.filter(
      m => !m.decryptedUrl && !m.loading && !m.failed
        && !(m.type === 'video' && !m.media_url) // skip chunked
        && m.media_url && m.media_key && m.media_nonce
    );
    if (undecrypted.length === 0) return;

    // Sort: visible items first, then look-ahead
    const visibleIndices = Array.from(visibleFeedIds)
      .map(id => feedItems.findIndex(m => m.id === id))
      .filter(i => i !== -1);
    const maxVisibleIdx = visibleIndices.length > 0 ? Math.max(...visibleIndices) : -1;

    const sorted = [...undecrypted].sort((a, b) => {
      const aIdx = feedItems.findIndex(m => m.id === a.id);
      const bIdx = feedItems.findIndex(m => m.id === b.id);
      const aVisible = visibleFeedIds.has(a.id);
      const bVisible = visibleFeedIds.has(b.id);
      if (aVisible && !bVisible) return -1;
      if (!aVisible && bVisible) return 1;
      const aAhead = aIdx > maxVisibleIdx && aIdx <= maxVisibleIdx + FEED_LOOK_AHEAD;
      const bAhead = bIdx > maxVisibleIdx && bIdx <= maxVisibleIdx + FEED_LOOK_AHEAD;
      if (aAhead && !bAhead) return -1;
      if (!aAhead && bAhead) return 1;
      return aIdx - bIdx;
    });

    // Rebuild queue without losing in-progress items
    feedDecryptionQueue.length = 0;
    sorted.forEach(m => feedDecryptionQueue.push(m.id));

    // Kick off workers up to max concurrency
    for (let i = 0; i < MAX_FEED_CONCURRENT; i++) {
      processFeedQueue(feedItemsRef, setFeedItems, getDecryptedBlob, partnerKey);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedItems.length, visibleFeedIds, partner?.public_key]);

  // ── IntersectionObserver for feed visibility tracking (1500px lookahead) ──
  useEffect(() => {
    feedObserverRef.current = new IntersectionObserver((entries) => {
      setVisibleFeedIds(prev => {
        const next = new Set(prev);
        entries.forEach(entry => {
          const id = entry.target.getAttribute('data-feed-id');
          if (!id) return;
          if (entry.isIntersecting) next.add(id);
          else next.delete(id);
        });
        return next;
      });
    }, { rootMargin: '1500px', threshold: 0.01 });

    return () => feedObserverRef.current?.disconnect();
  }, []);

  const feedCardRef = useCallback((node: HTMLDivElement | null) => {
    if (node && feedObserverRef.current) {
      feedObserverRef.current.observe(node);
    }
  }, []);

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
      <header className={`relative z-30 bg-[var(--bg-primary)]/80 backdrop-blur-md px-4 py-2 grid grid-cols-3 items-center border-b border-white/5 ${isNative ? 'safe-top' : ''}`}>
        {/* Left Side: Upload Reel Button */}
        <div className="flex justify-start">
          <button
            onClick={() => onTabChange('upload-reel')}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
            title="Upload Reel"
          >
            <Plus className="w-5 h-5" />
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
            <Search className="w-5 h-5" />
          </button>
          <button
            onClick={() => onTabChange('chat')}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white/70 active:scale-95 transition-transform lg:hidden"
          >
            <MessageCircle className="w-5 h-5" />
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
            ) : isMobileGrid ? (
              <div className="space-y-6">
                {feedItems.map((item) => (
                  <FeedPost
                    key={item.id}
                    item={item}
                    partnerPublicKey={partner?.public_key || ''}
                    getDecryptedBlob={getDecryptedBlob}
                    preDecryptedUrl={item.decryptedUrl}
                    isLoading={item.loading}
                    isLiked={favorites.has(item.id)}
                    onLikeToggle={() => toggleFavorite(item.id)}
                    isSaved={savedItems.has(item.id)}
                    onSaveToggle={() => toggleSaved(item.id)}
                    observerRef={feedCardRef}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-6 items-start">
                <div className="flex flex-col gap-6">
                  {feedItems.filter((_, idx) => idx % 2 === 0).map((item) => (
                    <FeedPost
                      key={item.id}
                      item={item}
                      partnerPublicKey={partner?.public_key || ''}
                      getDecryptedBlob={getDecryptedBlob}
                      preDecryptedUrl={item.decryptedUrl}
                      isLoading={item.loading}
                      isLiked={favorites.has(item.id)}
                      onLikeToggle={() => toggleFavorite(item.id)}
                      isSaved={savedItems.has(item.id)}
                      onSaveToggle={() => toggleSaved(item.id)}
                      observerRef={feedCardRef}
                    />
                  ))}
                </div>
                <div className="flex flex-col gap-6">
                  {feedItems.filter((_, idx) => idx % 2 === 1).map((item) => (
                    <FeedPost
                      key={item.id}
                      item={item}
                      partnerPublicKey={partner?.public_key || ''}
                      getDecryptedBlob={getDecryptedBlob}
                      preDecryptedUrl={item.decryptedUrl}
                      isLoading={item.loading}
                      isLiked={favorites.has(item.id)}
                      onLikeToggle={() => toggleFavorite(item.id)}
                      isSaved={savedItems.has(item.id)}
                      onSaveToggle={() => toggleSaved(item.id)}
                      observerRef={feedCardRef}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <aside className="hidden lg:flex flex-col sticky top-[73px] h-[calc(100vh-105px)] max-h-[calc(100vh-105px)] overflow-y-auto scrollbar-hide w-full bg-[var(--bg-secondary)] border border-white/5 rounded-3xl shadow-xl flex-none p-6 space-y-6">
          {/* Partner Identity Header */}
          {partner && (
            <div className="flex flex-col items-center text-center pb-6 border-b border-white/5 space-y-4">
              {/* Pulsing Avatar Container */}
              <div 
                className="relative cursor-pointer hover:opacity-90 active:scale-95 transition-all group"
                onClick={() => {
                  document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                  document.dispatchEvent(new CustomEvent('view-partner-profile'));
                }}
              >
                {/* Glowing ring */}
                <div className={`absolute -inset-1 rounded-full blur-md opacity-40 group-hover:opacity-70 transition-all ${partner.is_online ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></div>
                <div className={`relative w-20 h-20 rounded-full p-0.5 border-2 ${partner.is_online ? 'border-emerald-500/70' : 'border-amber-500/40'} overflow-hidden`}>
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
                  <span className="absolute bottom-1 right-1 w-4 h-4 bg-emerald-500 border-2 border-[var(--bg-secondary)] rounded-full shadow-lg"></span>
                )}
              </div>

              {/* Identity details */}
              <div>
                <h3
                  className="font-serif italic text-lg text-white hover:underline cursor-pointer"
                  onClick={() => {
                    document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                    document.dispatchEvent(new CustomEvent('view-partner-profile'));
                  }}
                >
                  {partner.display_name || 'Your Partner'}
                </h3>
                <div className="text-[10px] font-label uppercase tracking-widest text-white/40 flex items-center justify-center gap-1.5 mt-1">
                  <LastSeenStatus isOnline={partner.is_online} lastSeen={partner.last_seen} />
                </div>
              </div>

              {/* Call Controls */}
              <div className="flex items-center gap-3 w-full px-4">
                <button
                  onClick={() => initiateCall(false)}
                  className="flex-1 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-xs font-semibold tracking-wider flex items-center justify-center gap-2 active:scale-95 transition-all"
                  title="Voice Call"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Voice Call
                </button>
                <button
                  onClick={() => initiateCall(true)}
                  className="flex-1 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 text-sky-400 text-xs font-semibold tracking-wider flex items-center justify-center gap-2 active:scale-95 transition-all"
                  title="Video Call"
                >
                  <Video className="w-3.5 h-3.5" />
                  Video Call
                </button>
              </div>
            </div>
          )}

          {/* Together Statistics Dashboard */}
          <div className="space-y-4">
            <h4 className="font-serif italic text-sm text-[var(--gold)] tracking-wide">Together Space</h4>
            <div className="grid grid-cols-2 gap-3">
              {/* Active Streak Card */}
              <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-3 flex flex-col items-center justify-center text-center space-y-1 relative overflow-hidden group">
                <div className="absolute -right-2 -bottom-2 opacity-5 group-hover:scale-120 transition-transform">
                  <Flame className="w-12 h-12 text-[var(--gold)]" />
                </div>
                <Flame className={`w-5 h-5 text-orange-500 ${streakAtRisk ? 'animate-bounce' : ''}`} />
                <span className="text-lg font-bold text-white leading-tight">{streakCount} Days</span>
                <span className="text-[8px] uppercase tracking-wider text-white/40">
                  {streakAtRisk 
                    ? '⏳ At Risk!' 
                    : mySnappedToday && partnerSnappedToday
                      ? 'Safe Today! 🔥'
                      : mySnappedToday
                        ? 'Waiting for Partner'
                        : partnerSnappedToday
                          ? 'Waiting for You'
                          : 'Not Snapped Today'}
                </span>
              </div>

              {/* Longest Streak Card */}
              <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-3 flex flex-col items-center justify-center text-center space-y-1 relative overflow-hidden group">
                <div className="absolute -right-2 -bottom-2 opacity-5 group-hover:scale-120 transition-transform">
                  <Trophy className="w-12 h-12 text-[var(--gold)]" />
                </div>
                <Trophy className="w-5 h-5 text-[var(--gold)]" />
                <span className="text-lg font-bold text-white leading-tight">{longestStreak} Days</span>
                <span className="text-[8px] uppercase tracking-wider text-white/40">Best Record</span>
              </div>
            </div>

            {/* Total Shared Media Counter */}
            <div className="bg-white/[0.01] border border-white/5 rounded-2xl p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[var(--gold)]/10 flex items-center justify-center text-[var(--gold)]">
                  <Camera className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-wider text-white/40">Media Shared</span>
                  <span className="text-xs font-semibold text-white/90">E2E Vault Capsule</span>
                </div>
              </div>
              <span className="text-sm font-bold text-[var(--gold)] bg-[var(--gold)]/10 px-2.5 py-1 rounded-lg">
                {totalMediaCount !== null ? `${totalMediaCount} files` : 'Loading...'}
              </span>
            </div>
          </div>

          {/* Quick Love Nudges */}
          <div className="space-y-3">
            <h4 className="font-serif italic text-sm text-[var(--gold)] tracking-wide">Quick Nudges</h4>
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => sendNudge('❤️ sent a heart')}
                className="py-2.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-xl text-lg flex items-center justify-center active:scale-90 transition-transform"
                title="Send Heart"
              >
                ❤️
              </button>
              <button
                onClick={() => sendNudge('🤗 sent a hug')}
                className="py-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-xl text-lg flex items-center justify-center active:scale-90 transition-transform"
                title="Send Hug"
              >
                🤗
              </button>
              <button
                onClick={() => sendNudge('☕ sent a coffee request')}
                className="py-2.5 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/20 rounded-xl text-lg flex items-center justify-center active:scale-90 transition-transform"
                title="Send Coffee Request"
              >
                <Coffee className="w-5 h-5 text-yellow-500" />
              </button>
              <button
                onClick={() => sendNudge('⚡ sent a nudge')}
                className="py-2.5 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 rounded-xl text-lg flex items-center justify-center active:scale-90 transition-transform"
                title="Send Nudge"
              >
                <Zap className="w-5 h-5 text-sky-400 fill-sky-400" />
              </button>
            </div>
          </div>

          {/* Shared Note Board */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="font-serif italic text-sm text-[var(--gold)] tracking-wide">Shared Notepad</h4>
              <button
                onClick={() => {
                  document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'explore' }));
                  toast.info('Opening notes area under Search/Explore tab!');
                }}
                className="text-[9px] font-bold uppercase tracking-widest text-[var(--gold)] hover:underline"
              >
                Manage Notes
              </button>
            </div>

            {sharedNotes.length === 0 ? (
              <div className="border border-dashed border-white/5 rounded-2xl p-4 text-center text-white/30 text-[10px] bg-white/[0.01]">
                No active notes or checklists.
              </div>
            ) : (
              <div className="space-y-3">
                {sharedNotes.map((note) => {
                  const bgStyle = NOTE_COLORS[note.color as NoteColor] || NOTE_COLORS.default;
                  const hasChecklist = note.is_checklist && note.checklist?.length > 0;

                  return (
                    <div
                      key={note.id}
                      style={{ backgroundColor: bgStyle.bg, borderColor: bgStyle.border }}
                      className="border rounded-2xl p-3.5 space-y-2 text-left relative group overflow-hidden"
                    >
                      <h5 className="font-sans font-bold text-xs text-white truncate pr-4">
                        {note.title || 'Untitled Note'}
                      </h5>
                      
                      {hasChecklist ? (
                        <div className="space-y-1">
                          {note.checklist.slice(0, 3).map((item: ChecklistItem) => (
                            <div key={item.id} className="flex items-center gap-2 text-[10px] text-white/70">
                              <span className={`w-2 h-2 rounded-sm border ${item.checked ? 'bg-[var(--gold)] border-[var(--gold)]' : 'border-white/20'}`} />
                              <span className={item.checked ? 'line-through opacity-45' : ''}>{item.text}</span>
                            </div>
                          ))}
                          {note.checklist.length > 3 && (
                            <span className="text-[8px] text-white/30 block">+ {note.checklist.length - 3} more items</span>
                          )}
                        </div>
                      ) : (
                        <p className="text-[10px] text-white/60 line-clamp-3 leading-relaxed whitespace-pre-wrap">
                          {getPlainText(note.content)}
                        </p>
                      )}
                      
                      <div className="text-[7px] text-white/30 flex items-center justify-between pt-1">
                        <span>Updated {new Date(note.updated_at).toLocaleDateString()}</span>
                        {note.is_pinned && <span className="text-[var(--gold)]">★ Pinned</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
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
  preDecryptedUrl?: string;   // Passed by central queue if already decrypted
  isLoading?: boolean;        // Passed by central queue loading state
  observerRef?: (node: HTMLDivElement | null) => void; // For visibility tracking
  isLiked: boolean;
  onLikeToggle: () => void;
  isSaved: boolean;
  onSaveToggle: () => void;
}

function FeedPost({ item, partnerPublicKey, getDecryptedBlob, preDecryptedUrl, isLoading: externalLoading, observerRef, isLiked, onLikeToggle, isSaved, onSaveToggle }: FeedPostProps) {
  const { user } = useAuth();
  const { partner } = usePartner();
  // Use pre-decrypted URL from central queue if available, otherwise decrypt locally
  const [localDecryptedUrl, setLocalDecryptedUrl] = useState<string | null>(null);
  const decryptedUrl = preDecryptedUrl || localDecryptedUrl;
  const [loading, setLoading] = useState(false);
  const isLoadingState = externalLoading || loading;
  const [decryptionFailed, setDecryptionFailed] = useState(false);
  const [showOriginalRatio, setShowOriginalRatio] = useState(false);
  const [isTallMedia, setIsTallMedia] = useState(false);
  const postRef = useRef<HTMLDivElement>(null);
  const decryptedUrlRef = useRef<string | null>(null);
  // Guard: prevent double decrypt from StrictMode double-invoke
  const hasDecryptedRef = useRef(false);
  const tag = `[FeedPost][${item.id?.slice(0, 8)}]`;

  const { isMuted, toggleMute } = useGlobalMute();
  const [isPaused, setIsPaused] = useState(false);
  const [showStatusIcon, setShowStatusIcon] = useState<'play' | 'pause' | null>(null);
  const [showHeartBurst, setShowHeartBurst] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMediaTap = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('a') || target.closest('.no-pause-trigger')) {
      return;
    }

    if (clickTimeoutRef.current) {
      // Double click/tap detected (Like)
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      if (!isLiked) {
        onLikeToggle();
      }
      setShowHeartBurst(true);
      setTimeout(() => setShowHeartBurst(false), 800);
      navigator.vibrate?.([10, 30]);
    } else {
      // Start single click/tap timer
      clickTimeoutRef.current = setTimeout(() => {
        clickTimeoutRef.current = null;
        if (item.type === 'video' && videoRef.current) {
          const video = videoRef.current;
          if (video.paused) {
            video.play().catch(() => { });
            setIsPaused(false);
            setShowStatusIcon('play');
            setTimeout(() => setShowStatusIcon(null), 500);
          } else {
            video.pause();
            setIsPaused(true);
            setShowStatusIcon('pause');
            setTimeout(() => setShowStatusIcon(null), 500);
          }
        }
      }, 250);
    }
  };

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  const handleMediaLoad = (width: number, height: number) => {
    if (width > 0 && height > 0) {
      const ratio = height / width;
      // On desktop/tablet (2-column layout width >= 768), always show the original aspect ratio
      // to let cards size themselves dynamically and stack in a clean masonry/bento grid.
      // On mobile, show original ratio for all media. If it is tall media (> 2/3 ratio, i.e., ratio > 1.5),
      // we also mark it as tall media so the post header can overlay on the top side of the media.
      if (window.innerWidth >= 768) {
        setShowOriginalRatio(true);
      } else {
        setShowOriginalRatio(true);
        if (ratio > 1.5) {
          setIsTallMedia(true);
        }
      }
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

  // Play/pause video when active in viewport (non-desktop)
  useEffect(() => {
    if (item.type !== 'video' || !decryptedUrl) return;

    const isDesktop = window.innerWidth >= 1024;

    const observer = new IntersectionObserver(([entry]) => {
      const video = videoRef.current;
      if (!video) return;

      if (isDesktop) {
        // On desktop, if it goes out of viewport, always pause it
        if (!entry.isIntersecting) {
          video.pause();
          setIsPaused(true);
        }
        return;
      }

      if (entry.isIntersecting) {
        if (!isPaused) {
          video.play().catch(() => { });
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
      setLocalDecryptedUrl(chunk.blobUrl);
      setLoading(false);
      hasDecryptedRef.current = true;
    }
  }, [isChunkedVideo, videoChunks]);

  // Clean up Object URL on unmount or item change
  useEffect(() => {
    setLocalDecryptedUrl(null);
    setLoading(false);
    setIsTallMedia(false);
    setShowOriginalRatio(false);
    hasDecryptedRef.current = false;
    return () => {
      if (decryptedUrlRef.current && !isChunkedVideo) {
        URL.revokeObjectURL(decryptedUrlRef.current);
        decryptedUrlRef.current = null;
      }
    };
  }, [item.id, item.media_url, isChunkedVideo]);

  // Handle decryption on viewport entry — only used as FALLBACK if central queue hasn't pre-decrypted yet
  useEffect(() => {
    // If central queue already provided a URL, skip local decryption entirely
    if (preDecryptedUrl) return;

    let active = true;

    // Chunked video path — always local (chunked videos not handled by central queue)
    if (isChunkedVideo) {
      if (!partnerPublicKey || !item.media_key || !item.media_nonce) {
        setDecryptionFailed(true);
        return;
      }

      const observer = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting || !active) return;
        if (hasDecryptedRef.current) { observer.disconnect(); return; }

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
          } catch (e) {
            console.error(`${tag} Chunked video load error`, e);
            if (active) { hasDecryptedRef.current = false; setDecryptionFailed(true); setLoading(false); }
          }
        })();

        observer.disconnect();
      }, { rootMargin: '1500px' });

      if (postRef.current) observer.observe(postRef.current);
      return () => { active = false; observer.disconnect(); };
    }

    // Regular media path — fallback if central queue missed this item
    if (!partnerPublicKey || !item.media_url || !item.media_key || !item.media_nonce) {
      setDecryptionFailed(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || !active) return;
      if (hasDecryptedRef.current || preDecryptedUrl) { observer.disconnect(); return; }

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
            setLocalDecryptedUrl(url);
            observer.disconnect();
          } else if (!blob) {
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
    }, { rootMargin: '1500px' });

    if (postRef.current) observer.observe(postRef.current);

    return () => { active = false; observer.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.media_url, item.media_key, item.media_nonce, partnerPublicKey, getDecryptedBlob, isChunkedVideo, preDecryptedUrl]);

  // Determine sender info
  const isMine = item.sender_id === user?.id;
  const senderName = isMine ? 'You' : (partner?.display_name || 'Partner');
  const avatarUrl = isMine ? user?.user_metadata?.avatar_url : partner?.avatar_url;
  const avatarKey = isMine ? user?.user_metadata?.avatar_key : partner?.avatar_key;
  const avatarNonce = isMine ? user?.user_metadata?.avatar_nonce : partner?.avatar_nonce;
  const placeholder = `https://ui-avatars.com/api/?name=${senderName}&background=c9a96e&color=13131b`;

  const handleMouseEnter = () => {
    if (window.innerWidth >= 1024 && item.type === 'video' && videoRef.current) {
      videoRef.current.play().catch(() => {});
      setIsPaused(false);
    }
  };

  const handleMouseLeave = () => {
    if (window.innerWidth >= 1024 && item.type === 'video' && videoRef.current) {
      videoRef.current.pause();
      setIsPaused(true);
    }
  };

  if (decryptionFailed && !preDecryptedUrl) return null;

  const overlayHeader = window.innerWidth < 768 && isTallMedia;

  return (
    <div
      ref={(node) => {
        (postRef as any).current = node;
        if (observerRef) observerRef(node);
      }}
      data-feed-id={item.id}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="bg-transparent border-none rounded-none shadow-none w-full flex flex-col mx-auto pb-6 border-b border-white/5 last:border-b-0 lg:bg-[var(--bg-secondary)] lg:border lg:border-white/5 lg:rounded-3xl lg:overflow-hidden lg:shadow-xl lg:w-full lg:h-auto lg:pb-0"
    >
      {/* Post Header */}
      {!overlayHeader && (
        <div className="py-3 px-0 lg:p-4 flex items-center justify-between flex-none">
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
        </div>
      )}

      {/* Post Media Container */}
      <div 
        onClick={handleMediaTap}
        className={`relative -mx-4 w-[calc(100%+2rem)] lg:mx-0 lg:w-full bg-black/40 flex items-center justify-center overflow-hidden border-y border-white/5 cursor-pointer ${
          showOriginalRatio && decryptedUrl ? 'aspect-auto h-auto flex-none' : 'aspect-[2/3] lg:aspect-[2/3] flex-1'
        }`}
      >
        {overlayHeader && decryptedUrl && (
          <div className="absolute top-0 left-0 right-0 z-30 py-3 px-4 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/30 to-transparent pointer-events-auto">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-full overflow-hidden border border-white/10 ${!isMine ? 'cursor-pointer hover:opacity-85 active:scale-95 transition-all' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
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
                  className={`text-xs font-bold text-white/95 drop-shadow-sm ${!isMine ? 'cursor-pointer hover:underline' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isMine) {
                      document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                      document.dispatchEvent(new CustomEvent('view-partner-profile'));
                    }
                  }}
                >
                  {senderName}
                </h4>
                <p className="text-[10px] text-white/70 drop-shadow-sm">
                  {new Date(item.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>
            </div>
          </div>
        )}
        {isLoadingState ? (
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 border-2 border-[var(--gold)]/20 border-t-[var(--gold)] rounded-full animate-spin"></div>
            <span className="text-[10px] uppercase tracking-widest text-white/30">Decrypting...</span>
          </div>
        ) : decryptedUrl ? (
          item.type === 'video' ? (
            <div className="relative w-full h-full flex items-center justify-center">
              <video
                ref={videoRef}
                src={decryptedUrl}
                className={`w-full ${showOriginalRatio ? 'h-auto object-contain' : 'h-full object-cover'}`}
                loop
                playsInline
                preload="metadata"
                muted={isMuted}
                onLoadedMetadata={(e) => {
                  const video = e.currentTarget;
                  handleMediaLoad(video.videoWidth, video.videoHeight);
                }}
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
                {isMuted ? <VolumeX className="w-4 h-4 text-white" /> : <Volume2 className="w-4 h-4 text-white" />}
              </button>
            </div>
          ) : (
            <img
              src={decryptedUrl}
              alt="Post media"
              className={`w-full ${showOriginalRatio ? 'h-auto object-contain' : 'h-full object-cover'}`}
              onLoad={(e) => {
                const img = e.currentTarget;
                handleMediaLoad(img.naturalWidth, img.naturalHeight);
              }}
            />
          )
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-white/20">
            <Lock className="w-8 h-8 animate-pulse" />
            <span className="text-[9px] uppercase tracking-widest font-bold">Securely Encrypted</span>
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

      {/* Post Actions Bar */}
      <div className="py-3 px-0 lg:p-4 flex items-center justify-between flex-none">
        <div className="flex items-center gap-4">
          <button
            onClick={onLikeToggle}
            className={`flex items-center justify-center transition-all active:scale-75 ${isLiked ? 'text-rose-500 scale-110' : 'text-white/60 hover:text-white hover:scale-110'}`}
          >
            <Heart className={`w-6 h-6 transition-all duration-300 ${isLiked ? 'fill-rose-500 stroke-rose-500' : 'stroke-current'}`} />
          </button>
          <span className="text-white/60 hover:text-white cursor-pointer hover:scale-110 transition-transform">
            <MessageSquare className="w-6 h-6" />
          </span>
          <button
            onClick={handleSharePost}
            className="flex items-center justify-center transition-all active:scale-75 text-white/60 hover:text-white cursor-pointer hover:scale-110"
            title="Share to chat"
          >
            <Send className="w-6 h-6" />
          </button>
          <button
            onClick={() => setShowOriginalRatio(!showOriginalRatio)}
            className={`flex items-center justify-center transition-all active:scale-75 ${
              showOriginalRatio ? 'text-[var(--gold)] scale-110' : 'text-white/60 hover:text-white hover:scale-110'
            }`}
            title={showOriginalRatio ? "Crop to fit (2:3)" : "Original ratio"}
          >
            {showOriginalRatio ? <Minimize2 className="w-6 h-6" /> : <Maximize2 className="w-6 h-6" />}
          </button>
        </div>
        <button
          onClick={onSaveToggle}
          className={`flex items-center justify-center transition-all active:scale-75 ${isSaved ? 'text-[var(--gold)] scale-110' : 'text-white/60 hover:text-white hover:scale-110'}`}
          title="Save post"
        >
          <Bookmark className={`w-6 h-6 transition-all duration-300 ${isSaved ? 'fill-[var(--gold)] stroke-[var(--gold)]' : 'stroke-current'}`} />
        </button>
      </div>
    </div>
  );
}
