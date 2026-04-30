import { useState, useEffect } from 'react';

const STORAGE_KEY = 'aura_autocomplete_phrases';

export function useAutocompletePhrases() {
  const [phrases, setPhrases] = useState<string[]>([]);

  const loadPhrases = () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setPhrases(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse autocomplete phrases', e);
      }
    } else {
      setPhrases([]);
    }
  };

  useEffect(() => {
    loadPhrases();

    const handleCustomEvent = () => loadPhrases();
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) loadPhrases();
    };

    window.addEventListener('autocomplete_phrases_changed', handleCustomEvent);
    window.addEventListener('storage', handleStorageEvent);

    return () => {
      window.removeEventListener('autocomplete_phrases_changed', handleCustomEvent);
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, []);

  const addPhrase = (phrase: string) => {
    const trimmed = phrase.trim();
    if (!trimmed || phrases.includes(trimmed)) return;
    
    const newPhrases = [...phrases, trimmed];
    setPhrases(newPhrases);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newPhrases));
    window.dispatchEvent(new Event('autocomplete_phrases_changed'));
  };

  const removePhrase = (phrase: string) => {
    const newPhrases = phrases.filter(p => p !== phrase);
    setPhrases(newPhrases);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newPhrases));
    window.dispatchEvent(new Event('autocomplete_phrases_changed'));
  };

  return { phrases, addPhrase, removePhrase };
}
