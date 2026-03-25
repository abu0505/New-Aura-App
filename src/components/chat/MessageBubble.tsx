import { motion } from 'framer-motion';
import { format } from 'date-fns';
import type { Message } from '../../types';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  showTail?: boolean;
}

export default function MessageBubble({ message, isOwn, showTail = true }: MessageBubbleProps) {
  // TODO: Decrypt message content in the future. For now assume plaintext for UI testing.
  const content = message.ciphertext;
  const time = format(new Date(message.created_at || new Date()), 'HH:mm');
  
  // Status logic
  let statusIcon = null;
  if (isOwn) {
    if (message.read_at) {
      statusIcon = <span className="material-symbols-outlined text-[14px] text-[#C9A96E]" style={{ fontVariationSettings: "'FILL' 1" }}>done_all</span>;
    } else if (message.delivered_at) {
      statusIcon = <span className="material-symbols-outlined text-[14px] text-[#998f81]/60">done_all</span>;
    } else {
      statusIcon = <span className="material-symbols-outlined text-[14px] text-[#998f81]/60">done</span>;
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex w-full mb-1 ${isOwn ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`relative max-w-[75%] px-4 py-2.5 flex flex-col gap-1 ${
          isOwn
            ? `rounded-2xl ${showTail ? 'rounded-tr-sm' : 'rounded-tr-2xl'} bg-gradient-to-br from-[#C9A96E] to-[#A8845A] text-[#0C0C14]`
            : `rounded-2xl ${showTail ? 'rounded-tl-sm' : 'rounded-tl-2xl'} text-[#E4E1ED]`
        }`}
        style={
          !isOwn
            ? {
                background: 'rgba(19, 19, 30, 0.8)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(201, 169, 110, 0.08)',
              }
            : {
                boxShadow: '0 4px 15px rgba(201, 169, 110, 0.15)',
              }
        }
      >
        <p className="font-body text-sm whitespace-pre-wrap break-words leading-relaxed">
          {content}
        </p>
        
        <div 
          className={`flex items-center justify-end gap-1 text-[10px] select-none ${
            isOwn ? 'text-[#0C0C14]/70' : 'text-[#8A8799]'
          }`}
        >
          <span>{time}</span>
          {isOwn && statusIcon}
        </div>
      </div>
    </motion.div>
  );
}
