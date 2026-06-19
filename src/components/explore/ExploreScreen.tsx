import { useState, useEffect, useRef, lazy, Suspense, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';

// Lazy load the sub-screens to preserve codebase architecture
const MemoriesScreen = lazy(() => import('../memories/MemoriesScreen'));
const NotesScreen = lazy(() => import('../notes/NotesScreen'));
const GamesScreen = lazy(() => import('../games/GamesScreen'));

interface ExploreItem {
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

export default function ExploreScreen() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();

  const [subView, setSubView] = useState<'grid' | 'gallery' | 'notes' | 'games'>(() => {
    const isStealth = typeof window !== 'undefined' && localStorage.getItem('aura_stealth_mode') === 'true';
    return isStealth ? 'notes' : 'grid';
  });
  const [exploreItems, setExploreItems] = useState<ExploreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: string } | null>(null);

  const handleOpenMedia = (url: string, type: string) => {
    setSelectedMedia({ url, type });
  };

  // Sync stealth mode changes
  useEffect(() => {
    const handleStealthChange = () => {
      const isStealth = localStorage.getItem('aura_stealth_mode') === 'true';
      if (isStealth) {
        setSubView('notes');
      }
    };
    window.addEventListener('stealth-mode-change', handleStealthChange);
    return () => window.removeEventListener('stealth-mode-change', handleStealthChange);
  }, []);


  // Fetch random images/videos for the discovery grid
  const fetchExploreGrid = useCallback(async () => {
    if (!user || !partner) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id,media_url,media_key,media_nonce,sender_public_key,type,created_at')
        .or('type.eq.image,type.eq.video')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partner.id}),and(sender_id.eq.${partner.id},receiver_id.eq.${user.id})`)
        .order('created_at', { ascending: false })
        .limit(24);

      if (error) throw error;
      setExploreItems((data as ExploreItem[]) || []);
    } catch (e) {
      console.error('Error loading explore items:', e);
    } finally {
      setLoading(false);
    }
  }, [user, partner]);

  useEffect(() => {
    if (subView === 'grid') {
      fetchExploreGrid();
    }
  }, [subView, fetchExploreGrid]);

  // Handle subView Back Action
  const handleBack = () => {
    setSubView('grid');
  };

  // Render Sub Views
  if (subView === 'gallery') {
    return (
      <div className="w-full h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<div className="p-6 text-center text-xs uppercase tracking-widest text-white/30 animate-pulse">Loading gallery...</div>}>
            <MemoriesScreen onBack={handleBack} />
          </Suspense>
        </div>
      </div>
    );
  }

  if (subView === 'notes') {
    return (
      <div className="w-full h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<div className="p-6 text-center text-xs uppercase tracking-widest text-white/30 animate-pulse">Loading notes...</div>}>
            <NotesScreen onBack={handleBack} />
          </Suspense>
        </div>
      </div>
    );
  }

  if (subView === 'games') {
    return (
      <div className="w-full h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<div className="p-6 text-center text-xs uppercase tracking-widest text-white/30 animate-pulse">Loading arcade...</div>}>
            <GamesScreen onBack={handleBack} />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-[var(--bg-primary)] overflow-y-auto social-feed-scroll pb-24 safe-top">
      {/* Search Header */}
      <div className="px-4 py-3 bg-[var(--bg-primary)] sticky top-0 z-30">
        <div className="relative flex items-center w-full bg-white/5 rounded-2xl border border-white/10 px-4 py-2.5">
          <span className="material-symbols-outlined text-white/40 mr-2 text-xl">search</span>
          <input 
            type="text" 
            placeholder="Search moments, topics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent focus:outline-none text-white text-sm placeholder-white/30"
          />
        </div>
      </div>

      {/* Discovery Hub Card Grid */}
      <div className="px-4 py-4 grid grid-cols-3 gap-3">
        {/* Gallery */}
        <button 
          onClick={() => setSubView('gallery')}
          className="aspect-square rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.02] to-white/[0.04] p-3 flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-[var(--gold)]/10 flex items-center justify-center text-[var(--gold)]">
            <span className="material-symbols-outlined text-xl">photo_library</span>
          </div>
          <span className="text-[10px] font-bold tracking-wider uppercase text-white/80">Gallery</span>
        </button>

        {/* Notes */}
        <button 
          onClick={() => setSubView('notes')}
          className="aspect-square rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.02] to-white/[0.04] p-3 flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-400">
            <span className="material-symbols-outlined text-xl">sticky_note_2</span>
          </div>
          <span className="text-[10px] font-bold tracking-wider uppercase text-white/80">Vault</span>
        </button>

        {/* Games */}
        <button 
          onClick={() => setSubView('games')}
          className="aspect-square rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.02] to-white/[0.04] p-3 flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400">
            <span className="material-symbols-outlined text-xl">sports_esports</span>
          </div>
          <span className="text-[10px] font-bold tracking-wider uppercase text-white/80">Arcade</span>
        </button>
      </div>

      {/* Explore Grid */}
      <div className="px-4 py-4 space-y-4">
        <h3 className="font-serif italic text-base text-[var(--gold)] tracking-wide">Explore Shared Grid</h3>

        {loading ? (
          <div className="py-12 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-[var(--gold)]/20 border-t-[var(--gold)] rounded-full animate-spin"></div>
          </div>
        ) : exploreItems.length === 0 ? (
          <div className="py-12 text-center text-white/30 text-xs font-label uppercase tracking-widest">
            No memories to explore.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 rounded-3xl overflow-hidden">
            {exploreItems.map((item) => (
              <ExploreGridThumb 
                key={item.id} 
                item={item} 
                partnerPublicKey={partner?.public_key || ''} 
                getDecryptedBlob={getDecryptedBlob}
                onClick={handleOpenMedia}
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

interface ExploreGridThumbProps {
  item: ExploreItem;
  partnerPublicKey: string;
  getDecryptedBlob: any;
  onClick: (url: string, type: string) => void;
}

function ExploreGridThumb({ item, partnerPublicKey, getDecryptedBlob, onClick }: ExploreGridThumbProps) {
  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [decryptionFailed, setDecryptionFailed] = useState(false);
  const thumbRef = useRef<HTMLButtonElement>(null);
  const decryptedUrlRef = useRef<string | null>(null);
  // Guard: prevent double decrypt from StrictMode double-invoke
  const hasDecryptedRef = useRef(false);
  const tag = `[ExploreThumb][${item.id?.slice(0,8)}]`;

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
  // teardown/recreate on every state change, breaking decryption.
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
    }, { rootMargin: '150px' });

    if (thumbRef.current) {
      observer.observe(thumbRef.current);
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
