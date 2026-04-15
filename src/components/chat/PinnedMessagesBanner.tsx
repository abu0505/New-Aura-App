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
      className="bg-aura-bg-elevated/95 backdrop-blur-md border-b border-white/5 px-4 py-2 flex items-center justify-between cursor-pointer shadow-lg z-30 relative"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
        <span className="material-symbols-outlined text-primary text-xl rotate-45 shrink-0">push_pin</span>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-primary text-[10px] font-label uppercase tracking-widest font-semibold flex items-center gap-2 truncate">
            Pinned Message {pinnedMessages.length > 1 && `(${safeIndex + 1}/${pinnedMessages.length})`}
            {/* Fix 2.6: Show pin usage out of max 3 */}
            <span className="ml-auto text-[9px] text-white/25 font-bold tracking-wider shrink-0">
              {pinnedMessages.length}/3
            </span>
          </span>
          <span className="text-[#e4e1ed] text-sm truncate font-body w-full">
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
