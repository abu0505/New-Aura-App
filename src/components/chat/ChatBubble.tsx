import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';
import type { ChatMessage } from '../../hooks/useChat';
import MessageContextMenu from './MessageContextMenu';
import MediaViewer from './MediaViewer';

interface ChatBubbleProps {
  message: ChatMessage;
  partnerPublicKey: string | null;
  onReact?: (msgId: string, emoji: string | null) => void;
  onEdit?: (msgId: string, content: string) => void;
  onDelete?: (msgId: string, forEveryone: boolean) => void;
  onPin?: (msgId: string) => void;
}

export default function ChatBubble({ 
  message, 
  partnerPublicKey,
  onReact,
  onEdit,
  onDelete,
  onPin
}: ChatBubbleProps) {
  const { getDecryptedBlob } = useMedia();
  const [decryptedMediaUrl, setDecryptedMediaUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showInteractions, setShowInteractions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showAllEmojis, setShowAllEmojis] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  
  const isMine = message.is_mine;
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    if (message.media_url && message.media_key && message.media_nonce && partnerPublicKey && !message.is_deleted_for_everyone) {
      setLoading(true);
      getDecryptedBlob(
        message.media_url, message.media_key, message.media_nonce, 
        partnerPublicKey,
        message.sender_public_key
      )
        .then(blob => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            blobUrlRef.current = url;
            setDecryptedMediaUrl(url);
          }
          setLoading(false);
        });
    }
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [message.id, partnerPublicKey, message.is_deleted_for_everyone]);

  // Click outside listener for interaction menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) {
        setShowInteractions(false);
        setShowAllEmojis(false); // Close all emojis when clicking outside
      }
    };
    if (showInteractions) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showInteractions]);

  // Hidden if deleted for me
  if (message.is_deleted_for_me) return null;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowInteractions(true);
  };

  const pressTimer = useRef<number | null>(null);

  const handleTouchStart = () => {
    // Custom long press interval for mobile (250ms, half of default 500ms)
    pressTimer.current = window.setTimeout(() => {
      setShowInteractions(true);
    }, 250);
  };

  const handleTouchEnd = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  const handleEditSubmit = () => {
    if (editContent && editContent !== message.decrypted_content) {
      onEdit?.(message.id, editContent);
    }
    setIsEditing(false);
  };

  const isOnlyMedia = (message.type === 'image' || message.type === 'video') && !message.decrypted_content;

  // Check if message is a location share
  const isLocation = message.type === 'location';
  const locationCoords = isLocation && message.decrypted_content ? message.decrypted_content.split(',') : null;
  const isSticker = message.type === 'sticker';
  const decryptionError = message.decryption_error;

  const renderMedia = () => {
    if (message.is_deleted_for_everyone) return null;
    if (loading) {
      return (
        <div className="w-48 h-32 flex flex-col items-center justify-center bg-black/20 rounded-xl gap-2">
          <div className="w-5 h-5 border-2 border-[#e6c487]/30 border-t-[#e6c487] rounded-full animate-spin" />
          <span className="text-[8px] uppercase tracking-widest text-[#e6c487]/60 font-label">Securing...</span>
        </div>
      );
    }

    if (!decryptedMediaUrl) return null;

    switch (message.type) {
      case 'image':
        return (
          <div className="relative group max-w-[240px]">
            <motion.img 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              src={decryptedMediaUrl} 
              className={`w-full h-auto ${isOnlyMedia ? 'rounded-2xl' : 'rounded-xl'} overflow-hidden shadow-lg border border-white/5 cursor-pointer hover:opacity-90 transition-opacity`}
              onClick={() => setIsPreviewOpen(true)}
            />
            {isPreviewOpen && (
              <MediaViewer 
                url={decryptedMediaUrl} 
                type="image" 
                onClose={() => setIsPreviewOpen(false)} 
              />
            )}
          </div>
        );
      case 'video':
        return (
          <div className="relative max-w-[240px] group">
            <div className={`relative cursor-pointer group ${isOnlyMedia ? 'rounded-2xl' : 'rounded-xl'} overflow-hidden shadow-lg border border-white/5`} onClick={() => setIsPreviewOpen(true)}>
              <video 
                src={decryptedMediaUrl} 
                className="w-full pointer-events-none" 
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
                <span className="material-symbols-outlined text-white text-4xl shadow-xl">play_circle</span>
              </div>
            </div>
            {isPreviewOpen && (
              <MediaViewer 
                url={decryptedMediaUrl} 
                type="video" 
                onClose={() => setIsPreviewOpen(false)} 
              />
            )}
          </div>
        );
      case 'audio':
        return (
          <div className="flex items-center gap-3 bg-black/20 rounded-full px-4 py-2 min-w-[200px]">
            <span className="material-symbols-outlined text-[#e6c487]">mic</span>
            <audio src={decryptedMediaUrl} controls className="h-8 w-full" />
          </div>
        );
      default:
        return (
          <a 
            href={decryptedMediaUrl} 
            target="_blank" 
            className="flex items-center gap-2 bg-black/20 px-4 py-2 rounded-xl text-xs text-[#e6c487] underline"
          >
            <span className="material-symbols-outlined">description</span>
            View Attachment
          </a>
        );
    }
  };

  if (isEditing) {
    return (
      <div className={`flex w-full ${isMine ? 'justify-end' : 'justify-start'}`}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }} 
          animate={{ opacity: 1, scale: 1 }} 
          className="bg-[#1b1b23] p-4 rounded-3xl w-full max-w-sm border border-[#e6c487]/20 shadow-2xl relative"
        >
          <div className="flex items-center gap-2 mb-3 text-[#e6c487] px-1">
             <span className="material-symbols-outlined text-sm">edit_note</span>
             <span className="text-[10px] uppercase tracking-widest font-label font-bold">Edit Sanctuary Note</span>
          </div>
          <textarea
            ref={editInputRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full bg-black/30 rounded-2xl px-4 py-3 text-sm text-[#e4e1ed] placeholder:text-[#998f81]/40 border border-[#e6c487]/10 focus:border-[#e6c487]/40 outline-none resize-none font-body custom-scrollbar transition-colors"
            rows={3}
          />
          <div className="flex justify-end gap-3 mt-4 pr-1">
            <button onClick={() => setIsEditing(false)} className="px-5 py-2 rounded-full text-[10px] font-label uppercase tracking-widest text-[#998f81] hover:text-white transition-colors">Cancel</button>
            <button onClick={handleEditSubmit} className="px-6 py-2 rounded-full text-[10px] font-label uppercase tracking-widest bg-gradient-to-r from-[#c9a96e] to-[#e6c487] text-[#13131b] font-bold hover:shadow-[0_0_15px_rgba(230,196,135,0.4)] transition-all active:scale-95">Save Changes</button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div 
      ref={bubbleRef}
      className={`flex flex-col relative ${isMine ? 'items-end' : 'items-start'} gap-1 ${isMine ? 'self-end' : 'self-start'}`}
    >
      {/* Location mini-map message */}
      {locationCoords && locationCoords.length === 2 && (
        <div className={`overflow-hidden rounded-2xl shadow-xl border border-white/10 w-[240px] ${isMine ? 'self-end' : 'self-start'} group cursor-pointer`}
             onClick={() => document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'location' }))}>
          <div className="relative">
            <img 
              src={`https://staticmap.openstreetmap.de/staticmap.php?center=${locationCoords[0]},${locationCoords[1]}&zoom=15&size=240x160&maptype=mapnik&markers=${locationCoords[0]},${locationCoords[1]},ol-marker`}
              alt="Shared location"
              className="w-full h-40 object-cover group-hover:scale-105 transition-transform duration-500"
              onError={(e) => {
                // Fallback if the static service is down
                e.currentTarget.src = 'https://ui-avatars.com/api/?name=Map&background=1b1b23&color=e6c487&size=240';
              }}
            />
            <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />
            
            {/* Dark mode overlay since OSM default tiles are light */}
            <div className="absolute inset-0 bg-[#0d0d15]/40 mix-blend-multiply pointer-events-none" />
          </div>
          <div className="bg-[#1b1b23] px-3 py-2 flex items-center justify-between border-t border-white/5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#e6c487] text-sm">location_on</span>
              <span className="text-[10px] text-[#e4e1ed] font-label uppercase tracking-widest">Sanctuary Live</span>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
               <span className="text-[9px] uppercase tracking-tighter text-[#e4e1ed]/40 font-bold">{time}</span>
               {isMine && !message.is_deleted_for_everyone && (
                <span 
                  className={`material-symbols-outlined text-[12px] ${message.is_read ? 'text-[#e6c487]' : 'text-[#e4e1ed]/30'}`} 
                  style={{ fontVariationSettings: "'wght' 700" }}
                >
                  {message.is_read ? 'done_all' : (message.is_delivered ? 'done_all' : 'check')}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      <AnimatePresence>
        {showInteractions && (
          <motion.div 
            initial={{ opacity: 0, y: isMine ? 10 : -10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`absolute z-30 ${isMine ? 'right-0 top-full mt-2' : 'left-0 bottom-full mb-2'} flex flex-col items-center gap-1`}
          >
            {/* Quick Reactions */}
            <div className={`p-3 bg-[#1b1b23]/95 backdrop-blur-md shadow-2xl border border-white/10 ${showAllEmojis ? 'w-[200px] flex flex-wrap justify-center gap-2 rounded-3xl' : 'flex justify-center gap-2 rounded-full'}`}>
              {(showAllEmojis ? ['❤️', '😂', '😮', '😢', '🙏', '🔥', '😍', '✨', '🥺', '🎉', '💔', '💯', '🥂', '🫂', '🥰', '😘', '💍', '🙈', '🚀'] : ['❤️', '😂', '😮', '😢', '🔥']).map(emoji => (
                <button 
                  key={emoji}
                  onClick={() => { onReact?.(message.id, emoji); setShowInteractions(false); setShowAllEmojis(false); }}
                  className="hover:scale-125 transition-transform text-xl active:scale-90"
                >
                  {emoji}
                </button>
              ))}
              {!showAllEmojis && (
                <button onClick={() => setShowAllEmojis(true)} className="ml-1 w-7 h-7 bg-white/5 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors text-[#e6c487]">
                  <span className="material-symbols-outlined text-sm">add</span>
                </button>
              )}
            </div>

            {/* Context Menu Actions */}
            <MessageContextMenu 
              isMine={isMine}
              onPin={() => { onPin?.(message.id); setShowInteractions(false); }}
              onEdit={message.type === 'text' && !message.is_deleted_for_everyone && !message.decryption_error ? () => { 
                setIsEditing(true);
                setEditContent(message.decrypted_content || '');
                setShowInteractions(false);
                // Focus textarea after it renders
                setTimeout(() => editInputRef.current?.focus(), 0);
              } : undefined}
              onDeleteForMe={() => { onDelete?.(message.id, false); setShowInteractions(false); }}
              onDeleteForEveryone={() => { onDelete?.(message.id, true); setShowInteractions(false); }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {!isLocation && (
        <div 
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchEnd}
          className={`shadow-lg relative cursor-pointer transition-transform ${showInteractions ? 'scale-95' : ''} ${
          isOnlyMedia || isSticker
             ? 'bg-transparent shadow-none' 
             : isMine 
               ? 'px-4 py-3 bg-gradient-to-br from-[#c9a96e] to-[#e6c487] text-[#13131b] rounded-2xl rounded-br-sm' 
               : 'px-4 py-3 bg-[#1b1b23] text-[#e4e1ed] rounded-2xl rounded-bl-sm border border-white/5'
          } ${message.is_deleted_for_everyone ? 'opacity-60 italic' : ''} ${decryptionError ? 'border-dashed border-red-500/50 bg-red-500/5' : ''}`}
        >
        {decryptionError ? (
          <div className="flex items-center gap-2 py-1 px-1">
            <span className="material-symbols-outlined text-red-400 text-lg">history_edu</span>
            <span className="text-xs text-red-200/70 font-label tracking-wide uppercase">Decryption Failed</span>
          </div>
        ) : isSticker ? (
          <motion.span 
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-7xl block py-2 select-none filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
          >
            {message.decrypted_content}
          </motion.span>
        ) : renderMedia()}
        {message.decrypted_content && !isSticker && (
          <p className={`text-[15px] flex flex-wrap items-end gap-2 ${message.media_url ? 'mt-2' : ''} leading-relaxed font-body`}>
            {message.decrypted_content}
            {message.is_edited && !message.is_deleted_for_everyone && (
              <span className={`text-[10px] ${isMine ? 'text-[#13131b]/50' : 'text-[#998f81]/60'}`}>(edited)</span>
            )}
          </p>
        )}
        
        {/* Reaction Badge */}
        {message.reaction && (
          <div className={`absolute -bottom-3 ${isMine ? 'left-4' : 'right-4'} bg-[#292932] border border-white/10 rounded-full px-2 py-0.5 text-sm shadow-xl z-10`}>
            {message.reaction}
          </div>
        )}

        {/* Embedded Timestamp and Status Info */}
        <div className={`flex items-center justify-end gap-1 mt-1.5 ${isOnlyMedia || isSticker ? 'absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-md' : ''}`}>
          <span className={`text-[9px] uppercase tracking-tighter ${
            isOnlyMedia || isSticker
              ? 'text-white/90'
              : isMine 
                ? 'text-[#13131b]/80 font-bold' 
                : 'text-[#e4e1ed]/60 font-bold'
          }`}>
            {time}
          </span>
          {isMine && !message.is_deleted_for_everyone && (
            <span 
              className={`material-symbols-outlined text-[12px] ${
                isOnlyMedia || isSticker
                  ? (message.is_read ? 'text-[#e6c487]' : 'text-white/60')
                  : (message.is_read ? 'text-[#13131b]/70' : 'text-[#13131b]/30')
              }`} 
              style={{ fontVariationSettings: "'wght' 700" }}
            >
              {message.is_read ? 'done_all' : (message.is_delivered ? 'done_all' : 'check')}
            </span>
          )}
          {isMine && message.is_pending && (
            <span className={`material-symbols-outlined text-[12px] animate-pulse ${isOnlyMedia || isSticker ? 'text-[#e6c487]' : 'text-[#13131b]/40'}`}>schedule</span>
          )}
        </div>
      </div>
    )}
  </div>
);
}
