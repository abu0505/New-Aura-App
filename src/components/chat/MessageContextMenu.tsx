import { motion } from 'framer-motion';

interface MessageContextMenuProps {
  isMine: boolean;
  hasMedia?: boolean;
  onEdit?: () => void;
  onPin: () => void;
  onMoveToGarbage?: () => void;
}

export default function MessageContextMenu({
  isMine, hasMedia, onEdit, onPin, onMoveToGarbage
}: MessageContextMenuProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9, y: 5 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 5 }}
      className={`flex flex-col bg-[#292932]/90 backdrop-blur-md rounded-xl shadow-2xl border border-white/5 overflow-hidden w-48`}
    >
      <button 
        onClick={onPin}
        className="flex items-center gap-3 px-4 py-3 hover:bg-[rgba(var(--primary-rgb),_0.1)] text-[#e4e1ed] transition-colors text-sm text-left font-body"
      >
        <span className="material-symbols-outlined text-[18px]">push_pin</span>
        Pin Message
      </button>

      {isMine && onEdit && (
        <button 
          onClick={onEdit}
          className="flex items-center gap-3 px-4 py-3 hover:bg-[rgba(var(--primary-rgb),_0.1)] text-[#e4e1ed] transition-colors text-sm text-left font-body border-t border-white/5"
        >
          <span className="material-symbols-outlined text-[18px]">edit</span>
          Edit
        </button>
      )}

      {/* Move to Garbage — only visible for media messages */}
      {hasMedia && onMoveToGarbage && (
        <button 
          onClick={onMoveToGarbage}
          className="flex items-center gap-3 px-4 py-3 hover:bg-amber-500/10 text-amber-400 transition-colors text-sm text-left font-body border-t border-white/5"
        >
          <span className="material-symbols-outlined text-[18px]">delete_outline</span>
          Move to Garbage
        </button>
      )}
    </motion.div>
  );
}
