import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

// ═══════════════════════════════════════════════════════════════════════════════
// NOTE TYPES & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  background: NoteBackground;
  isPinned: boolean;
  isArchived: boolean;
  isTrashed: boolean;
  trashedAt: string | null;
  labels: string[];
  checklist: ChecklistItem[];
  isChecklist: boolean;
  createdAt: string;
  updatedAt: string;
  // Mood journaling — unique feature
  mood: NoteMood | null;
  customBg?: {
    ciphertext: string;
    nonce: string;
  } | null;
  customColor?: string | null;
}

export type NoteColor =
  | 'default'
  | 'coral'
  | 'peach'
  | 'sand'
  | 'sage'
  | 'fog'
  | 'storm'
  | 'dusk'
  | 'blossom'
  | 'clay'
  | 'chalk';

export type NoteBackground =
  | 'none'
  | 'groceries'
  | 'food'
  | 'music'
  | 'recipes'
  | 'notes'
  | 'places'
  | 'travel'
  | 'celebration';

export type NoteMood = 'happy' | 'calm' | 'grateful' | 'energetic' | 'reflective' | 'anxious' | 'sad';

export type NoteView = 'grid' | 'list';
export type NoteFilter = 'all' | 'archived' | 'trash' | string; // string = label name

// Google Keep-inspired dark theme colors
export const NOTE_COLORS: Record<NoteColor, { bg: string; border: string; label: string }> = {
  default:  { bg: 'rgba(28, 28, 46, 0.6)',  border: 'rgba(255,255,255,0.08)', label: 'Default' },
  coral:    { bg: 'rgba(119, 49, 41, 0.55)', border: 'rgba(190, 89, 78, 0.3)', label: 'Coral' },
  peach:    { bg: 'rgba(127, 79, 30, 0.5)',  border: 'rgba(200, 133, 60, 0.3)', label: 'Peach' },
  sand:     { bg: 'rgba(127, 106, 30, 0.45)',border: 'rgba(200, 178, 60, 0.3)', label: 'Sand' },
  sage:     { bg: 'rgba(40, 89, 53, 0.5)',   border: 'rgba(80, 160, 96, 0.3)', label: 'Sage' },
  fog:      { bg: 'rgba(33, 78, 84, 0.5)',   border: 'rgba(66, 156, 168, 0.3)', label: 'Fog' },
  storm:    { bg: 'rgba(40, 54, 93, 0.55)',  border: 'rgba(78, 108, 186, 0.3)', label: 'Storm' },
  dusk:     { bg: 'rgba(72, 42, 90, 0.55)',  border: 'rgba(140, 84, 178, 0.3)', label: 'Dusk' },
  blossom:  { bg: 'rgba(104, 42, 63, 0.5)',  border: 'rgba(186, 84, 120, 0.3)', label: 'Blossom' },
  clay:     { bg: 'rgba(92, 64, 48, 0.5)',   border: 'rgba(168, 120, 88, 0.3)', label: 'Clay' },
  chalk:    { bg: 'rgba(60, 60, 68, 0.5)',   border: 'rgba(120, 120, 136, 0.3)', label: 'Chalk' },
};

// Background SVG patterns (CSS-only approach — no images needed)
export const NOTE_BACKGROUNDS: Record<NoteBackground, { label: string; emoji: string; pattern: string }> = {
  none:        { label: 'None',        emoji: '🚫', pattern: '' },
  groceries:   { label: 'Groceries',   emoji: '🛒', pattern: 'radial-gradient(circle at 15% 85%, rgba(120,200,120,0.06) 0%, transparent 50%), radial-gradient(circle at 85% 15%, rgba(120,200,120,0.04) 0%, transparent 40%)' },
  food:        { label: 'Food',        emoji: '🍕', pattern: 'radial-gradient(circle at 80% 80%, rgba(255,180,100,0.07) 0%, transparent 50%), radial-gradient(circle at 20% 20%, rgba(255,150,80,0.05) 0%, transparent 40%)' },
  music:       { label: 'Music',       emoji: '🎵', pattern: 'radial-gradient(circle at 10% 90%, rgba(130,100,200,0.07) 0%, transparent 50%), radial-gradient(circle at 90% 10%, rgba(160,120,220,0.05) 0%, transparent 40%)' },
  recipes:     { label: 'Recipes',     emoji: '👨‍🍳', pattern: 'radial-gradient(circle at 75% 75%, rgba(200,160,100,0.07) 0%, transparent 50%), radial-gradient(circle at 25% 25%, rgba(220,180,120,0.05) 0%, transparent 40%)' },
  notes:       { label: 'Notes',       emoji: '📝', pattern: 'repeating-linear-gradient(0deg, transparent, transparent 27px, rgba(255,255,255,0.03) 27px, rgba(255,255,255,0.03) 28px)' },
  places:      { label: 'Places',      emoji: '📍', pattern: 'radial-gradient(circle at 30% 70%, rgba(100,180,220,0.07) 0%, transparent 50%), radial-gradient(circle at 70% 30%, rgba(80,160,200,0.05) 0%, transparent 40%)' },
  travel:      { label: 'Travel',      emoji: '✈️', pattern: 'radial-gradient(circle at 60% 80%, rgba(100,200,200,0.06) 0%, transparent 50%), radial-gradient(circle at 40% 20%, rgba(80,180,180,0.04) 0%, transparent 40%)' },
  celebration: { label: 'Celebration', emoji: '🎉', pattern: 'radial-gradient(circle at 20% 80%, rgba(255,200,100,0.07) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(220,100,180,0.05) 0%, transparent 40%)' },
};

