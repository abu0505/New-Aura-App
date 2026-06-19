import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotes, type Note, type NoteFilter } from '../../hooks/useNotes';
import { useFolders } from '../../hooks/useFolders';
import NoteCard from './NoteCard';
import NoteEditor from './NoteEditor';
import FolderBrowser from './FolderBrowser';
import FolderTree from './FolderTree';
import { useChatSettingsContext } from '../../contexts/ChatSettingsContext';
import { hashPin } from '../../contexts/AppLockContext';

interface NotesScreenProps {
  onBack?: () => void;
}

export default function NotesScreen({ onBack }: NotesScreenProps = {}) {
  const {
    notes,
    labels,
    loading,
    createNote,
    updateNote,
    deleteNotePermanently,
    trashNote,
    restoreNote,
    togglePin,
    duplicateNote,
    addChecklistItem,
    updateChecklistItem,
    removeChecklistItem,
    addLabel,
    removeLabel,
    toggleNoteLabel,
    emptyTrash,
  } = useNotes();

  const viewMode = 'grid';
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [filter, setFilter] = useState<NoteFilter>('all');
  const { settings } = useChatSettingsContext();
  const [isSecretModeActive, setIsSecretModeActive] = useState(false);
  const [isStealthActive, setIsStealthActive] = useState(() => {
    return typeof window !== 'undefined' && localStorage.getItem('aura_stealth_mode') === 'true';
  });

  useEffect(() => {
    const handleStealthChange = () => {
      setIsStealthActive(localStorage.getItem('aura_stealth_mode') === 'true');
    };
    window.addEventListener('stealth-mode-change', handleStealthChange);
    return () => window.removeEventListener('stealth-mode-change', handleStealthChange);
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickContent, setQuickContent] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const quickContentRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const isDraggingSidebar = useRef(false);

  useEffect(() => {
    if (isDesktop && editingNote) {
      document.dispatchEvent(new CustomEvent('shrink-global-nav'));
    } else {
      document.dispatchEvent(new CustomEvent('expand-global-nav'));
    }
    return () => {
      document.dispatchEvent(new CustomEvent('expand-global-nav'));
    };
  }, [isDesktop, editingNote]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingSidebar.current) return;
      const newWidth = Math.max(200, Math.min(e.clientX - 64, 600)); // 64px is shrunk nav width
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      isDraggingSidebar.current = false;
      document.body.style.cursor = 'default';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ── Folders ──
  const {
    folders,
    createFolder,
    updateFolder,
    deleteFolder,
    getChildFolders,
    getFolderPath,
  } = useFolders();

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Check search query for stealth mode toggle code "jinga"
  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query === 'jinga') {
      const isCurrentlyStealth = localStorage.getItem('aura_stealth_mode') === 'true';
      localStorage.setItem('aura_stealth_mode', String(!isCurrentlyStealth));
      window.dispatchEvent(new Event('stealth-mode-change'));
      setSearchQuery(''); // Clear query so the code disappears
    }
  }, [searchQuery]);

  // Check search query for PIN to unlock Secret Mode
  useEffect(() => {
    const checkSecretPin = async () => {
      if (!searchQuery.trim() || !settings?.shared_pin) return;
      const hashed = await hashPin(searchQuery.trim());
      if (hashed === settings.shared_pin) {
        setIsSecretModeActive(true);
        setSearchQuery(''); // Clear query to hide the PIN!
      }
    };
    checkSecretPin();
  }, [searchQuery, settings?.shared_pin]);



  // Filter + search notes
  const filteredNotes = useMemo(() => {
    let filtered = notes;

    // Apply secret filter
    if (!isSecretModeActive) {
      filtered = filtered.filter(n => !n.labels.includes('__secret__'));
    }

    // Apply filter
    if (filter === 'all') {
      filtered = filtered.filter(n => !n.isTrashed);
    } else if (filter === 'trash') {
      filtered = filtered.filter(n => n.isTrashed);
    } else {
      // Label filter
      filtered = filtered.filter(n => !n.isTrashed && n.labels.includes(filter));
    }

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.checklist.some(i => i.text.toLowerCase().includes(q)) ||
        n.labels.some(l => l.toLowerCase().includes(q))
      );
    }

    // Apply folder filter (only when not searching and not in trash)
    if (!searchQuery.trim() && filter !== 'trash') {
      filtered = filtered.filter(n => (n.folderId || null) === currentFolderId);
    }

    return filtered;
  }, [notes, filter, searchQuery, currentFolderId, isSecretModeActive]);

  // Desktop tree view notes (should NOT filter by currentFolderId)
  const treeNotes = useMemo(() => {
    let filtered = notes;

    // Apply secret filter
    if (!isSecretModeActive) {
      filtered = filtered.filter(n => !n.labels.includes('__secret__'));
    }

    // Apply filter
    if (filter === 'all') {
      filtered = filtered.filter(n => !n.isTrashed);
    } else if (filter === 'trash') {
      filtered = filtered.filter(n => n.isTrashed);
    } else {
      // Label filter
      filtered = filtered.filter(n => !n.isTrashed && n.labels.includes(filter));
    }

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.checklist.some(i => i.text.toLowerCase().includes(q)) ||
        n.labels.some(l => l.toLowerCase().includes(q))
      );
    }

    return filtered;
  }, [notes, filter, searchQuery, isSecretModeActive]);

  // Split pinned and unpinned
  const pinnedNotes = useMemo(() => filteredNotes.filter(n => n.isPinned), [filteredNotes]);
  const unpinnedNotes = useMemo(() => filteredNotes.filter(n => !n.isPinned), [filteredNotes]);

  // Handle note creation (in current folder)
  const handleCreateNote = useCallback(() => {
    const note = createNote({ 
      folderId: currentFolderId,
      labels: isSecretModeActive ? ['__secret__'] : []
    });
    setEditingNote(note);
  }, [createNote, currentFolderId, isSecretModeActive]);

  const handleQuickAdd = () => {
    if (!quickTitle.trim() && !quickContent.trim()) {
      setShowQuickAdd(false);
      return;
    }
    createNote({
      title: quickTitle.trim(),
      content: quickContent.trim(),
      folderId: currentFolderId,
      labels: isSecretModeActive ? ['__secret__'] : []
    });
    setQuickTitle('');
    setQuickContent('');
    setShowQuickAdd(false);
    // Don't open editor, just create inline
  };

  const handleCreateChecklist = () => {
    const note = createNote({ 
      isChecklist: true, 
      checklist: [{ id: crypto.randomUUID(), text: '', checked: false }], 
      folderId: currentFolderId,
      labels: isSecretModeActive ? ['__secret__'] : []
    });
    setEditingNote(note);
  };

  const handleToggleSecret = useCallback((noteId: string) => {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    const isSecret = note.labels.includes('__secret__');
    const newLabels = isSecret
      ? note.labels.filter(l => l !== '__secret__')
      : [...note.labels, '__secret__'];
    updateNote(noteId, { labels: newLabels });
  }, [notes, updateNote]);

  const handleToggleFolderSecret = useCallback((folderId: string, makeSecret: boolean) => {
    const getFolderIdsRecursive = (fId: string): string[] => {
      const children = folders.filter(f => f.parentId === fId);
      return [fId, ...children.flatMap(c => getFolderIdsRecursive(c.id))];
    };

    const targetFolderIds = getFolderIdsRecursive(folderId);
    const notesToUpdate = notes.filter(n => n.folderId && targetFolderIds.includes(n.folderId) && !n.isTrashed);

    notesToUpdate.forEach(note => {
      const isSecret = note.labels.includes('__secret__');
      if (makeSecret && !isSecret) {
        updateNote(note.id, { labels: [...note.labels, '__secret__'] });
      } else if (!makeSecret && isSecret) {
        updateNote(note.id, { labels: note.labels.filter(l => l !== '__secret__') });
      }
    });
  }, [notes, folders, updateNote]);

  // Selection
  const handleSelect = useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (next.size === 0) setSelectionMode(false);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const bulkTrash = () => {
    selectedIds.forEach(id => trashNote(id));
    cancelSelection();
  };

  // Re-fetch the editing note when notes update (keep editor in sync)
  const currentEditingNote = useMemo(() => {
    if (!editingNote) return null;
    return notes.find(n => n.id === editingNote.id) || null;
  }, [editingNote, notes]);

  const handleOpenNote = useCallback((note: Note) => {
    setEditingNote(note);
  }, []);

  const trashCount = useMemo(() => notes.filter(n => n.isTrashed).length, [notes]);

  // Toggle search
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  return (
    <div
      className="w-full h-full bg-[var(--bg-primary)] flex flex-col font-sans overflow-hidden relative"
      onClick={() => document.dispatchEvent(new CustomEvent('hide-global-nav'))}
    >
      {/* Secret Vault Top Banner */}
      {isSecretModeActive && (
        <div className="px-4 pb-2 pt-6 bg-purple-950/80 border-b border-purple-500/20 flex items-center justify-between shrink-0 backdrop-blur-md z-30 safe-top safe-pt">
          <div className="flex items-center gap-2 text-purple-300">
            <span className="material-symbols-outlined animate-pulse text-purple-400 font-variation-settings-fill" style={{ fontSize: '16px' }}>lock</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-purple-300">Secret Vault Active</span>
          </div>
          <button
            onClick={() => setIsSecretModeActive(false)}
            className="flex items-center gap-1 px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-[9px] font-bold uppercase tracking-wider transition-all"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>logout</span>
            Exit Vault
          </button>
        </div>
      )}

      {/* If Desktop & Editing, show split pane with folder tree. Otherwise, normal view. */}
      {isDesktop && currentEditingNote ? (
        <div className="flex w-full h-full overflow-hidden relative bg-[var(--bg-primary)]">
          {/* Resizable Sidebar */}
          <div 
            style={{ width: sidebarWidth }} 
            className="h-full flex flex-col border-r border-white/5 bg-zinc-950/40 shrink-0 relative"
          >
            {/* Sidebar Header */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between shrink-0">
               {isSecretModeActive ? (
                 <div className="flex items-center gap-1.5 text-[var(--gold)]">
                   <span className="material-symbols-outlined animate-pulse text-[var(--gold)] font-variation-settings-fill" style={{ fontSize: '18px' }}>lock</span>
                   <h2 className="font-serif italic text-lg text-[var(--gold)]">Vault</h2>
                 </div>
               ) : (
                 <h2 className="font-serif italic text-lg text-[var(--gold)]">Explorer</h2>
               )}
               
               <div className="flex items-center gap-1">
                 {isSecretModeActive && (
                   <button
                     onClick={() => setIsSecretModeActive(false)}
                     className="px-2 py-1 bg-[var(--gold)] text-black rounded-lg text-[9px] font-bold uppercase tracking-wider hover:brightness-110 transition-all shrink-0"
                     title="Exit Vault"
                   >
                     Exit
                   </button>
                 )}
                 <button onClick={() => setEditingNote(null)} className="p-1 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
                 </button>
               </div>
            </div>

            {/* Sidebar Search */}
            <div className="p-3 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/40">
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>search</span>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search notes..."
                  className="flex-1 bg-transparent text-xs text-white/80 placeholder:text-white/20 focus:outline-none"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="p-0.5 rounded text-white/30 hover:text-white/60">
                    <span className="material-symbols-outlined block" style={{ fontSize: '14px' }}>close</span>
                  </button>
                )}
              </div>
            </div>

            {/* Quick Links & Filters */}
            <div className="p-2 border-b border-white/5 shrink-0 flex flex-col gap-0.5">
               <button
                 onClick={() => { setFilter('all'); setCurrentFolderId(null); }}
                 className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs font-medium transition-colors ${filter === 'all' ? 'bg-white/10 text-[var(--gold)] font-semibold' : 'hover:bg-white/5 text-white/60'}`}
               >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>notes</span>
                  <span>All Notes</span>
               </button>
               <button
                 onClick={() => { setFilter('trash'); setCurrentFolderId(null); }}
                 className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs font-medium transition-colors ${filter === 'trash' ? 'bg-white/10 text-red-400 font-semibold' : 'hover:bg-white/5 text-white/60'}`}
               >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                  <span>Trash</span>
                  {notes.filter(n => n.isTrashed).length > 0 && (
                    <span className="ml-auto px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-red-500/20 text-red-400">
                      {notes.filter(n => n.isTrashed).length}
                    </span>
                  )}
               </button>
               
               {/* Labels Section */}
               {labels.filter(l => l !== '__secret__').length > 0 && (
                 <div className="mt-1.5">
                   <div className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-white/30">Labels</div>
                   <div className="flex flex-wrap gap-1 px-1 py-0.5">
                     {labels.filter(l => l !== '__secret__').map(l => (
                       <button
                         key={l}
                         onClick={() => setFilter(filter === l ? 'all' : l)}
                         className={`px-2 py-0.5 rounded text-[10px] border transition-all ${filter === l ? 'bg-[var(--gold)]/20 text-[var(--gold)] border-[var(--gold)]/30' : 'border-white/10 text-white/50 hover:border-white/25 hover:text-white'}`}
                       >
                         {l}
                       </button>
                     ))}
                   </div>
                 </div>
               )}
            </div>
            
            {/* Sidebar Content (Folders Tree / Trash List) */}
            <div className="flex-1 overflow-y-auto p-2 scrollbar-hide">
               {filter === 'trash' ? (
                 /* Trash flat list in sidebar */
                 <div className="flex flex-col gap-0.5">
                   <div className="flex items-center justify-between px-2 mb-2 shrink-0">
                     <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-red-400/60">
                       Trash Bin
                     </span>
                     {notes.filter(n => n.isTrashed).length > 0 && (
                       <button
                         onClick={emptyTrash}
                         className="text-[9px] font-bold uppercase text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1 rounded"
                       >
                         Empty Trash
                       </button>
                     )}
                   </div>
                   {notes.filter(n => n.isTrashed).map(n => {
                     const isSelected = currentEditingNote?.id === n.id;
                     return (
                       <button
                         key={n.id}
                         onClick={() => handleOpenNote(n)}
                         className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${isSelected ? 'bg-red-500/15 text-red-400 border border-red-500/20' : 'hover:bg-white/5 text-white/60'}`}
                       >
                         <span className="material-symbols-outlined shrink-0" style={{ fontSize: '16px' }}>{n.isChecklist ? 'checklist' : 'sticky_note_2'}</span>
                         <span className="text-xs font-medium truncate flex-1">{n.title || 'Untitled'}</span>
                       </button>
                     );
                   })}
                   {notes.filter(n => n.isTrashed).length === 0 && (
                     <div className="px-2 py-6 text-xs text-white/20 text-center italic">Trash is empty</div>
                   )}
                 </div>
               ) : (
                 /* Hierarchical FolderTree */
                 <FolderTree
                   folders={folders}
                   notes={treeNotes}
                   currentEditingNoteId={currentEditingNote?.id ?? null}
                   onSelectNote={handleOpenNote}
                   onCreateFolder={createFolder}
                   onCreateNote={(folderId) => {
                     const note = createNote({ 
                       folderId,
                       labels: isSecretModeActive ? ['__secret__'] : []
                     });
                     setEditingNote(note);
                   }}
                   onUpdateFolder={updateFolder}
                   onDeleteFolder={deleteFolder}
                   onTrashNote={trashNote}
                   isFiltering={searchQuery.trim().length > 0 || (filter !== 'all' && filter !== 'trash')}
                   isSecretModeActive={isSecretModeActive}
                   onToggleFolderSecret={handleToggleFolderSecret}
                 />
               )}
            </div>

            {/* Resize Handle */}
            <div 
              className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[var(--gold)]/50 transition-colors z-10"
              onMouseDown={() => {
                isDraggingSidebar.current = true;
                document.body.style.cursor = 'col-resize';
              }}
            />
          </div>

          {/* Right side NoteEditor */}
          <div className="flex-1 min-w-0 relative h-full bg-black/10">
            <NoteEditor
              key={currentEditingNote.id}
              note={currentEditingNote}
              onUpdate={updateNote}
              onClose={() => setEditingNote(null)}
              onTrash={trashNote}
              onDuplicate={duplicateNote}
              onTogglePin={togglePin}
              onAddChecklistItem={addChecklistItem}
              onUpdateChecklistItem={updateChecklistItem}
              onRemoveChecklistItem={removeChecklistItem}
              labels={labels}
              onToggleLabel={toggleNoteLabel}
              onAddLabel={addLabel}
              onDeleteLabel={removeLabel}
              isInline={true}
            />
          </div>
        </div>
      ) : (
      <>
      {/* ═══ HEADER ═══ */}
      <header className={`px-4 pt-6 pb-4 flex flex-col gap-3 border-b border-white/5 bg-black/20 shrink-0 ${!isSecretModeActive ? 'safe-top safe-pt' : ''}`}>
        {selectionMode ? (
          /* Selection header */
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={cancelSelection} className="p-2 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[var(--gold)] transition-all">
                <span className="material-symbols-outlined text-[20px] block">close</span>
              </button>
              <p className="text-sm text-white/80 font-medium">{selectedIds.size} selected</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={bulkTrash}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400/70 hover:text-red-400 hover:bg-red-500/15 transition-all"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
                <span className="text-[10px] font-bold uppercase tracking-wider hidden lg:block">Delete</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Title row */}
            <div className="flex items-center justify-between gap-3 h-[46px] relative overflow-hidden">
              <AnimatePresence>
                {!showSearch && (
                  <motion.div
                    initial={{ opacity: 0, x: -20, width: 'auto' }}
                    animate={{ opacity: 1, x: 0, width: 'auto' }}
                    exit={{ opacity: 0, x: -20, width: 0 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                    className="flex items-center gap-2 overflow-hidden shrink-0"
                  >
                    {!isStealthActive && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onBack) {
                            onBack();
                          } else {
                            document.dispatchEvent(new CustomEvent('toggle-nav'));
                          }
                        }}
                        className={`p-2 -ml-2 rounded-full text-[#998f81] hover:text-[var(--gold)] hover:bg-white/5 active:scale-90 transition-all flex items-center justify-center shrink-0 ${onBack ? '' : 'lg:hidden'}`}
                      >
                        <span className="material-symbols-outlined text-xl">arrow_back</span>
                      </button>
                    )}
                    <div className="shrink-0">
                      <h1 className="font-serif italic text-2xl text-[var(--gold)] whitespace-nowrap">Notes</h1>
                     <p className="font-label text-[9px] uppercase tracking-[0.2em] text-[#998f81] whitespace-nowrap">
                        {filter === 'trash'
                          ? `${trashCount} note${trashCount !== 1 ? 's' : ''} in trash`
                          : currentFolderId
                          ? `${filteredNotes.length} note${filteredNotes.length !== 1 ? 's' : ''}`
                          : `${filteredNotes.length} note${filteredNotes.length !== 1 ? 's' : ''}`}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
                {/* Search toggle */}
                <motion.div
                  layout
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  className={`flex items-center rounded-full bg-white/5 border border-white/10 overflow-hidden cursor-pointer ${
                    showSearch ? 'flex-1 max-w-[400px] px-3 py-1.5' : 'w-[38px] h-[38px] justify-center hover:text-[var(--gold)]'
                  } text-[#998f81] min-w-0`}
                  onClick={() => {
                    if (!showSearch) {
                      setShowSearch(true);
                    }
                  }}
                >
                  <motion.span
                    layout
                    className="material-symbols-outlined shrink-0 select-none"
                    style={{ fontSize: '20px' }}
                  >
                    search
                  </motion.span>
                  {showSearch && (
                    <motion.input
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: '100%' }}
                      exit={{ opacity: 0, width: 0 }}
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search notes..."
                      className="ml-2 flex-1 bg-transparent text-xs text-white/80 placeholder:text-white/20 focus:outline-none min-w-0"
                      style={{ outline: 'none', boxShadow: 'none' }}
                    />
                  )}
                  {showSearch && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowSearch(false);
                        setSearchQuery('');
                      }}
                      className="p-1 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors shrink-0"
                    >
                      <span className="material-symbols-outlined block" style={{ fontSize: '16px' }}>close</span>
                    </button>
                  )}
                </motion.div>

                {/* New Folder toggle button */}
                {filter !== 'trash' && !searchQuery.trim() && (
                  <button
                    onClick={() => setShowNewFolder(prev => !prev)}
                    className={`p-2 rounded-xl bg-white/5 border border-white/10 transition-all shrink-0 ${
                      showNewFolder ? 'text-[var(--gold)] bg-white/10 border-[var(--gold)]/30' : 'text-[#998f81] hover:text-[var(--gold)] hover:bg-white/10'
                    }`}
                    title="New Folder"
                  >
                    <span className="material-symbols-outlined block font-variation-settings-fill" style={{ fontSize: '20px' }}>
                      create_new_folder
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Filter chips */}
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pr-4 -mx-1 px-1">
              {[
                { key: 'all', label: 'All Notes', icon: 'notes' },
                { key: 'trash', label: 'Trash', icon: 'delete' },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key as NoteFilter)}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap shrink-0 ${
                    filter === f.key
                      ? 'bg-[var(--gold)] text-[var(--on-accent)] border-[var(--gold)] shadow-md shadow-[rgba(var(--primary-rgb),_0.1)]'
                      : 'bg-transparent text-[#998f81] border-white/10 hover:border-white/20'
                  }`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>{f.icon}</span>
                  {f.label}
                </button>
              ))}
              {/* Label filters */}
              {labels.filter(l => l !== '__secret__').map(label => (
                <button
                  key={label}
                  onClick={() => setFilter(filter === label ? 'all' : label)}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap shrink-0 ${
                    filter === label
                      ? 'bg-[var(--gold)] text-[var(--on-accent)] border-[var(--gold)] shadow-md shadow-[rgba(var(--primary-rgb),_0.1)]'
                      : 'bg-transparent text-[#998f81] border-white/10 hover:border-white/20'
                  }`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>label</span>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </header>

      {/* ═══ CONTENT ═══ */}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-hide">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <span className="material-symbols-outlined text-4xl text-[var(--gold)]/30 animate-pulse">sticky_note_2</span>
            <p className="text-xs text-white/30 uppercase tracking-widest animate-pulse">Loading notes...</p>
          </div>
        ) : (
          <>
            {/* Quick add bar — Google Keep style */}
            {filter === 'all' && (
              <div className="mb-6 max-w-lg mx-auto">
                {showQuickAdd ? (
                  <motion.div
                    initial={{ y: -10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="rounded-2xl bg-[var(--bg-elevated)] border border-white/10 overflow-hidden shadow-lg"
                  >
                    <input
                      value={quickTitle}
                      onChange={(e) => setQuickTitle(e.target.value)}
                      placeholder="Title"
                      className="w-full bg-transparent px-4 pt-3 pb-1 text-sm font-semibold text-white/80 placeholder:text-white/20 focus:outline-none"
                      style={{ outline: 'none', boxShadow: 'none' }}
                    />
                    <textarea
                      ref={quickContentRef}
                      value={quickContent}
                      onChange={(e) => setQuickContent(e.target.value)}
                      placeholder="Take a note..."
                      className="w-full bg-transparent px-4 py-2 text-xs text-white/60 placeholder:text-white/15 focus:outline-none resize-none"
                      style={{ outline: 'none', boxShadow: 'none' }}
                      rows={3}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          handleQuickAdd();
                        }
                      }}
                    />
                    <div className="flex items-center justify-between px-3 py-2 border-t border-white/5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleCreateChecklist}
                          className="p-1.5 rounded-full hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
                          title="New checklist"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>checklist</span>
                        </button>
                      </div>
                      <button
                        onClick={handleQuickAdd}
                        className="px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
                      >
                        Close
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <button
                    onClick={() => { setShowQuickAdd(true); setTimeout(() => quickContentRef.current?.focus(), 100); }}
                    className="w-full rounded-full bg-[var(--bg-elevated)] border border-white/10 px-6 py-3 text-left text-sm text-white/25 hover:border-white/15 hover:text-white/35 transition-all shadow-md"
                  >
                    Take a note...
                  </button>
                )}
              </div>
            )}

            {/* Folder browser — only show when not searching and not in trash */}
            {filter !== 'trash' && !searchQuery.trim() && (
              <FolderBrowser
                folders={folders}
                notes={notes}
                currentFolderId={currentFolderId}
                onNavigateToFolder={setCurrentFolderId}
                onCreateFolder={createFolder}
                onUpdateFolder={updateFolder}
                onDeleteFolder={deleteFolder}
                getChildFolders={getChildFolders}
                getFolderPath={getFolderPath}
                showNewFolder={showNewFolder}
                setShowNewFolder={setShowNewFolder}
                isSecretModeActive={isSecretModeActive}
                onToggleFolderSecret={handleToggleFolderSecret}
              />
            )
            }

            {filteredNotes.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center gap-4">
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1 }}
                >
                  <span className="material-symbols-outlined text-6xl text-white/10">
                    {filter === 'trash' ? 'delete_sweep' : searchQuery ? 'search_off' : 'sticky_note_2'}
                  </span>
                </motion.div>
                <div className="text-center">
                  <p className="text-sm text-white/30 mb-1">
                    {filter === 'trash' ? 'Trash is empty' : searchQuery ? 'No matching notes' : 'No notes yet'}
                  </p>
                  <p className="text-xs text-white/15">
                    {filter === 'all' && !searchQuery && 'Tap the + button to create your first note'}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Empty trash button */}
                {filter === 'trash' && trashCount > 0 && (
                  <div className="flex justify-center mb-4">
                    <button
                      onClick={emptyTrash}
                      className="flex items-center gap-2 px-5 py-2 rounded-full bg-red-500/10 border border-red-500/20 text-red-400/70 hover:text-red-400 hover:bg-red-500/15 transition-all text-xs font-bold uppercase tracking-wider"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete_sweep</span>
                      Empty Trash
                    </button>
                  </div>
                )}

                {/* Pinned section */}
                {pinnedNotes.length > 0 && filter !== 'trash' && (
                  <div className="mb-6">
                    <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/25 mb-3 px-1">
                      <span className="material-symbols-outlined align-middle mr-1" style={{ fontSize: '12px', fontVariationSettings: "'FILL' 1" }}>push_pin</span>
                      Pinned
                    </p>
                    {viewMode === 'grid' ? (
                      <div
                        style={{
                          columns: isDesktop ? 3 : 2,
                          columnGap: '12px',
                        }}
                      >
                        {pinnedNotes.map(note => (
                          <div key={note.id} style={{ breakInside: 'avoid', marginBottom: '12px' }}>
                            <NoteCard
                              note={note}
                              viewMode={viewMode}
                              onOpen={handleOpenNote}
                              onPin={togglePin}
                              onTrash={trashNote}
                              isSelected={selectedIds.has(note.id)}
                              onSelect={handleSelect}
                              selectionMode={selectionMode}
                              isSecretModeActive={isSecretModeActive}
                              onToggleSecret={handleToggleSecret}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <AnimatePresence mode="popLayout">
                          {pinnedNotes.map(note => (
                            <NoteCard
                              key={note.id}
                              note={note}
                              viewMode={viewMode}
                              onOpen={handleOpenNote}
                              onPin={togglePin}
                              onTrash={trashNote}
                              isSelected={selectedIds.has(note.id)}
                              onSelect={handleSelect}
                              selectionMode={selectionMode}
                              isSecretModeActive={isSecretModeActive}
                              onToggleSecret={handleToggleSecret}
                            />
                          ))}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                )}

                {/* Other notes */}
                {unpinnedNotes.length > 0 && (
                  <div>
                    {pinnedNotes.length > 0 && filter !== 'trash' && (
                      <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/25 mb-3 px-1">Others</p>
                    )}
                    {viewMode === 'grid' ? (
                      <div
                        style={{
                          columns: isDesktop ? 3 : 2,
                          columnGap: '12px',
                        }}
                      >
                        {unpinnedNotes.map(note => (
                          <div key={note.id} style={{ breakInside: 'avoid', marginBottom: '12px' }}>
                            <NoteCard
                              note={note}
                              viewMode={viewMode}
                              onOpen={handleOpenNote}
                              onPin={togglePin}
                              onTrash={trashNote}
                              onRestore={restoreNote}
                              onDeletePermanently={deleteNotePermanently}
                              isSelected={selectedIds.has(note.id)}
                              onSelect={handleSelect}
                              selectionMode={selectionMode}
                              isSecretModeActive={isSecretModeActive}
                              onToggleSecret={handleToggleSecret}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <AnimatePresence mode="popLayout">
                          {unpinnedNotes.map(note => (
                            <NoteCard
                              key={note.id}
                              note={note}
                              viewMode={viewMode}
                              onOpen={handleOpenNote}
                              onPin={togglePin}
                              onTrash={trashNote}
                              onRestore={restoreNote}
                              onDeletePermanently={deleteNotePermanently}
                              isSelected={selectedIds.has(note.id)}
                              onSelect={handleSelect}
                              selectionMode={selectionMode}
                              isSecretModeActive={isSecretModeActive}
                              onToggleSecret={handleToggleSecret}
                            />
                          ))}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Bottom padding for FAB */}
            <div className="h-24" />
          </>
        )}
      </div>

      {/* ═══ FAB — Floating Action Button ═══ */}
      {!selectionMode && filter !== 'trash' && (
        <motion.div
          className="absolute bottom-6 right-6 lg:bottom-8 lg:right-8 flex flex-col items-end gap-3 z-50"
          initial={false}
        >
          {/* Secondary FABs */}
          <AnimatePresence>
            {showQuickAdd && !isDesktop && (
              <>
                <motion.button
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ delay: 0.05 }}
                  onClick={handleCreateChecklist}
                  className="w-12 h-12 rounded-2xl bg-[var(--bg-elevated)] border border-white/15 text-white/50 hover:text-[var(--gold)] shadow-xl flex items-center justify-center transition-colors"
                  title="New checklist"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>checklist</span>
                </motion.button>
              </>
            )}
          </AnimatePresence>

          {/* Primary FAB */}
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              if (isDesktop) {
                handleCreateNote();
              } else {
                if (showQuickAdd) {
                  handleCreateNote();
                  setShowQuickAdd(false);
                } else {
                  handleCreateNote();
                }
              }
            }}
            className="w-14 h-14 rounded-2xl bg-[var(--gold)] text-black shadow-2xl shadow-[var(--gold)]/20 flex items-center justify-center transition-colors hover:brightness-110"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>add</span>
          </motion.button>
        </motion.div>
      )}

      {/* ═══ NOTE EDITOR MODAL ═══ */}
      <AnimatePresence>
        {currentEditingNote && !isDesktop && (
          <NoteEditor
            key={currentEditingNote.id}
            note={currentEditingNote}
            onUpdate={updateNote}
            onClose={() => setEditingNote(null)}
            onTrash={trashNote}
            onDuplicate={duplicateNote}
            onTogglePin={togglePin}
            onAddChecklistItem={addChecklistItem}
            onUpdateChecklistItem={updateChecklistItem}
            onRemoveChecklistItem={removeChecklistItem}
            labels={labels}
            onToggleLabel={toggleNoteLabel}
            onAddLabel={addLabel}
            onDeleteLabel={removeLabel}
          />
        )}
      </AnimatePresence>
      </>
      )}
    </div>
  );
}
