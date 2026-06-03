import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { NoteFolder } from '../../hooks/useFolders';
import type { Note } from '../../hooks/useNotes';

// ═══════════════════════════════════════════════════════════════════════════════
// PROPS & TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface FolderTreeProps {
  folders: NoteFolder[];
  notes: Note[];
  currentEditingNoteId: string | null;
  onSelectNote: (note: Note) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onCreateNote: (folderId: string | null) => void;
  onUpdateFolder: (id: string, changes: Partial<NoteFolder>) => void;
  onDeleteFolder: (id: string) => void;
  onTrashNote: (id: string) => void;
  isFiltering?: boolean;
  isSecretModeActive?: boolean;
  onToggleFolderSecret?: (folderId: string, makeSecret: boolean) => void;
}

interface TreeNodeProps {
  folder: NoteFolder;
  folders: NoteFolder[];
  notes: Note[];
  expandedFolderIds: Set<string>;
  toggleExpand: (id: string) => void;
  currentEditingNoteId: string | null;
  onSelectNote: (note: Note) => void;
  onCreateNote: (folderId: string | null) => void;
  onCreateFolderClick: (parentId: string) => void;
  onUpdateFolder: (id: string, changes: Partial<NoteFolder>) => void;
  onDeleteFolder: (id: string) => void;
  onTrashNote: (id: string) => void;
  level: number;
  isFiltering?: boolean;
  onCreateFolder: (name: string, parentId: string | null) => void;

