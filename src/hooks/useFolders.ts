import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

// ═══════════════════════════════════════════════════════════════════════════════
// FOLDER TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface NoteFolder {
  id: string;
  name: string;
  parentId: string | null; // null = root level
  color: string; // folder accent color
  icon: string; // material icon name
  createdAt: string;
  updatedAt: string;
}

// Shared couple ID (same as notes)
const COUPLE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// Map DB row to NoteFolder
const mapDbFolder = (db: any): NoteFolder => ({
  id: db.id,
  name: db.name || 'Untitled Folder',
  parentId: db.parent_id || null,
  color: db.color || '#e6c487',
  icon: db.icon || 'folder',
  createdAt: db.created_at || new Date().toISOString(),
  updatedAt: db.updated_at || new Date().toISOString(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════════

export function useFolders() {
  const { user } = useAuth();
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const foldersRef = useRef(folders);

  useEffect(() => { foldersRef.current = folders; }, [folders]);

  // ── Fetch from Supabase ──────────────────────────────────────────────
  const fetchFolders = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('note_folders')
        .select('*')
        .eq('couple_id', COUPLE_ID)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setFolders((data || []).map(mapDbFolder));
    } catch (err) {
      console.error('Error fetching folders:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // ── Initialize and Subscribe ─────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    fetchFolders();

    const channel = supabase
      .channel('note-folders-couple-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'note_folders',
          filter: `couple_id=eq.${COUPLE_ID}`,
        },
        () => {
          fetchFolders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchFolders]);

  // ── CRUD ──────────────────────────────────────────────────────────────

  const createFolder = useCallback((name: string, parentId: string | null = null, color?: string, icon?: string): NoteFolder => {
    if (!user) throw new Error('No user authenticated');
    const now = new Date().toISOString();
    const folder: NoteFolder = {
      id: crypto.randomUUID(),
      name: name.trim() || 'Untitled Folder',
      parentId,
      color: color || '#e6c487',
      icon: icon || 'folder',
      createdAt: now,
      updatedAt: now,
    };

    // Optimistic
    setFolders(prev => [...prev, folder]);

    supabase.from('note_folders').insert({
      id: folder.id,
      user_id: user.id,
      couple_id: COUPLE_ID,
      name: folder.name,
      parent_id: folder.parentId,
      color: folder.color,
      icon: folder.icon,
      created_at: folder.createdAt,
      updated_at: folder.updatedAt,
    }).then(({ error }) => {
      if (error) console.error('Error creating folder:', error);
    });

    return folder;
  }, [user]);

  const updateFolder = useCallback((id: string, changes: Partial<NoteFolder>) => {
    if (!user) return;
    const now = new Date().toISOString();

    // Optimistic
    setFolders(prev => prev.map(f =>
      f.id === id ? { ...f, ...changes, updatedAt: now } : f
    ));

    const payload: any = { updated_at: now };
    if (changes.name !== undefined) payload.name = changes.name;
    if (changes.parentId !== undefined) payload.parent_id = changes.parentId;
    if (changes.color !== undefined) payload.color = changes.color;
    if (changes.icon !== undefined) payload.icon = changes.icon;

    supabase.from('note_folders')
      .update(payload)
      .eq('id', id)
      .eq('couple_id', COUPLE_ID)
      .then(({ error }) => {
        if (error) console.error('Error updating folder:', error);
      });
  }, [user]);

  const deleteFolder = useCallback((id: string) => {
    if (!user) return;

    // Get all descendant folder IDs (recursive)
    const getAllDescendantIds = (parentId: string): string[] => {
      const children = foldersRef.current.filter(f => f.parentId === parentId);
      return children.reduce<string[]>(
        (acc, child) => [...acc, child.id, ...getAllDescendantIds(child.id)],
        []
      );
    };

    const descendantIds = getAllDescendantIds(id);
    const allIdsToDelete = [id, ...descendantIds];

    // Optimistic
    setFolders(prev => prev.filter(f => !allIdsToDelete.includes(f.id)));

    // Also move notes in these folders back to root (set folder_id to null)
    supabase.from('notes')
      .update({ folder_id: null })
      .in('folder_id', allIdsToDelete)
      .eq('couple_id', COUPLE_ID)
      .then(({ error }) => {
        if (error) console.error('Error moving notes from deleted folders:', error);
      });

    // Delete all folders
    supabase.from('note_folders')
      .delete()
      .in('id', allIdsToDelete)
      .eq('couple_id', COUPLE_ID)
      .then(({ error }) => {
        if (error) console.error('Error deleting folders:', error);
      });
  }, [user]);

  // ── Tree helpers ─────────────────────────────────────────────────────

  const getChildFolders = useCallback((parentId: string | null): NoteFolder[] => {
    return folders.filter(f => f.parentId === parentId);
  }, [folders]);

  const getFolderPath = useCallback((folderId: string | null): NoteFolder[] => {
    if (!folderId) return [];
    const path: NoteFolder[] = [];
    let currentId: string | null = folderId;
    while (currentId) {
      const folder = folders.find(f => f.id === currentId);
      if (!folder) break;
      path.unshift(folder);
      currentId = folder.parentId;
    }
    return path;
  }, [folders]);

  const getFolderById = useCallback((id: string): NoteFolder | undefined => {
    return folders.find(f => f.id === id);
  }, [folders]);

  return {
    folders,
    loading,
    createFolder,
    updateFolder,
    deleteFolder,
    getChildFolders,
    getFolderPath,
    getFolderById,
  };
}
