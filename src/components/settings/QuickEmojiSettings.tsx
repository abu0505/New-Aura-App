import { useState, useRef, useEffect } from 'react';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import type { EmojiClickData } from 'emoji-picker-react';
import { useChatSettingsContext } from '../../contexts/ChatSettingsContext';
import { motion, AnimatePresence } from 'framer-motion';

const DEFAULT_EMOJIS = ['❤️', '😂', '😮', '😢', '🔥', '✨'];

export default function QuickEmojiSettings() {
  const { settings, updateSettings } = useChatSettingsContext();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const emojis = settings?.quick_emojis || DEFAULT_EMOJIS;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setEditingIndex(null);
      }
    };
    if (editingIndex !== null) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editingIndex]);

  const handleEmojiClick = async (emojiData: EmojiClickData) => {
    if (editingIndex === null) return;
    
    const newEmojis = [...emojis];
    newEmojis[editingIndex] = emojiData.emoji;
    
    await updateSettings({ quick_emojis: newEmojis });
    setEditingIndex(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold">Quick Reactions</span>
        <span className="text-[9px] text-[var(--gold)] italic">Tap a slot to customize your 6 express emojis</span>
      </div>

      <div className="relative">
        <div className="grid grid-cols-6 gap-3">
          {emojis.map((emoji, index) => (
            <motion.button
              key={index}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setEditingIndex(index)}
              className={`aspect-square flex items-center justify-center text-2xl rounded-2xl bg-white/5 border transition-all duration-300 ${
                editingIndex === index 
                  ? 'border-[var(--gold)] bg-[var(--gold)]/10 shadow-glow-gold' 
                  : 'border-white/10 hover:border-white/20'
              }`}
            >
              {emoji}
            </motion.button>
          ))}
        </div>

        <AnimatePresence>
          {editingIndex !== null && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              ref={pickerRef}
              className="absolute z-50 top-full mt-4 left-0 md:left-auto md:right-0 shadow-2xl rounded-2xl overflow-hidden border border-white/10"
            >
              <div className="custom-emoji-picker-container bg-aura-bg-elevated/95 backdrop-blur-md">
                <EmojiPicker
                  theme={Theme.DARK}
                  onEmojiClick={handleEmojiClick}
                  lazyLoadEmojis={true}
                  searchPlaceHolder="Search emoji"
                  previewConfig={{ showPreview: false }}
                  skinTonesDisabled={true}
                  width={300}
                  height={400}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
