import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';

interface QualityChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (optimize: boolean) => void;
  fileSize: number;
  optimizedSize?: number;
}

export default function QualityChoiceModal({ 
  isOpen, 
  onClose, 
  onSelect,
  fileSize, 
  optimizedSize 
}: QualityChoiceModalProps) {
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getOptimizedEstimate = () => {
    if (optimizedSize) return formatSize(optimizedSize);
    return `~ ${formatSize(fileSize * 0.35)}`;
  };

  const [selected, setSelected] = useState<'optimized' | 'original'>('optimized');

  useEffect(() => {
    if (isOpen) {
      const savedPref = localStorage.getItem('aura_quality_preference');
      if (savedPref === 'optimized' || savedPref === 'original') {
        setSelected(savedPref);
      }
    }
  }, [isOpen]);

  const handleSend = () => {
    localStorage.setItem('aura_quality_preference', selected);
    onSelect(selected === 'optimized');
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] bg-[#0d0d15]/90 backdrop-blur-xl flex items-center justify-center p-6 font-sans"
      >
        <motion.div 
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          className="bg-[#1b1b23] border border-white/5 rounded-[2.5rem] w-full max-w-sm overflow-hidden flex flex-col shadow-3xl p-8"
        >
          <h2 className="font-serif italic text-2xl text-[#e6c487] mb-2">Preserve the Moment?</h2>
          <p className="text-[#998f81] text-xs mb-8 leading-relaxed">Choose how much detail you wish to carry into our sanctuary.</p>

          <div className="flex flex-col gap-4 mb-8">
            {/* Optimized Option */}
            <button 
              onClick={() => setSelected('optimized')}
              className={`flex items-center justify-between p-6 border rounded-3xl transition-all group relative ${
                selected === 'optimized' 
                  ? 'bg-[#e6c487]/10 border-[#e6c487]/50 shadow-[0_0_20px_rgba(230,196,135,0.1)]' 
                  : 'bg-white/5 border-white/10 hover:border-white/20'
              }`}
            >
              <div className="absolute top-0 right-0 transform translate-x-2 -translate-y-2">
                <span className="bg-[#6ECB8A] text-[#0d0d15] font-bold text-[8px] uppercase tracking-widest px-2 py-1 rounded-full shadow-lg">Recommended</span>
              </div>
              <div className="text-left flex-1 pl-2">
                <span className={`block font-label text-[10px] uppercase tracking-widest mb-1 ${selected === 'optimized' ? 'text-[#e6c487]' : 'text-[#e6c487]/60'}`}>⚡ Optimized</span>
                <span className="block text-white text-sm font-medium">Saves significant space</span>
              </div>
              <div className="text-right flex flex-col items-end">
                <span className="block text-white/40 text-[10px] uppercase tracking-tighter line-through">{formatSize(fileSize)}</span>
                <span className={`font-bold text-xs ${selected === 'optimized' ? 'text-[#e6c487]' : 'text-[#e6c487]/60'}`}>{getOptimizedEstimate()}</span>
              </div>
            </button>

            {/* Original Option */}
            <button 
              onClick={() => setSelected('original')}
              className={`flex items-center justify-between p-6 border rounded-3xl transition-all ${
                selected === 'original'
                  ? 'bg-white/10 border-white/40 shadow-[0_0_20px_rgba(255,255,255,0.05)]'
                  : 'bg-white/5 border-white/10 hover:border-white/20'
              }`}
            >
              <div className="text-left pl-2">
                <span className={`block font-label text-[10px] uppercase tracking-widest mb-1 ${selected === 'original' ? 'text-white/80' : 'text-white/40'}`}>💎 Original</span>
                <span className="block text-white text-sm font-medium">Uncompromising detail</span>
              </div>
              <div className="text-right">
                <span className={`font-bold text-xs ${selected === 'original' ? 'text-[#998f81]' : 'text-[#998f81]/60'}`}>{formatSize(fileSize)}</span>
              </div>
            </button>
          </div>

          <button 
            onClick={handleSend}
            className="w-full bg-[#e6c487] text-[#0d0d15] font-label text-[10px] font-bold uppercase tracking-[0.2em] py-4 rounded-full hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_15px_rgba(230,196,135,0.2)] mb-4"
          >
            Send Collection
          </button>

          <p className="text-[9px] text-white/30 text-center uppercase tracking-wider mb-6">
            Optimized files are compressed on your device before encrypting. We never see your media.
          </p>

          <button 
            onClick={onClose}
            className="text-white/20 hover:text-white/60 transition-colors font-label text-[10px] uppercase tracking-widest w-full text-center"
          >
            Cancel Upload
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