export const MOOD_CONFIG: Record<NoteMood, { emoji: string; label: string; gradient: string }> = {
  happy:      { emoji: '😊', label: 'Happy',      gradient: 'linear-gradient(135deg, rgba(255,200,50,0.15), rgba(255,150,50,0.08))' },
  calm:       { emoji: '😌', label: 'Calm',       gradient: 'linear-gradient(135deg, rgba(100,180,220,0.15), rgba(80,160,200,0.08))' },
  grateful:   { emoji: '🙏', label: 'Grateful',   gradient: 'linear-gradient(135deg, rgba(200,160,100,0.15), rgba(180,140,80,0.08))' },
  energetic:  { emoji: '⚡', label: 'Energetic',  gradient: 'linear-gradient(135deg, rgba(255,100,100,0.15), rgba(255,180,50,0.08))' },
  reflective: { emoji: '🤔', label: 'Reflective', gradient: 'linear-gradient(135deg, rgba(130,100,200,0.15), rgba(100,80,180,0.08))' },
  anxious:    { emoji: '😰', label: 'Anxious',    gradient: 'linear-gradient(135deg, rgba(180,180,60,0.12), rgba(160,140,40,0.06))' },
  sad:        { emoji: '😢', label: 'Sad',        gradient: 'linear-gradient(135deg, rgba(80,100,160,0.15), rgba(60,80,140,0.08))' },
};

const STORAGE_KEY = 'aura_notes';
const LABELS_KEY = 'aura_note_labels';
const TRASH_EXPIRY_DAYS = 7;

// ═══════════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════════

