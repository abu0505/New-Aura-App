import { motion } from 'framer-motion';

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
      className="flex items-center gap-2 bg-[#292932]/90 backdrop-blur-md px-4 py-2 rounded-full shadow-2xl border border-white/10"
    >
      {EMOJIS.map(emoji => (
        <button
          key={emoji}
          onClick={() => onSelect(emoji)}
          className="text-2xl hover:scale-125 transition-transform active:scale-90"
        >
          {emoji}
        </button>
      ))}
    </motion.div>
  );
}
