import { useState, useEffect, useLayoutEffect, useRef, lazy, Suspense, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import { useStreak } from '../../contexts/StreakContext';
import { useVideoChunks } from '../../hooks/useVideoChunks';
import { toast } from 'sonner';
import EncryptedImage from '../common/EncryptedImage';
import { ReelCard } from '../reels/ReelsScreen';

const SettingsScreen = lazy(() => import('../settings/SettingsScreen'));

interface ProfilePostItem {
  id: string;
  media_url: string | null;
  media_key: string | null;
  media_nonce: string | null;
  sender_public_key: string | null;
  type: string;
  created_at: string;
  decryptedUrl?: string;
  loading?: boolean;
  sender_id: string;
  receiver_id: string;
  thumbnail_url?: string | null;
  is_reel_upload?: boolean;
}

export default function ProfileScreen() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();
  const { streakCount } = useStreak();

  const [viewMode, setViewMode] = useState<'profile' | 'settings'>('profile');
  const [posts, setPosts] = useState<ProfilePostItem[]>([]);
  const [likedItems, setLikedItems] = useState<ProfilePostItem[]>([]);
  const [savedItems, setSavedItems] = useState<ProfilePostItem[]>([]);
  const [activeTab, setActiveTab] = useState<'posts' | 'liked' | 'saved'>('posts');
  const [profileOwner, setProfileOwner] = useState<'me' | 'partner'>('me');
  const [partnerPosts, setPartnerPosts] = useState<ProfilePostItem[]>([]);
  const [partnerLikedItems, setPartnerLikedItems] = useState<ProfilePostItem[]>([]);
  const [partnerSavedItems, setPartnerSavedItems] = useState<ProfilePostItem[]>([]);
  const [partnerStats, setPartnerStats] = useState({ posts: 0, notes: 0 });
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ posts: 0, notes: 0 });
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [updatingName, setUpdatingName] = useState(false);

  // Reel Swiper Viewer State
  const [activeReelIndex, setActiveReelIndex] = useState<number | null>(null);
  const [reelViewerItems, setReelViewerItems] = useState<ProfilePostItem[]>([]);
  const [likedIdsSet, setLikedIdsSet] = useState<Set<string>>(new Set());
  const [savedIdsSet, setSavedIdsSet] = useState<Set<string>>(new Set());
  const reelContainerRef = useRef<HTMLDivElement>(null);
  const isInitialScrollRef = useRef(true);

  // Fetch stats and posts
  const fetchProfileData = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      // 1. Fetch posts uploaded by current user
      const { data: postsData, error: postsError } = await supabase
        .from('messages')
        .select('id,media_url,media_key,media_nonce,sender_public_key,type,created_at,sender_id,receiver_id,thumbnail_url,is_reel_upload')
        .eq('sender_id', user.id)
        .or('type.eq.image,type.eq.video')
        .order('created_at', { ascending: false });

      if (postsError) throw postsError;
      const items = (postsData as ProfilePostItem[]) || [];
      setPosts(items);

      // Fetch notes count for current user
      const { count: notesCount } = await supabase
        .from('notes')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

      setStats({
        posts: items.length,
        notes: notesCount || 0
      });

      // 3. Fetch liked and saved posts/reels from profiles table for current user
      let profileData = null;
      try {
        const { data, error: profileError } = await supabase
          .from('profiles')
          .select('favorited_message_ids, saved_message_ids')
          .eq('id', user.id)
          .single();

        if (profileError) {
          if (profileError.code !== 'PGRST116') {
            throw profileError;
          }
          console.log('Profile row not found for user', user.id);
        } else {
          profileData = data;
        }
      } catch (err) {
        console.error('Error fetching user profile data:', err);
      }

      const favIds = (profileData?.favorited_message_ids as string[]) || [];
      setLikedIdsSet(new Set(favIds));
      if (favIds.length > 0) {
        const { data: likedData, error: likedError } = await supabase
          .from('messages')
          .select('id,media_url,media_key,media_nonce,sender_public_key,type,created_at,sender_id,receiver_id,thumbnail_url,is_reel_upload')
          .in('id', favIds)
          .or('type.eq.image,type.eq.video');

        if (likedError) throw likedError;
        const sortedLiked = ((likedData as ProfilePostItem[]) || []).sort((a, b) => {
          return favIds.indexOf(b.id) - favIds.indexOf(a.id);
        });
        setLikedItems(sortedLiked);
      } else {
        setLikedItems([]);
      }

      const savedIds = (profileData?.saved_message_ids as string[]) || [];
      setSavedIdsSet(new Set(savedIds));
      if (savedIds.length > 0) {
        const { data: savedData, error: savedError } = await supabase
          .from('messages')
          .select('id,media_url,media_key,media_nonce,sender_public_key,type,created_at,sender_id,receiver_id,thumbnail_url,is_reel_upload')
          .in('id', savedIds)
          .or('type.eq.image,type.eq.video');

        if (savedError) throw savedError;
        const sortedSaved = ((savedData as ProfilePostItem[]) || []).sort((a, b) => {
          return savedIds.indexOf(b.id) - savedIds.indexOf(a.id);
        });
        setSavedItems(sortedSaved);
      } else {
        setSavedItems([]);
      }

      // 4. Fetch data for partner (wife) if exists
      if (partner) {
        // Fetch posts uploaded by partner
        const { data: partnerPostsData, error: partnerPostsError } = await supabase
          .from('messages')
          .select('id,media_url,media_key,media_nonce,sender_public_key,type,created_at,sender_id,receiver_id,thumbnail_url,is_reel_upload')
          .eq('sender_id', partner.id)
          .or('type.eq.image,type.eq.video')
          .order('created_at', { ascending: false });

        if (partnerPostsError) throw partnerPostsError;
        const pItems = (partnerPostsData as ProfilePostItem[]) || [];
        setPartnerPosts(pItems);

        // Fetch notes count for partner
        const { count: partnerNotesCount } = await supabase
          .from('notes')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', partner.id);

        setPartnerStats({
          posts: pItems.length,
          notes: partnerNotesCount || 0
        });

        // Fetch liked and saved posts/reels from profiles table for partner
        let partnerProfileData = null;
        try {
          const { data, error: partnerProfileError } = await supabase
            .from('profiles')
            .select('favorited_message_ids, saved_message_ids')
            .eq('id', partner.id)
            .single();

          if (partnerProfileError) {
            if (partnerProfileError.code !== 'PGRST116') {
              throw partnerProfileError;
            }
            console.log('Profile row not found for partner', partner.id);
          } else {
            partnerProfileData = data;
          }
        } catch (err) {
          console.error('Error fetching partner profile data:', err);
        }

        const partnerFavIds = (partnerProfileData?.favorited_message_ids as string[]) || [];
        if (partnerFavIds.length > 0) {
          const { data: partnerLikedData, error: partnerLikedError } = await supabase
            .from('messages')
            .select('id,media_url,media_key,media_nonce,sender_public_key,type,created_at,sender_id,receiver_id,thumbnail_url,is_reel_upload')
            .in('id', partnerFavIds)
            .or('type.eq.image,type.eq.video');

          if (partnerLikedError) throw partnerLikedError;
          const sortedPartnerLiked = ((partnerLikedData as ProfilePostItem[]) || []).sort((a, b) => {
            return partnerFavIds.indexOf(b.id) - partnerFavIds.indexOf(a.id);
          });
          setPartnerLikedItems(sortedPartnerLiked);
        } else {
          setPartnerLikedItems([]);
        }

        const partnerSavedIds = (partnerProfileData?.saved_message_ids as string[]) || [];
        if (partnerSavedIds.length > 0) {
          const { data: partnerSavedData, error: partnerSavedError } = await supabase
            .from('messages')
            .select('id,media_url,media_key,media_nonce,sender_public_key,type,created_at,sender_id,receiver_id,thumbnail_url,is_reel_upload')
            .in('id', partnerSavedIds)
            .or('type.eq.image,type.eq.video');

          if (partnerSavedError) throw partnerSavedError;
          const sortedPartnerSaved = ((partnerSavedData as ProfilePostItem[]) || []).sort((a, b) => {
            return partnerSavedIds.indexOf(b.id) - partnerSavedIds.indexOf(a.id);
          });
          setPartnerSavedItems(sortedPartnerSaved);
        } else {
          setPartnerSavedItems([]);
        }
      }
    } catch (e) {
      console.error('Error fetching profile stats/posts:', e);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user, partner]);

  // Toggle favorite/like within profile reels viewer
  const toggleFavorite = useCallback(async (id: string) => {
    if (!user?.id) return;
    setLikedIdsSet(prev => {
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
        .then(() => {
          fetchProfileData(true); // Silent update to keep profile grids synced
        });
      return next;
    });
  }, [user, fetchProfileData]);

  // Toggle saved within profile reels viewer
  const toggleSaved = useCallback(async (id: string) => {
    if (!user?.id) return;
    setSavedIdsSet(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        navigator.vibrate?.(10);
      }
      const arr = Array.from(next);
      localStorage.setItem('aura_saved', JSON.stringify(arr));
      supabase
        .from('profiles')
        .update({ saved_message_ids: arr })
        .eq('id', user.id)
        .then(() => {
          fetchProfileData(true); // Silent update to keep profile grids synced
        });
      return next;
    });
  }, [user, fetchProfileData]);

  // Scroll to selected item when swiper viewer opens (using useLayoutEffect for instant jump before paint)
  useLayoutEffect(() => {
    if (activeReelIndex !== null && isInitialScrollRef.current) {
      const container = reelContainerRef.current;
      if (container) {
        container.style.scrollBehavior = 'auto';
        
        // Use clientHeight if available, fallback to window.innerHeight
        const itemHeight = container.clientHeight || window.innerHeight;
        container.scrollTop = activeReelIndex * itemHeight;
        
        // A single frame check to ensure alignment and reset the initial scroll ref
        let attempts = 0;
        const alignScroll = () => {
          const c = reelContainerRef.current;
          if (c) {
            c.style.scrollBehavior = 'auto';
            const h = c.clientHeight || window.innerHeight;
            c.scrollTop = activeReelIndex * h;
            
            // Mark initial scroll as complete so normal scroll events are processed
            setTimeout(() => {
              isInitialScrollRef.current = false;
            }, 50);
          } else if (attempts < 10) {
            attempts++;
            requestAnimationFrame(alignScroll);
          } else {
            isInitialScrollRef.current = false;
          }
        };
        requestAnimationFrame(alignScroll);
      }
    }
  }, [activeReelIndex]);

  // Handle slide change inside swiper viewer
  const handleReelScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (isInitialScrollRef.current) return;
    const scrollTop = e.currentTarget.scrollTop;
    const clientHeight = e.currentTarget.clientHeight;
    if (clientHeight === 0) return;
    const newIndex = Math.round(scrollTop / clientHeight);
    if (newIndex !== activeReelIndex && newIndex >= 0 && newIndex < reelViewerItems.length) {
      setActiveReelIndex(newIndex);
    }
  };

  // Keyboard navigation for Profile reels swiper (ArrowUp / ArrowDown)
  useEffect(() => {
    if (activeReelIndex === null || reelViewerItems.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true')) {
        return;
      }

      const container = reelContainerRef.current;
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
  }, [activeReelIndex, reelViewerItems.length]);

  useEffect(() => {
    if (viewMode === 'profile') {
      fetchProfileData();
    }
  }, [viewMode, fetchProfileData]);

  useEffect(() => {
    const showPartner = () => setProfileOwner('partner');
    const showMe = () => setProfileOwner('me');
    document.addEventListener('view-partner-profile', showPartner);
    document.addEventListener('view-my-profile', showMe);
    return () => {
      document.removeEventListener('view-partner-profile', showPartner);
      document.removeEventListener('view-my-profile', showMe);
    };
  }, []);

  // Handle display name update
  const handleUpdateName = async () => {
    if (!user || !newDisplayName.trim()) return;
    setUpdatingName(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: newDisplayName.trim() })
        .eq('id', user.id);

      if (error) throw error;
      toast.success('Display name updated successfully!');
      setIsEditOpen(false);
      // Reload page or trigger profile context reload if any
      window.location.reload();
    } catch (e: any) {
      toast.error(e.message || 'Failed to update display name');
    } finally {
      setUpdatingName(false);
    }
  };

  if (viewMode === 'settings') {
    return (
      <div className="w-full h-full flex flex-col bg-[var(--bg-primary)]">
        <header className="px-4 py-3 flex items-center gap-3 border-b border-white/5 bg-[var(--bg-primary)] safe-top">
          <button onClick={() => setViewMode('profile')} className="p-2 rounded-full hover:bg-white/5 text-white/70">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <span className="font-serif italic text-lg text-white">Settings</span>
        </header>
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<div className="p-6 text-center text-xs uppercase tracking-widest text-white/30 animate-pulse">Loading settings...</div>}>
            <SettingsScreen />
          </Suspense>
        </div>
      </div>
    );
  }

  // Get user name
  const userDisplayName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'You';
  const partnerDisplayName = partner?.display_name || 'Partner';

  const currentAvatarUrl = profileOwner === 'me' ? user?.user_metadata?.avatar_url : partner?.avatar_url;
  const currentAvatarKey = profileOwner === 'me' ? user?.user_metadata?.avatar_key : partner?.avatar_key;
  const currentAvatarNonce = profileOwner === 'me' ? user?.user_metadata?.avatar_nonce : partner?.avatar_nonce;

  const currentDisplayName = profileOwner === 'me' ? userDisplayName : partnerDisplayName;
  const currentPostCount = profileOwner === 'me' ? stats.posts : partnerStats.posts;
  const currentNotesCount = profileOwner === 'me' ? stats.notes : partnerStats.notes;

  const currentPosts = profileOwner === 'me' ? posts : partnerPosts;
  const currentLikedItems = profileOwner === 'me' ? likedItems : partnerLikedItems;
  const currentSavedItems = profileOwner === 'me' ? savedItems : partnerSavedItems;

  return (
    <div className="h-full w-full bg-[var(--bg-primary)] overflow-y-auto social-feed-scroll pb-24 safe-top">
      {/* Profile Header (Mobile Only, Hidden on Desktop) */}
      <header className="px-4 py-3 flex items-center justify-between border-b border-white/5 bg-[var(--bg-primary)] lg:hidden">
        <span className="font-serif italic text-lg text-white">
          {profileOwner === 'me' ? userDisplayName : `${partnerDisplayName}'s Profile`}
        </span>
        {profileOwner === 'me' && (
          <button 
            onClick={() => setViewMode('settings')} 
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/5 text-white/70"
          >
            <span className="material-symbols-outlined text-[22px]">settings</span>
          </button>
        )}
      </header>



      {/* Profile Info Section */}
      <div className="px-6 py-6 flex flex-col gap-6 lg:max-w-4xl lg:mx-auto lg:px-8 lg:py-12">
        
        {/* Desktop Profile Info Layout (Hidden on Mobile) */}
        <div className="hidden lg:flex gap-12 items-start border-b border-white/5 pb-10">
          {/* Large Desktop Avatar */}
          <div className="relative w-32 h-32 rounded-full p-[2.5px] bg-gradient-to-tr from-[var(--gold)] to-[var(--gold-light)] shrink-0">
            <div className="w-full h-full rounded-full bg-[var(--bg-primary)] p-[3px] overflow-hidden">
              <EncryptedImage 
                url={currentAvatarUrl}
                encryptionKey={currentAvatarKey ? (typeof currentAvatarKey === 'string' ? currentAvatarKey : JSON.stringify(currentAvatarKey)) : null}
                nonce={currentAvatarNonce ? (typeof currentAvatarNonce === 'string' ? currentAvatarNonce : JSON.stringify(currentAvatarNonce)) : null}
                alt={`${currentDisplayName}'s profile`} 
                className="w-full h-full object-cover rounded-full" 
                placeholder={`https://ui-avatars.com/api/?name=${currentDisplayName}&background=c9a96e&color=13131b`}
              />
            </div>
          </div>

          {/* Desktop Profile Info Column */}
          <div className="flex-grow space-y-5">
            <div className="flex items-center gap-5">
              <h2 className="text-xl font-serif italic text-white font-semibold">{currentDisplayName}</h2>
              {profileOwner === 'me' && (
                <>
                  <button 
                    onClick={() => { setNewDisplayName(userDisplayName); setIsEditOpen(true); }}
                    className="bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-xl py-2 px-5 text-xs font-semibold active:scale-98 transition-all"
                  >
                    Edit Profile
                  </button>
                  <button 
                    onClick={() => setViewMode('settings')} 
                    className="bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-xl p-2 flex items-center justify-center active:scale-98 transition-all"
                  >
                    <span className="material-symbols-outlined text-[18px]">settings</span>
                  </button>
                </>
              )}
            </div>

            {/* Desktop Stats Row */}
            <div className="flex gap-10 text-sm">
              <div><span className="font-bold text-white">{currentPostCount}</span> <span className="text-white/50 text-xs uppercase tracking-wider ml-1.5">Posts</span></div>
              <div><span className="font-bold text-white">{streakCount}</span> <span className="text-white/50 text-xs uppercase tracking-wider ml-1.5">Streak</span></div>
              <div><span className="font-bold text-white">{currentNotesCount}</span> <span className="text-white/50 text-xs uppercase tracking-wider ml-1.5">Notes</span></div>
            </div>

            {/* Bio */}
            <div>
              <h3 className="text-sm font-bold text-white">{currentDisplayName}</h3>
              <p className="text-xs text-white/50 italic mt-0.5">Private Aura Space</p>
            </div>
          </div>
        </div>

        {/* Mobile Profile Info Layout (Hidden on Desktop) */}
        <div className="lg:hidden flex flex-col gap-6">
          <div className="flex items-center gap-6">
            {/* Avatar */}
            <div className="relative w-20 h-20 rounded-full p-[2.5px] bg-gradient-to-tr from-[var(--gold)] to-[var(--gold-light)] shrink-0">
              <div className="w-full h-full rounded-full bg-[var(--bg-primary)] p-[2px] overflow-hidden">
                <EncryptedImage 
                  url={currentAvatarUrl}
                  encryptionKey={currentAvatarKey ? (typeof currentAvatarKey === 'string' ? currentAvatarKey : JSON.stringify(currentAvatarKey)) : null}
                  nonce={currentAvatarNonce ? (typeof currentAvatarNonce === 'string' ? currentAvatarNonce : JSON.stringify(currentAvatarNonce)) : null}
                  alt={`${currentDisplayName}'s profile`} 
                  className="w-full h-full object-cover rounded-full" 
                  placeholder={`https://ui-avatars.com/api/?name=${currentDisplayName}&background=c9a96e&color=13131b`}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="flex-1 flex justify-around items-center">
              <div className="flex flex-col items-center">
                <span className="text-base font-bold text-white leading-tight">{currentPostCount}</span>
                <span className="text-[10px] uppercase font-semibold text-white/40 tracking-wider">Posts</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-base font-bold text-white leading-tight">{streakCount}</span>
                <span className="text-[10px] uppercase font-semibold text-white/40 tracking-wider">Streak</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-base font-bold text-white leading-tight">{currentNotesCount}</span>
                <span className="text-[10px] uppercase font-semibold text-white/40 tracking-wider">Notes</span>
              </div>
            </div>
          </div>

          {/* Bio / Edit Profile */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-bold text-white">{currentDisplayName}</h3>
              <p className="text-xs text-white/50 italic mt-0.5">Private Aura Space</p>
            </div>

            {profileOwner === 'me' && (
              <button 
                onClick={() => { setNewDisplayName(userDisplayName); setIsEditOpen(true); }}
                className="w-full bg-white/5 border border-white/10 text-white rounded-xl py-2 px-4 text-xs font-semibold hover:bg-white/10 active:scale-98 transition-all"
              >
                Edit Profile
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Profile Tabs */}
      <div className="border-t border-white/5 lg:max-w-4xl lg:mx-auto">
        <div className="flex justify-around items-center w-full max-w-md mx-auto relative">
          <button
            onClick={() => setActiveTab('posts')}
            className={`flex items-center justify-center gap-2 py-3 px-3 relative transition-all duration-300 ${
              activeTab === 'posts' ? 'text-[var(--gold)]' : 'text-white/40 hover:text-white/70'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">grid_on</span>
            <span className="text-xs font-bold uppercase tracking-wider">
              {profileOwner === 'me' ? 'My Posts' : 'Posts'}
            </span>
            {activeTab === 'posts' && (
              <motion.div
                layoutId="profileTabLine"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--gold)]"
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            )}
          </button>
          
          <button
            onClick={() => setActiveTab('liked')}
            className={`flex items-center justify-center gap-2 py-3 px-3 relative transition-all duration-300 ${
              activeTab === 'liked' ? 'text-[var(--gold)]' : 'text-white/40 hover:text-white/70'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">favorite</span>
            <span className="text-xs font-bold uppercase tracking-wider">Liked</span>
            {activeTab === 'liked' && (
              <motion.div
                layoutId="profileTabLine"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--gold)]"
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            )}
          </button>

          <button
            onClick={() => setActiveTab('saved')}
            className={`flex items-center justify-center gap-2 py-3 px-3 relative transition-all duration-300 ${
              activeTab === 'saved' ? 'text-[var(--gold)]' : 'text-white/40 hover:text-white/70'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">bookmark</span>
            <span className="text-xs font-bold uppercase tracking-wider">Saved</span>
            {activeTab === 'saved' && (
              <motion.div
                layoutId="profileTabLine"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--gold)]"
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            )}
          </button>
        </div>
      </div>

      {/* User Posts / Liked Items Grid */}
      <div className="px-1 py-1 lg:max-w-4xl lg:mx-auto lg:px-8 lg:py-6">
        {loading ? (
          <div className="py-12 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-[var(--gold)]/20 border-t-[var(--gold)] rounded-full animate-spin"></div>
          </div>
        ) : activeTab === 'posts' ? (
          currentPosts.length === 0 ? (
            <div className="py-16 text-center text-white/30 text-xs font-label uppercase tracking-widest">
              {profileOwner === 'me' ? 'No posts shared by you.' : `No posts shared by ${partnerDisplayName}.`}
            </div>
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-4 gap-1 rounded-2xl overflow-hidden">
              {currentPosts.map((item, idx) => (
                <ProfileGridThumb 
                  key={item.id} 
                  item={item} 
                  partnerPublicKey={partner?.public_key || ''} 
                  getDecryptedBlob={getDecryptedBlob}
                  onClick={() => {
                    isInitialScrollRef.current = true;
                    setReelViewerItems(currentPosts);
                    setActiveReelIndex(idx);
                  }}
                />
              ))}
            </div>
          )
        ) : activeTab === 'liked' ? (
          currentLikedItems.length === 0 ? (
            <div className="py-16 text-center text-white/30 text-xs font-label uppercase tracking-widest">
              {profileOwner === 'me' ? 'No liked posts or reels.' : `No liked posts or reels by ${partnerDisplayName}.`}
            </div>
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-4 gap-1 rounded-2xl overflow-hidden">
              {currentLikedItems.map((item, idx) => (
                <ProfileGridThumb 
                  key={item.id} 
                  item={item} 
                  partnerPublicKey={partner?.public_key || ''} 
                  getDecryptedBlob={getDecryptedBlob}
                  onClick={() => {
                    isInitialScrollRef.current = true;
                    setReelViewerItems(currentLikedItems);
                    setActiveReelIndex(idx);
                  }}
                />
              ))}
            </div>
          )
        ) : (
          currentSavedItems.length === 0 ? (
            <div className="py-16 text-center text-white/30 text-xs font-label uppercase tracking-widest">
              {profileOwner === 'me' ? 'No saved posts or reels.' : `No saved posts or reels by ${partnerDisplayName}.`}
            </div>
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-4 gap-1 rounded-2xl overflow-hidden">
              {currentSavedItems.map((item, idx) => (
                <ProfileGridThumb 
                  key={item.id} 
                  item={item} 
                  partnerPublicKey={partner?.public_key || ''} 
                  getDecryptedBlob={getDecryptedBlob}
                  onClick={() => {
                    isInitialScrollRef.current = true;
                    setReelViewerItems(currentSavedItems);
                    setActiveReelIndex(idx);
                  }}
                />
              ))}
            </div>
          )
        )}
      </div>

      {/* Edit Profile Modal */}
      <AnimatePresence>
        {isEditOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div 
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.95 }}
            className="w-full max-w-sm bg-[var(--bg-secondary)] border border-white/10 rounded-3xl p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-white">Edit Display Name</h3>
            <input 
              type="text" 
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="Enter new display name"
              className="w-full bg-white/5 border border-white/10 focus:ring-1 focus:ring-[var(--gold)]/40 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none"
            />
            <div className="flex gap-3 pt-2">
              <button 
                onClick={() => setIsEditOpen(false)}
                className="flex-1 bg-white/5 border border-white/10 text-white rounded-xl py-2 px-4 text-xs font-semibold"
              >
                Cancel
              </button>
              <button 
                onClick={handleUpdateName}
                disabled={updatingName || !newDisplayName.trim()}
                className="flex-1 bg-[var(--gold)] text-[var(--on-accent)] rounded-xl py-2 px-4 text-xs font-bold disabled:opacity-50"
              >
                {updatingName ? 'Updating...' : 'Save'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Fullscreen Video/Photo Reels Swiper Viewer */}
    <AnimatePresence>
      {activeReelIndex !== null && reelViewerItems.length > 0 && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
        >
          {/* Close button */}
          <button 
            onClick={() => {
              setActiveReelIndex(null);
              setReelViewerItems([]);
            }}
            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-white z-50 hover:bg-black/60 active:scale-95 transition-all"
          >
            <span className="material-symbols-outlined">close</span>
          </button>

          {/* Reels Swiper */}
          <div
            onScroll={handleReelScroll}
            className="h-full w-full overflow-y-scroll snap-y snap-mandatory"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            ref={reelContainerRef}
          >
            {reelViewerItems.map((item, idx) => {
              const isVisible = Math.abs(idx - activeReelIndex) <= 5;
              const isNearby = Math.abs(idx - activeReelIndex) <= 2;

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
                  item={item as any}
                  isActive={idx === activeReelIndex}
                  isNearby={isNearby}
                  partnerPublicKey={partner?.public_key || ''}
                  isLiked={likedIdsSet.has(item.id)}
                  onLikeToggle={() => toggleFavorite(item.id)}
                  isSaved={savedIdsSet.has(item.id)}
                  onSaveToggle={() => toggleSaved(item.id)}
                />
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}

interface ProfileGridThumbProps {
  item: ProfilePostItem;
  partnerPublicKey: string;
  getDecryptedBlob: any;
  onClick: (url: string, type: string) => void;
}

function ProfileGridThumb({ item, partnerPublicKey, getDecryptedBlob, onClick }: ProfileGridThumbProps) {
  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [decryptionFailed, setDecryptionFailed] = useState(false);
  const thumbRef = useRef<HTMLButtonElement>(null);
  const decryptedUrlRef = useRef<string | null>(null);
  const hasDecryptedRef = useRef(false);
  const tag = `[ProfileThumb][${item.id?.slice(0,8)}]`;

  const isChunkedVideo = item.type === 'video' && !item.media_url;
  const { chunks: videoChunks, loadExistingChunks } = useVideoChunks(isChunkedVideo ? item.id : undefined);

  // Chunked video watcher
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

    if (!partnerPublicKey || (!item.media_url && !isChunkedVideo) || !item.media_key || !item.media_nonce) {
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
          if (isChunkedVideo) {
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
            observer.disconnect();
          } else {
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
              console.error(`${tag} FAILED — getDecryptedBlob returned null`);
              hasDecryptedRef.current = false;
              setDecryptionFailed(true);
            }
          }
        } catch (e) {
          console.error(`${tag} EXCEPTION`, e);
          hasDecryptedRef.current = false;
          setDecryptionFailed(true);
        } finally {
          if (active && !isChunkedVideo) setLoading(false);
        }
      };
      decrypt();
    }, { rootMargin: '150px' });

    if (thumbRef.current) {
      observer.observe(thumbRef.current);
    }

    return () => {
      active = false;
      observer.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.media_url, item.media_key, item.media_nonce, partnerPublicKey, getDecryptedBlob, isChunkedVideo]);

  if (decryptionFailed) return null;

  return (
    <button 
      ref={thumbRef}
      onClick={() => decryptedUrl && onClick(decryptedUrl, item.type)}
      className="aspect-square relative w-full bg-black/20 flex items-center justify-center overflow-hidden active:scale-95 transition-transform"
    >
      {loading ? (
        <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
      ) : decryptedUrl ? (
        <>
          {item.type === 'video' ? (
            <div className="w-full h-full relative">
              <video src={decryptedUrl} className="w-full h-full object-cover" preload="metadata" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                <span className="material-symbols-outlined text-white/60 text-sm">play_circle</span>
              </div>
            </div>
          ) : (
            <img src={decryptedUrl} alt="" className="w-full h-full object-cover" />
          )}
        </>
      ) : (
        <span className="material-symbols-outlined text-white/10 text-lg">lock</span>
      )}
    </button>
  );
}
