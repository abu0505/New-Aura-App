import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMediaFolders, type MediaFolder } from '../../hooks/useMediaFolders';
import { useMedia } from '../../hooks/useMedia';
import { usePartner } from '../../hooks/usePartner';
import { supabase } from '../../lib/supabase';

interface FoldersPanelProps {
  onClose: () => void;
  onOpenFolder: (folder: MediaFolder) => void;
}

// Sub-component to handle decryption of a single folder's cover image
function FolderCover({ messageId }: { messageId: string }) {
  const { getDecryptedBlob } = useMedia();
  const { partner } = usePartner();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadCover = async () => {
      if (!partner?.public_key) return;
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('media_url, media_key, media_nonce')
          .eq('id', messageId)
          .single();

        if (error || !data) throw error || new Error('No data');

        const blob = await getDecryptedBlob(
          data.media_url!,
          data.media_key!,
          data.media_nonce!,
          partner.public_key
        );

        if (blob && active) {
          setUrl(URL.createObjectURL(blob));
        }
      } catch (err) {
        
      } finally {
        if (active) setLoading(false);
      }
    };

    loadCover();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [messageId, partner?.public_key]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[rgba(var(--primary-rgb),_0.05)]">
        <div className="w-4 h-4 border border-[rgba(var(--primary-rgb),_0.2)] border-t-[var(--gold)] rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[rgba(var(--primary-rgb),_0.05)]">
        <span className="material-symbols-outlined text-[48px] text-[rgba(var(--primary-rgb),_0.2)]">folder</span>
      </div>
    );
  }

  return (
    <img
      src={url}
      className="w-full h-full object-cover object-center"
      alt="Folder Preview"
    />
  );
}

