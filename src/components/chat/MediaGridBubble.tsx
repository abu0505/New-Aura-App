import { useState, useEffect, useRef, memo } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';
import type { ChatMessage } from '../../hooks/useChat';
import MediaViewer from './MediaViewer';

interface MediaGridBubbleProps {
  messages: ChatMessage[];
  partnerPublicKey: string | null;
  isMine: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  onReply?: (msgId: string) => void;
}

function MediaGridBubble({ 
  messages, 
  partnerPublicKey, 
  isMine, 
  isFirst = true, 
  isLast = true,
  onReply
}: MediaGridBubbleProps) {
  const { getDecryptedBlob } = useMedia();
  const [decryptedUrls, setDecryptedUrls] = useState<Record<string, string>>({});
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);
  
  const blobUrlsRef = useRef<Record<string, string>>({});
  const touchStartX = useRef<number | null>(null);
  const hapticTriggered = useRef(false);
  const swipeX = useMotionValue(0);
  const springX = useSpring(swipeX, { stiffness: 800, damping: 35 });
  
  const replyOpacity = useTransform(springX, (v) => Math.min(Math.abs(v) / 45, 1));
  const replyScale = useTransform(springX, (v) => 0.8 + Math.min(Math.abs(v) / 45, 1) * 0.3);
  const iconTranslate = useTransform(springX, (v) => -v / 2);

  const time = new Date(messages[messages.length - 1].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).replace(':', ' : ');

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - touchStartX.current;
    
    let newOffset = 0;
    if (!isMine && diff > 0) {
      newOffset = Math.min(diff, 70); 
    } else if (isMine && diff < 0) {
      newOffset = Math.max(diff, -70);
    }
    
    swipeX.set(newOffset);

    if (Math.abs(newOffset) >= 45) {
      if (!hapticTriggered.current) {
        if ('vibrate' in navigator) navigator.vibrate(8);
        hapticTriggered.current = true;
      }
    } else {
      hapticTriggered.current = false;
    }
  };

  const handleTouchEnd = () => {
    if (touchStartX.current !== null) {
      if (Math.abs(swipeX.get()) >= 45 && onReply) {
        onReply(messages[0].id);
      }
      swipeX.set(0);
      touchStartX.current = null;
      hapticTriggered.current = false;
    }
  };

  useEffect(() => {
    let mounted = true;
    const fetchMedia = async () => {
      if (!partnerPublicKey) return;
      
      // Fire all decryptions concurrently
      const promises = messages.map(async (msg) => {
        if (msg.decrypted_media_url && !msg.media_key) {
           blobUrlsRef.current[msg.id] = msg.decrypted_media_url;
           setDecryptedUrls(prev => ({ ...prev, [msg.id]: msg.decrypted_media_url as string }));
           return;
        }

        if (!msg.media_url || !msg.media_key || !msg.media_nonce) return;
        try {
          const blob = await getDecryptedBlob(
            msg.media_url, msg.media_key, msg.media_nonce,
            partnerPublicKey,
            msg.sender_public_key,
            undefined,
            msg.type
          );
          
          if (blob && mounted) {
            const url = URL.createObjectURL(blob);
            blobUrlsRef.current[msg.id] = url;
            setDecryptedUrls(prev => ({ ...prev, [msg.id]: url }));
          }
        } catch (e) {
          
        }
      });

      await Promise.all(promises);
    };

    fetchMedia();

    return () => {
      mounted = false;
      Object.values(blobUrlsRef.current).forEach((url) => {
        // Only revoke if it was a createObjectURL and not a data URI maybe. Oh wait, URL.revokeObjectURL ignores failure.
        // It's safe to run on blob URLs.
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [messages, partnerPublicKey]);

  const displayItems = messages.slice(0, 4);
  const remainingCount = messages.length - 4;



  const renderItem = (msg: ChatMessage, index: number) => {
    const url = decryptedUrls[msg.id];

    // Placeholder while decrypting
    if (!url) {
      return (
        <div key={msg.id} className="w-full h-full bg-white/5 animate-pulse flex items-center justify-center rounded-xl border border-white/5">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      );
    }

    const isLastDisplayItem = index === 3;
    const showOverlay = isLastDisplayItem && remainingCount > 0;
    const isUploading = msg.is_uploading;

    return (
      <div 
        key={msg.id} 
        className={`relative ${!isUploading ? 'cursor-pointer' : ''} group h-full w-full overflow-hidden`}
        onClick={() => { if (!isUploading) setSelectedMediaIndex(index) }}
      >
        {msg.type === 'video' ? (
          <div className="w-full h-full relative">
            <video src={url} className={`w-full h-full object-cover ${isUploading ? 'opacity-60 blur-[2px] grayscale-[20%]' : ''}`} />
            {!isUploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                <span className="material-symbols-outlined text-white text-3xl opacity-80">play_circle</span>
              </div>
            )}
          </div>
        ) : (
          <img src={url} alt="" className={`w-full h-full object-cover ${!isUploading ? 'group-hover:scale-105 transition-transform duration-500' : 'opacity-60 blur-[2px] grayscale-[20%]'}`} />
        )}

        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="w-8 h-8 flex items-center justify-center bg-black/50 rounded-full backdrop-blur-md border border-white/20 shadow-2xl shadow-black/50">
               <span className="material-symbols-outlined text-primary text-xl animate-spin">data_usage</span>
            </div>
          </div>
        )}

        {showOverlay && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
            <span className="text-2xl font-bold text-primary">+{remainingCount}</span>
          </div>
        )}
      </div>
    );
  };

  const getGridClass = () => {
    const count = displayItems.length;
    if (count === 1) return 'grid-cols-1';
    if (count === 2) return 'grid-cols-2';
    if (count === 3) return 'grid-cols-2 grid-rows-2';
    return 'grid-cols-2 grid-rows-2';
  };

  return (
    <div 
      className={`flex flex-col relative w-full ${isMine ? 'items-end' : 'items-start'} gap-1 group z-10 overflow-visible`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
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

      <div className={`flex items-center gap-2 w-full ${isMine ? 'justify-end' : 'justify-start'} relative z-10`}>
        {isMine && (
          <div className="hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button 
              onClick={() => onReply?.(messages[0].id)} 
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-aura-text-secondary hover:text-aura-text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">reply</span>
            </button>
          </div>
        )}

        <motion.div 
          style={{ x: springX }}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`relative overflow-hidden shadow-2xl bg-transparent rounded-2xl ${!isFirst ? (isMine ? 'rounded-tr-sm' : 'rounded-tl-sm') : ''} ${!isLast ? (isMine ? 'rounded-br-sm' : 'rounded-bl-sm') : ''} w-full max-w-[85%] sm:max-w-[75%] lg:max-w-[50%] aspect-square`}
        >
          <div className={`grid h-full w-full gap-1 rounded-xl overflow-hidden ${getGridClass()}`}>
            {displayItems.map((msg, idx) => {
              const isFirstItem = idx === 0;
              const isThreeItems = displayItems.length === 3;
              
              return (
                <div 
                  key={msg.id} 
                  className={`${isThreeItems && isFirstItem ? 'row-span-2' : ''}`}
                >
                  {renderItem(msg, idx)}
                </div>
              );
            })}
          </div>

          {/* Unified Status Info Overlay */}
          <div className="absolute bottom-2 right-2 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md shadow-lg flex items-center gap-1.5 pointer-events-none">
            <span className="text-[10px] font-bold text-white/90 tracking-tighter uppercase">{time}</span>
            {isMine && (
               <span 
                className={`material-symbols-outlined text-[13px] ${
                  messages[messages.length-1].is_read ? 'text-blue-400' : 'text-white/60'
                }`} 
                style={{ fontVariationSettings: "'wght' 700" }}
              >
                {messages[messages.length-1].is_read ? 'done_all' : (messages[messages.length-1].is_delivered ? 'done_all' : 'check')}
              </span>
            )}
          </div>
        </motion.div>

        {!isMine && (
          <div className="hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button 
              onClick={() => onReply?.(messages[0].id)} 
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-aura-text-secondary hover:text-aura-text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">reply</span>
            </button>
          </div>
        )}
      </div>

      {selectedMediaIndex !== null && (
        <MediaViewer 
          url={decryptedUrls[messages[selectedMediaIndex]?.id] || ''}
          type={messages[selectedMediaIndex]?.type as 'image' | 'video'}
          onClose={() => setSelectedMediaIndex(null)}
          // Future-proofing for swipable gallery
          allMedia={messages.map(m => ({
            id: m.id,
            url: decryptedUrls[m.id],
            type: m.type as 'image' | 'video'
          }))}
          initialIndex={selectedMediaIndex}
        />
      )}
    </div>
  );
}

export default memo(MediaGridBubble);
