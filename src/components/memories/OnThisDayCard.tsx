import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';
import type { Database } from '../../integrations/supabase/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];

interface ThrowbackItem extends MessageRow {
  decryptedUrl?: string;
  loading?: boolean;
}

interface OnThisDayCardProps {
  throwbacks: ThrowbackItem[];
  partnerPublicKey: string;
  onOpenMedia: (url: string, type: string) => void;
}

export default function OnThisDayCard({ throwbacks, partnerPublicKey, onOpenMedia }: OnThisDayCardProps) {
  const { getDecryptedBlob } = useMedia();
  const [items, setItems] = useState<ThrowbackItem[]>(throwbacks);
  const generatedUrlsRef = useRef<Set<string>>(new Set());

  const decryptItem = async (item: ThrowbackItem) => {
    if (item.decryptedUrl || !partnerPublicKey || !item.media_url || !item.media_key || !item.media_nonce) return;

    setItems(prev => prev.map(i => i.id === item.id ? { ...i, loading: true } : i));

    try {
      const blob = await getDecryptedBlob(
        item.media_url,
        item.media_key,
        item.media_nonce,
        partnerPublicKey,
        item.sender_public_key
      );
      if (blob) {
        const url = URL.createObjectURL(blob);
        generatedUrlsRef.current.add(url);
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, decryptedUrl: url, loading: false } : i));
      }
    } catch (err) {
      console.error('Decryption failed for throwback:', item.id, err);
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, loading: false } : i));
    }
  };

  useEffect(() => {
    return () => {
      generatedUrlsRef.current.forEach((url: string) => URL.revokeObjectURL(url));
    };
  }, []);

  if (throwbacks.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative mb-10 overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-[#1b1b23] to-[#13131b] border border-[#e6c487]/20 p-6 shadow-2xl group"
    >
      {/* Decorative Glow */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#e6c487]/10 blur-[80px] rounded-full group-hover:bg-[#e6c487]/20 transition-all duration-1000" />
      
      <div className="relative flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif italic text-2xl text-[#e6c487] flex items-center gap-3">
              <span className="material-symbols-outlined text-[#e6c487] animate-pulse">auto_awesome</span>
              On This Day
            </h2>
            <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#998f81] mt-1">Fragments of our shared history</p>
          </div>
        </div>

        {/* Scrollable strip */}
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 snap-x">
          {items.map((item) => (
            <ThrowbackThumb
              key={item.id}
              item={item}
              onDecrypt={() => decryptItem(item)}
              onClick={() => item.decryptedUrl && onOpenMedia(item.decryptedUrl, item.type || 'image')}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function ThrowbackThumb({ item, onDecrypt, onClick }: { item: ThrowbackItem, onDecrypt: () => void, onClick: () => void }) {
  const year = new Date(item.created_at).getFullYear();
  
  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      onViewportEnter={onDecrypt}
      viewport={{ once: true, margin: "100px" }}
      onClick={onClick}
      className="relative shrink-0 w-32 h-44 rounded-2xl overflow-hidden bg-black/40 border border-white/5 cursor-pointer snap-start shadow-xl lg:w-40 lg:h-56 group/thumb"
    >
      {item.loading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#e6c487]/20 border-t-[#e6c487] rounded-full animate-spin"></div>
        </div>
      ) : item.decryptedUrl ? (
        <>
          {item.type === 'image' && <img src={item.decryptedUrl} className="w-full h-full object-cover" alt="Throwback" />}
          {item.type === 'video' && (
            <div className="w-full h-full relative">
              <video src={item.decryptedUrl} className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <span className="material-symbols-outlined text-white/50 text-2xl">play_circle</span>
              </div>
            </div>
          )}
          
          {/* Year Badge */}
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-black/40 backdrop-blur-md border border-white/10">
            <span className="text-[10px] font-bold text-[#e6c487] tracking-wider">{year}</span>
          </div>

          {/* Hover highlight */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover/thumb:opacity-100 transition-opacity" />
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30">
          <span className="material-symbols-outlined text-2xl mb-1">lock</span>
          <span className="font-label text-[8px] uppercase tracking-widest">Encrypted</span>
        </div>
      )}
    </motion.div>
  );
}
