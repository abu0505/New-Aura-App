import { motion } from 'framer-motion';
import PremiumEmoji from '../common/PremiumEmoji';

interface ReactionPickerProps {
  onSelect: (emoji: string) => void;
}

const EMOJIS = ['❤️', '😂', '🔥', '🥺', '👍', '👎'];

export default function ReactionPicker({ onSelect }: ReactionPickerProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 10 }}
      className="flex items-center gap-2 bg-[#292932]/95 backdrop-blur-md px-4 py-3 rounded-full shadow-2xl border border-white/10"
    >
      {EMOJIS.map(emoji => (
        <button
          key={emoji}
          onClick={() => onSelect(emoji)}
          className="hover:scale-125 transition-transform active:scale-90 px-1"
        >
          <PremiumEmoji emoji={emoji} size={28} />
        </button>
      ))}
    </motion.div>
  );
}
