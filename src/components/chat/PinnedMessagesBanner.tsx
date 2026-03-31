import { useState } from 'react';
import { motion } from 'framer-motion';

interface PinnedMessagesBannerProps {
  pinnedMessages: any[]; 
  messages: any[]; // The full ChatMessage array to resolve message text
  pinnedMessageDetails?: Record<string, any>;
  onUnpin: (messageId: string) => void;
  onJumpToMessage: (messageId: string) => void;
}

export default function PinnedMessagesBanner({ 
  pinnedMessages, messages, pinnedMessageDetails = {}, onUnpin, onJumpToMessage 
}: PinnedMessagesBannerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!pinnedMessages || pinnedMessages.length === 0) return null;

  const safeIndex = Math.min(currentIndex, Math.max(0, pinnedMessages.length - 1));
  const currentPin = pinnedMessages[safeIndex];

  if (!currentPin) return null;

  const activeMessage = messages.find(m => m.id === currentPin.message_id) || pinnedMessageDetails[currentPin.message_id];

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % pinnedMessages.length);
  };
  
  const renderMessageContent = () => {
    if (!activeMessage) return 'Message from chat history...';
    if (activeMessage.type === 'image') return '📷 Image';
    if (activeMessage.type === 'video') return '🎥 Video';
    if (activeMessage.type === 'document') return '📄 Document';
    if (activeMessage.type === 'audio') return '🎵 Audio';
    return activeMessage.decrypted_content || 'Message from chat history...';
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      onClick={() => activeMessage && onJumpToMessage(activeMessage.id)}
      className="bg-[#292932]/95 backdrop-blur-md border-b border-white/5 px-4 py-2 flex items-center justify-between cursor-pointer shadow-lg z-30 relative"
    >
      <div className="flex items-center gap-3 overflow-hidden">
        <span className="material-symbols-outlined text-[#e6c487] text-xl rotate-45">push_pin</span>
        <div className="flex flex-col truncate">
          <span className="text-[#e6c487] text-xs font-label uppercase tracking-widest font-semibold flex items-center gap-2">
            Pinned Message {pinnedMessages.length > 1 && `(${safeIndex + 1}/${pinnedMessages.length})`}
          </span>
          <span className="text-[#e4e1ed] text-sm truncate max-w-xs md:max-w-md font-body">
            {renderMessageContent()}
          </span>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        {pinnedMessages.length > 1 && (
          <button 
            onClick={handleNext}
            className="p-1 hover:bg-white/10 rounded-full text-[#998f81] transition-colors"
          >
            <span className="material-symbols-outlined text-lg">swap_vert</span>
          </button>
        )}
        <button 
          onClick={(e) => { e.stopPropagation(); onUnpin(currentPin.message_id); }}
          className="p-1 hover:bg-white/10 rounded-full text-[#998f81] transition-colors"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>
    </motion.div>
  );
}
