import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotes, type Note, type NoteView, type NoteFilter } from '../../hooks/useNotes';
import NoteCard from './NoteCard';
import NoteEditor from './NoteEditor';

export default function NotesScreen() {
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
    toggleNoteLabel,
    emptyTrash,
  } = useNotes();

  const [viewMode, setViewMode] = useState<NoteView>(() => {
    return (localStorage.getItem('aura_notes_view') as NoteView) || 'grid';
  });
  const [filter, setFilter] = useState<NoteFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickContent, setQuickContent] = useState('');
  const quickContentRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Persist view mode
  const handleViewChange = (mode: NoteView) => {
    setViewMode(mode);
    localStorage.setItem('aura_notes_view', mode);
  };

  // Filter + search notes
  const filteredNotes = useMemo(() => {
    let filtered = notes;

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
  }, [notes, filter, searchQuery]);

  // Split pinned and unpinned
  const pinnedNotes = useMemo(() => filteredNotes.filter(n => n.isPinned), [filteredNotes]);
  const unpinnedNotes = useMemo(() => filteredNotes.filter(n => !n.isPinned), [filteredNotes]);

  // Handle note creation
  const handleCreateNote = useCallback(() => {
    const note = createNote();
    setEditingNote(note);
  }, [createNote]);

  const handleQuickAdd = () => {
    if (!quickTitle.trim() && !quickContent.trim()) {
      setShowQuickAdd(false);
      return;
    }
    createNote({
      title: quickTitle.trim(),
      content: quickContent.trim(),
    });
    setQuickTitle('');
    setQuickContent('');
    setShowQuickAdd(false);
    // Don't open editor, just create inline
  };

  const handleCreateChecklist = () => {
    const note = createNote({ isChecklist: true, checklist: [{ id: crypto.randomUUID(), text: '', checked: false }] });
    setEditingNote(note);
  };

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

  const handleArchiveAction = useCallback((id: string) => {
    const note = notes.find(n => n.id === id);
    if (note?.isArchived) {
      unarchiveNote(id);
    } else {
      archiveNote(id);
    }
  }, [notes, archiveNote, unarchiveNote]);

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
      {/* ═══ HEADER ═══ */}
      <header className="px-4 pt-6 pb-4 flex flex-col gap-3 border-b border-white/5 bg-black/20 shrink-0 safe-top safe-pt">
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        document.dispatchEvent(new CustomEvent('toggle-nav'));
                      }}
                      className="p-2 -ml-2 rounded-full lg:hidden text-[#998f81] hover:text-[var(--gold)] hover:bg-white/5 active:scale-90 transition-all flex items-center justify-center shrink-0"
                    >
                      <span className="material-symbols-outlined text-xl">arrow_back</span>
                    </button>
                    <div className="shrink-0">
                      <h1 className="font-serif italic text-2xl text-[var(--gold)] whitespace-nowrap">Notes</h1>
                      <p className="font-label text-[9px] uppercase tracking-[0.2em] text-[#998f81] whitespace-nowrap">
                        {filter === 'trash'
                          ? `${trashCount} note${trashCount !== 1 ? 's' : ''} in trash`
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

                {/* View toggle */}
                <button
                  onClick={() => handleViewChange(viewMode === 'grid' ? 'list' : 'grid')}
                  className="p-2 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[var(--gold)] transition-all shrink-0"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    {viewMode === 'grid' ? 'view_agenda' : 'grid_view'}
                  </span>
                </button>
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
              {labels.map(label => (
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
        {currentEditingNote && (
          <NoteEditor
            key={currentEditingNote.id}
            note={currentEditingNote}
            onUpdate={updateNote}
            onClose={() => setEditingNote(null)}
            onTrash={trashNote}
            onArchive={handleArchiveAction}
            onDuplicate={duplicateNote}
            onTogglePin={togglePin}
            onAddChecklistItem={addChecklistItem}
            onUpdateChecklistItem={updateChecklistItem}
            onRemoveChecklistItem={removeChecklistItem}
            labels={labels}
            onToggleLabel={toggleNoteLabel}
            onAddLabel={addLabel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
