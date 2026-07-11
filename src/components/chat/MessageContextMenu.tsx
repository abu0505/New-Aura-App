import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMediaFolders } from '../../hooks/useMediaFolders';
import { toast } from 'sonner';

interface MessageContextMenuProps {
  isMine: boolean;
  hasMedia?: boolean;
  onEdit?: () => void;
  onPin: () => void;
  onMoveToGarbage?: () => void;
  messageIds?: string[];
  onCloseMenu?: () => void;
  onRetry?: () => void;
  onReply?: () => void;
}

export default function MessageContextMenu({
  isMine, hasMedia, onEdit, onPin, onMoveToGarbage, messageIds, onCloseMenu, onRetry, onReply
}: MessageContextMenuProps) {
  const [showFolders, setShowFolders] = useState(false);
  const { folders, addItemsToFolder, createFolder, loading } = useMediaFolders();
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleAddToFolder = async (folderId: string) => {
    if (!messageIds || messageIds.length === 0) return;
    const folderName = folders.find(f => f.id === folderId)?.name || 'folder';
    const success = await addItemsToFolder(folderId, messageIds);
    if (success) {
      toast.success(`Saved to "${folderName}"! 📁`, {
        description: `Successfully added ${messageIds.length} item${messageIds.length !== 1 ? 's' : ''} to folder.`,
      });
      if (onCloseMenu) onCloseMenu();
    } else {
      toast.error('Failed to add items to folder');
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setCreating(true);
    try {
      const newFolderId = await createFolder(newFolderName.trim());
      if (newFolderId) {
        await handleAddToFolder(newFolderId);
      } else {
        toast.error('Failed to create folder');
      }
    } catch (err) {
      console.error('[MessageContextMenu] Error creating folder:', err);
      toast.error('Error creating folder');
    } finally {
      setCreating(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9, y: 5 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 5 }}
      className={`flex flex-col bg-[#292932]/90 backdrop-blur-md rounded-xl shadow-2xl border border-white/5 overflow-hidden w-48`}
    >
      <AnimatePresence mode="wait">
        {!showFolders ? (
          <motion.div
            key="main-menu"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col w-full"
          >
            {onRetry && (
              <button 
                onClick={onRetry}
                className="flex items-center gap-3 px-4 py-3 hover:bg-emerald-500/10 text-emerald-400 transition-colors text-sm text-left font-body border-b border-white/5 font-bold"
              >
                <span className="material-symbols-outlined text-[18px]">sync</span>
                Retry Resend
              </button>
            )}

            {onReply && (
              <button 
                onClick={onReply}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[rgba(var(--primary-rgb),_0.1)] text-[#e4e1ed] transition-colors text-sm text-left font-body border-b border-white/5"
              >
                <span className="material-symbols-outlined text-[18px]">reply</span>
                Reply
              </button>
            )}

            <button 
              onClick={onPin}
              className="flex items-center gap-3 px-4 py-3 hover:bg-[rgba(var(--primary-rgb),_0.1)] text-[#e4e1ed] transition-colors text-sm text-left font-body"
            >
              <span className="material-symbols-outlined text-[18px]">push_pin</span>
              Pin Message
            </button>

            {isMine && onEdit && (
              <button 
                onClick={onEdit}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[rgba(var(--primary-rgb),_0.1)] text-[#e4e1ed] transition-colors text-sm text-left font-body border-t border-white/5"
              >
                <span className="material-symbols-outlined text-[18px]">edit</span>
                Edit
              </button>
            )}

            {/* Save to Folder — visible for media messages */}
            {messageIds && messageIds.length > 0 && (
              <button 
                onClick={() => setShowFolders(true)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[rgba(var(--primary-rgb),_0.1)] text-[#e4e1ed] transition-colors text-sm text-left font-body border-t border-white/5"
              >
                <span className="material-symbols-outlined text-[18px]">folder</span>
                Save to Folder
              </button>
            )}

            {/* Move to Garbage — only visible for media messages */}
            {hasMedia && onMoveToGarbage && (
              <button 
                onClick={onMoveToGarbage}
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-500/10 text-amber-400 transition-colors text-sm text-left font-body border-t border-white/5"
              >
                <span className="material-symbols-outlined text-[18px]">delete_outline</span>
                Move to Garbage
              </button>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="folders-menu"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col w-full"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-white/[0.02]">
              <button 
                onClick={() => setShowFolders(false)}
                className="flex items-center gap-1.5 text-white/50 hover:text-white transition-colors text-xs font-bold uppercase tracking-wider py-1"
              >
                <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                Back
              </button>
              <span className="text-[10px] text-white/40 uppercase tracking-widest font-bold font-label">Folders</span>
            </div>

            {/* Folder List */}
            <div className="max-h-40 overflow-y-auto flex flex-col py-1 scrollbar-hide">
              {loading ? (
                <div className="px-4 py-3 text-xs text-white/40 flex items-center justify-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin border-white/30" />
                  Loading...
                </div>
              ) : folders.length === 0 ? (
                <div className="px-4 py-4 text-[11px] text-white/30 italic text-center font-body">
                  No folders yet
                </div>
              ) : (
                folders.map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => handleAddToFolder(folder.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[rgba(var(--primary-rgb),_0.1)] text-[#e4e1ed] transition-colors text-xs text-left font-body truncate"
                  >
                    <span className="material-symbols-outlined text-[16px] text-white/30">folder</span>
                    <span className="truncate flex-1">{folder.name || 'Folder'}</span>
                  </button>
                ))
              )}
            </div>

            {/* Create Folder Form */}
            <form onSubmit={handleCreateFolder} className="p-2 border-t border-white/5 flex gap-1 bg-white/[0.01]">
              <input
                type="text"
                placeholder="New folder..."
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                disabled={creating}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--gold)]/40 transition-colors font-body min-w-0"
              />
              <button
                type="submit"
                disabled={creating || !newFolderName.trim()}
                className="px-2 py-1 rounded-lg bg-[var(--gold)] text-black hover:brightness-110 active:scale-95 transition-all text-xs font-bold disabled:opacity-30 flex items-center justify-center shrink-0"
              >
                {creating ? (
                  <div className="w-3 h-3 border border-t-transparent rounded-full animate-spin border-black" />
                ) : (
                  <span className="material-symbols-outlined text-[14px] font-bold">add</span>
                )}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
