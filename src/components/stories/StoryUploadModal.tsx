import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';
import QualityChoiceModal from '../chat/QualityChoiceModal';

interface StoryUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadComplete: (content: string, media?: { url: string, media_key: string, media_nonce: string, type: string }) => Promise<void>;
}

export default function StoryUploadModal({ isOpen, onClose, onUploadComplete }: StoryUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [showQualityModal, setShowQualityModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { processAndUpload } = useMedia();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result as string);
      reader.readAsDataURL(selectedFile);
    }
  };

  const startUpload = async (optimize: boolean) => {
    if (!file) return;
    setShowQualityModal(false);
    setIsUploading(true);
    try {
      const uploaded = await processAndUpload(file, { optimize });
      if (uploaded) {
        await onUploadComplete(caption, {
          url: uploaded.url,
          media_key: uploaded.media_key,
          media_nonce: uploaded.media_nonce,
          type: uploaded.type
        });
        onClose();
        // Reset
        setFile(null);
        setPreview(null);
        setCaption('');
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleUploadClick = () => {
    if (file && file.type.startsWith('image/')) {
      setShowQualityModal(true);
    } else if (file) {
      startUpload(false);
    } else if (caption.trim()) {
      onUploadComplete(caption);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[110] bg-[var(--bg-primary)]/95 backdrop-blur-xl flex items-center justify-center p-6 font-sans"
      >
        <motion.div 
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          className="bg-[var(--bg-elevated)] border border-white/5 rounded-[2.5rem] w-full max-w-lg overflow-hidden flex flex-col shadow-3xl"
        >
          {/* Header */}
          <div className="px-8 py-6 flex justify-between items-center border-b border-white/5 bg-black/20">
            <h2 className="font-serif italic text-2xl text-[var(--gold)]">New Memory</h2>
            <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Content */}
          <div className="p-8 flex flex-col gap-6">
            {!preview ? (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="aspect-square rounded-[2rem] border-2 border-dashed border-[#998f81]/20 bg-black/20 flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-[rgba(var(--primary-rgb),_0.5)] hover:bg-black/40 transition-all group"
              >
                <span className="material-symbols-outlined text-5xl text-[#998f81] group-hover:text-[var(--gold)] transition-colors">add_photo_alternate</span>
                <p className="font-label text-xs uppercase tracking-[0.2em] text-[#998f81] group-hover:text-white">Select a visual fragment</p>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  className="hidden" 
                  accept="image/*,video/*"
                />
              </div>
            ) : (
              <div className="relative aspect-square rounded-[2rem] overflow-hidden group shadow-2xl">
                {file?.type.startsWith('video/') ? (
                  <video src={preview} className="w-full h-full object-cover" />
                ) : (
                  <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                )}
                <button 
                  onClick={() => { setFile(null); setPreview(null); }}
                  className="absolute top-4 right-4 bg-black/60 backdrop-blur-md rounded-full p-2 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              </div>
            )}

            {/* Caption Input */}
            <div className="flex flex-col gap-2">
              <label className="font-label text-[10px] uppercase tracking-widest text-[#998f81] px-1">Private Reflection</label>
              <textarea 
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Describe this moment..."
                className="w-full bg-black/20 border border-white/5 rounded-2xl p-4 text-[#e4e1ed] placeholder:text-[#998f81]/40 focus:ring-1 focus:ring-[var(--gold)] outline-none transition-all resize-none font-sans italic text-sm"
                rows={3}
              />
            </div>

            <button 
              disabled={isUploading || (!file && !caption.trim())}
              onClick={handleUploadClick}
              className="w-full bg-[var(--gold)] text-[var(--on-accent)] py-4 rounded-full font-label font-bold tracking-widest uppercase text-xs hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 shadow-xl shadow-[rgba(var(--primary-rgb),_0.1)]"
            >
              {isUploading ? 'Securing with Encryption...' : 'Share to Sanctuary'}
            </button>
          </div>
        </motion.div>

        {/* Quality Selection Modal */}
        <QualityChoiceModal 
          isOpen={showQualityModal}
          onClose={() => setShowQualityModal(false)}
          onSelect={startUpload}
          fileSize={file?.size || 0}
        />
      </motion.div>
    </AnimatePresence>
  );
}
