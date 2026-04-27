import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { MediaFolder } from '../../hooks/useMediaFolders';
import { useMedia } from '../../hooks/useMedia';
import { usePartner } from '../../hooks/usePartner';
import { supabase } from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawMediaItem {
  id: string;
  media_url: string | null;
  media_key: string | null;
  media_nonce: string | null;
  sender_public_key: string | null;
  type: string | null;
  created_at: string;
}

interface DecryptedMediaItem extends RawMediaItem {
  decryptedUrl?: string;
  loadingDecrypt?: boolean;
  failedDecrypt?: boolean;
}

export interface SelectedMemoryMedia {
  messageId: string;
  media_url: string;
  media_key: string;
  media_nonce: string;
  type: string;
  decryptedUrl?: string;
}

interface FolderPickerPopupProps {
  /** Folders passed from parent (pre-fetched) */
  folders: MediaFolder[];
  /** Loading state passed from parent */
  foldersLoading: boolean;
  /** Called when a folder is picked (to show the bold chip) */
  onFolderSelect?: (name: string) => void;
  /** Currently selected media IDs (global) */
  selectedMediaIds: Set<string>;
  /** Called to toggle a specific media item */
  onToggleMedia: (item: SelectedMemoryMedia) => void;
  /** Called when the picker is dismissed without selection */
  onDismiss: () => void;
  /** The current search query typed after "/" */
  searchQuery: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 14;       // How many items to fetch at once from DB
const PRELOAD_AHEAD = 10;   // Prefetch next N items before user scrolls there
const VISIBLE_TRIGGER = 4;  // How many items from the end should trigger next load

// ─── Component ────────────────────────────────────────────────────────────────

export default function FolderPickerPopup({ 
  folders, 
  foldersLoading, 
  onFolderSelect,
  onToggleMedia,
  selectedMediaIds,
  onDismiss: _onDismiss, 
  searchQuery 
}: FolderPickerPopupProps) {
  const { getDecryptedBlob } = useMedia();
  const { partner } = usePartner();

  // ── Folder selection state ──
  const [selectedFolder, setSelectedFolder] = useState<MediaFolder | null>(null);

  // ── Media strip state ──
  const [items, setItems] = useState<DecryptedMediaItem[]>([]);
  const [allMessageIds, setAllMessageIds] = useState<string[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isTwoRow, setIsTwoRow] = useState(false);

  // ── Decryption tracking ──
  const decryptingRef = useRef<Set<string>>(new Set());
  const blobUrlsRef = useRef<Map<string, string>>(new Map());

  // ── Scroll ref for media strip ──
  const stripRef = useRef<HTMLDivElement>(null);

  // ─── Filtered folders ──────────────────────────────────────────────────────

  const filteredFolders = folders.filter(f => {
    if (!searchQuery) return true;
    return (f.name || '').toLowerCase().includes(searchQuery.toLowerCase());
  });

  // ─── Reset when folder changes ─────────────────────────────────────────────

  useEffect(() => {
    if (!selectedFolder) {
      // Auto-select folder if searchQuery matches exactly (Smart Logic)
      const exactMatch = folders.find(f => f.name?.toLowerCase() === searchQuery.toLowerCase());
      if (exactMatch) {
        setSelectedFolder(exactMatch);
        onFolderSelect?.(exactMatch.name || 'Folder');
        return;
      }
      return;
    }

    // Clear everything
    setItems([]);
    setAllMessageIds([]);
    setLoadedCount(0);
    setLoadError(false);

    // Revoke old blob URLs
    blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    blobUrlsRef.current.clear();
    decryptingRef.current.clear();

    loadFolderIndex(selectedFolder.id);
  }, [selectedFolder?.id, searchQuery, folders]);

  // ─── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      blobUrlsRef.current.clear();
      decryptingRef.current.clear();
    };
  }, []);

  // ─── Step 1: Load all message IDs for the folder (cheap — just IDs) ────────

  const loadFolderIndex = async (folderId: string) => {
    try {
      const { data, error } = await supabase
        .from('media_folder_items')
        .select('message_id')
        .eq('folder_id', folderId)
        .order('added_at', { ascending: false });

      if (error) throw error;
      const ids = (data || []).map(d => d.message_id);
      setAllMessageIds(ids);

      if (ids.length > 0) {
        await loadWindow(ids, 0);
      }
    } catch (err) {
      setLoadError(true);
    }
  };

  // ─── Step 2: Load a page of actual message rows ────────────────────────────

  const loadWindow = useCallback(async (ids: string[], fromIndex: number) => {
    const multiplier = isTwoRow ? 2 : 1;
    const effectivePageSize = PAGE_SIZE * multiplier;
    const effectivePreload = PRELOAD_AHEAD * multiplier;

    const slice = ids.slice(fromIndex, fromIndex + effectivePageSize + effectivePreload);
    if (slice.length === 0) return;

    setIsLoadingMedia(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id,media_url,media_key,media_nonce,sender_public_key,type,created_at')
        .in('id', slice)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = (data || []) as RawMediaItem[];

      setItems(prev => {
        // Merge without duplicates
        const existingIds = new Set(prev.map(p => p.id));
        const newRows = rows
          .filter(r => !existingIds.has(r.id))
          .map(r => ({ ...r, loadingDecrypt: true }));
        return [...prev, ...newRows];
      });

      const multiplier = isTwoRow ? 2 : 1;
      const effectivePageSize = PAGE_SIZE * multiplier;

      // Decrypt visible window (first PAGE_SIZE) eagerly, rest lazily
      rows.slice(0, effectivePageSize).forEach(item => decryptItem(item));
      // Preload the rest in the background
      setTimeout(() => {
        rows.slice(effectivePageSize).forEach(item => decryptItem(item));
      }, 300);

    } catch (err) {
      setLoadError(true);
    } finally {
      setIsLoadingMedia(false);
    }
  }, [partner?.public_key]);

  // ─── Step 3: Decrypt individual item ──────────────────────────────────────

  const decryptItem = useCallback(async (item: RawMediaItem) => {
    if (!partner?.public_key || !item.media_url || !item.media_key || !item.media_nonce) return;
    if (decryptingRef.current.has(item.id)) return;
    decryptingRef.current.add(item.id);

    try {
      const blob = await getDecryptedBlob(
        item.media_url,
        item.media_key,
        item.media_nonce,
        partner.public_key,
        item.sender_public_key || undefined,
        undefined,
        item.type || undefined,
      );

      if (blob) {
        const url = URL.createObjectURL(blob);
        blobUrlsRef.current.set(item.id, url);
        setItems(prev => prev.map(p =>
          p.id === item.id ? { ...p, decryptedUrl: url, loadingDecrypt: false } : p
        ));
      } else {
        setItems(prev => prev.map(p =>
          p.id === item.id ? { ...p, loadingDecrypt: false, failedDecrypt: true } : p
        ));
      }
    } catch {
      decryptingRef.current.delete(item.id); // allow retry
      setItems(prev => prev.map(p =>
        p.id === item.id ? { ...p, loadingDecrypt: false, failedDecrypt: true } : p
      ));
    }
  }, [partner?.public_key, getDecryptedBlob]);
  
  // Re-trigger decryption when partner key becomes available
  useEffect(() => {
    if (partner?.public_key && items.length > 0) {
      items.forEach(item => {
        if (!item.decryptedUrl && !item.failedDecrypt) {
          decryptItem(item);
        }
      });
    }
  }, [partner?.public_key, items.length, decryptItem]);

  // ─── Windowed scroll trigger ───────────────────────────────────────────────

  const handleStripScroll = useCallback(() => {
    const el = stripRef.current;
    if (!el || isLoadingMedia) return;

    // Items visible at current scroll position (approximate by item width ~88px)
    const itemWidth = isTwoRow ? 88 : 88;
    const scrolledItems = Math.floor(el.scrollLeft / itemWidth);
    const visibleCount = Math.ceil(el.clientWidth / itemWidth);
    const lastVisible = scrolledItems + visibleCount;

    // If user is VISIBLE_TRIGGER items away from the loaded boundary, fetch next page
    const multiplier = isTwoRow ? 2 : 1;
    const effectiveVisible = lastVisible * multiplier;
    const effectiveTrigger = VISIBLE_TRIGGER * multiplier;

    if (effectiveVisible >= loadedCount - effectiveTrigger && loadedCount < allMessageIds.length) {
      loadWindow(allMessageIds, loadedCount);
    }
  }, [isLoadingMedia, loadedCount, allMessageIds, loadWindow, isTwoRow]);

  // ─── Selection Logic ──────────────────────────────────────────────────────

  const handleToggleSelect = (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item || !item.media_url || !item.media_key || !item.media_nonce || !item.type) return;

    onToggleMedia({
      messageId: item.id,
      media_url: item.media_url,
      media_key: item.media_key,
      media_nonce: item.media_nonce,
      type: item.type,
      decryptedUrl: item.decryptedUrl
    });
  };



  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.97 }}
      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
      className="w-full max-w-[720px] mx-auto mb-2 relative z-50"
    >
      <div className="bg-aura-bg-elevated/95 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden">

        {/* ── Phase 1: Folder list ─────────────────────────────────────── */}
        {!selectedFolder && (
          <div className="p-2">
            {foldersLoading ? (
              <div className="flex items-center justify-center py-6 gap-3">
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-xs text-aura-text-secondary uppercase tracking-widest">Loading...</span>
              </div>
            ) : filteredFolders.length === 0 ? (
              <div className="flex items-center justify-center py-6 gap-2 opacity-50">
                <span className="material-symbols-outlined text-xl text-primary">folder_off</span>
                <span className="text-xs text-aura-text-secondary">
                  {searchQuery ? `No folders matching "${searchQuery}"` : 'No folders yet'}
                </span>
              </div>
            ) : (
              <div
                className="flex flex-col gap-0.5 max-h-[180px] overflow-y-auto scrollbar-hide"
                style={{ maxHeight: '180px' }}
              >
                {/* Show max 4 visible, rest scrollable */}
                {filteredFolders.map((folder, idx) => (
                  <motion.button
                    key={folder.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    onClick={() => {
                      setSelectedFolder(folder);
                      onFolderSelect?.(folder.name || 'Folder');
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/8 active:bg-white/12 transition-colors text-left group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0 group-hover:bg-primary/25 transition-colors">
                      <span className="material-symbols-outlined text-[16px] text-primary">folder</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-aura-text-primary font-medium truncate">{folder.name || 'Folder'}</p>
                      <p className="text-[10px] text-aura-text-secondary uppercase tracking-wider">
                        {folder.item_count ?? 0} item{(folder.item_count ?? 0) !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <span className="material-symbols-outlined text-[16px] text-aura-text-secondary/40 group-hover:text-primary/60 transition-colors">chevron_right</span>
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Phase 2: Folder selected — media strip ───────────────────── */}
        {selectedFolder && (
          <div>
            {/* Header bar */}
            <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 border-b border-white/5">
              <button
                onClick={() => { setSelectedFolder(null); setItems([]); }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors shrink-0"
              >
                <span className="material-symbols-outlined text-[16px] text-aura-text-secondary">arrow_back</span>
              </button>

              {/* Folder name chip (bold, gold) */}
              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px] text-primary shrink-0">folder</span>
                <span className="text-sm font-bold text-primary truncate">{selectedFolder.name}</span>
              </div>

              {/* Expand toggle (1 row / 2 row) */}
              <button
                onClick={() => setIsTwoRow(v => !v)}
                title={isTwoRow ? 'Collapse to 1 row' : 'Expand to 2 rows'}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors shrink-0"
              >
                <motion.span
                  animate={{ rotate: isTwoRow ? 180 : 0 }}
                  transition={{ duration: 0.25 }}
                  className="material-symbols-outlined text-[16px] text-aura-text-secondary"
                >
                  expand_less
                </motion.span>
              </button>

            </div>

            {/* Media Strip */}
            <motion.div
              animate={{ height: isTwoRow ? 176 : 96 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              {items.length === 0 && isLoadingMedia ? (
                /* Shimmer loading */
                <div 
                  className="grid grid-flow-col gap-2 px-2 py-2 h-full items-center"
                  style={{ gridTemplateRows: isTwoRow ? 'repeat(2, 80px)' : 'repeat(1, 80px)' }}
                >
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="shrink-0 rounded-xl bg-white/5 chunk-shimmer relative overflow-hidden"
                      style={{ width: 80, height: 80 }}
                    />
                  ))}
                </div>
              ) : loadError ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 px-4">
                  <span className="material-symbols-outlined text-danger text-2xl">error</span>
                  <div className="flex flex-col items-center">
                    <span className="text-xs text-aura-text-secondary">Failed to load media</span>
                    <button 
                      onClick={() => { setLoadError(false); loadFolderIndex(selectedFolder.id); }}
                      className="mt-2 text-[10px] font-bold uppercase tracking-widest text-primary hover:underline"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              ) : items.length === 0 ? (
                <div className="flex items-center justify-center h-full gap-2 opacity-40 px-4">
                  <span className="material-symbols-outlined text-lg text-primary">photo_library</span>
                  <span className="text-xs text-aura-text-secondary">No media in this folder</span>
                </div>
              ) : (
                <div
                  ref={stripRef}
                  onScroll={handleStripScroll}
                  className="grid grid-flow-col overflow-x-auto overflow-y-hidden gap-2 px-2 py-2 h-full scrollbar-hide"
                  style={{ 
                    gridTemplateRows: isTwoRow ? 'repeat(2, 80px)' : 'repeat(1, 80px)',
                    scrollSnapType: 'x mandatory',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  {items.map(item => {
                    const isSelected = selectedMediaIds.has(item.id);
                    const tileSize = isTwoRow ? 80 : 80;

                    return (
                      <div
                        key={item.id}
                        className="relative shrink-0 rounded-xl overflow-hidden cursor-pointer select-none"
                        style={{
                          width: tileSize,
                          height: tileSize,
                          scrollSnapAlign: 'start',
                          border: isSelected ? '2px solid #eab308' : '2px solid transparent', // vibrant gold accent
                          boxShadow: isSelected ? '0 0 15px rgba(234, 179, 8, 0.3)' : 'none',
                          transition: 'border-color 0.15s ease, transform 0.1s ease',
                          transform: isSelected ? 'scale(0.93)' : 'scale(1)',
                        }}
                        onClick={() => handleToggleSelect(item.id)}
                        onContextMenu={e => e.preventDefault()}
                      >
                        {/* Thumbnail / Shimmer */}
                        {item.loadingDecrypt ? (
                          <div className="w-full h-full bg-white/5 chunk-shimmer relative overflow-hidden rounded-xl" />
                        ) : item.decryptedUrl ? (
                          item.type === 'video' ? (
                            <>
                              <video
                                src={item.decryptedUrl}
                                className="w-full h-full object-cover"
                                muted
                                playsInline
                                preload="metadata"
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                <span className="material-symbols-outlined text-white text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>play_circle</span>
                              </div>
                            </>
                          ) : (
                            <img
                              src={item.decryptedUrl}
                              alt="Memory"
                              className="w-full h-full object-cover"
                              draggable={false}
                            />
                          )
                        ) : (
                          /* Failed / no URL */
                          <div className="w-full h-full bg-white/5 rounded-xl flex items-center justify-center">
                            <span className="material-symbols-outlined text-sm text-white/20">lock</span>
                          </div>
                        )}

                        {/* Selection overlay */}
                        <AnimatePresence>
                          {isSelected && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="absolute inset-0 bg-primary/30 flex items-start justify-end p-1"
                            >
                              <div className="w-5 h-5 rounded-full bg-primary shadow-glow-gold flex items-center justify-center">
                                <span className="material-symbols-outlined text-[12px] text-background" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Type badge for video */}
                        {item.type === 'video' && !isSelected && (
                          <div className="absolute bottom-1 left-1 px-1 py-0.5 bg-black/60 rounded text-[8px] text-white/70 uppercase tracking-wider">
                            vid
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Load more shimmer tiles if more available */}
                  {loadedCount < allMessageIds.length && (
                    <>
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div
                          key={`shimmer-${i}`}
                          className="shrink-0 rounded-xl bg-white/5 chunk-shimmer relative overflow-hidden"
                          style={{ width: 80, height: 80 }}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
