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
  // Custom background — supports two formats:
  // Legacy: { ciphertext: string, nonce: string } (inline encrypted base64 in DB)
  // New:    { url: string, nonce: string } (encrypted file on Cloudinary, URL in DB)
  customBg?: {
    ciphertext?: string;
    url?: string;
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

import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'aura_notes';
const LABELS_KEY = 'aura_note_labels';
const TRASH_EXPIRY_DAYS = 7;

// Helper to map DB row back to Note camelCase keys
const mapDbNoteToNote = (db: any): Note => ({
  id: db.id,
  title: db.title || '',
  content: db.content || '',
  color: db.color || 'default',
  background: db.background || 'none',
  isPinned: db.is_pinned || false,
  isArchived: db.is_archived || false,
  isTrashed: db.is_trashed || false,
  trashedAt: db.trashed_at,
  labels: db.labels || [],
  checklist: db.checklist || [],
  isChecklist: db.is_checklist || false,
  createdAt: db.created_at || new Date().toISOString(),
  updatedAt: db.updated_at || new Date().toISOString(),
  mood: db.mood || null,
  customBg: db.custom_bg || null,
  customColor: db.custom_color || null,
});

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

  // ── Fetch from Supabase ──────────────────────────────────────────────
  const fetchNotesAndLabels = useCallback(async () => {
    if (!user) return;
    try {
      const { data: notesData, error: notesError } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', user.id);

      if (notesError) throw notesError;

      const { data: labelsData, error: labelsError } = await supabase
        .from('note_labels')
        .select('name')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (labelsError) throw labelsError;

      const mappedNotes = (notesData || []).map(mapDbNoteToNote);

      // Auto-delete trash items older than 7 days
      const now = Date.now();
      const expiredTrashIds: string[] = [];
      const cleanedNotes = mappedNotes.filter(n => {
        if (n.isTrashed && n.trashedAt) {
          const elapsed = now - new Date(n.trashedAt).getTime();
          const expired = elapsed >= TRASH_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
          if (expired) {
            expiredTrashIds.push(n.id);
          }
          return !expired;
        }
        return true;
      });

      if (expiredTrashIds.length > 0) {
        supabase.from('notes').delete().in('id', expiredTrashIds).then();
      }

      setNotes(cleanedNotes);
      setLabels((labelsData || []).map(l => l.name));
    } catch (err) {
      console.error('Error fetching notes/labels:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // ── Migrate from localStorage ──────────────────────────────────────────
  const migrateLocalNotes = useCallback(async (userId: string) => {
    const localNotesKey = `${STORAGE_KEY}_${userId}`;
    const localLabelsKey = `${LABELS_KEY}_${userId}`;

    const localNotesRaw = localStorage.getItem(localNotesKey);
    const localLabelsRaw = localStorage.getItem(localLabelsKey);

    if (localNotesRaw) {
      try {
        const localNotes: Note[] = JSON.parse(localNotesRaw);
        if (localNotes.length > 0) {
          const toInsert = localNotes.map(n => ({
            id: n.id,
            user_id: userId,
            title: n.title,
            content: n.content,
            color: n.color,
            background: n.background,
            is_pinned: n.isPinned,
            is_archived: n.isArchived,
            is_trashed: n.isTrashed,
            trashed_at: n.trashedAt,
            labels: n.labels,
            checklist: n.checklist,
            is_checklist: n.isChecklist,
            custom_bg: n.customBg,
            custom_color: n.customColor,
            mood: n.mood,
            created_at: n.createdAt,
            updated_at: n.updatedAt
          }));

          await supabase.from('notes').upsert(toInsert);
          localStorage.removeItem(localNotesKey);
        }
      } catch (e) {
        console.error('Error migrating local notes:', e);
      }
    }

    if (localLabelsRaw) {
      try {
        const localLabels: string[] = JSON.parse(localLabelsRaw);
        if (localLabels.length > 0) {
          const toInsert = localLabels.map(l => ({
            user_id: userId,
            name: l
          }));
          await supabase.from('note_labels').upsert(toInsert, { onConflict: 'user_id,name' });
          localStorage.removeItem(localLabelsKey);
        }
      } catch (e) {
        console.error('Error migrating local labels:', e);
      }
    }
  }, []);

  // ── Initialize and Subscribe ─────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const init = async () => {
      await migrateLocalNotes(user.id);
      await fetchNotesAndLabels();
    };

    init();

    // Subscribe to realtime updates for notes
    const notesChannel = supabase
      .channel(`notes-changes-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notes',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          fetchNotesAndLabels();
        }
      )
      .subscribe();

    // Subscribe to realtime updates for labels
    const labelsChannel = supabase
      .channel(`note-labels-changes-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'note_labels',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          fetchNotesAndLabels();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(notesChannel);
      supabase.removeChannel(labelsChannel);
    };
  }, [user, fetchNotesAndLabels, migrateLocalNotes]);

  // ── CRUD ──────────────────────────────────────────────────────────────

  const createNote = useCallback((partial?: Partial<Note>): Note => {
    if (!user) throw new Error("No user authenticated");
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

    // Optimistic Update
    setNotes(prev => [note, ...prev]);

    supabase.from('notes').insert({
      id: note.id,
      user_id: user.id,
      title: note.title,
      content: note.content,
      color: note.color,
      background: note.background,
      is_pinned: note.isPinned,
      is_archived: note.isArchived,
      is_trashed: note.isTrashed,
      trashed_at: note.trashedAt,
      labels: note.labels,
      checklist: note.checklist,
      is_checklist: note.isChecklist,
      custom_bg: note.customBg,
      custom_color: note.customColor,
      mood: note.mood,
      created_at: note.createdAt,
      updated_at: note.updatedAt
    }).then(({ error }) => {
      if (error) console.error("Error inserting note:", error);
    });

    return note;
  }, [user]);

  const updateNote = useCallback((id: string, changes: Partial<Note>) => {
    if (!user) return;
    const now = new Date().toISOString();

    // Optimistic Update
    setNotes(prev => prev.map(n =>
      n.id === id ? { ...n, ...changes, updatedAt: now } : n
    ));

    const payload: any = { updated_at: now };
    if (changes.title !== undefined) payload.title = changes.title;
    if (changes.content !== undefined) payload.content = changes.content;
    if (changes.color !== undefined) payload.color = changes.color;
    if (changes.background !== undefined) payload.background = changes.background;
    if (changes.isPinned !== undefined) payload.is_pinned = changes.isPinned;
    if (changes.isArchived !== undefined) payload.is_archived = changes.isArchived;
    if (changes.isTrashed !== undefined) payload.is_trashed = changes.isTrashed;
    if (changes.trashedAt !== undefined) payload.trashed_at = changes.trashedAt;
    if (changes.labels !== undefined) payload.labels = changes.labels;
    if (changes.checklist !== undefined) payload.checklist = changes.checklist;
    if (changes.isChecklist !== undefined) payload.is_checklist = changes.isChecklist;
    if (changes.customBg !== undefined) payload.custom_bg = changes.customBg;
    if (changes.customColor !== undefined) payload.custom_color = changes.customColor;
    if (changes.mood !== undefined) payload.mood = changes.mood;

    supabase.from('notes')
      .update(payload)
      .eq('id', id)
      .eq('user_id', user.id)
      .then(({ error }) => {
        if (error) console.error("Error updating note:", error);
      });
  }, [user]);

  const deleteNotePermanently = useCallback((id: string) => {
    if (!user) return;
    // Optimistic Update
    setNotes(prev => prev.filter(n => n.id !== id));

    supabase.from('notes')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .then(({ error }) => {
        if (error) console.error("Error deleting note:", error);
      });
  }, [user]);

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
      customColor: original.customColor,
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
    if (!user) return;
    const trimmed = labelName.trim();
    if (!trimmed || labels.includes(trimmed)) return;

    // Optimistic Update
    setLabels(prev => [...prev, trimmed]);

    supabase.from('note_labels')
      .insert({
        user_id: user.id,
        name: trimmed
      })
      .then(({ error }) => {
        if (error) console.error("Error adding label:", error);
      });
  }, [user, labels]);

  const removeLabel = useCallback((labelName: string) => {
    if (!user) return;
    // Optimistic Update
    setLabels(prev => prev.filter(l => l !== labelName));
    setNotes(prev => prev.map(n =>
      n.labels.includes(labelName) ? { ...n, labels: n.labels.filter(l => l !== labelName) } : n
    ));

    supabase.from('note_labels')
      .delete()
      .eq('name', labelName)
      .eq('user_id', user.id)
      .then(({ error }) => {
        if (error) console.error("Error removing label:", error);
      });

    supabase.from('notes')
      .select('id, labels')
      .eq('user_id', user.id)
      .contains('labels', [labelName])
      .then(({ data }) => {
        if (data) {
          data.forEach(note => {
            const updatedLabels = note.labels.filter((l: string) => l !== labelName);
            supabase.from('notes')
              .update({ labels: updatedLabels })
              .eq('id', note.id)
              .then();
          });
        }
      });
  }, [user]);

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
    if (!user) return;
    // Optimistic Update
    setNotes(prev => prev.filter(n => !n.isTrashed));

    supabase.from('notes')
      .delete()
      .eq('is_trashed', true)
      .eq('user_id', user.id)
      .then(({ error }) => {
        if (error) console.error("Error emptying trash:", error);
      });
  }, [user]);

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