  // Inline creation states passed down
  creationState: { parentId: string | null; type: 'folder' } | null;
  setCreationState: (state: { parentId: string | null; type: 'folder' } | null) => void;
  isSecretModeActive?: boolean;
  onToggleFolderSecret?: (folderId: string, makeSecret: boolean) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENT: TREE NODE (RECURSIVE)
// ═══════════════════════════════════════════════════════════════════════════════

function TreeNode({
  folder,
  folders,
  notes,
  expandedFolderIds,
  toggleExpand,
  currentEditingNoteId,
  onSelectNote,
  onCreateNote,
  onCreateFolderClick,
  onUpdateFolder,
  onDeleteFolder,
  onTrashNote,
  level,
  isFiltering = false,
  onCreateFolder,
  creationState,
  setCreationState,
  isSecretModeActive = false,
  onToggleFolderSecret,
}: TreeNodeProps) {
  const isExpanded = expandedFolderIds.has(folder.id);
  const childFolders = folders.filter(f => f.parentId === folder.id);
  const childNotes = notes.filter(n => n.folderId === folder.id && !n.isTrashed);

  // Visibility helper for folders when filtering
  const hasVisibleContent = (folderId: string): boolean => {
    const hasNotes = notes.some(n => n.folderId === folderId && !n.isTrashed);
    if (hasNotes) return true;
    const subfolders = folders.filter(f => f.parentId === folderId);
    return subfolders.some(f => hasVisibleContent(f.id));
  };

  const visibleChildFolders = childFolders.filter(child => {
    if (!isFiltering) return true;
    return hasVisibleContent(child.id);
  });

  // Renaming folder state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const editInputRef = useRef<HTMLInputElement>(null);

  // New subfolder creation state
  const [newSubfolderName, setNewSubfolderName] = useState('');
  const newSubfolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (creationState?.parentId === folder.id && creationState?.type === 'folder' && newSubfolderInputRef.current) {
      newSubfolderInputRef.current.focus();
    }
  }, [creationState, folder.id]);

  const handleSaveRename = () => {
    if (editName.trim() && editName.trim() !== folder.name) {
      onUpdateFolder(folder.id, { name: editName.trim() });
    }
    setIsEditing(false);
  };

  // Deleted handleCreateSubfolder to fix TS6133


  return (
    <div className="w-full">
      {/* Folder Row */}
      <div
        className="w-full flex items-center justify-between group py-1 pr-2 rounded-lg hover:bg-white/5 cursor-pointer select-none transition-colors"
        style={{ paddingLeft: `${level * 16 + 4}px` }}
        onClick={() => toggleExpand(folder.id)}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {/* Chevron */}
          <button
            className="w-5 h-5 flex items-center justify-center text-white/30 hover:text-white/70 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(folder.id);
            }}
          >
            <span
              className="material-symbols-outlined transition-transform duration-200"
              style={{
                fontSize: '16px',
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            >
              chevron_right
            </span>
          </button>

          {/* Folder Icon */}
          <span
            className="material-symbols-outlined shrink-0"
            style={{
              fontSize: '18px',
              color: folder.color,
              fontVariationSettings: "'FILL' 1",
            }}
          >
            {folder.icon}
          </span>

          {/* Folder Name (or rename input) */}
          {isEditing ? (
            <input
              ref={editInputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRename();
                if (e.key === 'Escape') {
                  setIsEditing(false);
                  setEditName(folder.name);
                }
              }}
              onBlur={handleSaveRename}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 bg-white/10 border border-[var(--gold)]/30 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
            />
          ) : (
            <span className="text-xs font-medium text-white/80 truncate flex-1 py-0.5">
              {folder.name}
            </span>
          )}
        </div>

        {/* Hover Actions */}
        {!isEditing && (
          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 opacity-60 hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Ensure folder is expanded
                if (!isExpanded) toggleExpand(folder.id);
                // Trigger create note
                onCreateNote(folder.id);
              }}
              title="New Note"
              className="p-1 rounded text-white/40 hover:text-[var(--gold)] hover:bg-white/10"
            >
              <span className="material-symbols-outlined block" style={{ fontSize: '14px' }}>
                note_add
              </span>
            </button>
            {isSecretModeActive && onToggleFolderSecret && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const getFolderIdsRecursive = (fId: string): string[] => {
                    const children = folders.filter(f => f.parentId === fId);
                    return [fId, ...children.flatMap(c => getFolderIdsRecursive(c.id))];
                  };
                  const targetFolderIds = getFolderIdsRecursive(folder.id);
                  const folderNotes = notes.filter(n => n.folderId && targetFolderIds.includes(n.folderId) && !n.isTrashed);
                  const hasAnyNormal = folderNotes.length === 0 || folderNotes.some(n => !n.labels.includes('__secret__'));
                  onToggleFolderSecret(folder.id, hasAnyNormal);
                }}
                title={(() => {
                  const getFolderIdsRecursive = (fId: string): string[] => {
                    const children = folders.filter(f => f.parentId === fId);
                    return [fId, ...children.flatMap(c => getFolderIdsRecursive(c.id))];
                  };
                  const targetFolderIds = getFolderIdsRecursive(folder.id);
                  const folderNotes = notes.filter(n => n.folderId && targetFolderIds.includes(n.folderId) && !n.isTrashed);
                  const hasAnyNormal = folderNotes.length === 0 || folderNotes.some(n => !n.labels.includes('__secret__'));
                  return hasAnyNormal ? 'Make Folder Secret' : 'Make Folder Normal';
                })()}
                className="p-1 rounded text-purple-400 hover:bg-white/10"
              >
                <span className="material-symbols-outlined block" style={{ fontSize: '14px', fontVariationSettings: "'FILL' 1" }}>
                  {(() => {
                    const getFolderIdsRecursive = (fId: string): string[] => {
                      const children = folders.filter(f => f.parentId === fId);
                      return [fId, ...children.flatMap(c => getFolderIdsRecursive(c.id))];
                    };
                    const targetFolderIds = getFolderIdsRecursive(folder.id);
                    const folderNotes = notes.filter(n => n.folderId && targetFolderIds.includes(n.folderId) && !n.isTrashed);
                    const hasAnyNormal = folderNotes.length === 0 || folderNotes.some(n => !n.labels.includes('__secret__'));
                    return hasAnyNormal ? 'lock' : 'lock_open';
                  })()}
                </span>
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!isExpanded) toggleExpand(folder.id);
                setCreationState({ parentId: folder.id, type: 'folder' });
              }}
              title="New Sub-folder"
              className="p-1 rounded text-white/40 hover:text-[var(--gold)] hover:bg-white/10"
            >
              <span className="material-symbols-outlined block" style={{ fontSize: '14px' }}>
                create_new_folder
              </span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              title="Rename Folder"
              className="p-1 rounded text-white/40 hover:text-[var(--gold)] hover:bg-white/10"
            >
              <span className="material-symbols-outlined block" style={{ fontSize: '14px' }}>
                edit
              </span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete folder "${folder.name}" and all contents recursively? Notes will move to root.`)) {
                  onDeleteFolder(folder.id);
                }
              }}
              title="Delete Folder"
              className="p-1 rounded text-white/40 hover:text-red-400 hover:bg-red-500/10"
            >
              <span className="material-symbols-outlined block" style={{ fontSize: '14px' }}>
                delete
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Children Panel */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="overflow-hidden flex flex-col"
          >
            {/* Inline Subfolder Creation Input */}
            {creationState?.parentId === folder.id && creationState?.type === 'folder' && (
              <div
                className="w-full flex items-center gap-1.5 py-1 pr-2 rounded-lg"
                style={{ paddingLeft: `${(level + 1) * 16 + 24}px` }}
              >
                <span
                  className="material-symbols-outlined text-white/30 shrink-0"
                  style={{ fontSize: '16px' }}
                >
                  folder
                </span>
                <input
                  ref={newSubfolderInputRef}
                  value={newSubfolderName}
                  onChange={(e) => setNewSubfolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (newSubfolderName.trim()) {
                        onCreateFolder(newSubfolderName.trim(), folder.id);
                        setNewSubfolderName('');
                        setCreationState(null);
                      }
                    }
                    if (e.key === 'Escape') {
                      setNewSubfolderName('');
                      setCreationState(null);
                    }
                  }}
                  onBlur={() => {
                    if (newSubfolderName.trim()) {
                      onCreateFolder(newSubfolderName.trim(), folder.id);
                    }
                    setNewSubfolderName('');
                    setCreationState(null);
                  }}
                  placeholder="New folder..."
                  className="flex-1 bg-white/10 border border-[var(--gold)]/30 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                />
              </div>
            )}

            {/* Render Subfolders */}
            {visibleChildFolders.map(child => (
              <TreeNode
                key={child.id}
                folder={child}
                folders={folders}
                notes={notes}
                expandedFolderIds={expandedFolderIds}
                toggleExpand={toggleExpand}
                currentEditingNoteId={currentEditingNoteId}
                onSelectNote={onSelectNote}
                onCreateNote={onCreateNote}
                onCreateFolder={onCreateFolder}
                onCreateFolderClick={onCreateFolderClick}
                onUpdateFolder={onUpdateFolder}
                onDeleteFolder={onDeleteFolder}
                onTrashNote={onTrashNote}
                level={level + 1}
                isFiltering={isFiltering}
                creationState={creationState}
                setCreationState={setCreationState}
                isSecretModeActive={isSecretModeActive}
                onToggleFolderSecret={onToggleFolderSecret}
              />
            ))}

            {/* Render Sub-notes (Files) */}
            {childNotes.map(note => {
              const isSelected = currentEditingNoteId === note.id;
              return (
                <div
                  key={note.id}
                  className={`w-full flex items-center justify-between group py-1 pr-2 rounded-lg cursor-pointer select-none transition-colors ${
                    isSelected
                      ? 'bg-[var(--gold)]/15 text-[var(--gold)]'
                      : 'hover:bg-white/5 text-white/70 hover:text-white'
                  }`}
                  style={{ paddingLeft: `${(level + 1) * 16 + 24}px` }}
                  onClick={() => onSelectNote(note)}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 py-0.5">
                    {/* Note Icon */}
                    <span
                      className={`material-symbols-outlined shrink-0 ${
                        isSelected
                          ? 'text-[var(--gold)]'
                          : note.labels.includes('__secret__')
                            ? 'text-purple-400'
                            : 'text-white/30 group-hover:text-white/50'
                      }`}
                      style={{ 
                        fontSize: '16px',
                        fontVariationSettings: note.labels.includes('__secret__') ? "'FILL' 1" : undefined
                      }}
                    >
                      {note.labels.includes('__secret__')
                        ? 'lock'
                        : note.isChecklist
                          ? 'checklist'
                          : 'sticky_note_2'}
                    </span>
                    {/* Note Title */}
                    <span className="text-xs font-normal truncate flex-1">
                      {note.title || 'Untitled'}
                    </span>
                  </div>

                  {/* Note Hover Actions */}
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 opacity-60 hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTrashNote(note.id);
                      }}
                      title="Move to Trash"
                      className="p-0.5 rounded text-white/40 hover:text-red-400 hover:bg-red-500/10"
                    >
                      <span className="material-symbols-outlined block" style={{ fontSize: '13px' }}>
                        delete
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORTED COMPONENT: FOLDER TREE
// ═══════════════════════════════════════════════════════════════════════════════

export default function FolderTree({
  folders,
  notes,
  currentEditingNoteId,
  onSelectNote,
  onCreateFolder,
  onCreateNote,
  onUpdateFolder,
  onDeleteFolder,
  onTrashNote,
  isFiltering = false,
  isSecretModeActive = false,
  onToggleFolderSecret,
}: FolderTreeProps) {
  // Toggle states
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());

  // Creation state
  const [creationState, setCreationState] = useState<{
    parentId: string | null;
    type: 'folder';
  } | null>(null);

  const [newFolderName, setNewFolderName] = useState('');
  const rootCreationInputRef = useRef<HTMLInputElement>(null);

  const toggleExpand = (id: string) => {
    setExpandedFolderIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Auto-expand folder path when active note changes or search matching occurs
  useEffect(() => {
    if (!currentEditingNoteId) return;
    const activeNote = notes.find(n => n.id === currentEditingNoteId);
    if (!activeNote || !activeNote.folderId) return;

    // Find parent folders path
    const pathIds: string[] = [];
    let currentParentId: string | null = activeNote.folderId;
    while (currentParentId) {
      const folder = folders.find(f => f.id === currentParentId);
      if (!folder) break;
      pathIds.push(folder.id);
      currentParentId = folder.parentId;
    }

    if (pathIds.length > 0) {
      setExpandedFolderIds(prev => {
        const next = new Set(prev);
        let changed = false;
        pathIds.forEach(id => {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [currentEditingNoteId, notes, folders]);

  // Auto-expand all matching folders during search filtering
  useEffect(() => {
    if (isFiltering && notes.length > 0) {
      const matchedFolderIds = new Set<string>();
      notes.forEach(note => {
        if (note.folderId) {
          let pId: string | null = note.folderId;
          while (pId) {
            matchedFolderIds.add(pId);
            const folder = folders.find(f => f.id === pId);
            pId = folder ? folder.parentId : null;
          }
        }
      });
      if (matchedFolderIds.size > 0) {
        setExpandedFolderIds(prev => {
          const next = new Set(prev);
          let changed = false;
          matchedFolderIds.forEach(id => {
            if (!next.has(id)) {
              next.add(id);
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }
    }
  }, [isFiltering, notes, folders]);

  // Focus root new folder input when triggered
  useEffect(() => {
    if (creationState?.parentId === null && creationState?.type === 'folder' && rootCreationInputRef.current) {
      rootCreationInputRef.current.focus();
    }
  }, [creationState]);

  const handleCreateRootFolder = () => {
    if (newFolderName.trim()) {
      onCreateFolder(newFolderName.trim(), null);
      setNewFolderName('');
      setCreationState(null);
    }
  };

  // Visibility helper for folders when filtering
  const hasVisibleContent = (folderId: string): boolean => {
    const hasNotes = notes.some(n => n.folderId === folderId && !n.isTrashed);
    if (hasNotes) return true;
    const subfolders = folders.filter(f => f.parentId === folderId);
    return subfolders.some(f => hasVisibleContent(f.id));
  };

  // Separate root folders and root notes
  const rootFolders = folders.filter(f => f.parentId === null);
  const rootNotes = notes.filter(n => n.folderId === null && !n.isTrashed);

  const visibleRootFolders = rootFolders.filter(folder => {
    if (!isFiltering) return true;
    return hasVisibleContent(folder.id);
  });

  return (
    <div className="flex flex-col w-full h-full text-white/70 select-none pb-8">
      {/* Sidebar Controls Header */}
      <div className="flex items-center justify-between px-2 mb-2 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/30">
          Folders & Files
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onCreateNote(null)}
            title="New Note in Root"
            className="p-1 rounded text-white/40 hover:text-[var(--gold)] hover:bg-white/5 transition-colors"
          >
            <span className="material-symbols-outlined block" style={{ fontSize: '16px' }}>
              note_add
            </span>
          </button>
          <button
            onClick={() => setCreationState({ parentId: null, type: 'folder' })}
            title="New Folder in Root"
            className="p-1 rounded text-white/40 hover:text-[var(--gold)] hover:bg-white/5 transition-colors"
          >
            <span className="material-symbols-outlined block" style={{ fontSize: '16px' }}>
              create_new_folder
            </span>
          </button>
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
        {/* Inline Root Folder Creation Input */}
        {creationState?.parentId === null && creationState?.type === 'folder' && (
          <div className="flex items-center gap-1.5 py-1 px-2 rounded-lg" style={{ paddingLeft: '8px' }}>
            <span
              className="material-symbols-outlined text-white/30 shrink-0"
              style={{ fontSize: '16px' }}
            >
              folder
            </span>
            <input
              ref={rootCreationInputRef}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateRootFolder();
                if (e.key === 'Escape') {
                  setNewFolderName('');
                  setCreationState(null);
                }
              }}
              onBlur={() => {
                handleCreateRootFolder();
                setNewFolderName('');
                setCreationState(null);
              }}
              placeholder="New folder..."
              className="flex-1 bg-white/10 border border-[var(--gold)]/30 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
            />
          </div>
        )}

        {/* Folders List */}
        {visibleRootFolders.map(folder => (
          <TreeNode
            key={folder.id}
            folder={folder}
            folders={folders}
            notes={notes}
            expandedFolderIds={expandedFolderIds}
            toggleExpand={toggleExpand}
            currentEditingNoteId={currentEditingNoteId}
            onSelectNote={onSelectNote}
            onCreateNote={onCreateNote}
            onCreateFolder={onCreateFolder}
            onCreateFolderClick={(parentId) => setCreationState({ parentId, type: 'folder' })}
            onUpdateFolder={onUpdateFolder}
            onDeleteFolder={onDeleteFolder}
            onTrashNote={onTrashNote}
            level={0}
            isFiltering={isFiltering}
            creationState={creationState}
            setCreationState={setCreationState}
            isSecretModeActive={isSecretModeActive}
            onToggleFolderSecret={onToggleFolderSecret}
          />
        ))}

        {/* Root Notes List */}
        {rootNotes.map(note => {
          const isSelected = currentEditingNoteId === note.id;
          return (
            <div
              key={note.id}
              className={`flex items-center justify-between group py-1 pr-2 rounded-lg cursor-pointer select-none transition-colors ${
                isSelected
                  ? 'bg-[var(--gold)]/15 text-[var(--gold)]'
                  : 'hover:bg-white/5 text-white/70 hover:text-white'
              }`}
              style={{ paddingLeft: '24px' }} // Align with root folder icons (spacer width 20px + 4px padding)
              onClick={() => onSelectNote(note)}
            >
              <div className="flex items-center gap-1.5 min-w-0 flex-1 py-0.5">
                {/* Note Icon */}
                <span
                  className={`material-symbols-outlined shrink-0 ${
                    isSelected
                      ? 'text-[var(--gold)]'
                      : note.labels.includes('__secret__')
                        ? 'text-purple-400'
                        : 'text-white/30 group-hover:text-white/50'
                  }`}
                  style={{ 
                    fontSize: '16px',
                    fontVariationSettings: note.labels.includes('__secret__') ? "'FILL' 1" : undefined
                  }}
                >
                  {note.labels.includes('__secret__')
                    ? 'lock'
                    : note.isChecklist
                      ? 'checklist'
                      : 'sticky_note_2'}
                </span>
                {/* Note Title */}
                <span className="text-xs font-normal truncate flex-1">
                  {note.title || 'Untitled'}
                </span>
              </div>

              {/* Note Hover Actions */}
              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 opacity-60 hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTrashNote(note.id);
                  }}
                  title="Move to Trash"
                  className="p-0.5 rounded text-white/40 hover:text-red-400 hover:bg-red-500/10"
                >
                  <span className="material-symbols-outlined block" style={{ fontSize: '13px' }}>
                    delete
                  </span>
                </button>
              </div>
            </div>
          );
        })}

        {/* Empty State */}
        {visibleRootFolders.length === 0 && rootNotes.length === 0 && (
          <div className="px-2 py-6 text-xs text-white/20 text-center italic">
            {isFiltering ? 'No matching items' : 'No folders or files. Click icons above to create.'}
          </div>
        )}
      </div>
    </div>
  );
}