export function useNotes() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const notesRef = useRef(notes);

  useEffect(() => { notesRef.current = notes; }, [notes]);

  // ── Load from localStorage ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    try {
      const key = `${STORAGE_KEY}_${user.id}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed: Note[] = JSON.parse(raw);
        // Auto-delete trash items older than 7 days
        const now = Date.now();
        const cleaned = parsed.filter(n => {
          if (n.isTrashed && n.trashedAt) {
            const elapsed = now - new Date(n.trashedAt).getTime();
            return elapsed < TRASH_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
          }
          return true;
        });
        setNotes(cleaned);
        if (cleaned.length !== parsed.length) {
          localStorage.setItem(key, JSON.stringify(cleaned));
        }
      }

      const labelsRaw = localStorage.getItem(`${LABELS_KEY}_${user.id}`);
      if (labelsRaw) setLabels(JSON.parse(labelsRaw));
    } catch {
      // ignore corrupt data
    }
    setLoading(false);
  }, [user?.id]);

  // ── Persist to localStorage ───────────────────────────────────────────
  const persist = useCallback((updatedNotes: Note[]) => {
    if (!user) return;
    localStorage.setItem(`${STORAGE_KEY}_${user.id}`, JSON.stringify(updatedNotes));
  }, [user?.id]);

  const persistLabels = useCallback((updatedLabels: string[]) => {
    if (!user) return;
    localStorage.setItem(`${LABELS_KEY}_${user.id}`, JSON.stringify(updatedLabels));
  }, [user?.id]);

  // ── CRUD ──────────────────────────────────────────────────────────────

  const createNote = useCallback((partial?: Partial<Note>): Note => {
    const now = new Date().toISOString();
    const note: Note = {
      id: crypto.randomUUID(),
      title: '',
      content: '',
      color: 'default',
      background: 'none',
      isPinned: false,
      isArchived: false,
      isTrashed: false,
      trashedAt: null,
      labels: [],
      checklist: [],
      isChecklist: false,
      createdAt: now,
      updatedAt: now,
      mood: null,
      ...partial,
    };
    const updated = [note, ...notesRef.current];
    setNotes(updated);
    persist(updated);
    return note;
  }, [persist]);

  const updateNote = useCallback((id: string, changes: Partial<Note>) => {
    const updated = notesRef.current.map(n =>
      n.id === id ? { ...n, ...changes, updatedAt: new Date().toISOString() } : n
    );
    setNotes(updated);
    persist(updated);
  }, [persist]);

  const deleteNotePermanently = useCallback((id: string) => {
    const updated = notesRef.current.filter(n => n.id !== id);
    setNotes(updated);
    persist(updated);
  }, [persist]);

  const trashNote = useCallback((id: string) => {
    updateNote(id, { isTrashed: true, trashedAt: new Date().toISOString(), isPinned: false });
  }, [updateNote]);

  const restoreNote = useCallback((id: string) => {
    updateNote(id, { isTrashed: false, trashedAt: null });
  }, [updateNote]);

  const archiveNote = useCallback((id: string) => {
    updateNote(id, { isArchived: true, isPinned: false });
  }, [updateNote]);

  const unarchiveNote = useCallback((id: string) => {
    updateNote(id, { isArchived: false });
  }, [updateNote]);

  const togglePin = useCallback((id: string) => {
    const note = notesRef.current.find(n => n.id === id);
    if (note) updateNote(id, { isPinned: !note.isPinned });
  }, [updateNote]);

  const duplicateNote = useCallback((id: string) => {
    const original = notesRef.current.find(n => n.id === id);
    if (!original) return;
    createNote({
      title: original.title ? `${original.title} (copy)` : '',
      content: original.content,
      color: original.color,
      background: original.background,
      labels: [...original.labels],
      checklist: original.checklist.map(item => ({ ...item, id: crypto.randomUUID() })),
      isChecklist: original.isChecklist,
      mood: original.mood,
      customBg: original.customBg ? { ...original.customBg } : null,
    });
  }, [createNote]);

  // ── Checklist ops ─────────────────────────────────────────────────────

  const addChecklistItem = useCallback((noteId: string, text: string = '') => {
    const note = notesRef.current.find(n => n.id === noteId);
    if (!note) return;
    const newItem: ChecklistItem = { id: crypto.randomUUID(), text, checked: false };
    updateNote(noteId, { checklist: [...note.checklist, newItem] });
  }, [updateNote]);

  const updateChecklistItem = useCallback((noteId: string, itemId: string, changes: Partial<ChecklistItem>) => {
    const note = notesRef.current.find(n => n.id === noteId);
    if (!note) return;
    const updatedList = note.checklist.map(item =>
      item.id === itemId ? { ...item, ...changes } : item
    );
    updateNote(noteId, { checklist: updatedList });
  }, [updateNote]);

  const removeChecklistItem = useCallback((noteId: string, itemId: string) => {
    const note = notesRef.current.find(n => n.id === noteId);
    if (!note) return;
    updateNote(noteId, { checklist: note.checklist.filter(i => i.id !== itemId) });
  }, [updateNote]);

  const reorderChecklist = useCallback((noteId: string, newOrder: ChecklistItem[]) => {
    updateNote(noteId, { checklist: newOrder });
  }, [updateNote]);

  // ── Labels ────────────────────────────────────────────────────────────

  const addLabel = useCallback((labelName: string) => {
    if (labels.includes(labelName)) return;
    const updated = [...labels, labelName];
    setLabels(updated);
    persistLabels(updated);
  }, [labels, persistLabels]);

  const removeLabel = useCallback((labelName: string) => {
    const updated = labels.filter(l => l !== labelName);
    setLabels(updated);
    persistLabels(updated);
    // Remove label from all notes
    const updatedNotes = notesRef.current.map(n =>
      n.labels.includes(labelName) ? { ...n, labels: n.labels.filter(l => l !== labelName) } : n
    );
    setNotes(updatedNotes);
    persist(updatedNotes);
  }, [labels, persistLabels, persist]);

  const toggleNoteLabel = useCallback((noteId: string, labelName: string) => {
    const note = notesRef.current.find(n => n.id === noteId);
    if (!note) return;
    const hasLabel = note.labels.includes(labelName);
    updateNote(noteId, {
      labels: hasLabel ? note.labels.filter(l => l !== labelName) : [...note.labels, labelName],
    });
  }, [updateNote]);

  // ── Empty trash ───────────────────────────────────────────────────────
  const emptyTrash = useCallback(() => {
    const updated = notesRef.current.filter(n => !n.isTrashed);
    setNotes(updated);
    persist(updated);
  }, [persist]);

  return {
    notes,
    labels,
    loading,
    // CRUD
    createNote,
    updateNote,
    deleteNotePermanently,
    trashNote,
    restoreNote,
    archiveNote,
    unarchiveNote,
    togglePin,
    duplicateNote,
    // Checklist
    addChecklistItem,
    updateChecklistItem,
    removeChecklistItem,
    reorderChecklist,
    // Labels
    addLabel,
    removeLabel,
    toggleNoteLabel,
    // Trash
    emptyTrash,
  };
}
