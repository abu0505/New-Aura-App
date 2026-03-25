import { motion } from 'framer-motion';

interface MessageContextMenuProps {
  isMine: boolean;
  onEdit?: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone?: () => void;
  onPin: () => void;
}

export default function MessageContextMenu({
  isMine, onEdit, onDeleteForMe, onDeleteForEveryone, onPin
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
        className="flex items-center gap-3 px-4 py-3 hover:bg-[#c9a96e]/10 text-[#e4e1ed] transition-colors text-sm text-left font-body"
      >
        <span className="material-symbols-outlined text-[18px]">push_pin</span>
        Pin Message
      </button>

      {isMine && onEdit && (
        <button 
          onClick={onEdit}
          className="flex items-center gap-3 px-4 py-3 hover:bg-[#c9a96e]/10 text-[#e4e1ed] transition-colors text-sm text-left font-body border-t border-white/5"
        >
          <span className="material-symbols-outlined text-[18px]">edit</span>
          Edit
        </button>
      )}

      <button 
        onClick={onDeleteForMe}
        className="flex items-center gap-3 px-4 py-3 hover:bg-[#ffb4ab]/10 text-[#ffb4ab] transition-colors text-sm text-left font-body border-t border-white/5"
      >
        <span className="material-symbols-outlined text-[18px]">delete</span>
        Delete for me
      </button>

      {isMine && onDeleteForEveryone && (
        <button 
          onClick={onDeleteForEveryone}
          className="flex items-center gap-3 px-4 py-3 hover:bg-[#ffb4ab]/10 text-[#ffb4ab] transition-colors text-sm text-left font-body border-t border-white/5"
        >
          <span className="material-symbols-outlined text-[18px]">delete_forever</span>
          Delete for everyone
        </button>
      )}
    </motion.div>
  );
}
