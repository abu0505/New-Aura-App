import { useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { NoteFolder } from '../../hooks/useFolders';
import type { Note } from '../../hooks/useNotes';

// ═══════════════════════════════════════════════════════════════════════════════
// FOLDER ACCENT COLORS
// ═══════════════════════════════════════════════════════════════════════════════

const FOLDER_COLORS = [
  '#e6c487', '#6ECB8A', '#7C9AF2', '#D4A0A0', '#CC5DE8',
  '#38BDF8', '#FF922B', '#22B8CF', '#F06595', '#FFD43B',
];

const FOLDER_ICONS = [
  'folder', 'school', 'science', 'calculate', 'auto_stories',
  'code', 'palette', 'language', 'psychology', 'biotech',
  'architecture', 'music_note', 'sports_esports', 'work', 'favorite',
];

// ═══════════════════════════════════════════════════════════════════════════════
// PROPS
// ═══════════════════════════════════════════════════════════════════════════════

interface FolderBrowserProps {
  folders: NoteFolder[];
  notes: Note[];
  currentFolderId: string | null;
  onNavigateToFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId: string | null, color?: string, icon?: string) => NoteFolder;
  onUpdateFolder: (id: string, changes: Partial<NoteFolder>) => void;
  onDeleteFolder: (id: string) => void;
  getChildFolders: (parentId: string | null) => NoteFolder[];
  getFolderPath: (folderId: string | null) => NoteFolder[];
  showNewFolder: boolean;
  setShowNewFolder: (show: boolean) => void;
  isSecretModeActive?: boolean;
  onToggleFolderSecret?: (folderId: string, makeSecret: boolean) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function FolderBrowser({
  folders,
  notes,
  currentFolderId,
  onNavigateToFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  getChildFolders,
  getFolderPath,
  showNewFolder,
  setShowNewFolder,
  isSecretModeActive = false,
  onToggleFolderSecret,
}: FolderBrowserProps) {
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#e6c487');
  const [newFolderIcon, setNewFolderIcon] = useState('folder');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Current folder's children
  const childFolders = useMemo(() => getChildFolders(currentFolderId), [getChildFolders, currentFolderId]);

  // Breadcrumb path
  const breadcrumb = useMemo(() => getFolderPath(currentFolderId), [getFolderPath, currentFolderId]);

  // Notes count in a folder (including subfolders recursively)
  const getNotesCountInFolder = useCallback((folderId: string): number => {
    const directNotes = notes.filter(n => n.folderId === folderId && !n.isTrashed).length;
    const subFolders = folders.filter(f => f.parentId === folderId);
    const subNotes = subFolders.reduce((acc, sf) => acc + getNotesCountInFolder(sf.id), 0);
    return directNotes + subNotes;
  }, [notes, folders]);

  // Create folder
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    onCreateFolder(newFolderName.trim(), currentFolderId, newFolderColor, newFolderIcon);
    setNewFolderName('');
    setNewFolderColor('#e6c487');
    setNewFolderIcon('folder');
    setShowNewFolder(false);
  };

  // Start editing
  const startEditing = (folder: NoteFolder) => {
    setEditingFolderId(folder.id);
    setEditingName(folder.name);
    setContextMenuId(null);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  // Save edit
  const saveEdit = () => {
    if (editingFolderId && editingName.trim()) {
      onUpdateFolder(editingFolderId, { name: editingName.trim() });
    }
    setEditingFolderId(null);
    setEditingName('');
  };

  return (
    <div className="mb-4">
      {/* ═══ BREADCRUMB ═══ */}
      {(currentFolderId || breadcrumb.length > 0) && (
        <div className="flex items-center gap-1 mb-3 overflow-x-auto scrollbar-hide px-1">
          <button
            onClick={() => onNavigateToFolder(null)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-white/40 hover:text-[var(--gold)] hover:bg-white/5 transition-all shrink-0"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>home</span>
            Root
          </button>

          {breadcrumb.map((folder, i) => (
            <div key={folder.id} className="flex items-center gap-1 shrink-0">
              <span className="material-symbols-outlined text-white/15" style={{ fontSize: '14px' }}>chevron_right</span>
              <button
                onClick={() => onNavigateToFolder(folder.id)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shrink-0 ${
                  i === breadcrumb.length - 1
                    ? 'text-[var(--gold)] bg-white/5'
                    : 'text-white/40 hover:text-[var(--gold)] hover:bg-white/5'
                }`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: folder.color }}>{folder.icon}</span>
                {folder.name}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ═══ FOLDERS GRID ═══ */}
      {childFolders.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
          <AnimatePresence mode="popLayout">
            {childFolders.map(folder => {
              const noteCount = getNotesCountInFolder(folder.id);
              const subFolderCount = folders.filter(f => f.parentId === folder.id).length;

              return (
                <motion.div
                  key={folder.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  className="relative group"
                >
                  {editingFolderId === folder.id ? (
                    /* Editing mode */
                    <div
                      className="rounded-2xl p-3 border transition-all"
                      style={{
                        background: `${folder.color}08`,
                        borderColor: `${folder.color}30`,
                      }}
                    >
                      <input
                        ref={nameInputRef}
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit();
                          if (e.key === 'Escape') setEditingFolderId(null);
                        }}
                        onBlur={saveEdit}
                        className="w-full bg-transparent text-sm text-white/80 font-medium focus:outline-none placeholder:text-white/20"
                        style={{ outline: 'none', boxShadow: 'none' }}
                        placeholder="Folder name..."
                      />
                    </div>
                  ) : (
                    /* Normal mode */
                    <button
                      onClick={() => onNavigateToFolder(folder.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenuId(contextMenuId === folder.id ? null : folder.id);
                      }}
                      className="w-full rounded-2xl p-3 border transition-all hover:scale-[1.02] active:scale-[0.98] text-left"
                      style={{
                        background: `${folder.color}08`,
                        borderColor: `${folder.color}18`,
                      }}
                    >
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: '24px', color: folder.color, fontVariationSettings: "'FILL' 1" }}
                        >
                          {folder.icon}
                        </span>
                        <span className="text-sm font-medium text-white/80 truncate flex-1">{folder.name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[9px] text-white/25 font-medium uppercase tracking-wider">
                        {noteCount > 0 && (
                          <span>{noteCount} note{noteCount !== 1 ? 's' : ''}</span>
                        )}
                        {subFolderCount > 0 && (
                          <span>• {subFolderCount} folder{subFolderCount !== 1 ? 's' : ''}</span>
                        )}
                        {noteCount === 0 && subFolderCount === 0 && (
                          <span>Empty</span>
                        )}
                      </div>
                    </button>
                  )}

                  {/* Context menu dots button */}
                  {editingFolderId !== folder.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setContextMenuId(contextMenuId === folder.id ? null : folder.id);
                      }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/10 text-white/30 hover:text-white/60 transition-all"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>more_vert</span>
                    </button>
                  )}

                  {/* Context menu */}
                  <AnimatePresence>
                    {contextMenuId === folder.id && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: -5 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: -5 }}
                        className="absolute top-0 right-0 z-20 w-40 bg-zinc-900/95 border border-white/10 rounded-xl overflow-hidden shadow-2xl backdrop-blur-md"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => startEditing(folder)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-xs text-white/60 hover:bg-white/5 transition-colors"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                          Rename
                        </button>
                        {isSecretModeActive && onToggleFolderSecret && (
                          <>
                            <button
                              onClick={() => {
                                onToggleFolderSecret(folder.id, true);
                                setContextMenuId(null);
                              }}
                              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-purple-400 hover:bg-white/5 transition-colors font-semibold"
                            >
                              <span className="material-symbols-outlined text-purple-400" style={{ fontSize: '16px', fontVariationSettings: "'FILL' 1" }}>lock</span>
                              Make Secret
                            </button>
                            <button
                              onClick={() => {
                                onToggleFolderSecret(folder.id, false);
                                setContextMenuId(null);
                              }}
                              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-white/60 hover:bg-white/5 transition-colors"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>lock_open</span>
                              Make Normal
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete folder "${folder.name}" and all sub-folders? Notes will be moved to root.`)) {
                              onDeleteFolder(folder.id);
                            }
                            setContextMenuId(null);
                          }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-400/70 hover:bg-red-500/10 transition-colors"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                          Delete
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ═══ NEW FOLDER CREATION ═══ */}
      <AnimatePresence>
        {showNewFolder && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="rounded-2xl bg-[var(--bg-elevated)] border border-white/10 p-4 shadow-xl">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30 mb-3">New Folder</p>

              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') setShowNewFolder(false);
                }}
                placeholder="Folder name..."
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-white/20 mb-3"
                style={{ outline: 'none', boxShadow: 'none' }}
              />

              {/* Icon picker */}
              <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-white/20 mb-1.5">Icon</p>
              <div className="flex gap-1.5 flex-wrap mb-3">
                {FOLDER_ICONS.map(icon => (
                  <button
                    key={icon}
                    onClick={() => setNewFolderIcon(icon)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                      newFolderIcon === icon
                        ? 'bg-white/10 text-[var(--gold)] scale-110'
                        : 'text-white/30 hover:text-white/60 hover:bg-white/5'
                    }`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{icon}</span>
                  </button>
                ))}
              </div>

              {/* Color picker */}
              <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-white/20 mb-1.5">Color</p>
              <div className="flex gap-2 mb-4">
                {FOLDER_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setNewFolderColor(c)}
                    className={`w-6 h-6 rounded-full border-2 transition-all hover:scale-110 ${
                      newFolderColor === c ? 'border-white scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowNewFolder(false)}
                  className="px-4 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFolder}
                  disabled={!newFolderName.trim()}
                  className="px-4 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider bg-[var(--gold)] text-black hover:brightness-110 transition-all disabled:opacity-30"
                >
                  Create
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>



      {/* Close backdrop for context menu */}
      {contextMenuId && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setContextMenuId(null)}
        />
      )}
    </div>
  );
}
