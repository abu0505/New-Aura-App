import { motion } from 'framer-motion';
import { format } from 'date-fns';
import type { Message } from '../../types';
import LinkPreview from './LinkPreview';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  showTail?: boolean;
}

export default function MessageBubble({ message, isOwn, showTail = true }: MessageBubbleProps) {
  // TODO: Decrypt message content in the future. For now assume plaintext for UI testing.
  const content = message.ciphertext;
  const time = format(new Date(message.created_at || new Date()), 'h:mm a');

  // Extract URLs
  const urlRegex = /((?:https?:\/\/|www\.)[^\s]+|[a-zA-Z0-9.-]+\.(?:com|org|net|io|co|in|me|app|dev|to)(?:\/[^\s]*)?)/gi;
  const rawUrls = content.match(urlRegex) || [];
  const urls = rawUrls.map(u => u.trim());

  // Format valid URL (prepend https if needed, strip trailing punctuation)
  const formatUrl = (url: string) => {
    const clean = url.replace(/[.,;!?]$/, '');
    if (!/^https?:\/\//i.test(clean)) {
      return `https://${clean}`;
    }
    return clean;
  };

  const firstUrl = urls.length > 0 ? formatUrl(urls[0]) : null;

  // Render text with links
  const renderContent = (text: string) => {
    if (urls.length === 0) return text;
    
    const parts = text.split(urlRegex);

    return parts.map((part, i) => {
      if (part && urls.includes(part)) {
        return (
          <a
            key={i}
            href={formatUrl(part)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 font-semibold hover:opacity-80 transition-opacity break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };
  
  // Status logic
  let statusIcon = null;
  if (isOwn) {
    if (message.read_at) {
      statusIcon = <span className="material-symbols-outlined text-[14px] text-[var(--gold)]" style={{ fontVariationSettings: "'FILL' 1" }}>done_all</span>;
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
            ? `rounded-2xl ${showTail ? 'rounded-tr-sm' : 'rounded-tr-2xl'} bg-[var(--gold)] text-[var(--bg-primary)]`
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
        <div className="font-body text-sm whitespace-pre-wrap break-words leading-relaxed relative z-10">
          {renderContent(content)}
        </div>
        
        {firstUrl && <LinkPreview url={firstUrl} />}
        
        <div 
          className={`flex items-center justify-end gap-1 text-[10px] select-none ${
            isOwn ? 'text-[var(--bg-primary)]/70' : 'text-[#8A8799]'
          }`}
        >
          <span>{time}</span>
          {isOwn && statusIcon}
        </div>
      </div>
    </motion.div>
  );
}
