import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import { useMediaFolders, type MediaFolder } from '../../hooks/useMediaFolders';
import type { Database } from '../../integrations/supabase/types';
import MediaViewer from '../chat/MediaViewer';
import SearchOverlay from './SearchOverlay';
import FoldersPanel from './FoldersPanel';
import FolderView from './FolderView';

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
  const { folders, addItemsToFolder } = useMediaFolders();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'audio' | 'document'>('all');
  const [selectedMedia, setSelectedMedia] = useState<{ url: string, type: string } | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const LIMIT = 12;

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('gallery');
  const [activeFolderView, setActiveFolderView] = useState<MediaFolder | null>(null);

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchMemories(1);
  }, [user?.id, partner?.id]);

  useEffect(() => {
    return () => {
      memories.forEach(m => {
        if (m.decryptedUrl) URL.revokeObjectURL(m.decryptedUrl);
      });
    };
  }, [memories]);

  // Hide mobile navbar when overlays or selection modes are active
  useEffect(() => {
    if (viewMode !== 'gallery' || selectionMode || showFolderPicker) {
      document.dispatchEvent(new CustomEvent('hide-global-nav'));
    } else {
      document.dispatchEvent(new CustomEvent('show-global-nav'));
    }
  }, [viewMode, selectionMode, showFolderPicker]);

  useEffect(() => {
    return () => {
      document.dispatchEvent(new CustomEvent('show-global-nav'));
    };
  }, []);

  const fetchMemories = async (pageNumber = 1) => {
    if (!user || !partner) return;
    if (pageNumber === 1) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id,sender_id,media_url,media_key,media_nonce,type,created_at,sender_public_key', { count: 'exact' })
        .not('media_url', 'is', null)
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
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

      setHasMore(newMemories.length === LIMIT);
    } catch (err) {
      console.error('Error fetching memories:', err);
    } finally {
      if (pageNumber === 1) setLoading(false);
    }
  };

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchMemories(nextPage);
  };

  const decryptMedia = async (memory: MemoryItem) => {
    if (memory.decryptedUrl || !partner?.public_key || !memory.media_url || !memory.media_key || !memory.media_nonce) return;

    setMemories(prev => prev.map(m => m.id === memory.id ? { ...m, loading: true } : m));

    try {
      const blob = await getDecryptedBlob(
        memory.media_url,
        memory.media_key,
        memory.media_nonce,
        partner.public_key
      );
      if (blob) {
        const url = URL.createObjectURL(blob);
        setMemories(prev => prev.map(m => m.id === memory.id ? { ...m, decryptedUrl: url, loading: false } : m));
      }
    } catch (err) {
      console.error('Decryption failed for memory:', memory.id, err);
      setMemories(prev => prev.map(m => m.id === memory.id ? { ...m, loading: false } : m));
    }
  };

  const filteredMemories = memories.filter(m => {
    if (filter === 'all') return true;
    return m.type === filter;
  });

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
        setSelectedMedia({ url: memory.decryptedUrl, type: memory.type || 'image' });
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
    }
  };

  // Touch event handlers for long-press
  const handleTouchStart = (id: string) => {
    longPressTimerRef.current = setTimeout(() => {
      handleLongPress(id);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  return (
    <div className="w-full h-full bg-[#0d0d15] flex flex-col font-sans overflow-hidden relative">
      {/* Header */}
      <header className="px-4 pt-6 pb-4 flex flex-col gap-4 border-b border-white/5 bg-black/20 shrink-0">
        {selectionMode ? (
          /* Selection Mode Header */
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={cancelSelection} className="p-2 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[#e6c487] transition-all">
                <span className="material-symbols-outlined text-[20px] block">close</span>
              </button>
              <p className="text-sm text-white/80 font-medium">{selectedIds.size} selected</p>
            </div>
            <button
              onClick={() => setShowFolderPicker(true)}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#e6c487]/10 border border-[#e6c487]/20 text-[#e6c487] hover:bg-[#e6c487]/20 transition-all disabled:opacity-30"
            >
              <span className="material-symbols-outlined text-[18px]">folder</span>
              <span className="text-xs font-bold uppercase tracking-wider">Add to Collection</span>
            </button>
          </div>
        ) : (
          /* Normal Header */
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="font-serif italic text-2xl text-[#e6c487]">Sanctuary Gallery</h1>
                <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#998f81]">A visual archive of our shared journey</p>
              </div>
              
              <button
                onClick={() => setViewMode('folders')}
                className="p-2 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[#e6c487] hover:bg-white/10 transition-all group"
              >
                <span className="material-symbols-outlined text-[20px] block group-hover:scale-110 transition-transform">folder</span>
              </button>
            </div>

            {/* Filters & Search Row */}
            <div className="relative flex items-center">
              {/* Scrollable Filters */}
              <div className="flex-1 overflow-x-auto no-scrollbar scroll-smooth flex gap-2 pr-12">
                {['all', 'image', 'video', 'audio', 'document'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f as any)}
                    className={`px-5 py-1.5 rounded-full text-[10px] font-label uppercase tracking-widest border transition-all whitespace-nowrap ${filter === f
                        ? 'bg-[#e6c487] text-[#412d00] border-[#e6c487] font-bold shadow-md shadow-[#e6c487]/10'
                        : 'bg-transparent text-[#998f81] border-white/10 hover:border-white/20'
                      }`}
                  >
                    {f === 'all' ? 'All' : f + 's'}
                  </button>
                ))}
              </div>

              {/* Static Search Icon / Bar with Fade */}
              <div className="absolute right-0 top-0 bottom-0 flex items-center pl-8 bg-gradient-to-l from-[#0d0d15] via-[#0d0d15]/90 to-transparent">
                <button
                  onClick={() => setViewMode('search')}
                  className="flex items-center gap-3 p-2 px-3 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[#e6c487] hover:bg-white/10 hover:border-white/20 transition-all group lg:min-w-[200px]"
                >
                  <span className="material-symbols-outlined text-[20px] block group-hover:scale-110 transition-transform">search</span>
                  <span className="hidden lg:block text-[10px] font-label uppercase tracking-[0.2em] text-[#998f81]/60 font-bold whitespace-nowrap">Search by date</span>
                </button>
              </div>
            </div>
          </>
        )}
      </header>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-2 border-[#e6c487]/20 border-t-[#e6c487] rounded-full animate-spin"></div>
            <p className="font-label text-[10px] uppercase tracking-[0.4em] text-[#e6c487]/40">Gathering Echoes...</p>
          </div>
        ) : filteredMemories.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-12 opacity-40">
            <span className="material-symbols-outlined text-6xl mb-4 text-[#e6c487]">auto_awesome</span>
            <p className="font-serif italic text-xl text-[#e6c487]">The gallery is a blank canvas.</p>
            <p className="text-xs tracking-widest uppercase mt-2">Shared media will bloom here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-8 pb-32">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 auto-rows-[200px]">
              {filteredMemories.map((memory, index) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  index={index}
                  onDecrypt={() => decryptMedia(memory)}
                  onClick={() => handleTap(memory)}
                  onLongPress={() => handleLongPress(memory.id)}
                  onTouchStart={() => handleTouchStart(memory.id)}
                  onTouchEnd={handleTouchEnd}
                  isSelected={selectedIds.has(memory.id)}
                  selectionMode={selectionMode}
                />
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center mt-4">
                <button
                  onClick={loadMore}
                  className="px-8 py-3 rounded-full border border-white/10 text-[#e6c487] font-serif italic hover:bg-white/5 transition-colors"
                >
                  Load More Fragments
                </button>
              </div>
            )}

            {!hasMore && filteredMemories.length > 0 && (
              <p className="text-center font-label text-[10px] text-white/20 uppercase tracking-[0.4em] mt-8">
                End of the gallery
              </p>
            )}
          </div>
        )}
      </div>

      {/* Media Viewer */}
      <AnimatePresence>
        {selectedMedia && (
          <MediaViewer
            url={selectedMedia.url}
            type={selectedMedia.type as any}
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
              className="bg-[#1b1b23] border-t border-white/10 rounded-t-3xl w-full max-w-lg max-h-[60vh] flex flex-col"
            >
              <div className="p-4 border-b border-white/5 shrink-0">
                <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4"></div>
                <h3 className="font-serif italic text-lg text-[#e6c487]">Add to Collection</h3>
                <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#998f81] mt-1">
                  {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected
                </p>
              </div>

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {folders.length === 0 ? (
                  <p className="text-center text-white/30 text-sm py-8">No collections yet. Create one from the folder panel.</p>
                ) : (
                  <div className="space-y-2">
                    {folders.map(folder => (
                      <button
                        key={folder.id}
                        onClick={() => handleAddToFolder(folder.id)}
                        className="w-full flex items-center gap-4 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-[#e6c487]/20 hover:bg-white/[0.06] transition-all text-left"
                      >
                        <span className="material-symbols-outlined text-[24px] text-[#e6c487]/50">folder</span>
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
  onDecrypt: () => void;
  onClick: () => void;
  onLongPress: () => void;
  onTouchStart: () => void;
  onTouchEnd: () => void;
  isSelected: boolean;
  selectionMode: boolean;
}

function MemoryCard({ memory, index, onDecrypt, onClick, onLongPress, onTouchStart, onTouchEnd, isSelected, selectionMode }: MemoryCardProps) {
  const isTall = index % 5 === 0;
  const isWide = index % 7 === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ scale: selectionMode ? 1 : 1.02 }}
      viewport={{ once: true, margin: "300px" }}
      onViewportEnter={onDecrypt}
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onContextMenu={(e) => { e.preventDefault(); onLongPress(); }}
      className={`relative group rounded-[2rem] overflow-hidden bg-black/40 border cursor-pointer shadow-xl select-none ${
        isTall ? 'row-span-2' : isWide ? 'col-span-2' : ''
      } ${isSelected ? 'border-[#e6c487] ring-2 ring-[#e6c487]/40' : 'border-white/5'}`}
    >
      {memory.loading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#e6c487]/20 border-t-[#e6c487] rounded-full animate-spin"></div>
        </div>
      ) : memory.decryptedUrl ? (
        <>
          {memory.type === 'image' && (
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
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#1b1b23] gap-3">
              <span className="material-symbols-outlined text-4xl text-[#e6c487]">mic</span>
              <span className="font-label text-[8px] uppercase tracking-widest text-[#e6c487]/60">Voice Fragment</span>
            </div>
          )}
          {memory.type === 'document' && (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#1b1b23] gap-3">
              <span className="material-symbols-outlined text-4xl text-[#e6c487]">description</span>
              <span className="font-label text-[8px] uppercase tracking-widest text-[#e6c487]/60">Document</span>
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
                isSelected ? 'bg-[#e6c487] border-[#e6c487]' : 'bg-black/40 border-white/30 backdrop-blur-sm'
              }`}>
                {isSelected && <span className="material-symbols-outlined text-[16px] text-[#412d00]">check</span>}
              </div>
            </div>
          )}
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
