import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import { useMediaFolders, type MediaFolder } from '../../hooks/useMediaFolders';
import type { Database } from '../../integrations/supabase/types';
import MediaViewer from '../chat/MediaViewer';

type MessageRow = Database['public']['Tables']['messages']['Row'];
type LayoutMode = '2col' | '3col' | '4col' | 'bento';

interface MemoryItem extends MessageRow {
  decryptedUrl?: string;
  loading?: boolean;
}

interface FolderViewProps {
  folder: MediaFolder;
  onClose: () => void;
}

export default function FolderView({ folder, onClose }: FolderViewProps) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();
  const { fetchFolderItems, removeItemFromFolder } = useMediaFolders();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: string } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('bento');

  const getLayoutClasses = () => {
    switch (layoutMode) {
      case '2col': return 'grid grid-cols-2 gap-2 auto-rows-[200px] md:auto-rows-[250px]';
      case '3col': return 'grid grid-cols-3 gap-2 auto-rows-[160px] md:auto-rows-[200px]';
      case '4col': return 'grid grid-cols-4 gap-2 auto-rows-[120px] md:auto-rows-[180px]';
      case 'bento': return 'grid grid-flow-dense grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 auto-rows-[140px] md:auto-rows-[180px]';
    }
  };

  const getItemClasses = (index: number) => {
    const base = "relative group rounded-2xl overflow-hidden bg-black/40 border border-white/5 cursor-pointer hover:border-[rgba(var(--primary-rgb),_0.3)] transition-all duration-300";
    if (layoutMode !== 'bento') return base;
    
    const pattern = index % 8;
    let bentoClass = '';
    
    if (pattern === 0) bentoClass = 'col-span-2 row-span-2';
    else if (pattern === 3) bentoClass = 'col-span-2 row-span-1';
    else if (pattern === 4) bentoClass = 'row-span-2';
    else if (pattern === 7) bentoClass = 'col-span-2 row-span-2 md:col-span-2 md:row-span-2';
    else bentoClass = 'col-span-1 row-span-1';
    
    return `${base} ${bentoClass}`;
  };

  // Track which IDs we've already started decrypting to avoid stale-closure re-entry
  const decryptingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (user?.id && partner?.id) {
      loadFolderItems();
    }
  }, [folder.id, user?.id, partner?.id]);

  useEffect(() => {
    return () => {
      decryptingRef.current.clear();
    };
  }, []);

  const loadFolderItems = async () => {
    if (!user || !partner) return;
    setLoadingItems(true);
    decryptingRef.current.clear();

    try {
      const messageIds = await fetchFolderItems(folder.id);
      if (messageIds.length === 0) {
        setItems([]);
        setLoadingItems(false);
        return;
      }

      const { data, error } = await supabase
        .from('messages')
        .select('id,sender_id,media_url,media_key,media_nonce,type,created_at,sender_public_key')
        .in('id', messageIds)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const loaded = (data || []) as MemoryItem[];
      setLoadingItems(false);
      setItems(loaded);

      // Kick off decryption for ALL items immediately after load
      // Folder collections are small (usually 1–50 items), so eager load is fine
      loaded.forEach(item => decryptItem(item));
    } catch (err) {
      
      setLoadingItems(false);
    }
  };

  const decryptItem = async (memory: MemoryItem) => {
    if (!partner?.public_key || !memory.media_url || !memory.media_key || !memory.media_nonce) return;
    if (decryptingRef.current.has(memory.id)) return;
    decryptingRef.current.add(memory.id);

    setItems(prev => prev.map(m => m.id === memory.id ? { ...m, loading: true } : m));

    try {
      const blob = await getDecryptedBlob(
        memory.media_url,
        memory.media_key,
        memory.media_nonce,
        partner.public_key
      );
      if (blob) {
        const url = URL.createObjectURL(blob);
        setItems(prev => prev.map(m => m.id === memory.id ? { ...m, decryptedUrl: url, loading: false } : m));
      } else {
        setItems(prev => prev.map(m => m.id === memory.id ? { ...m, loading: false } : m));
      }
    } catch (err) {
      
      setItems(prev => prev.map(m => m.id === memory.id ? { ...m, loading: false } : m));
      decryptingRef.current.delete(memory.id); // allow retry on failure
    }
  };

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      items.forEach(r => { if (r.decryptedUrl) URL.revokeObjectURL(r.decryptedUrl); });
    };
  }, [items]);

  const handleRemove = async (messageId: string) => {
    await removeItemFromFolder(folder.id, messageId);
    setItems(prev => prev.filter(m => m.id !== messageId));
    setRemovingId(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 bg-[var(--bg-primary)] flex flex-col"
    >
      {/* Header */}
      <div className="px-4 pt-6 pb-3 border-b border-white/5 bg-black/20 shrink-0">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <button onClick={onClose} className="p-2 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[var(--gold)] transition-all">
            <span className="material-symbols-outlined text-[20px] block">arrow_back</span>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-serif italic text-xl text-[var(--gold)] truncate">{folder.name || 'Encrypted Folder'}</h2>
            <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#998f81]">
              {items.length} item{items.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Layout Controls */}
      <div className="px-4 pt-1 pb-2 flex items-center justify-end gap-4 overflow-x-auto hide-scrollbar z-20">
        <div className="flex items-center gap-1 bg-white/5 backdrop-blur-md p-1 rounded-2xl border border-white/10 relative shrink-0">
          {(['2col', '3col', '4col', 'bento'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setLayoutMode(mode)}
              className={`relative px-4 py-2 rounded-xl transition-all flex items-center justify-center gap-2 z-10 ${layoutMode === mode ? 'text-[var(--bg-elevated)]' : 'text-white/40 hover:text-white/80'}`}
              title={`${mode} view`}
            >
              <span className={`material-symbols-outlined block relative z-10 ${
                mode === '2col' ? 'text-[22px]' : 
                mode === '3col' ? 'text-[26px]' : 
                mode === '4col' ? 'text-[26px]' : 
                'text-[22px]'
              }`}>
                {mode === '2col' && 'grid_view'}
                {mode === '3col' && 'view_module'}
                {mode === '4col' && 'apps'}
                {mode === 'bento' && 'dashboard'}
              </span>
              
              {layoutMode === mode && (
                <motion.span
                  initial={{ opacity: 0, width: 0, marginLeft: 0 }}
                  animate={{ opacity: 1, width: 'auto', marginLeft: 4 }}
                  exit={{ opacity: 0, width: 0, marginLeft: 0 }}
                  transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                  className="font-bold text-[10px] uppercase tracking-wider relative z-10 whitespace-nowrap overflow-hidden"
                >
                  {mode === '2col' && '2x2'}
                  {mode === '3col' && '3x3'}
                  {mode === '4col' && '4x4'}
                  {mode === 'bento' && 'Bento'}
                </motion.span>
              )}

              {layoutMode === mode && (
                <motion.div
                  layoutId="activeLayout"
                  className="absolute inset-0 bg-[var(--gold)] rounded-xl -z-10 shadow-[0_4px_15px_rgba(var(--primary-rgb),0.3)]"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {loadingItems ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-2 border-[rgba(var(--primary-rgb),_0.2)] border-t-[var(--gold)] rounded-full animate-spin"></div>
            <p className="font-label text-[10px] uppercase tracking-[0.4em] text-[rgba(var(--primary-rgb),_0.4)]">Loading Collection...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-12 opacity-40">
            <span className="material-symbols-outlined text-6xl mb-4 text-[var(--gold)]">folder_open</span>
            <p className="font-serif italic text-xl text-[var(--gold)]">Empty collection</p>
            <p className="text-xs tracking-widest uppercase mt-2">Add media from the gallery to this collection</p>
          </div>
        ) : (
          <motion.div 
            layout 
            className={getLayoutClasses()} 
            transition={{ 
              layout: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } 
            }}
          >
            {items.map((memory, index) => (
              <motion.div
                layout
                key={memory.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ 
                  opacity: { duration: 0.5 },
                  y: { duration: 0.5 },
                  layout: { duration: 0.6, ease: [0.4, 0, 0.2, 1] }
                }}
                className={getItemClasses(index)}
              >
                <div className="w-full h-full" onClick={() => memory.decryptedUrl && setSelectedMedia({ url: memory.decryptedUrl, type: memory.type || 'image' })}>
                  {memory.loading ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-[rgba(var(--primary-rgb),_0.2)] border-t-[var(--gold)] rounded-full animate-spin"></div>
                    </div>
                  ) : memory.decryptedUrl ? (
                    <>
                      {memory.type === 'image' && (
                        <img src={memory.decryptedUrl} className="w-full h-full object-cover object-center" alt="Memory" />
                      )}
                      {memory.type === 'video' && (
                        <div className="w-full h-full relative">
                          <video src={memory.decryptedUrl} className="w-full h-full object-cover object-center" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <span className="material-symbols-outlined text-white text-3xl">play_circle</span>
                          </div>
                        </div>
                      )}
                      {memory.type === 'audio' && (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--bg-elevated)] gap-3">
                          <span className="material-symbols-outlined text-4xl text-[var(--gold)]">mic</span>
                          <span className="font-label text-[8px] uppercase tracking-widest text-[rgba(var(--primary-rgb),_0.6)]">Voice</span>
                        </div>
                      )}
                      {memory.type === 'document' && (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--bg-elevated)] gap-3">
                          <span className="material-symbols-outlined text-4xl text-[var(--gold)]">description</span>
                          <span className="font-label text-[8px] uppercase tracking-widest text-[rgba(var(--primary-rgb),_0.6)]">Document</span>
                        </div>
                      )}

                      {/* Date badge */}
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur-sm rounded-lg">
                        <span className="text-[9px] text-white/60 uppercase tracking-wider">
                          {new Date(memory.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center opacity-20">
                      <span className="material-symbols-outlined text-3xl mb-2">lock</span>
                      <span className="font-label text-[8px] uppercase tracking-widest">Encrypted</span>
                    </div>
                  )}
                </div>

                {/* Remove button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setRemovingId(memory.id); }}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-white/40 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
                >
                  <span className="material-symbols-outlined text-[14px] block">remove_circle</span>
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Remove Confirmation */}
      <AnimatePresence>
        {removingId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-8"
            onClick={() => setRemovingId(null)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={e => e.stopPropagation()}
              className="bg-[var(--bg-elevated)] border border-white/10 rounded-2xl p-6 max-w-sm w-full"
            >
              <h3 className="font-serif italic text-lg text-[var(--gold)] mb-2">Remove from Collection?</h3>
              <p className="text-sm text-white/50 mb-6">This will only remove it from this collection. The file won't be deleted.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setRemovingId(null)}
                  className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => removingId && handleRemove(removingId)}
                  className="flex-1 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-bold hover:bg-red-500/30 transition-colors"
                >
                  Remove
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Media Viewer */}
      {selectedMedia && (
        <MediaViewer
          url={selectedMedia.url}
          type={selectedMedia.type as any}
          onClose={() => setSelectedMedia(null)}
        />
      )}
    </motion.div>
  );
}
