import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface GarbageItem {
  id: string;
  message_id: string | null;
  cloudinary_public_id: string;
  cloud_name: string;
  media_type: string;
  file_size: number | null;
  added_at: string;
}

export function useGarbage() {
  const { user } = useAuth();
  const [items, setItems] = useState<GarbageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isEmptying, setIsEmptying] = useState(false);

  const fetchGarbage = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('garbage_bin')
        .select('id, message_id, cloudinary_public_id, cloud_name, media_type, file_size, added_at')
        .eq('added_by', user.id)
        .order('added_at', { ascending: false });

      if (error) throw error;
      setItems(data || []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchGarbage();

    if (!user) return;

    // Realtime listener for garbage_bin changes
    const channel = supabase
      .channel(`garbage-bin-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'garbage_bin',
          filter: `added_by=eq.${user.id}`
        },
        () => {
          fetchGarbage(); // Refetch on any change
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchGarbage]);

  /**
   * Move a media message to the garbage bin.
   * This does NOT delete from Cloudinary — only marks it for later bulk delete.
   */
  const moveToGarbage = useCallback(async (
    messageId: string,
    cloudinaryPublicId: string,
    cloudName: string,
    mediaType: string,
    fileSize?: number | null
  ): Promise<boolean> => {
    if (!user) return false;
    try {
      // Insert into garbage_bin
      const { error } = await supabase
        .from('garbage_bin')
        .insert({
          message_id: messageId,
          cloudinary_public_id: cloudinaryPublicId,
          cloud_name: cloudName,
          media_type: mediaType,
          file_size: fileSize ?? null,
          added_by: user.id,
        });

      if (error) throw error;

      // Optimistic update
      setItems(prev => [{
        id: crypto.randomUUID(),
        message_id: messageId,
        cloudinary_public_id: cloudinaryPublicId,
        cloud_name: cloudName,
        media_type: mediaType,
        file_size: fileSize ?? null,
        added_at: new Date().toISOString(),
      }, ...prev]);

      return true;
    } catch {
      return false;
    }
  }, [user]);

  /**
   * Remove a single item from the garbage bin (undo).
   */
  const removeFromGarbage = useCallback(async (garbageId: string): Promise<boolean> => {
    if (!user) return false;
    try {
      const { error } = await supabase
        .from('garbage_bin')
        .delete()
        .eq('id', garbageId)
        .eq('added_by', user.id);

      if (error) throw error;
      setItems(prev => prev.filter(i => i.id !== garbageId));
      return true;
    } catch {
      return false;
    }
  }, [user]);

  /**
   * Empty the entire garbage: calls the Edge Function which:
   * 1. Deletes all assets from Cloudinary
   * 2. Marks messages as deleted_for_everyone
   * 3. Clears all garbage_bin rows
   */
  const emptyGarbage = useCallback(async (): Promise<{ deleted: number; failed: number }> => {
    if (!user || items.length === 0) return { deleted: 0, failed: 0 };
    setIsEmptying(true);
    try {
      const { data, error } = await supabase.functions.invoke('empty-garbage', {
        method: 'POST',
      });

      if (error) throw error;

      // Clear local state
      setItems([]);
      return { deleted: data?.deleted || 0, failed: data?.failed || 0 };
    } catch (err) {
      throw err;
    } finally {
      setIsEmptying(false);
    }
  }, [user, items.length]);

  const totalSize = items.reduce((acc, i) => acc + (i.file_size || 0), 0);
  const count = items.length;

  return {
    items,
    loading,
    isEmptying,
    count,
    totalSize,
    moveToGarbage,
    removeFromGarbage,
    emptyGarbage,
    refetch: fetchGarbage,
  };
}
