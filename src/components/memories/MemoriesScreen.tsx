import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import { useMediaFolders, type MediaFolder } from '../../hooks/useMediaFolders';
import type { Database } from '../../integrations/supabase/types';
import { realtimeHub } from '../../lib/realtimeHub';
import MediaViewer from '../chat/MediaViewer';
import SearchOverlay from './SearchOverlay';
import FoldersPanel from './FoldersPanel';
import FolderView from './FolderView';
import OnThisDayCard from './OnThisDayCard';
import TimelineScrubber from './TimelineScrubber';

type MessageRow = Database['public']['Tables']['messages']['Row'];

interface MemoryItem extends MessageRow {
  decryptedUrl?: string;
  decrypted_content?: string;
  loading?: boolean;
}

type ViewMode = 'gallery' | 'search' | 'folders' | 'folder-view';

export default function MemoriesScreen() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();
  const { folders, addItemsToFolder, createFolder } = useMediaFolders();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [throwbacks, setThrowbacks] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'audio' | 'document' | 'favorites'>('all');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [selectedMedia, setSelectedMedia] = useState<{ url: string, type: string, messageId?: string, initialIndex?: number } | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const LIMIT = 12;

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('gallery');
  const [activeFolderView, setActiveFolderView] = useState<MediaFolder | null>(null);

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [isCreatingInPicker, setIsCreatingInPicker] = useState(false);
  const [newFolderNameInPicker, setNewFolderNameInPicker] = useState('');
  const [creatingInPicker, setCreatingInPicker] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatedUrlsRef = useRef<Set<string>>(new Set());
  const pageRef = useRef(1);          // tracks current page synchronously
  const isFetchingMoreRef = useRef(false); // prevents concurrent fetches
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  
  // ── Phase 7: Priority Decryption Queue ──────────────────────────────
  // Fix: Implements a priority-based loading system.
  // ++1 (Highest): Items currently visible on screen.
  // +1  (High):    Next 20-30 items below the viewport.
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const decryptionQueueRef = useRef<string[]>([]);
  const processingIdsRef = useRef<Set<string>>(new Set());
  const MAX_CONCURRENT_DECRYPTIONS = 8; // Increased for "full speed"
  const LOOK_AHEAD_COUNT = 30; // Pre-fetch next 30 items

  // ── Phase 4: Pinch-to-Zoom grid density ─────────────────────────────
  type GridDensity = 2 | 3 | 4;
  const [gridDensity, setGridDensity] = useState<GridDensity>(() => {
    if (typeof window === 'undefined') return 3;
    const saved = localStorage.getItem('aura_grid_density');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if ([2, 3, 4].includes(parsed)) return parsed as GridDensity;
    }
    return (window.innerWidth < 768 ? 2 : 3) as GridDensity;
  });
  const [densityFlash, setDensityFlash] = useState(false);
  const pinchState = useRef<{
    active: boolean;
    startDist: number;
    lastChangeTime: number;
  }>({ active: false, startDist: 0, lastChangeTime: 0 });

  // ── Phase 5: Timeline Scrubber ───────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reset pagination state on user/partner change.
    pageRef.current = 1;
    setHasMore(true);
    isFetchingMoreRef.current = false;
    fetchMemories(1);
    fetchThrowbacks();
  }, [user?.id, partner?.id]);

  useEffect(() => {
    return () => {
      generatedUrlsRef.current.forEach((url: string) => URL.revokeObjectURL(url));
    };
  }, []);

  // Fix 5.2: Load favorites from Supabase DB (cross-device), fall back to localStorage
  useEffect(() => {
    if (!user) return;
    const loadFavorites = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('favorited_message_ids')
          .eq('id', user.id)
          .single();
        if (data?.favorited_message_ids && data.favorited_message_ids.length > 0) {
          setFavorites(new Set(data.favorited_message_ids));
          return;
        }
      } catch {
        // Silently fall back to localStorage if column not available
      }
      // Fallback: migrate from localStorage
      const saved = localStorage.getItem('aura_favorites');
      if (saved) {
        try {
          setFavorites(new Set(JSON.parse(saved)));
        } catch (e) {
          
        }
      }
    };
    loadFavorites();
  }, [user?.id]);

  const toggleFavorite = async (id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        navigator.vibrate?.(10);
      }
      // Fix 5.2: Persist to DB (fire-and-forget) + localStorage backup
      const arr = Array.from(next);
      localStorage.setItem('aura_favorites', JSON.stringify(arr));
      if (user) {
        supabase
          .from('profiles')
          .update({ favorited_message_ids: arr })
          .eq('id', user.id)
          .then(); // fire-and-forget
      }
      return next;
    });
  };

  // Hide mobile navbar when overlays or selection modes are active
  useEffect(() => {
    if (selectionMode || showFolderPicker) {
      document.dispatchEvent(new CustomEvent('hide-global-nav'));
    }
  }, [selectionMode, showFolderPicker]);

  // ── Phase 6: Real-time media synchronization ────────────────────────
  // Ensures new media uploaded in chat appears instantly in the gallery
  // without needing a page refresh or manual re-fetch.
  useEffect(() => {
    if (!user || !partner) return;

    const unsubscribe = realtimeHub.on('messages', (payload) => {
      if (payload.eventType === 'INSERT') {
        const newMsg = payload.new as MemoryItem;
        
        // Filter: must have media and belong to this specific conversation
        if (!newMsg.media_url) return;
        
        const isFromMe = newMsg.sender_id === user.id && newMsg.receiver_id === partner.id;
        const isFromPartner = newMsg.sender_id === partner.id && newMsg.receiver_id === user.id;
        
        if (isFromMe || isFromPartner) {
          setMemories(prev => {
            // Deduplication guard
            if (prev.some(m => m.id === newMsg.id)) return prev;
            // Prepend the new memory so it appears at the top of the grid
            return [newMsg, ...prev];
          });
        }
      } else if (payload.eventType === 'UPDATE') {
        const updatedMsg = payload.new as MemoryItem;
        // Handle media updates (e.g. if a message is edited to add media, though rare)
        if (updatedMsg.media_url) {
          setMemories(prev => {
            const exists = prev.some(m => m.id === updatedMsg.id);
            if (exists) {
              return prev.map(m => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m);
            } else {
              // If it now has media but wasn't in memories, check conversation and add it
              const isFromMe = updatedMsg.sender_id === user.id && updatedMsg.receiver_id === partner.id;
              const isFromPartner = updatedMsg.sender_id === partner.id && updatedMsg.receiver_id === user.id;
              if (isFromMe || isFromPartner) return [updatedMsg, ...prev];
              return prev;
            }
          });
        }
      } else if (payload.eventType === 'DELETE') {
        const oldMsg = payload.old as any;
        if (oldMsg?.id) {
          setMemories(prev => prev.filter(m => m.id !== oldMsg.id));
        }
      }
    });

    return () => unsubscribe();
  }, [user?.id, partner?.id]);

  // ── Pinch gesture on mobile ───────────────────────────────────────────
  const getDist = (touches: React.TouchList) =>
    Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );

  const handleGridTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 2) return;
    pinchState.current.active = true;
    pinchState.current.startDist = getDist(e.touches);
  };

  const handleGridTouchMove = (e: React.TouchEvent) => {
    if (!pinchState.current.active || e.touches.length !== 2) return;
    const COOLDOWN = 350; // ms between density changes
    const THRESHOLD = 40; // px delta to trigger change
    const now = Date.now();
    if (now - pinchState.current.lastChangeTime < COOLDOWN) return;

    const currentDist = getDist(e.touches);
    const delta = currentDist - pinchState.current.startDist;

    if (Math.abs(delta) < THRESHOLD) return;

    // Compute next density outside the state updater to avoid side-effects in Strict Mode
    setGridDensity(prev => {
      let next: GridDensity = prev;
      if (delta < 0 && prev < 4) next = (prev + 1) as GridDensity; // pinch apart = more columns
      if (delta > 0 && prev > 2) next = (prev - 1) as GridDensity; // pinch together = fewer columns
      return next;
    });

    // Compute next independently for side-effect logic
    const next: GridDensity =
      delta < 0 && gridDensity < 4 ? (gridDensity + 1) as GridDensity :
      delta > 0 && gridDensity > 2 ? (gridDensity - 1) as GridDensity :
      gridDensity;

    if (next !== gridDensity) {
      localStorage.setItem('aura_grid_density', String(next));
      setDensityFlash(true);
      setTimeout(() => setDensityFlash(false), 350);
      navigator.vibrate?.(8);
    }

    pinchState.current.startDist = currentDist;
    pinchState.current.lastChangeTime = now;
  };

  const handleGridTouchEnd = () => {
    pinchState.current.active = false;
  };


  const fetchMemories = useCallback(async (pageNumber = 1) => {
    if (!user || !partner) return;
    if (pageNumber === 1) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id,sender_id,receiver_id,media_url,media_key,media_nonce,type,created_at,sender_public_key', { count: 'exact' })
        .not('media_url', 'is', null)
        // Fix 5.1: Use correct AND filter — must have matching sender+receiver pairs
        // Old: .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`) — TOO LOOSE, returns any msg the user was in
        // New: explicit pair filter so we only get this conversation's media
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partner.id}),and(sender_id.eq.${partner.id},receiver_id.eq.${user.id})`)
        .range((pageNumber - 1) * LIMIT, pageNumber * LIMIT - 1)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const newMemories = data as MemoryItem[];

      if (pageNumber === 1) {
        setMemories(newMemories);
      } else {
        setMemories(prev => {
          const newItems = newMemories.filter(d => !prev.some(p => p.id === d.id));
          return [...prev, ...newItems];
        });
      }

      // Stop paging if we got fewer rows than the limit.
      setHasMore(newMemories.length === LIMIT);
    } catch (err) {
      
      setHasMore(false);
    } finally {
      if (pageNumber === 1) setLoading(false);
    }
  }, [user?.id, partner?.id]);

  const fetchThrowbacks = async () => {
    if (!user || !partner) return;
    try {
      const now = new Date();
      const month = now.getMonth() + 1; // 1-indexed for PG extract
      const day = now.getDate();

      const { data, error } = await supabase.rpc('get_throwbacks', {
        u_id: user.id,
        p_id: partner.id,
        current_month: month,
        current_day: day,
        limit_count: 6
      });

      if (error) throw error;
      setThrowbacks(data as MemoryItem[]);
    } catch (err) {
      
    }
  };


  const loadMore = useCallback(() => {
    // Guard: skip if a fetch is already in-flight, no more pages, or initial load is still running.
    if (isFetchingMoreRef.current || !hasMore || loading) return;
    isFetchingMoreRef.current = true;
    setIsFetchingMore(true);
    // Compute next page from ref (synchronous, no state-updater side-effects).
    const nextPage = pageRef.current + 1;
    pageRef.current = nextPage;
    fetchMemories(nextPage).finally(() => {
      isFetchingMoreRef.current = false;
      setIsFetchingMore(false);
    });
  }, [hasMore, loading, fetchMemories]);

  // ── Infinite Scroll Observer ──────────────────────────────────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    const sentinel = document.getElementById('infinite-scroll-sentinel');
    if (sentinel) observer.observe(sentinel);

    return () => observer.disconnect();
  }, [loadMore]);

  const memoriesRef = useRef(memories);
  useEffect(() => { memoriesRef.current = memories; }, [memories]);

  // ── Priority Queue Logic ──
  const processQueue = useCallback(async () => {
    if (processingIdsRef.current.size >= MAX_CONCURRENT_DECRYPTIONS) return;
    if (decryptionQueueRef.current.length === 0) return;

    // Filter out items already being processed
    const nextId = decryptionQueueRef.current.find(id => !processingIdsRef.current.has(id));
    if (!nextId) return;

    const memory = memoriesRef.current.find(m => m.id === nextId);
    if (!memory || memory.decryptedUrl || memory.loading) {
      // Remove invalid items from queue
      decryptionQueueRef.current = decryptionQueueRef.current.filter(id => id !== nextId);
      processQueue();
      return;
    }

    // Start decryption
    processingIdsRef.current.add(nextId);
    setMemories(prev => prev.map(m => m.id === nextId ? { ...m, loading: true } : m));

    try {
      const blob = await getDecryptedBlob(
        memory.media_url!,
        memory.media_key!,
        memory.media_nonce!,
        partner!.public_key!,
        memory.sender_public_key,
        undefined,
        memory.type
      );

      if (blob) {
        const url = URL.createObjectURL(blob);
        generatedUrlsRef.current.add(url);
        setMemories(prev => prev.map(m => m.id === nextId ? { ...m, decryptedUrl: url, loading: false } : m));
      } else {
        setMemories(prev => prev.map(m => m.id === nextId ? { ...m, loading: false } : m));
      }
    } catch {
      setMemories(prev => prev.map(m => m.id === nextId ? { ...m, loading: false } : m));
    } finally {
      processingIdsRef.current.delete(nextId);
      decryptionQueueRef.current = decryptionQueueRef.current.filter(id => id !== nextId);
      // Process next in queue
      processQueue();
    }
  }, [partner?.public_key, getDecryptedBlob]);

  // Update queue based on visibility and proximity
  const lastMemoriesCountRef = useRef(0);
  useEffect(() => {
    if (memories.length === 0 || !partner?.public_key) return;

    // Only refresh the whole queue if visibility changed OR new memories were loaded (pagination)
    // If memories changed but length is same, it's likely just a loading/decrypted state update,
    // which we should NOT trigger a queue refresh for (infinite loop prevention).
    lastMemoriesCountRef.current = memories.length;

    const itemsToDecrypt = filteredMemories.filter(m => !m.decryptedUrl && !m.loading && !processingIdsRef.current.has(m.id));
    if (itemsToDecrypt.length === 0) return;

    // Sort by priority...
    const visibleIndices = Array.from(visibleIds)
      .map(id => filteredMemories.findIndex(m => m.id === id))
      .filter(idx => idx !== -1);
    
    const maxVisibleIdx = visibleIndices.length > 0 ? Math.max(...visibleIndices) : -1;
    
    const sorted = [...itemsToDecrypt].sort((a, b) => {
      const aIdx = filteredMemories.findIndex(m => m.id === a.id);
      const bIdx = filteredMemories.findIndex(m => m.id === b.id);
      const aVisible = visibleIds.has(a.id);
      const bVisible = visibleIds.has(b.id);
      if (aVisible && !bVisible) return -1;
      if (!aVisible && bVisible) return 1;
      const aInLookAhead = aIdx > maxVisibleIdx && aIdx <= maxVisibleIdx + LOOK_AHEAD_COUNT;
      const bInLookAhead = bIdx > maxVisibleIdx && bIdx <= maxVisibleIdx + LOOK_AHEAD_COUNT;
      if (aInLookAhead && !bInLookAhead) return -1;
      if (!aInLookAhead && bInLookAhead) return 1;
      return aIdx - bIdx;
    });

    decryptionQueueRef.current = sorted.map(m => m.id);
    
    // Kick off workers up to limit
    for (let i = 0; i < MAX_CONCURRENT_DECRYPTIONS; i++) {
      processQueue();
    }
  }, [visibleIds, partner?.public_key, processQueue, memories.length]);

  // Robust IntersectionObserver for visibility tracking
  const observerRef = useRef<IntersectionObserver | null>(null);
  
  useEffect(() => {
    observerRef.current = new IntersectionObserver((entries) => {
      setVisibleIds(prev => {
        const next = new Set(prev);
        entries.forEach(entry => {
          const id = entry.target.getAttribute('data-id');
          if (!id) return;
          if (entry.isIntersecting) {
            next.add(id);
          } else {
            next.delete(id);
          }
        });
        return next;
      });
    }, {
      root: null,
      rootMargin: '200px', // Increased margin for smoother proactive loading
      threshold: 0.01
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const cardRef = useCallback((node: HTMLDivElement | null) => {
    if (node && observerRef.current) {
      observerRef.current.observe(node);
    }
  }, []);

  const filteredMemories = memories.filter(m => {
    if (filter === 'all') return true;
    if (filter === 'favorites') return favorites.has(m.id);
    return m.type === filter;
  });

  const groupedMemories = useMemo(() => {
    // Use a Map to accumulate items per date so that same-date items from
    // different pagination batches are always merged into one group.
    const map = new Map<string, MemoryItem[]>();
    const order: string[] = []; // preserves insertion order of unique dates

    filteredMemories.forEach(memory => {
      const d = new Date(memory.created_at);
      // Normalise to a plain date key (YYYY-MM-DD) for accurate grouping,
      // but display a human-friendly label.
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
        order.push(dateKey);
      }
      map.get(dateKey)!.push(memory);
    });

    return order.map(dateKey => {
      const items = map.get(dateKey)!;
      // Generate the human label from the first item's date
      const d = new Date(items[0].created_at);
      const dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
      return { dateKey, dateLabel, items };
    });
  }, [filteredMemories]);
  
  // Media Viewer Navigation List
  const allMediaForViewer = useMemo(() => {
    return filteredMemories
      .filter(m => m.decryptedUrl)
      .map(m => ({
        id: m.id,
        url: m.decryptedUrl!,
        type: (m.type === 'video') ? 'video' : 'image' as 'image' | 'video' | 'gif'
      }));
  }, [filteredMemories]);

  // Selection handlers
  const handleLongPress = (id: string) => {
    if (!selectionMode) {
      setSelectionMode(true);
      setSelectedIds(new Set([id]));
    }
  };

  const handleTap = (memory: MemoryItem) => {
    if (selectionMode) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(memory.id)) {
          next.delete(memory.id);
        } else {
          next.add(memory.id);
        }
        // Exit selection mode if nothing selected
        if (next.size === 0) setSelectionMode(false);
        return next;
      });
    } else {
      if (memory.decryptedUrl) {
        const index = allMediaForViewer.findIndex(m => m.id === memory.id);
        setSelectedMedia({ 
          url: memory.decryptedUrl, 
          type: memory.type || 'image', 
          messageId: memory.id,
          initialIndex: index !== -1 ? index : 0
        });
      }
    }
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleAddToFolder = async (folderId: string) => {
    const ids = Array.from(selectedIds);
    const success = await addItemsToFolder(folderId, ids);
    if (success) {
      cancelSelection();
      setShowFolderPicker(false);
      setIsCreatingInPicker(false);
      setNewFolderNameInPicker('');
    }
  };

  const handleCreateAndAdd = async () => {
    if (!newFolderNameInPicker.trim()) return;
    setCreatingInPicker(true);
    const newFolderId = await createFolder(newFolderNameInPicker.trim());
    if (newFolderId) {
      await handleAddToFolder(newFolderId);
    } else {
      setCreatingInPicker(false);
    }
  };

  const touchStartPos = useRef<{ x: number, y: number } | null>(null);

  // Touch event handlers for long-press
  const handleTouchStart = (id: string, e: React.TouchEvent) => {
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressTimerRef.current = setTimeout(() => {
      handleLongPress(id);
    }, 750);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPos.current) return;
    const dx = e.touches[0].clientX - touchStartPos.current.x;
    const dy = e.touches[0].clientY - touchStartPos.current.y;
    // Cancel if moved more than 10px
    if (Math.hypot(dx, dy) > 10) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPos.current = null;
  };

  return (
    <div 
      className="w-full h-full bg-[var(--bg-primary)] flex flex-col font-sans overflow-hidden relative"
      onClick={() => document.dispatchEvent(new CustomEvent('hide-global-nav'))}
    >
      {/* Header */}
      <header className="px-4 pt-6 pb-4 flex flex-col gap-4 border-b border-white/5 bg-black/20 shrink-0">
        {selectionMode ? (
          /* Selection Mode Header */
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={cancelSelection} className="p-2 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[var(--gold)] transition-all">
                <span className="material-symbols-outlined text-[20px] block">close</span>
              </button>
              <p className="text-sm text-white/80 font-medium">{selectedIds.size} selected</p>
            </div>
            
            <div className="flex items-center gap-2">
              {selectedIds.size === 1 && (
                <button
                  onClick={() => {
                    const id = Array.from(selectedIds)[0];
                    document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'chat' }));
                    setTimeout(() => {
                      document.dispatchEvent(new CustomEvent('jump-to-message', { detail: { messageId: id } }));
                    }, 100);
                    cancelSelection();
                  }}
                  className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[var(--gold)] hover:bg-white/10 transition-all"
                >
                  <span className="material-symbols-outlined text-[18px]">forum</span>
                  <span className="text-xs font-bold uppercase tracking-wider">View in Chat</span>
                </button>
              )}
              
              <button
                onClick={() => setShowFolderPicker(true)}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[rgba(var(--primary-rgb),_0.1)] border border-[rgba(var(--primary-rgb),_0.2)] text-[var(--gold)] hover:bg-[rgba(var(--primary-rgb),_0.2)] transition-all disabled:opacity-30"
              >
                <span className="material-symbols-outlined text-[18px]">folder</span>
                <span className="text-xs font-bold uppercase tracking-wider">Add to Collection</span>
              </button>
            </div>
          </div>
        ) : (
          /* Normal Header */
          <>
            <div className="flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-2 pointer-events-auto">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    document.dispatchEvent(new CustomEvent('toggle-nav'));
                  }}
                  className="p-2 -ml-2 rounded-full lg:hidden text-[#998f81] hover:text-[var(--gold)] hover:bg-white/5 active:scale-90 transition-all flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-xl">arrow_back</span>
                </button>
                <div>
                  <h1 className="font-serif italic text-2xl text-[var(--gold)]">Sanctuary Gallery</h1>
                  <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#998f81]">A visual archive of our shared journey</p>
                </div>
              </div>
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewMode('folders');
                }}
                className="p-2 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[var(--gold)] hover:bg-white/10 transition-all group pointer-events-auto"
              >
                <span className="material-symbols-outlined text-[20px] block group-hover:scale-110 transition-transform">folder</span>
              </button>
            </div>

            {/* Filters & Search Row */}
            <div className="relative flex items-center">
              {/* Scrollable Filters */}
              <div className="flex-1 overflow-x-auto no-scrollbar scroll-smooth flex gap-2 pr-12">
                {['all', 'favorites', 'image', 'video', 'audio', 'document'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f as any)}
                    className={`px-5 py-1.5 rounded-full text-[10px] font-label uppercase tracking-widest border transition-all whitespace-nowrap ${filter === f
                        ? 'bg-[var(--gold)] text-[var(--on-accent)] border-[var(--gold)] font-bold shadow-md shadow-[rgba(var(--primary-rgb),_0.1)]'
                        : 'bg-transparent text-[#998f81] border-white/10 hover:border-white/20'
                      }`}
                  >
                    {f === 'all' ? 'All' : f === 'favorites' ? 'Favorites' : f + 's'}
                  </button>
                ))}
              </div>

              {/* Static Search Icon / Bar with Fade */}
              <div className="absolute right-0 top-0 bottom-0 flex items-center pl-8 bg-gradient-to-l from-[var(--bg-primary)] via-[var(--bg-primary)]/90 to-transparent">
                <button
                  onClick={() => setViewMode('search')}
                  className="flex items-center gap-3 p-2 px-3 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[var(--gold)] hover:bg-white/10 hover:border-white/20 transition-all group lg:min-w-[200px]"
                >
                  <span className="material-symbols-outlined text-[20px] block group-hover:scale-110 transition-transform">search</span>
                  <span className="hidden lg:block text-[10px] font-label uppercase tracking-[0.2em] text-[#998f81]/60 font-bold whitespace-nowrap">Search by date</span>
                </button>
              </div>
            </div>
          </>
        )}
      </header>

      {/* Grid + Scrubber wrapper */}
      <div className="flex-1 relative overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="w-full h-full overflow-y-auto p-4 pr-3 [&::-webkit-scrollbar]:hidden"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch',
            willChange: 'scroll-position',
            transform: 'translateZ(0)',
          }}
        >
        {loading ? (

          <div className="h-full flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-2 border-[rgba(var(--primary-rgb),_0.2)] border-t-[var(--gold)] rounded-full animate-spin"></div>
            <p className="font-label text-[10px] uppercase tracking-[0.4em] text-[rgba(var(--primary-rgb),_0.4)]">Gathering Echoes...</p>
          </div>
        ) : filteredMemories.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-12 opacity-40">
            <span className="material-symbols-outlined text-6xl mb-4 text-[var(--gold)]">auto_awesome</span>
            <p className="font-serif italic text-xl text-[var(--gold)]">The gallery is a blank canvas.</p>
            <p className="text-xs tracking-widest uppercase mt-2">Shared media will bloom here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-8 pb-32">
            {throwbacks.length > 0 && !selectionMode && filter === 'all' && (
              <OnThisDayCard 
                throwbacks={throwbacks} 
                partnerPublicKey={partner?.public_key || ''} 
                onOpenMedia={(url, type, messageId) => setSelectedMedia({ url, type, messageId })}
              />
            )}

            <div
              className="flex flex-col gap-6"
              onTouchStart={handleGridTouchStart}
              onTouchMove={handleGridTouchMove}
              onTouchEnd={handleGridTouchEnd}
              style={{ touchAction: 'pan-y' }}
            >
              {groupedMemories.map(group => (
                <div key={group.dateKey} className="flex flex-col gap-2">
                  <h2 className="sticky top-[-1rem] z-10 py-4 font-bold text-sm text-white/80 bg-aura-bg-elevated/95 backdrop-blur-md shadow-[0_20px_50px_rgba(0,0,0,0.5)] -mx-4 px-4">
                    {group.dateLabel}
                  </h2>
                  <div
                    className={`grid gap-2 grid-flow-dense ${
                      densityFlash ? 'ring-2 ring-[rgba(var(--primary-rgb),_0.3)] rounded-xl' : ''
                    } ${
                      gridDensity === 2 ? 'grid-cols-2 auto-rows-[250px]' :
                      gridDensity === 3 ? 'grid-cols-3 auto-rows-[200px]' :
                      'grid-cols-4 auto-rows-[150px]'
                    }`}
                  >
                    {group.items.map((memory, index) => (
                      <MemoryCard
                        key={memory.id}
                        memory={memory}
                        index={index}
                        cardRef={cardRef}
                        onClick={() => handleTap(memory)}
                        onLongPress={() => handleLongPress(memory.id)}
                        onTouchStart={(e) => handleTouchStart(memory.id, e)}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                        isSelected={selectedIds.has(memory.id)}
                        selectionMode={selectionMode}
                        isFavorited={favorites.has(memory.id)}
                        onToggleFavorite={() => toggleFavorite(memory.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div id="infinite-scroll-sentinel" className="h-20 flex items-center justify-center">
              {isFetchingMore && (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-6 h-6 border-2 border-[rgba(var(--primary-rgb),_0.2)] border-t-[var(--gold)] rounded-full animate-spin"></div>
                  <span className="font-label text-[8px] uppercase tracking-[0.2em] text-[rgba(var(--primary-rgb),_0.4)]">Fetching fragments...</span>
                </div>
              )}
            </div>

            {!hasMore && filteredMemories.length > 0 && (
              <p className="text-center font-label text-[10px] text-white/20 uppercase tracking-[0.4em] mt-8">
                End of the gallery
              </p>
            )}
          </div>
        )}
        </div>

        {/* Timeline Scrubber – only visible when gallery is loaded */}
        {!loading && filteredMemories.length > 0 && (
          <TimelineScrubber
            items={filteredMemories}
            scrollContainerRef={scrollContainerRef}
          />
        )}
      </div>

      {/* Media Viewer */}
      <AnimatePresence>
        {selectedMedia && (
          <MediaViewer
            url={selectedMedia.url}
            type={selectedMedia.type as any}
            messageId={selectedMedia.messageId}
            allMedia={allMediaForViewer}
            initialIndex={selectedMedia.initialIndex ?? 0}
            showViewInChat={true}
            onClose={() => setSelectedMedia(null)}
          />
        )}
      </AnimatePresence>

      {/* Overlays */}
      <AnimatePresence>
        {viewMode === 'search' && (
          <SearchOverlay onClose={() => setViewMode('gallery')} />
        )}
        {viewMode === 'folders' && (
          <FoldersPanel
            onClose={() => setViewMode('gallery')}
            onOpenFolder={(folder) => {
              setActiveFolderView(folder);
              setViewMode('folder-view');
            }}
          />
        )}
        {viewMode === 'folder-view' && activeFolderView && (
          <FolderView
            folder={activeFolderView}
            onClose={() => {
              setActiveFolderView(null);
              setViewMode('folders');
            }}
          />
        )}
      </AnimatePresence>

      {/* Folder Picker Bottom Sheet */}
      <AnimatePresence>
        {showFolderPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end justify-center"
            onClick={() => setShowFolderPicker(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={e => e.stopPropagation()}
              className="bg-[var(--bg-elevated)] border-t border-white/10 rounded-t-3xl w-full max-w-lg max-h-[60vh] flex flex-col"
            >
              <div className="p-4 border-b border-white/5 shrink-0">
                <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4"></div>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-serif italic text-lg text-[var(--gold)]">Add to Collection</h3>
                    <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#998f81] mt-1">
                      {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected
                    </p>
                  </div>
                  <button
                    onClick={() => setIsCreatingInPicker(!isCreatingInPicker)}
                    className={`p-2 rounded-xl transition-all ${isCreatingInPicker ? 'bg-[var(--gold)] text-[var(--on-accent)]' : 'bg-white/5 text-[var(--gold)] border border-white/10 hover:bg-white/10'}`}
                  >
                    <span className="material-symbols-outlined text-[20px] block">{isCreatingInPicker ? 'close' : 'create_new_folder'}</span>
                  </button>
                </div>
              </div>

              {isCreatingInPicker && (
                <div className="p-4 bg-[var(--gold)]/5 border-b border-white/5 animate-in slide-in-from-top duration-300">
                  <p className="font-label text-[9px] uppercase tracking-[0.2em] text-[var(--gold)] mb-2 font-bold">New Collection Name</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newFolderNameInPicker}
                      onChange={e => setNewFolderNameInPicker(e.target.value)}
                      placeholder="e.g. Summer Trip 2026"
                      autoFocus
                      onKeyDown={e => e.key === 'Enter' && handleCreateAndAdd()}
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-[var(--gold)]/40 transition-colors"
                    />
                    <button
                      onClick={handleCreateAndAdd}
                      disabled={!newFolderNameInPicker.trim() || creatingInPicker}
                      className="px-4 py-2 rounded-xl bg-[var(--gold)] text-[var(--on-accent)] font-bold text-xs uppercase tracking-wider disabled:opacity-30"
                    >
                      {creatingInPicker ? '...' : 'Create & Add'}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {folders.length === 0 ? (
                  <p className="text-center text-white/30 text-sm py-8">No collections yet. Create one from the folder panel.</p>
                ) : (
                  <div className="space-y-2">
                    {folders.map(folder => (
                      <button
                        key={folder.id}
                        onClick={() => handleAddToFolder(folder.id)}
                        className="w-full flex items-center gap-4 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-[rgba(var(--primary-rgb),_0.2)] hover:bg-white/[0.06] transition-all text-left"
                      >
                        <span className="material-symbols-outlined text-[24px] text-[rgba(var(--primary-rgb),_0.5)]">folder</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white/80 truncate">{folder.name || 'Encrypted Folder'}</p>
                          <p className="font-label text-[9px] uppercase tracking-widest text-[#998f81]">
                            {folder.item_count || 0} item{(folder.item_count || 0) !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <span className="material-symbols-outlined text-[18px] text-white/20">add</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══ Memory Card Component ═══
interface MemoryCardProps {
  memory: MemoryItem;
  index: number;
  cardRef?: (node: HTMLDivElement | null) => void;
  onClick: () => void;
  onLongPress: () => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  isSelected: boolean;
  selectionMode: boolean;
  isFavorited: boolean;
  onToggleFavorite: () => void;
}

function MemoryCard({ memory, index, cardRef, onClick, onLongPress, onTouchStart, onTouchMove, onTouchEnd, isSelected, selectionMode, isFavorited, onToggleFavorite }: MemoryCardProps) {
  const isTall = index % 5 === 0;
  const isWide = index % 7 === 0;
  const lastTapRef = useRef<number>(0);
  const [showHeart, setShowHeart] = useState(false);
  const suppressClickRef = useRef<boolean>(false);

  const handlePointerDown = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // Double tap detected
      suppressClickRef.current = true;
      onToggleFavorite();
      if (!isFavorited) {
        setShowHeart(true);
        setTimeout(() => setShowHeart(false), 800);
      }
      lastTapRef.current = 0; // Reset to avoid triple tap
    } else {
      lastTapRef.current = now;
      suppressClickRef.current = false;
    }
  };

  const handleInternalClick = (e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      e.stopPropagation();
      suppressClickRef.current = false;
      return;
    }
    onClick();
  };

  return (
    <motion.div
      ref={cardRef}
      data-id={memory.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      onPointerDown={handlePointerDown}
      onClick={handleInternalClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onContextMenu={(e) => { e.preventDefault(); onLongPress(); }}
      className={`memory-card relative group rounded-[2rem] overflow-hidden bg-black/40 border cursor-pointer shadow-xl select-none ${
        isTall ? 'row-span-2' : isWide ? 'col-span-2' : ''
      } ${isSelected ? 'border-[var(--gold)] ring-2 ring-[rgba(var(--primary-rgb),_0.4)]' : 'border-white/5'}`}
      style={{
        contain: 'content',
        willChange: 'opacity',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      {memory.loading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[rgba(var(--primary-rgb),_0.2)] border-t-[var(--gold)] rounded-full animate-spin"></div>
        </div>
      ) : memory.decryptedUrl ? (
        <>
          {((memory.type as string) === 'image' || (memory.type as string) === 'gif' || (memory.type as string) === 'sticker') && (
            <img src={memory.decryptedUrl} className="w-full h-full object-cover" alt="Memory" loading="lazy" />
          )}
          {memory.type === 'video' && (
            <div className="w-full h-full relative">
              <video src={memory.decryptedUrl} className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <span className="material-symbols-outlined text-white text-3xl">play_circle</span>
              </div>
            </div>
          )}
          {memory.type === 'audio' && (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--bg-elevated)] gap-3">
              <span className="material-symbols-outlined text-4xl text-[var(--gold)]">mic</span>
              <span className="font-label text-[8px] uppercase tracking-widest text-[rgba(var(--primary-rgb),_0.6)]">Voice Fragment</span>
            </div>
          )}
          {memory.type === 'document' && (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--bg-elevated)] gap-3">
              <span className="material-symbols-outlined text-4xl text-[var(--gold)]">description</span>
              <span className="font-label text-[8px] uppercase tracking-widest text-[rgba(var(--primary-rgb),_0.6)]">Document</span>
            </div>
          )}

          {/* Hover Overlay (only in non-selection mode) */}
          {!selectionMode && (
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
              <span className="text-[9px] text-white/80 uppercase tracking-[0.2em] font-bold">
                {new Date(memory.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          )}

          {/* Selection Checkbox */}
          {selectionMode && (
            <div className="absolute top-3 right-3 z-10">
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                isSelected ? 'bg-[var(--gold)] border-[var(--gold)]' : 'bg-black/40 border-white/30 backdrop-blur-sm'
              }`}>
                {isSelected && <span className="material-symbols-outlined text-[16px] text-[var(--on-accent)]">check</span>}
              </div>
            </div>
          )}

          {/* Favorite Badge */}
          {isFavorited && !selectionMode && (
            <div className="absolute bottom-3 right-3 z-10">
              <motion.span 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="material-symbols-outlined text-red-500 fill-current text-[18px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                favorite
              </motion.span>
            </div>
          )}

          {/* Pop Heart Animation */}
          <AnimatePresence>
            {showHeart && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: [0, 1.5, 1], opacity: [0, 1, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, times: [0, 0.4, 1] }}
                className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none"
              >
                <span className="material-symbols-outlined text-red-500 text-6xl fill-current" style={{ fontVariationSettings: "'FILL' 1" }}>
                  favorite
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center opacity-20">
          <span className="material-symbols-outlined text-3xl mb-2">lock</span>
          <span className="font-label text-[8px] uppercase tracking-widest">Encrypted</span>
        </div>
      )}
    </motion.div>
  );
}
