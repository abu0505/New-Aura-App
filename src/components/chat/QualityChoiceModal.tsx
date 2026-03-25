import { motion, AnimatePresence } from 'framer-motion';

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

          <div className="flex flex-col gap-4">
            {/* Optimized Option */}
            <button 
              onClick={() => onSelect(true)}
              className="flex items-center justify-between p-6 bg-white/5 border border-white/10 rounded-3xl hover:bg-[#e6c487]/10 hover:border-[#e6c487]/30 transition-all group"
            >
              <div className="text-left">
                <span className="block font-label text-[10px] uppercase tracking-widest text-[#e6c487] mb-1">Optimized</span>
                <span className="block text-white text-sm font-medium">Saves significant space</span>
              </div>
              <div className="text-right flex flex-col items-end">
                <span className="block text-white/40 text-[10px] uppercase tracking-tighter line-through">{formatSize(fileSize)}</span>
                <span className="block text-[#e6c487] font-bold text-xs">{getOptimizedEstimate()}</span>
              </div>
            </button>

            {/* Original Option */}
            <button 
              onClick={() => onSelect(false)}
              className="flex items-center justify-between p-6 bg-white/5 border border-white/10 rounded-3xl hover:bg-white/10 transition-all"
            >
              <div className="text-left">
                <span className="block font-label text-[10px] uppercase tracking-widest text-white/40 mb-1">Original</span>
                <span className="block text-white text-sm font-medium">Uncompromising detail</span>
              </div>
              <div className="text-right">
                <span className="block text-[#998f81] font-bold text-xs">{formatSize(fileSize)}</span>
              </div>
            </button>
          </div>

          <button 
            onClick={onClose}
            className="mt-8 text-white/20 hover:text-white/60 transition-colors font-label text-[10px] uppercase tracking-widest"
          >
            Cancel Upload
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
