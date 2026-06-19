import { useState, useEffect, useRef, lazy, Suspense, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import { useStreak } from '../../contexts/StreakContext';
import { toast } from 'sonner';
import EncryptedImage from '../common/EncryptedImage';

const SettingsScreen = lazy(() => import('../settings/SettingsScreen'));

interface ProfilePostItem {
  id: string;
  media_url: string;
  media_key: string;
  media_nonce: string;
  sender_public_key: string;
  type: string;
  created_at: string;
  decryptedUrl?: string;
  loading?: boolean;
}

export default function ProfileScreen() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();
  const { streakCount } = useStreak();

  const [viewMode, setViewMode] = useState<'profile' | 'settings'>('profile');
  const [posts, setPosts] = useState<ProfilePostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ posts: 0, notes: 0 });
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [updatingName, setUpdatingName] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: string } | null>(null);

  // Fetch stats and posts
  const fetchProfileData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // 1. Fetch posts uploaded by current user
      const { data: postsData, error: postsError } = await supabase
        .from('messages')
        .select('id,media_url,media_key,media_nonce,sender_public_key,type,created_at')
        .eq('sender_id', user.id)
        .or('type.eq.image,type.eq.video')
        .order('created_at', { ascending: false });

      if (postsError) throw postsError;
      const items = (postsData as ProfilePostItem[]) || [];
      setPosts(items);

      // 2. Fetch notes count
      const { count: notesCount } = await supabase
        .from('notes')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

      setStats({
        posts: items.length,
        notes: notesCount || 0
      });
    } catch (e) {
      console.error('Error fetching profile stats/posts:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (viewMode === 'profile') {
      fetchProfileData();
    }
  }, [viewMode, fetchProfileData]);

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

  return (
    <div className="h-full w-full bg-[var(--bg-primary)] overflow-y-auto social-feed-scroll pb-24 safe-top">
      {/* Profile Header */}
      <header className="px-4 py-3 flex items-center justify-between border-b border-white/5 bg-[var(--bg-primary)]">
        <span className="font-serif italic text-lg text-white">{userDisplayName}</span>
        <button 
          onClick={() => setViewMode('settings')} 
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/5 text-white/70"
        >
          <span className="material-symbols-outlined text-[22px]">settings</span>
        </button>
      </header>

      {/* Profile Info Row */}
      <div className="px-6 py-6 flex flex-col gap-6">
        <div className="flex items-center gap-6">
          {/* Avatar */}
          <div className="relative w-20 h-20 rounded-full p-[2.5px] bg-gradient-to-tr from-[var(--gold)] to-[var(--gold-light)] shrink-0">
            <div className="w-full h-full rounded-full bg-[var(--bg-primary)] p-[2px] overflow-hidden">
              <EncryptedImage 
                url={user?.user_metadata?.avatar_url}
                encryptionKey={user?.user_metadata?.avatar_key ? (typeof user.user_metadata.avatar_key === 'string' ? user.user_metadata.avatar_key : JSON.stringify(user.user_metadata.avatar_key)) : null}
                nonce={user?.user_metadata?.avatar_nonce ? (typeof user.user_metadata.avatar_nonce === 'string' ? user.user_metadata.avatar_nonce : JSON.stringify(user.user_metadata.avatar_nonce)) : null}
                alt="User profile" 
                className="w-full h-full object-cover rounded-full" 
                placeholder={`https://ui-avatars.com/api/?name=${userDisplayName}&background=c9a96e&color=13131b`}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="flex-1 flex justify-around items-center">
            <div className="flex flex-col items-center">
              <span className="text-base font-bold text-white leading-tight">{stats.posts}</span>
              <span className="text-[10px] uppercase font-semibold text-white/40 tracking-wider">Posts</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-base font-bold text-white leading-tight">{streakCount}</span>
              <span className="text-[10px] uppercase font-semibold text-white/40 tracking-wider">Streak</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-base font-bold text-white leading-tight">{stats.notes}</span>
              <span className="text-[10px] uppercase font-semibold text-white/40 tracking-wider">Notes</span>
            </div>
          </div>
        </div>

        {/* Bio / Edit Profile */}
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-bold text-white">{userDisplayName}</h3>
            <p className="text-xs text-white/50 italic mt-0.5">Private Aura Space</p>
          </div>

          <button 
            onClick={() => { setNewDisplayName(userDisplayName); setIsEditOpen(true); }}
            className="w-full bg-white/5 border border-white/10 text-white rounded-xl py-2 px-4 text-xs font-semibold hover:bg-white/10 active:scale-98 transition-all"
          >
            Edit Profile
          </button>
        </div>
      </div>

      {/* Grid Posts Divider */}
      <div className="border-t border-white/5">
        <div className="flex justify-center py-2.5 border-b border-[var(--gold)]/30 w-1/3 mx-auto">
          <span className="material-symbols-outlined text-[20px] text-[var(--gold)]">grid_on</span>
        </div>
      </div>

      {/* User Posts Grid */}
      <div className="px-1 py-1">
        {loading ? (
          <div className="py-12 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-[var(--gold)]/20 border-t-[var(--gold)] rounded-full animate-spin"></div>
          </div>
        ) : posts.length === 0 ? (
          <div className="py-16 text-center text-white/30 text-xs font-label uppercase tracking-widest">
            No posts shared by you.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1 rounded-2xl overflow-hidden">
            {posts.map((item) => (
              <ProfileGridThumb 
                key={item.id} 
                item={item} 
                partnerPublicKey={partner?.public_key || ''} 
                getDecryptedBlob={getDecryptedBlob}
                onClick={(url, type) => setSelectedMedia({ url, type })}
              />
            ))}
          </div>
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

      {/* Fullscreen Video/Photo Viewer */}
      <AnimatePresence>
        {selectedMedia && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4"
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
  // Prevent double-decrypt in React StrictMode (effects run twice in dev)
  const hasDecryptedRef = useRef(false);
  const tag = `[ProfileThumb][${item.id?.slice(0,8)}]`;

  // Clean up Object URL on unmount or item change
  useEffect(() => {
    // Reset state when the item changes
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
  // NOTE: decryptedUrl intentionally NOT in dep array — adding it causes the
  // observer to be destroyed/recreated on every state change, preventing decryption.
  useEffect(() => {
    let active = true;

    if (!partnerPublicKey || !item.media_url || !item.media_key || !item.media_nonce) {
      console.warn(`${tag} SKIP observer — missing fields`, { partnerPublicKey: !!partnerPublicKey, url: !!item.media_url, key: !!item.media_key, nonce: !!item.media_nonce });
      setDecryptionFailed(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || !active) return;
      if (hasDecryptedRef.current) {
        console.log(`${tag} SKIP decrypt — already done`);
        observer.disconnect();
        return;
      }

      hasDecryptedRef.current = true;
      console.log(`${tag} VISIBLE → starting decrypt url=...${item.media_url?.slice(-30)}`);

      const decrypt = async () => {
        setLoading(true);
        try {
          const blob = await getDecryptedBlob(
            item.media_url,
            item.media_key,
            item.media_nonce,
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
            console.error(`${tag} FAILED — getDecryptedBlob returned null`);
            hasDecryptedRef.current = false; // allow retry
            setDecryptionFailed(true);
          }
        } catch (e) {
          console.error(`${tag} EXCEPTION`, e);
          hasDecryptedRef.current = false; // allow retry
          setDecryptionFailed(true);
        } finally {
          if (active) setLoading(false);
        }
      };
      decrypt();
    }, { rootMargin: '150px' });

    if (thumbRef.current) {
      observer.observe(thumbRef.current);
      console.log(`${tag} IntersectionObserver attached`);
    }

    return () => {
      active = false;
      observer.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.media_url, item.media_key, item.media_nonce, partnerPublicKey, getDecryptedBlob]);

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
