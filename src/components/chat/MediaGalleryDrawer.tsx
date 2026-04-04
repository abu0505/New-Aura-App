import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';

interface MediaGalleryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (files: File[], caption: string) => void;
}

export default function MediaGalleryDrawer({ isOpen, onClose, onSend }: MediaGalleryDrawerProps) {
  const { getRecentCachedMedia } = useMedia();
  const [recentItems, setRecentItems] = useState<{ id: string; objUrl: string; blob: Blob }[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<{ id: string; file: File; objUrl: string }[]>([]);
  const [caption, setCaption] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load recent media from cache
  useEffect(() => {
    if (isOpen) {
      const items = getRecentCachedMedia();
      const mapped = items.map((item, i) => {
        // We need an object URL to display the decrypted blob
        const objUrl = URL.createObjectURL(item.blob);
        return {
          id: `recent-${i}-${Date.now()}`,
          objUrl,
          blob: item.blob
        };
      });
      setRecentItems(mapped);

      return () => {
        // Cleanup object URLs when closing
        mapped.forEach(m => URL.revokeObjectURL(m.objUrl));
      };
    } else {
      setCaption('');
      setSelectedFiles(prev => {
        prev.forEach(p => URL.revokeObjectURL(p.objUrl));
        return [];
      });
    }
  }, [isOpen, getRecentCachedMedia]);

  const handleBrowseAll = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).map(file => ({
        id: `local-${file.name}-${Date.now()}`,
        file,
        objUrl: URL.createObjectURL(file)
      }));
      setSelectedFiles(prev => [...prev, ...newFiles]);
    }
    // reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleRecentItem = (item: { id: string; objUrl: string; blob: Blob }) => {
    setSelectedFiles(prev => {
      const exists = prev.find(p => p.id === item.id);
      if (exists) {
        URL.revokeObjectURL(exists.objUrl);
        return prev.filter(p => p.id !== item.id);
      } else {
        // Create a File from the Blob
        const ext = item.blob.type.split('/')[1] || 'raw';
        const file = new File([item.blob], `shared_media.${ext}`, { type: item.blob.type });
        return [...prev, {
          id: item.id,
          file,
          objUrl: URL.createObjectURL(file)
        }];
      }
    });
  };

  const removeSelected = (id: string) => {
    setSelectedFiles(prev => {
      const target = prev.find(p => p.id === id);
      if (target) URL.revokeObjectURL(target.objUrl);
      return prev.filter(p => p.id !== id);
    });
  };

  const handleSend = () => {
    if (selectedFiles.length === 0) return;
    onSend(selectedFiles.map(s => s.file), caption);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 z-40 backdrop-blur-lg"
          />

          <motion.section
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-[3rem] overflow-hidden bg-[#13131b] border-t border-white/5 shadow-[0_-20px_60px_-10px_rgba(0,0,0,0.9)] max-h-[85vh] flex flex-col"
          >
            {/* Grip Handle */}
            <div className="flex justify-center pt-6 pb-2 shrink-0" onClick={onClose}>
              <div className="w-12 h-1.5 bg-white/10 rounded-full" />
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6 no-scrollbar flex flex-col">
              <h3 className="font-serif italic text-2xl text-[#e6c487] mb-6">Media Gallery</h3>

              {/* Hidden File Input */}
              <input 
                type="file" 
                ref={fileInputRef} 
                multiple 
                accept="image/*,video/*" 
                className="hidden" 
                onChange={handleFileChange}
              />

              {/* Recent Media Strip */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-label text-xs tracking-[0.2em] text-white/40 uppercase">Recent</span>
                  <button 
                    onClick={handleBrowseAll}
                    className="text-[#e6c487] text-xs uppercase tracking-wider font-bold hover:opacity-80 transition-opacity flex items-center gap-1"
                  >
                    <span>Browse All</span>
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                  </button>
                </div>

                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 snap-x">
                  <button 
                    onClick={handleBrowseAll}
                    className="shrink-0 w-24 h-32 rounded-2xl bg-white/5 border border-white/10 flex flex-col items-center justify-center gap-2 hover:bg-white/10 transition-colors snap-start"
                  >
                    <div className="w-10 h-10 rounded-full bg-[#e6c487]/10 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[#e6c487]">add_photo_alternate</span>
                    </div>
                    <span className="text-[10px] uppercase font-label tracking-widest text-white/40">Browse</span>
                  </button>

                  {recentItems.map((item) => {
                    const isSelected = selectedFiles.some(s => s.id === item.id);
                    const isVideo = item.blob.type.startsWith('video');
                    
                    return (
                      <button
                        key={item.id}
                        onClick={() => toggleRecentItem(item)}
                        className={`shrink-0 w-24 h-32 rounded-2xl relative overflow-hidden snap-start transition-all ${isSelected ? 'ring-2 ring-[#e6c487] scale-95' : 'ring-1 ring-white/10'}`}
                      >
                        {isVideo ? (
                          <div className="w-full h-full bg-black flex items-center justify-center">
                            <span className="material-symbols-outlined text-white/50 text-3xl">play_circle</span>
                          </div>
                        ) : (
                          <img src={item.objUrl} alt="Recent" className="w-full h-full object-cover" />
                        )}
                        {isSelected && (
                          <div className="absolute inset-0 bg-[#e6c487]/20 flex items-center justify-center">
                            <div className="w-8 h-8 rounded-full bg-[#e6c487] flex items-center justify-center shadow-lg">
                              <span className="material-symbols-outlined text-[#13131b] text-xl font-bold">check</span>
                            </div>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Selected Files Staging Area */}
              {selectedFiles.length > 0 && (
                <div className="mt-auto shrink-0 bg-white/5 rounded-3xl p-4 border border-white/10 animate-fade-in-up">
                  <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
                    {selectedFiles.map(sel => (
                      <div key={sel.id} className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 group">
                        {sel.file.type.startsWith('video') ? (
                          <video src={sel.objUrl} className="w-full h-full object-cover" />
                        ) : (
                          <img src={sel.objUrl} alt="Selected" className="w-full h-full object-cover" />
                        )}
                        <button 
                          onClick={() => removeSelected(sel.id)}
                          className="absolute top-1 right-1 w-5 h-5 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <span className="material-symbols-outlined text-white text-[12px]">close</span>
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-3 items-end">
                    <div className="flex-1 bg-black/40 rounded-2xl px-4 py-3 border border-white/5 focus-within:border-[#e6c487]/30 transition-colors">
                      <input
                        type="text"
                        placeholder="Add a caption..."
                        value={caption}
                        onChange={(e) => setCaption(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSend();
                        }}
                        className="w-full bg-transparent text-white text-sm outline-none placeholder:text-white/20"
                      />
                    </div>
                    <button
                      onClick={handleSend}
                      className="w-12 h-12 shrink-0 bg-[#e6c487] text-[#13131b] rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all"
                    >
                      <span className="material-symbols-outlined font-bold">send</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
