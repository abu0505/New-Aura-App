import { useState, useEffect, useRef, memo } from 'react';
import { motion } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';
import type { ChatMessage } from '../../hooks/useChat';
import MediaViewer from './MediaViewer';

interface MediaGridBubbleProps {
  messages: ChatMessage[];
  partnerPublicKey: string | null;
  isMine: boolean;
  isFirst?: boolean;
  isLast?: boolean;
}

function MediaGridBubble({ 
  messages, 
  partnerPublicKey, 
  isMine, 
  isFirst = true, 
  isLast = true 
}: MediaGridBubbleProps) {
  const { getDecryptedBlob } = useMedia();
  const [decryptedUrls, setDecryptedUrls] = useState<Record<string, string>>({});
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);
  
  const blobUrlsRef = useRef<Record<string, string>>({});
  const time = new Date(messages[messages.length - 1].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).replace(':', ' : ');

  useEffect(() => {
    let mounted = true;
    const fetchMedia = async () => {
      if (!partnerPublicKey) return;
      
      // Fire all decryptions concurrently
      const promises = messages.map(async (msg) => {
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
          console.error('Failed to decrypt media in grid:', e);
        }
      });

      await Promise.all(promises);
    };

    fetchMedia();

    return () => {
      mounted = false;
      Object.values(blobUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
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

    return (
      <div 
        key={msg.id} 
        className="relative cursor-pointer group h-full w-full overflow-hidden"
        onClick={() => setSelectedMediaIndex(index)}
      >
        {msg.type === 'video' ? (
          <div className="w-full h-full relative">
            <video src={url} className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
              <span className="material-symbols-outlined text-white text-3xl opacity-80">play_circle</span>
            </div>
          </div>
        ) : (
          <img src={url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        )}

        {showOverlay && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center">
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
    <div className={`flex flex-col relative w-full ${isMine ? 'items-end' : 'items-start'} gap-1`}>
      <motion.div 
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
