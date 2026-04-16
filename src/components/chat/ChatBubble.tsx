import { useState, useEffect, useRef, memo } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';
import type { ChatMessage } from '../../hooks/useChat';
import MessageContextMenu from './MessageContextMenu';
import MediaViewer from './MediaViewer';
import AudioWaveformPlayer from './AudioWaveformPlayer';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import LinkPreview from './LinkPreview';

interface ChatBubbleProps {
  message: ChatMessage;
  partnerPublicKey: string | null;
  onReact?: (msgId: string, emoji: string | null) => void;
  onEdit?: (msgId: string, content: string) => void;
  onDelete?: (msgId: string, forEveryone: boolean) => void;
  onPin?: (msgId: string) => void;
  isFirst?: boolean;
  isLast?: boolean;
  isPinnedView?: boolean;
  onRedirect?: (msgId: string) => void;
  onReply?: (msgId: string) => void;
  repliedMessage?: ChatMessage;
  onJumpToMessage?: (msgId: string) => void;
}

function ChatBubble({ 
  message, 
  partnerPublicKey,
  onReact,
  onEdit,
  onDelete,
  onPin,
  isFirst = true,
  isLast = true,
  isPinnedView = false,
  onRedirect,
  onReply,
  repliedMessage,
  onJumpToMessage
}: ChatBubbleProps) {
  const { getDecryptedBlob } = useMedia();
  const [decryptedMediaUrl, setDecryptedMediaUrl] = useState<string | null>(message.decrypted_media_url || null);
  const [repliedMediaUrl, setRepliedMediaUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [interactionType, setInteractionType] = useState<'none' | 'reactions' | 'menu'>('none');
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showAllEmojis, setShowAllEmojis] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const repliedBlobUrlRef = useRef<string | null>(null);
  const [bubbleRect, setBubbleRect] = useState<{ top: number; bottom: number } | null>(null);

  const swipeX = useMotionValue(0);
  const springX = useSpring(swipeX, { stiffness: 800, damping: 35 });
  const touchStartX = useRef<number | null>(null);
  const hapticTriggered = useRef(false);
  
  const isMine = isPinnedView ? true : message.is_mine;
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).replace(':', ' : ');

  // Extract URLs
  const urlRegex = /((?:https?:\/\/|www\.)[^\s]+|[a-zA-Z0-9.-]+\.(?:com|org|net|io|co|in|me|app|dev|to)(?:\/[^\s]*)?)/gi;
  const rawUrls = message.decrypted_content?.match(urlRegex) || [];
  const urls = rawUrls.map(u => u.trim());

  const formatUrl = (url: string) => {
    const clean = url.replace(/[.,;!?]$/, '');
    if (!/^https?:\/\//i.test(clean)) {
      return `https://${clean}`;
    }
    return clean;
  };

  const firstUrl = urls.length > 0 ? formatUrl(urls[0]) : null;

  const renderContent = (text: string) => {
    if (!text) return null;
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
            className={`underline underline-offset-2 font-semibold hover:opacity-80 transition-opacity break-all ${isMine ? 'text-background/90' : 'text-blue-300'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const replyOpacity = useTransform(springX, (v) => Math.min(Math.abs(v) / 45, 1));
  const replyScale = useTransform(springX, (v) => 0.8 + Math.min(Math.abs(v) / 45, 1) * 0.3);
  const iconTranslate = useTransform(springX, (v) => -v / 2);

  useEffect(() => {
    if (message.media_url && message.media_key && message.media_nonce && partnerPublicKey && !message.is_deleted_for_everyone) {
      setLoading(true);
      getDecryptedBlob(
        message.media_url, message.media_key, message.media_nonce, 
        partnerPublicKey,
        message.sender_public_key,
        undefined,         // partnerKeyHistory — not available here
        message.type       // Pass media type for correct MIME tagging (fixes alien audio sound)
      )
        .then(blob => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            blobUrlRef.current = url;
            setDecryptedMediaUrl(url);
          }
          setLoading(false);
        });
    } else if (message.decrypted_media_url && !message.media_key) {
      setDecryptedMediaUrl(message.decrypted_media_url);
    }
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [
    message.id, 
    partnerPublicKey, 
    message.is_deleted_for_everyone, 
    message.media_url, 
    message.media_key, 
    message.media_nonce, 
    message.type, 
    message.sender_public_key,
    message.decrypted_media_url
  ]);
  
  // Decrypt media for replied messages
  useEffect(() => {
    if (repliedMessage?.media_url && repliedMessage?.media_key && repliedMessage?.media_nonce && partnerPublicKey && !repliedMessage?.is_deleted_for_everyone) {
      getDecryptedBlob(
        repliedMessage.media_url, repliedMessage.media_key, repliedMessage.media_nonce, 
        partnerPublicKey,
        repliedMessage.sender_public_key,
        undefined,
        repliedMessage.type
      )
        .then(blob => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            repliedBlobUrlRef.current = url;
            setRepliedMediaUrl(url);
          }
        });
    }
    return () => {
      if (repliedBlobUrlRef.current) {
        URL.revokeObjectURL(repliedBlobUrlRef.current);
        repliedBlobUrlRef.current = null;
      }
    };
  }, [
    repliedMessage?.id,
    partnerPublicKey,
    repliedMessage?.is_deleted_for_everyone,
    repliedMessage?.media_url,
    repliedMessage?.media_key,
    repliedMessage?.media_nonce,
    repliedMessage?.type,
    repliedMessage?.sender_public_key,
    getDecryptedBlob
  ]);

  useEffect(() => {
    const handleClickOutside = (e: Event) => {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) {
        setInteractionType('none');
        setShowAllEmojis(false);
      }
    };

    if (interactionType !== 'none') {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('pointerdown', handleClickOutside);
    }
    
    // Elevate parent row z-index to stay above other messages
    const parentRow = bubbleRef.current?.closest('.message-row') as HTMLElement;
    if (parentRow) {
      if (interactionType !== 'none') {
        parentRow.style.zIndex = '100';
        parentRow.style.position = 'relative';
      } else {
        parentRow.style.zIndex = '';
        parentRow.style.position = '';
      }
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('pointerdown', handleClickOutside);
      if (parentRow) {
        parentRow.style.zIndex = '';
        parentRow.style.position = '';
      }
    };
  }, [interactionType]);

  // Hidden if deleted for this user (sender sees is_deleted_for_sender, receiver sees is_deleted_for_receiver)
  if ((message.is_mine && message.is_deleted_for_sender) || (!message.is_mine && message.is_deleted_for_receiver)) return null;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (bubbleRef.current) {
      setBubbleRect(bubbleRef.current.getBoundingClientRect());
    }
    setInteractionType('menu');
  };

  const pressTimer = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    // Custom long press interval for mobile (600ms, increased to prevent scroll triggers)
    pressTimer.current = window.setTimeout(() => {
      if (bubbleRef.current) {
        setBubbleRect(bubbleRef.current.getBoundingClientRect());
      }
      setInteractionType('menu');
    }, 600);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - touchStartX.current;
    
    // Partner -> swipe right (diff > 0)
    // Mine -> swipe left (diff < 0)
    let newOffset = 0;
    if (!isMine && diff > 0) {
      newOffset = Math.min(diff, 70); 
    } else if (isMine && diff < 0) {
      newOffset = Math.max(diff, -70);
    }
    
    swipeX.set(newOffset);

    // Subtle haptic feedback when threshold met
    if (Math.abs(newOffset) >= 45) {
      if (!hapticTriggered.current) {
        if ('vibrate' in navigator) navigator.vibrate(8);
        hapticTriggered.current = true;
      }
    } else {
      hapticTriggered.current = false;
    }
    
    // Cancel long press if swiping
    if (Math.abs(diff) > 10 && pressTimer.current) {
      clearTimeout(pressTimer.current);
    }
  };

  const handleTouchEnd = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    
    if (touchStartX.current !== null) {
      if (Math.abs(swipeX.get()) >= 45 && onReply) {
        onReply(message.id);
      }
      swipeX.set(0);
      touchStartX.current = null;
      hapticTriggered.current = false;
    }
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
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span className="text-[8px] uppercase tracking-widest text-primary/60 font-label">Securing...</span>
        </div>
      );
    }

    if (!decryptedMediaUrl) return null;

    switch (message.type) {
      case 'image':
        return (
          <div className={`relative group max-w-[240px] ${isMine ? 'ml-auto' : 'mr-auto'}`}>
            <motion.img 
              initial={{ opacity: 0 }}
              animate={{ opacity: message.is_uploading ? 0.6 : 1 }}
              src={decryptedMediaUrl} 
              className={`w-full h-auto ${isOnlyMedia ? 'rounded-2xl' : 'rounded-xl'} overflow-hidden shadow-lg border border-white/5 ${!message.is_uploading ? 'cursor-pointer hover:opacity-90' : ''} transition-opacity ${message.is_uploading ? 'blur-[2px] grayscale-[20%]' : ''}`}
              onClick={() => { if (!message.is_uploading) setIsPreviewOpen(true); }}
            />
            {message.is_uploading && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="w-10 h-10 flex items-center justify-center bg-black/50 rounded-full backdrop-blur-md border border-white/20 shadow-2xl shadow-black/50">
                  <span className="material-symbols-outlined text-primary text-2xl animate-spin">data_usage</span>
                </div>
              </div>
            )}
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
          <div className={`relative max-w-[240px] group ${isMine ? 'ml-auto' : 'mr-auto'}`}>
            <div className={`relative group ${isOnlyMedia ? 'rounded-2xl' : 'rounded-xl'} overflow-hidden shadow-lg border border-white/5 ${!message.is_uploading ? 'cursor-pointer' : 'opacity-60 blur-[2px] grayscale-[20%]'}`} onClick={() => { if (!message.is_uploading) setIsPreviewOpen(true) }}>
              <video 
                src={decryptedMediaUrl} 
                className="w-full pointer-events-none" 
              />
              {!message.is_uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
                  <span className="material-symbols-outlined text-white text-4xl shadow-xl">play_circle</span>
                </div>
              )}
            </div>
            {message.is_uploading && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="w-10 h-10 flex items-center justify-center bg-black/50 rounded-full backdrop-blur-md border border-white/20 shadow-2xl shadow-black/50">
                  <span className="material-symbols-outlined text-primary text-2xl animate-spin">data_usage</span>
                </div>
              </div>
            )}
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
          <div className="relative">
            <AudioWaveformPlayer 
              src={decryptedMediaUrl} 
              isMine={isMine}
              duration={message.duration || undefined}
            />
            {message.is_uploading && (
               <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 bg-black/20 rounded-full">
                 <span className="material-symbols-outlined text-primary text-xl animate-spin drop-shadow-md">data_usage</span>
               </div>
            )}
          </div>
        );
      default:
        return (
          <a 
            href={decryptedMediaUrl} 
            target="_blank" 
            className="flex items-center gap-2 bg-black/20 px-4 py-2 rounded-xl text-xs text-primary underline"
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
          className="bg-aura-bg-elevated p-4 rounded-3xl w-full max-w-sm border border-primary/20 shadow-2xl relative"
        >
          <div className="flex items-center gap-2 mb-3 text-primary px-1">
             <span className="material-symbols-outlined text-sm">edit_note</span>
             <span className="text-[10px] uppercase tracking-widest font-label font-bold">Edit Sanctuary Note</span>
          </div>
          <textarea
            ref={editInputRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full bg-black/30 rounded-2xl px-4 py-3 text-sm text-aura-text-primary placeholder:text-aura-text-secondary/40 border border-primary/10 focus:border-primary/40 outline-none resize-none font-body custom-scrollbar transition-colors"
            rows={3}
          />
          <div className="flex justify-end gap-3 mt-4 pr-1">
            <button onClick={() => setIsEditing(false)} className="px-5 py-2 rounded-full text-[10px] font-label uppercase tracking-widest text-aura-text-secondary hover:text-white transition-colors">Cancel</button>
            <button onClick={handleEditSubmit} className="px-6 py-2 rounded-full text-[10px] font-label uppercase tracking-widest bg-gradient-to-r from-primary to-primary-600 text-background font-bold hover:shadow-glow-gold transition-all active:scale-95">Save Changes</button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Safety guard: If it's a text message but has no decrypted content yet, 
  // don't render an empty bubble (unless it's a media/location type which handle their own loading)
  if ((!message.type || message.type === 'text') && !message.decrypted_content && !message.is_deleted_for_everyone) return null;

  return (
    <div 
      ref={bubbleRef}
      className={`flex flex-col relative w-full ${isMine ? 'items-end' : 'items-start'} gap-1 group z-10 overflow-visible`}
    >
      {/* Reply Icon Indicator for Swipe (Mobile) */}
      <motion.div 
        style={{ 
          [isMine ? 'right' : 'left']: '-45px', 
          opacity: replyOpacity,
          scale: replyScale,
          x: iconTranslate
        }}
        className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-primary md:hidden z-0"
      >
        <span className="material-symbols-outlined text-[18px]">reply</span>
      </motion.div>
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
                e.currentTarget.src = 'https://ui-avatars.com/api/?name=Map&background=1b1b23&color=primary&size=240';
              }}
            />
            <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />
            
            {/* Dark mode overlay since OSM default tiles are light */}
            <div className="absolute inset-0 bg-background/40 mix-blend-multiply pointer-events-none" />
          </div>
          <div className="bg-aura-bg-elevated px-3 py-2 flex items-center justify-between border-t border-white/5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-sm">location_on</span>
              <span className="text-[10px] text-aura-text-primary font-label uppercase tracking-widest">Sanctuary Live</span>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
               <span className="text-[9px] uppercase tracking-tighter text-aura-text-primary/40 font-bold">{time}</span>
              {isMine && !message.is_deleted_for_everyone && (
                <span 
                  className={`material-symbols-outlined text-[12px] transition-colors duration-300 ${
                    message.is_read 
                      ? 'text-blue-400' 
                      : (message.is_delivered ? 'text-aura-text-primary/40' : 'text-aura-text-primary/20')
                  }`} 
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
        {interactionType !== 'none' && (
          <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`absolute z-30 ${isMine ? 'right-0' : 'left-0'} flex flex-col items-center gap-1 ${
              bubbleRect && bubbleRect.top < window.innerHeight / 2 
                ? 'top-full mt-3' 
                : 'bottom-full mb-3'
            }`}
          >
            {/* Quick Reactions - Only for chat view */}
            {(interactionType === 'reactions' || interactionType === 'menu') && !isPinnedView && (
              <div className="relative flex flex-col items-center">
                {!showAllEmojis ? (
                  <div className="p-2.5 bg-aura-bg-elevated/95 backdrop-blur-md shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 flex justify-center gap-1.5 rounded-full">
                    {['❤️', '😂', '😮', '😢', '🔥'].map(emoji => (
                      <button 
                        key={emoji}
                        onClick={() => { 
                          const newEmoji = message.reaction === emoji ? null : emoji;
                          onReact?.(message.id, newEmoji); 
                          setInteractionType('none'); 
                          setShowAllEmojis(false); 
                        }}
                        className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-300 text-xl active:scale-90 ${
                          message.reaction === emoji 
                            ? 'bg-primary/20 border border-primary/40 scale-110 shadow-glow-gold' 
                            : 'hover:bg-white/10'
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                    <button onClick={() => setShowAllEmojis(true)} className="ml-1 w-9 h-9 bg-white/5 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors text-primary">
                      <span className="material-symbols-outlined text-[18px]">add</span>
                    </button>
                  </div>
                ) : (
                  <div className="p-0 shadow-2xl rounded-2xl overflow-hidden border border-white/10 bg-aura-bg-elevated/95 backdrop-blur-md custom-emoji-picker-container" style={{ width: 300, height: 400 }} onClick={e => e.stopPropagation()}>
                    <EmojiPicker 
                      theme={Theme.DARK}
                      onEmojiClick={(emojiData) => {
                        const newEmoji = message.reaction === emojiData.emoji ? null : emojiData.emoji;
                        onReact?.(message.id, newEmoji);
                        setInteractionType('none');
                        setShowAllEmojis(false);
                      }}
                      lazyLoadEmojis={true}
                      autoFocusSearch={false}
                      searchPlaceHolder="Search emoji"
                      previewConfig={{ showPreview: false }}
                      skinTonesDisabled={true}
                      width={300}
                      height={400}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Context Menu Actions */}
            {interactionType === 'menu' && !showAllEmojis && (
              isPinnedView ? (
                <div className="flex flex-col gap-1 w-[160px]">
                  <button 
                    onClick={() => { onRedirect?.(message.id); setInteractionType('none'); }}
                    className="flex items-center justify-between w-full px-4 py-3 bg-aura-bg-elevated/95 hover:bg-white/10 backdrop-blur-md rounded-2xl border border-white/5 transition-colors text-sm text-aura-text-primary"
                  >
                    Jump to Message
                    <span className="material-symbols-outlined text-[16px] text-primary">open_in_new</span>
                  </button>
                  <button 
                    onClick={() => { onPin?.(message.id); setInteractionType('none'); }}
                    className="flex items-center justify-between w-full px-4 py-3 bg-aura-bg-elevated/95 hover:bg-white/10 backdrop-blur-md rounded-2xl border border-white/5 transition-colors text-sm text-red-400"
                  >
                    Unpin
                    <span className="material-symbols-outlined text-[16px]">push_pin</span>
                  </button>
                </div>
              ) : (
                <MessageContextMenu 
                  isMine={isMine}
                  onPin={() => { onPin?.(message.id); setInteractionType('none'); }}
                  onEdit={message.type === 'text' && !message.is_deleted_for_everyone && !message.decryption_error ? () => { 
                    setIsEditing(true);
                    setEditContent(message.decrypted_content || '');
                    setInteractionType('none');
                    setTimeout(() => editInputRef.current?.focus(), 0);
                  } : undefined}
                  onDeleteForMe={() => { onDelete?.(message.id, false); setInteractionType('none'); }}
                  onDeleteForEveryone={() => { onDelete?.(message.id, true); setInteractionType('none'); }}
                />
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div 
        style={{ x: springX, willChange: 'transform' }} 
        className={`flex items-center gap-2 w-full ${isMine ? 'justify-end' : 'justify-start'} relative z-10`}
      >
        {isMine && !isPinnedView && (
          <div className="hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button onClick={handleContextMenu} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-aura-text-secondary hover:text-aura-text-primary transition-colors"><span className="material-symbols-outlined text-[18px]">more_vert</span></button>
            <button onClick={() => onReply?.(message.id)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-aura-text-secondary hover:text-aura-text-primary transition-colors"><span className="material-symbols-outlined text-[18px]">reply</span></button>
            <button onClick={() => setInteractionType('reactions')} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-aura-text-secondary hover:text-aura-text-primary transition-colors"><span className="material-symbols-outlined text-[18px]">add_reaction</span></button>
          </div>
        )}

      {!isLocation && (
        <div 
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          className={`shadow-lg relative cursor-pointer transition-transform w-fit max-w-[85%] ${interactionType !== 'none' ? 'scale-95 z-40' : ''} ${
          (message.type === 'image' || message.type === 'video' || message.type === 'audio') || isSticker
             ? 'bg-transparent shadow-none px-0 py-0' 
             : isMine 
               ? `px-4 py-3 bg-primary text-background rounded-2xl ${!isFirst ? 'rounded-tr-sm' : ''} ${!isLast ? 'rounded-br-sm' : ''}` 
               : `px-4 py-3 bg-aura-bg-elevated text-aura-text-primary rounded-2xl ${!isFirst ? 'rounded-tl-sm' : ''} ${!isLast ? 'rounded-bl-sm' : ''} border border-white/5`
          } ${message.is_deleted_for_everyone ? 'opacity-60 italic' : ''} ${decryptionError ? 'border-dashed border-red-500/50 bg-red-500/5' : ''}`}
          data-message-id={message.id}
          data-is-mine={isMine}
          data-is-read={message.is_read}
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
        
        {/* Reply Quote Block */}
        {repliedMessage && !isOnlyMedia && !isSticker && (
          <div 
            onClick={(e) => { e.stopPropagation(); onJumpToMessage?.(repliedMessage.id); }}
            className={`mb-2 pl-3 py-1.5 pr-2 rounded-lg cursor-pointer transition-colors border-l-2 active:scale-95 ${isMine ? 'bg-black/10 border-l-background/30 hover:bg-black/20 text-background/80' : 'bg-white/5 border-l-primary/50 hover:bg-white/10 text-aura-text-primary/80'}`}
          >
            <div className={`text-[10px] font-bold uppercase tracking-widest mb-0.5 flex items-center gap-1 ${isMine ? 'text-background' : 'text-primary'}`}>
              <span className="material-symbols-outlined text-[10px]">reply</span>
              {repliedMessage.is_mine ? 'You' : 'Partner'}
            </div>
            <div className="text-xs truncate max-w-[200px] flex items-center gap-2">
              {(repliedMessage.type === 'image' || repliedMessage.type === 'video') ? (
                repliedMediaUrl ? (
                  <img src={repliedMediaUrl} alt="media preview" className="w-20 h-20 rounded shadow-sm object-cover flex-shrink-0" />
                ) : (
                  <span className="material-symbols-outlined text-[18px] opacity-70 animate-pulse">image</span>
                )
              ) : null}
              <span className="truncate">
                {repliedMessage.decrypted_content || (repliedMessage.type !== 'text' ? (repliedMessage.type === 'audio' ? 'Voice Message' : '') : 'Message')}
              </span>
            </div>
          </div>
        )}
        {message.decrypted_content && !isSticker && (
          <div className={`${message.media_url ? 
            (isMine 
              ? `mt-1 px-3 py-2 bg-primary text-background rounded-2xl ${!isFirst ? 'rounded-tr-sm' : ''} ${!isLast ? 'rounded-br-sm' : ''} w-fit ml-auto min-w-[80px]` 
              : `mt-1 px-3 py-2 bg-aura-bg-elevated text-aura-text-primary rounded-2xl ${!isFirst ? 'rounded-tl-sm' : ''} ${!isLast ? 'rounded-bl-sm' : ''} border border-white/5 shadow-lg w-fit mr-auto min-w-[80px]`) 
            : 'text-[15px] leading-relaxed font-body whitespace-pre-wrap break-words'}`}>
            
            {message.media_url ? (
              <div className="flex flex-col">
                <div className="text-[15px] leading-relaxed font-body whitespace-pre-wrap break-words">
                  {renderContent(message.decrypted_content)}
                </div>
                <div className="flex items-center justify-end gap-1 mt-0.5">
                  <span className={`text-[9px] uppercase tracking-tighter w-max ${isMine ? 'text-background/80 font-bold' : 'text-aura-text-primary/60 font-bold'}`}>
                    {message.is_edited && !message.is_deleted_for_everyone && (
                      <span className="mr-1 opacity-70">(edited) </span>
                    )}
                    {time}
                  </span>
                  {isMine && !message.is_deleted_for_everyone && (
                    <span 
                      className={`material-symbols-outlined text-[12px] transition-colors duration-300 ${
                        message.is_read ? 'text-blue-400' : (message.is_delivered ? 'text-background/50' : 'text-background/25')
                      }`} 
                      style={{ fontVariationSettings: "'wght' 700" }}
                    >
                      {message.is_read ? 'done_all' : (message.is_delivered ? 'done_all' : 'check')}
                    </span>
                  )}
                  {isMine && message.is_pending && (
                    <span className="material-symbols-outlined text-[12px] animate-pulse text-background/40">schedule</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col relative z-20">
                <div className="text-[15px] leading-relaxed font-body whitespace-pre-wrap break-words">
                  {renderContent(message.decrypted_content)}
                </div>
                {firstUrl && <LinkPreview url={firstUrl} />}
              </div>
            )}
          </div>
        )}
        
        {/* Reaction Badge */}
        {message.reaction && (
          <button 
            onClick={(e) => { e.stopPropagation(); onReact?.(message.id, null); }}
            className={`absolute -bottom-[15px] ${isMine ? 'left-2' : 'right-2'} bg-aura-bg-elevated border border-primary/40 rounded-full px-2.5 py-1 text-sm shadow-[0_4px_15px_rgba(0,0,0,0.5)] z-30 transition-all hover:scale-110 active:scale-90 hover:bg-aura-bg-elevated/80 flex items-center justify-center`}
            title="Remove reaction"
          >
            {message.reaction}
          </button>
        )}

        {/* Embedded Timestamp and Status Info */}
        {(!message.media_url || isSticker || !message.decrypted_content) && (
          <div className={`flex items-center justify-end gap-1 mt-1.5 ${isOnlyMedia || isSticker ? 'absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-md' : ''}`}>
            <span className={`text-[9px] uppercase tracking-tighter ${
              isOnlyMedia || isSticker
                ? 'text-white/90'
                : isMine 
                  ? 'text-background/80 font-bold' 
                  : 'text-aura-text-primary/60 font-bold'
            }`}>
              {message.is_edited && !message.is_deleted_for_everyone && (
                <span className="mr-1 opacity-70">(edited) </span>
              )}
              {time}
            </span>
            {isMine && !message.is_deleted_for_everyone && !message.is_send_failed && (
              <span 
                className={`material-symbols-outlined text-[12px] transition-colors duration-300 ${
                  isOnlyMedia || isSticker
                    ? (message.is_read ? 'text-blue-400' : 'text-white/60')
                    : (message.is_read ? 'text-blue-400' : (message.is_delivered ? 'text-background/50' : 'text-background/25'))
                }`} 
                style={{ fontVariationSettings: "'wght' 700" }}
              >
                {message.is_read ? 'done_all' : (message.is_delivered ? 'done_all' : 'check')}
              </span>
            )}
            {isMine && message.is_pending && (
              <span className={`material-symbols-outlined text-[12px] animate-pulse ${isOnlyMedia || isSticker ? 'text-primary' : 'text-background/40'}`}>schedule</span>
            )}
          </div>
        )}
        {/* Fix 1.5: Permanent send failure indicator */}
        {isMine && message.is_send_failed && (
          <div className="flex items-center gap-1 mt-1 justify-end">
            <span className="material-symbols-outlined text-[13px] text-red-400">error_outline</span>
            <span className="text-[9px] text-red-400 uppercase tracking-wider font-bold">Not delivered</span>
          </div>
        )}
      </div>
      )}

      {!isMine && !isPinnedView && (
        <div className="hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button onClick={() => setInteractionType('reactions')} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-aura-text-secondary hover:text-aura-text-primary transition-colors"><span className="material-symbols-outlined text-[18px]">add_reaction</span></button>
          <button onClick={() => onReply?.(message.id)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-aura-text-secondary hover:text-aura-text-primary transition-colors"><span className="material-symbols-outlined text-[18px]">reply</span></button>
          <button onClick={handleContextMenu} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-aura-text-secondary hover:text-aura-text-primary transition-colors"><span className="material-symbols-outlined text-[18px]">more_vert</span></button>
        </div>
      )}
      </motion.div>
    </div>
  );
}

export default memo(ChatBubble);
