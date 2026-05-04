import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useGarbage, type GarbageItem } from '../../hooks/useGarbage';
import { useMedia } from '../../hooks/useMedia';
import { supabase } from '../../lib/supabase';

function GarbageItemCard({ item, onUndo }: { item: GarbageItem, onUndo: (id: string) => void }) {
  const { getDecryptedBlob } = useMedia();
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadThumb = async () => {
      if (!item.message_id) {
        setLoading(false);
        return;
      }

      // Fetch the message metadata to get encryption keys
      const { data: msg } = await supabase
        .from('messages')
        .select('media_url, media_key, media_nonce, type, sender_public_key, thumbnail_url, receiver_id, sender_id')
        .eq('id', item.message_id)
        .single();

      if (msg && msg.media_key && msg.media_nonce) {
        // For videos, try to decrypt thumbnail_url if it exists, otherwise media_url
        const targetUrl = (msg.type === 'video' && msg.thumbnail_url) ? msg.thumbnail_url : msg.media_url;
        
        try {
          // In the garbage bin, we are the receiver of the garbage action.
          // The getDecryptedBlob needs the 'other' person's public key.
          // Since it's a personal app, we can usually assume the sender_public_key of the message
          // is what we need if it's not ours, or we need the partner's key if it is ours.
          // For simplicity in this view, we use the sender_public_key from the message.
          const blob = await getDecryptedBlob(
            targetUrl!, 
            msg.media_key, 
            msg.media_nonce,
            msg.sender_public_key || '', 
            msg.sender_public_key,
            undefined,
            'image' 
          );

          if (blob && mounted) {
            const url = URL.createObjectURL(blob);
            blobUrlRef.current = url;
            setThumbUrl(url);
          }
        } catch (e) {
          console.error("Failed to decrypt garbage thumb", e);
        }
      }
      if (mounted) setLoading(false);
    };

    loadThumb();
    return () => {
      mounted = false;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, [item.message_id, getDecryptedBlob]);

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      className="relative aspect-square w-32 shrink-0 rounded-2xl overflow-hidden border border-white/5 bg-white/5 group"
    >
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-t-transparent border-primary/40 rounded-full animate-spin" />
        </div>
      ) : thumbUrl ? (
        <img src={thumbUrl} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <span className="material-symbols-outlined text-white/20 text-xl">
            {item.media_type === 'video' ? 'videocam' : item.media_type === 'audio' ? 'mic' : 'image'}
          </span>
        </div>
      )}

      {/* Undo Button Overlay */}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 backdrop-blur-[2px]">
        <button 
          onClick={() => onUndo(item.id)}
          className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center transition-all hover:scale-110 active:scale-95"
        >
          <span className="material-symbols-outlined text-[20px]">undo</span>
        </button>
        <span className="text-[8px] font-label uppercase tracking-widest text-white/80">Keep File</span>
      </div>

      {/* Media Type Indicator */}
      <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-md border border-white/10">
         <span className="material-symbols-outlined text-[10px] text-primary">
           {item.media_type === 'video' ? 'videocam' : item.media_type === 'audio' ? 'mic' : 'image'}
         </span>
      </div>
    </motion.div>
  );
}