export default function FoldersPanel({ onClose, onOpenFolder }: FoldersPanelProps) {
  const { folders, loading, createFolder, deleteFolder } = useMediaFolders();
  const [showCreate, setShowCreate] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<'2col' | '3col' | '4col'>('3col');

  const getLayoutClasses = () => {
    switch (layoutMode) {
      case '2col': return 'grid grid-cols-2 gap-3 md:gap-4';
      case '3col': return 'grid grid-cols-3 gap-2 md:gap-3';
      case '4col': return 'grid grid-cols-4 gap-1.5 md:gap-2';
      default: return 'grid grid-cols-3 gap-2 md:gap-3';
    }
  };

  const getCoverHeight = () => {
    switch (layoutMode) {
      case '2col': return 'h-40 sm:h-48';
      case '3col': return 'h-28 sm:h-32';
      case '4col': return 'h-24 sm:h-28';
      default: return 'h-28';
    }
  };

  const handleCreate = async () => {
    if (!newFolderName.trim()) return;
    setCreating(true);
    await createFolder(newFolderName.trim());
    setNewFolderName('');
    setShowCreate(false);
    setCreating(false);
  };

  const handleDelete = async (folderId: string) => {
    await deleteFolder(folderId);
    setConfirmDelete(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 bg-[var(--bg-primary)] flex flex-col"
    >
      {/* Header */}
      <div className="px-4 pt-6 pb-4 border-b border-white/5 bg-black/20 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onClose} className="p-2 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[var(--gold)] transition-all">
              <span className="material-symbols-outlined text-[20px] block">arrow_back</span>
            </button>
            <div>
              <h2 className="font-serif italic text-xl text-[var(--gold)]">Collections</h2>
              <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#998f81]">
                {folders.length} collection{folders.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreate(true)}
              className="p-2 rounded-xl bg-[rgba(var(--primary-rgb),_0.1)] border border-[rgba(var(--primary-rgb),_0.2)] text-[var(--gold)] hover:bg-[rgba(var(--primary-rgb),_0.2)] transition-all"
            >
              <span className="material-symbols-outlined text-[20px] block">create_new_folder</span>
            </button>
          </div>
        </div>
      </div>

      {/* Layout Controls Bar */}
      <div className="px-4 pt-1 pb-2 flex items-center justify-end gap-4 z-20">
        <div className="flex items-center gap-1 bg-white/5 backdrop-blur-md p-1 rounded-2xl border border-white/10 relative shrink-0">
          {(['2col', '3col', '4col'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setLayoutMode(mode)}
              className={`relative px-4 py-2 rounded-xl transition-all flex items-center justify-center gap-2 z-10 ${layoutMode === mode ? 'text-[var(--bg-elevated)]' : 'text-white/40 hover:text-white/80'}`}
              title={`${mode} view`}
            >
              <span className={`material-symbols-outlined block relative z-10 ${
                mode === '2col' ? 'text-[22px]' : 
                mode === '3col' ? 'text-[26px]' : 
                'text-[26px]'
              }`}>
                {mode === '2col' && 'grid_view'}
                {mode === '3col' && 'view_module'}
                {mode === '4col' && 'apps'}
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
                </motion.span>
              )}

              {layoutMode === mode && (
                <motion.div
                  layoutId="activeLayoutCollection"
                  className="absolute inset-0 bg-[var(--gold)] rounded-xl -z-10 shadow-[0_4px_15px_rgba(var(--primary-rgb),0.3)]"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Create Folder Dialog */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-white/5"
          >
            <div className="p-4 bg-white/[0.02]">
              <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#998f81] mb-3">New Collection</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  placeholder="e.g. Eid Mubarak 2026"
                  maxLength={50}
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white/80 text-sm placeholder:text-white/20 focus:outline-none focus:border-[rgba(var(--primary-rgb),_0.4)] transition-colors"
                />
                <button
                  onClick={handleCreate}
                  disabled={!newFolderName.trim() || creating}
                  className="px-4 py-2.5 rounded-xl bg-[var(--gold)] text-[var(--on-accent)] font-bold text-xs uppercase tracking-wider disabled:opacity-30 hover:bg-[var(--gold-deep)] transition-colors"
                >
                  {creating ? '...' : 'Create'}
                </button>
                <button
                  onClick={() => { setShowCreate(false); setNewFolderName(''); }}
                  className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-white transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px] block">close</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Folder List */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-2 border-[rgba(var(--primary-rgb),_0.2)] border-t-[var(--gold)] rounded-full animate-spin"></div>
            <p className="font-label text-[10px] uppercase tracking-[0.4em] text-[rgba(var(--primary-rgb),_0.4)]">Loading...</p>
          </div>
        ) : folders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-12 opacity-40">
            <span className="material-symbols-outlined text-6xl mb-4 text-[var(--gold)]">folder_off</span>
            <p className="font-serif italic text-xl text-[var(--gold)]">No collections yet</p>
            <p className="text-xs tracking-widest uppercase mt-2">Create a collection to organize your memories</p>
          </div>
        ) : (
          <motion.div 
            layout 
            className={getLayoutClasses()}
            transition={{ layout: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } }}
          >
            {folders.map(folder => (
              <motion.div
                layout
                key={folder.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ 
                  opacity: { duration: 0.4 },
                  layout: { duration: 0.6, ease: [0.4, 0, 0.2, 1] }
                }}
                whileHover={{ scale: 1.02 }}
                onClick={() => onOpenFolder(folder)}
                className="relative group bg-white/[0.03] border border-white/5 rounded-2xl overflow-hidden cursor-pointer hover:border-[rgba(var(--primary-rgb),_0.2)] transition-all"
              >
                {/* Cover area */}
                <div className={`${getCoverHeight()} bg-gradient-to-br from-[rgba(var(--primary-rgb),_0.05)] to-[rgba(var(--primary-rgb),_0.1)] flex items-center justify-center overflow-hidden transition-all duration-500`}>
                  {folder.cover_message_id ? (
                    <FolderCover messageId={folder.cover_message_id} />
                  ) : (
                    <span className="material-symbols-outlined text-[48px] text-[rgba(var(--primary-rgb),_0.3)]">folder</span>
                  )}
                </div>

                {/* Info */}
                <div className="p-3">
                  <p className="text-sm text-white/80 font-medium truncate">{folder.name || 'Encrypted Folder'}</p>
                  <p className="font-label text-[9px] uppercase tracking-widest text-[#998f81] mt-1">
                    {folder.item_count || 0} item{(folder.item_count || 0) !== 1 ? 's' : ''}
                  </p>
                </div>

                {/* Delete button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(folder.id); }}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 backdrop-blur-sm text-white/40 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px] block">delete</span>
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Delete Confirmation */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-8"
            onClick={() => setConfirmDelete(null)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={e => e.stopPropagation()}
              className="bg-[var(--bg-elevated)] border border-white/10 rounded-2xl p-6 max-w-sm w-full"
            >
              <h3 className="font-serif italic text-lg text-[var(--gold)] mb-2">Delete Collection?</h3>
              <p className="text-sm text-white/50 mb-6">This will remove the collection. The media files themselves won't be deleted.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(confirmDelete)}
                  className="flex-1 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-bold hover:bg-red-500/30 transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
