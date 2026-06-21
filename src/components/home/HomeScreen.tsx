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
import { Plus, Search, MessageCircle, Heart, MessageSquare, Send, Bookmark, Volume2, VolumeX, Lock, Maximize2, Minimize2 } from 'lucide-react';

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
  const isNative = Capacitor.isNativePlatform();

  // Direct chat widget state
  const {
    messages: chatMessages,
    sendMessage: sendChatMessage,
    loading: chatLoading
  } = useChat(
    partner?.id,
    partner?.public_key,
    partner?.key_history?.map((h: any) => h.public_key)
  );

  const [chatInput, setChatInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    try {
      await sendChatMessage(chatInput.trim());
      setChatInput('');
    } catch (error) {
      console.error('Failed to send direct message:', error);
      toast.error('Failed to send message');
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
        <aside className="hidden lg:flex flex-col sticky top-[73px] h-[calc(100vh-105px)] max-h-[calc(100vh-105px)] overflow-hidden w-full bg-[var(--bg-secondary)] border border-white/5 rounded-3xl shadow-xl flex-none">
          {/* Combined Header: Partner Profile Only */}
          {partner && (
            <div className="p-4 border-b border-white/5 flex items-center gap-3 bg-white/[0.01] flex-none">
              <div
                className={`w-10 h-10 rounded-full p-0.5 border-2 ${partner.is_online ? 'border-emerald-500/70 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'border-white/10'} overflow-hidden cursor-pointer hover:opacity-85 active:scale-95 transition-all`}
                onClick={() => {
                  document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                  document.dispatchEvent(new CustomEvent('view-partner-profile'));
                }}
              >
                <EncryptedImage
                  url={partner.avatar_url}
                  encryptionKey={partner.avatar_key}
                  nonce={partner.avatar_nonce}
                  alt={partner.display_name || 'Partner'}
                  className="w-full h-full object-cover rounded-full"
                  placeholder={`https://ui-avatars.com/api/?name=${partner.display_name || 'Partner'}&background=c9a96e&color=13131b`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  className="font-serif italic text-sm text-white cursor-pointer hover:underline truncate"
                  onClick={() => {
                    document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                    document.dispatchEvent(new CustomEvent('view-partner-profile'));
                  }}
                >
                  {partner.display_name || 'Your Partner'}
                </h3>
                <div className="text-[9px] font-label uppercase tracking-widest text-white/40 flex items-center gap-1.5 mt-0.5">
                  <LastSeenStatus isOnline={partner.is_online} lastSeen={partner.last_seen} />
                </div>
              </div>
            </div>
          )}

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 scrollbar-hide">
            {chatLoading ? (
              <div className="h-full flex flex-col items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-[var(--gold)]/20 border-t-[var(--gold)] rounded-full animate-spin"></div>
                <span className="text-[8px] uppercase tracking-widest text-white/30">Decrypting messages...</span>
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                <p className="text-[10px] text-white/30 italic font-medium">No messages yet. Say hi to your partner! 👋</p>
              </div>
            ) : (
              chatMessages.slice(-20).map((msg) => {
                const isMine = msg.sender_id === user?.id;
                const msgType = msg.type as string;
                const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                // Helper to render content type
                let contentNode = null;
                if (msg.is_deleted_for_everyone) {
                  contentNode = <span className="italic text-white/30">This message was deleted</span>;
                } else if (msgType === 'text') {
                  contentNode = <span>{msg.decrypted_content}</span>;
                } else if (msgType === 'image') {
                  contentNode = <span className="italic flex items-center gap-1">📷 Photo {msg.decrypted_content ? `• ${msg.decrypted_content}` : ''}</span>;
                } else if (msgType === 'video') {
                  contentNode = <span className="italic flex items-center gap-1">🎥 Video {msg.decrypted_content ? `• ${msg.decrypted_content}` : ''}</span>;
                } else if (msgType === 'sticker') {
                  contentNode = <span className="italic flex items-center gap-1">🖼️ Sticker</span>;
                } else if (msgType === 'audio') {
                  contentNode = <span className="italic flex items-center gap-1">🎵 Voice Note</span>;
                } else if (msgType === 'location') {
                  contentNode = <span className="italic flex items-center gap-1">📍 Location</span>;
                } else if (msgType === 'call_log') {
                  contentNode = <span className="italic flex items-center gap-1">📞 Call Log</span>;
                } else {
                  contentNode = <span>{msg.decrypted_content || '[Media Message]'}</span>;
                }

                // Render ticks for own messages
                let tickIcon = null;
                if (isMine && !msg.is_deleted_for_everyone) {
                  if (msg.is_read) {
                    tickIcon = (
                      <span className="material-symbols-outlined text-[12px] text-sky-500 font-bold ml-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>
                        done_all
                      </span>
                    );
                  } else if (msg.is_delivered) {
                    tickIcon = (
                      <span className="material-symbols-outlined text-[12px] text-black/40 font-bold ml-0.5">
                        done_all
                      </span>
                    );
                  } else {
                    tickIcon = (
                      <span className="material-symbols-outlined text-[12px] text-black/30 font-bold ml-0.5">
                        check
                      </span>
                    );
                  }
                }

                return (
                  <div key={msg.id} className={`flex w-full mb-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`relative max-w-[75%] px-4 py-2.5 flex flex-col gap-1 rounded-2xl ${isMine
                          ? 'rounded-tr-sm bg-[var(--gold)] text-[var(--bg-primary)] shadow-[0_4px_15px_rgba(201,169,110,0.15)]'
                          : 'rounded-tl-sm text-[#E4E1ED]'
                        }`}
                      style={
                        !isMine
                          ? {
                            background: 'rgba(19, 19, 30, 0.8)',
                            backdropFilter: 'blur(12px)',
                            WebkitBackdropFilter: 'blur(12px)',
                            border: '1px solid rgba(201, 169, 110, 0.08)',
                          }
                          : undefined
                      }
                    >
                      <div className="font-body text-xs whitespace-pre-wrap break-words leading-relaxed relative z-10">
                        {contentNode}
                      </div>
                      <div
                        className={`flex items-center justify-end gap-1 text-[9px] select-none mt-1 ${isMine ? 'text-[var(--bg-primary)]/60' : 'text-[#8A8799]'
                          }`}
                      >
                        <span>{time}</span>
                        {isMine && tickIcon}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Form */}
          <form onSubmit={handleSendChat} className="p-3 border-t border-white/5 flex gap-2 flex-none bg-white/[0.01]">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 bg-white/5 hover:bg-white/10 focus:bg-white/10 focus:ring-1 focus:ring-[var(--gold)]/30 text-white rounded-xl px-3 py-1.5 text-xs outline-none transition-all placeholder-white/30 border border-white/5"
            />
            <button
              type="submit"
              disabled={!chatInput.trim()}
              className="w-8 h-8 rounded-xl bg-[var(--gold)] text-black flex items-center justify-center hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:scale-100 disabled:hover:opacity-40 transition-all shadow-md shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
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
  const [showOriginalRatio, setShowOriginalRatio] = useState(false);
  const postRef = useRef<HTMLDivElement>(null);
  const decryptedUrlRef = useRef<string | null>(null);
  // Guard: prevent double decrypt from StrictMode double-invoke
  const hasDecryptedRef = useRef(false);
  const tag = `[FeedPost][${item.id?.slice(0, 8)}]`;

  const { isMuted, toggleMute } = useGlobalMute();
  const [isPaused, setIsPaused] = useState(false);
  const [showStatusIcon, setShowStatusIcon] = useState<'play' | 'pause' | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleVideoTap = () => {
    const video = videoRef.current;
    if (!video) return;

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
  };

  const handleMediaLoad = (width: number, height: number) => {
    if (window.innerWidth < 1024 && width > 0 && height > 0) {
      const ratio = height / width;
      if (ratio < 1.5) {
        setShowOriginalRatio(true);
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

  // Play/pause video when active in viewport
  useEffect(() => {
    if (item.type !== 'video' || !decryptedUrl) return;

    const observer = new IntersectionObserver(([entry]) => {
      const video = videoRef.current;
      if (!video) return;

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
      className="bg-transparent border-none rounded-none shadow-none w-full flex flex-col mx-auto pb-6 border-b border-white/5 last:border-b-0 lg:bg-[var(--bg-secondary)] lg:border lg:border-white/5 lg:rounded-3xl lg:overflow-hidden lg:shadow-xl lg:w-auto lg:h-[calc((100vh-57px)*0.85)] lg:max-h-[calc((100vh-57px)*0.85)] lg:aspect-[2/3] lg:pb-0"
    >
      {/* Post Header */}
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

      {/* Post Media Container */}
      <div className={`relative flex-1 -mx-4 w-[calc(100%+2rem)] lg:mx-0 lg:w-full bg-black/40 flex items-center justify-center overflow-hidden border-y border-white/5 ${
        showOriginalRatio && decryptedUrl ? 'aspect-auto h-auto' : 'aspect-[2/3] lg:aspect-auto'
      }`}>
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