export default function GarbageCanSection() {
  const { items, loading, isEmptying, count, totalSize, removeFromGarbage, emptyGarbage } = useGarbage();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleEmptyGarbage = async () => {
    setConfirmOpen(false);
    try {
      const result = await emptyGarbage();
      if (result.deleted > 0) {
        toast.success(`Garbage emptied`, {
          description: `${result.deleted} media file${result.deleted !== 1 ? 's' : ''} permanently deleted from Cloudinary.`,
        });
      } else {
        toast.info('Nothing to delete', { description: 'Garbage bin is already empty.' });
      }
    } catch (err: any) {
      toast.error('Failed to empty garbage', { description: err.message });
    }
  };

  const handleRemoveOne = async (id: string) => {
    const ok = await removeFromGarbage(id);
    if (ok) {
      toast.success('Removed from garbage', { description: 'Media will be kept on Cloudinary.' });
    }
  };

  // Split items into 2 rows
  const row1 = items.filter((_, i) => i % 2 === 0);
  const row2 = items.filter((_, i) => i % 2 !== 0);

  return (
    <div className="col-span-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-serif italic text-2xl text-[var(--gold)]">Garbage Can</h3>
          <p className="font-label text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mt-1">
            Media staged for deletion • Reclaim {formatBytes(totalSize)}
          </p>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2 justify-end">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <p className="text-xl font-light text-white">{count} item{count !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* Modern 2-Row Horizontal Scroll Grid */}
      <div className="relative group/scroll mb-8">
        {loading ? (
          <div className="h-72 bg-[var(--bg-secondary)] rounded-3xl border border-white/5 flex flex-col items-center justify-center gap-4">
             <div className="w-8 h-8 border-3 border-t-transparent border-primary/40 rounded-full animate-spin" />
             <span className="font-label text-[10px] uppercase tracking-widest text-white/30">Loading your garbage...</span>
          </div>
        ) : count === 0 ? (
          <div className="h-72 bg-[var(--bg-secondary)] rounded-3xl border border-white/5 flex flex-col items-center justify-center gap-4 text-white/10">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl">delete_sweep</span>
            </div>
            <p className="font-label text-[10px] uppercase tracking-widest">Your garbage is empty</p>
          </div>
        ) : (
          <div className="space-y-4 overflow-x-auto pb-4 no-scrollbar">
            {/* Row 1 */}
            <div className="flex gap-4 px-1">
              <AnimatePresence mode="popLayout">
                {row1.map((item) => (
                  <GarbageItemCard key={item.id} item={item} onUndo={handleRemoveOne} />
                ))}
              </AnimatePresence>
            </div>
            {/* Row 2 */}
            <div className="flex gap-4 px-1">
              <AnimatePresence mode="popLayout">
                {row2.map((item) => (
                  <GarbageItemCard key={item.id} item={item} onUndo={handleRemoveOne} />
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
        
        {/* Subtle Scroll Gradients */}
        {count > 4 && (
          <>
            <div className="absolute left-0 top-0 bottom-4 w-12 bg-gradient-to-r from-[var(--bg-secondary)] to-transparent pointer-events-none opacity-0 group-hover/scroll:opacity-100 transition-opacity" />
            <div className="absolute right-0 top-0 bottom-4 w-12 bg-gradient-to-l from-[var(--bg-secondary)] to-transparent pointer-events-none opacity-0 group-hover/scroll:opacity-100 transition-opacity" />
          </>
        )}
      </div>

      {/* Empty Garbage Button Container */}
      <div className="relative">
        <AnimatePresence mode="wait">
          {confirmOpen ? (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="flex flex-col gap-3 p-6 bg-red-500/5 rounded-3xl border border-red-500/20"
            >
              <p className="text-center text-xs text-red-200/60 font-label uppercase tracking-widest mb-2">
                This action is permanent and cannot be undone
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="flex-1 bg-white/5 text-white/60 py-4 rounded-2xl font-label font-bold tracking-widest uppercase text-[10px] hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEmptyGarbage}
                  disabled={isEmptying}
                  className="flex-1 bg-red-500 text-white py-4 rounded-2xl font-label font-bold tracking-widest uppercase text-[10px] hover:bg-red-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-xl shadow-red-500/20"
                >
                  {isEmptying ? (
                    <div className="w-3 h-3 rounded-full border-2 border-t-transparent border-white animate-spin" />
                  ) : (
                    "Confirm Deletion"
                  )}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.button
              key="empty-btn"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => count > 0 && setConfirmOpen(true)}
              disabled={count === 0 || isEmptying}
              className="w-full group relative overflow-hidden bg-gradient-to-r from-red-500/10 to-red-600/10 border border-red-500/20 text-red-400 py-6 rounded-3xl font-label font-bold tracking-[0.4em] uppercase text-[10px] hover:border-red-500/40 transition-all duration-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-red-500/0 via-red-500/5 to-red-500/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
              <span className="material-symbols-outlined text-sm group-hover:rotate-12 transition-transform">
                delete_forever
              </span>
              Empty Garbage Can
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
