import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'aura_autocomplete_phrases';

export function useAutocompletePhrases() {
  const { user } = useAuth();
  const [phrases, setPhrases] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchPhrases = useCallback(async () => {
    if (!user) {
      setPhrases([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('autocomplete_phrases')
        .select('phrase')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      setPhrases((data || []).map(row => row.phrase));
    } catch (e) {
      console.error('Failed to fetch autocomplete phrases from DB', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const migrateLocalStoragePhrases = useCallback(async (userId: string) => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    try {
      const localPhrases: string[] = JSON.parse(stored);
      if (Array.isArray(localPhrases) && localPhrases.length > 0) {
        const filtered = localPhrases.map(p => p.trim()).filter(Boolean);
        if (filtered.length > 0) {
          const toInsert = filtered.map(phrase => ({
            user_id: userId,
            phrase
          }));
          await supabase
            .from('autocomplete_phrases')
            .upsert(toInsert, { onConflict: 'user_id,phrase' });
        }
      }
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('Failed to migrate local autocomplete phrases', e);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setPhrases([]);
      setLoading(false);
      return;
    }

    const init = async () => {
      await migrateLocalStoragePhrases(user.id);
      await fetchPhrases();
    };

    init();

    // Subscribe to realtime changes on autocomplete_phrases table for this user
    const channel = supabase
      .channel(`autocomplete_phrases_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'autocomplete_phrases',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          fetchPhrases();
        }
      )
      .subscribe();

    const handleCustomEvent = () => fetchPhrases();
    window.addEventListener('autocomplete_phrases_changed', handleCustomEvent);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('autocomplete_phrases_changed', handleCustomEvent);
    };
  }, [user, fetchPhrases, migrateLocalStoragePhrases]);

  const addPhrase = async (phrase: string) => {
    const trimmed = phrase.trim();
    if (!trimmed || !user) return;

    if (phrases.includes(trimmed)) return;

    // Optimistic Update
    setPhrases(prev => [...prev, trimmed]);

    try {
      const { error } = await supabase
        .from('autocomplete_phrases')
        .insert({
          user_id: user.id,
          phrase: trimmed
        });

      if (error) {
        if (error.code !== '23505') { // Unique constraint violation code
          throw error;
        }
      } else {
        window.dispatchEvent(new Event('autocomplete_phrases_changed'));
      }
    } catch (error) {
      console.error('Failed to add autocomplete phrase to DB', error);
      // Revert optimistic update
      setPhrases(prev => prev.filter(p => p !== trimmed));
    }
  };

  const removePhrase = async (phrase: string) => {
    const trimmed = phrase.trim();
    if (!user) return;

    // Optimistic Update
    setPhrases(prev => prev.filter(p => p !== phrase));

    try {
      const { error } = await supabase
        .from('autocomplete_phrases')
        .delete()
        .eq('user_id', user.id)
        .eq('phrase', trimmed);

      if (error) throw error;
      window.dispatchEvent(new Event('autocomplete_phrases_changed'));
    } catch (error) {
      console.error('Failed to remove autocomplete phrase from DB', error);
      // Revert optimistic update
      setPhrases(prev => [...prev, phrase]);
    }
  };

  return { phrases, addPhrase, removePhrase, loading };
}

