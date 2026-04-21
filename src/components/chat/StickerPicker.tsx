import React from 'react';
import { motion } from 'framer-motion';
import { STICKER_PACK } from '../../lib/stickers';
import PremiumEmoji from '../common/PremiumEmoji';

interface StickerPickerProps {
  onSelect: (sticker: { emoji: string, id: string }) => void;
  onClose: () => void;
}

export const StickerPicker: React.FC<StickerPickerProps> = ({ onSelect, onClose }) => {
  return (
    <div className="flex flex-col h-full bg-background/95 backdrop-blur-xl border-t border-primary/10 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-primary font-medium tracking-wide">Stickers</h3>
        <button 
          onClick={onClose}
          className="text-primary/60 hover:text-primary transition-colors"
        >
          Close
        </button>
      </div>
      
      <div className="grid grid-cols-4 gap-4 overflow-y-auto pb-8 custom-scrollbar">
        {STICKER_PACK.map((sticker) => (
          <motion.button
            key={sticker.id}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelect({ emoji: sticker.emoji, id: sticker.id })}
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all group"
          >
            <div className="mb-1 group-hover:drop-shadow-[0_0_8px_var(--gold-glow)]">
              <PremiumEmoji emoji={sticker.emoji} size={36} />
            </div>
            <span className="text-[10px] text-white/40 uppercase tracking-tighter">
              {sticker.label}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
};
