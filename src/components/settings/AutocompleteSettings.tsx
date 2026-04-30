import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAutocompletePhrases } from '../../hooks/useAutocompletePhrases';

export default function AutocompleteSettings() {
  const { phrases, addPhrase, removePhrase } = useAutocompletePhrases();
  const [inputValue, setInputValue] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      addPhrase(inputValue);
      setInputValue('');
    }
  };

  return (
    <div className="bg-aura-bg-elevated/50 backdrop-blur-md rounded-3xl p-6 border border-white/5 shadow-2xl relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

      <div className="flex items-center gap-4 mb-5">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
          <span className="material-symbols-outlined text-primary text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
            keyboard
          </span>
        </div>
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-aura-text-primary mb-1">Auto Complete</h2>
          <p className="text-sm text-aura-text-secondary">Save frequently used phrases for quick typing</p>
        </div>
      </div>

      <div className="space-y-6 relative z-10">
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="e.g. Meri pyaari begham 💋"
            className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-aura-text-primary focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-aura-text-secondary/50"
          />
          <button
            type="submit"
            disabled={!inputValue.trim()}
            className="bg-primary text-background w-12 h-12 shrink-0 flex items-center justify-center rounded-xl font-semibold hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100"
          >
            <span className="material-symbols-outlined">add</span>
          </button>
        </form>

        <div className="space-y-2 max-h-[132px] overflow-y-auto scrollbar-hide">
          <AnimatePresence>
            {phrases.map((phrase) => (
              <motion.div
                key={phrase}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex items-center justify-between bg-black/20 border border-white/5 rounded-xl py-1 px-3 shrink-0"
              >
                <span className="text-aura-text-primary truncate mr-4">{phrase}</span>
                <button
                  onClick={() => removePhrase(phrase)}
                  className="text-aura-danger/80 hover:text-aura-danger transition-colors p-2 rounded-lg hover:bg-aura-danger/10 shrink-0"
                  title="Remove phrase"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              </motion.div>
            ))}
            {phrases.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-8 text-aura-text-secondary/50 text-sm"
              >
                No phrases added yet. Add one above!
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
