import { motion, AnimatePresence } from 'framer-motion';

interface AttachmentSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (type: 'camera' | 'photo' | 'video' | 'audio' | 'document' | 'location' | 'sticker' | 'gif') => void;
}

const attachmentOptions = [
  { id: 'document', icon: 'description', label: 'Document', colorClass: 'text-primary', bgClass: 'bg-primary/10' },
  { id: 'gif', icon: 'gif_box', label: 'GIFs', colorClass: 'text-primary', bgClass: 'bg-primary/10' },
  { id: 'sticker', icon: 'auto_awesome', label: 'Stickers', colorClass: 'text-primary', bgClass: 'bg-primary/10' },
] as const;

export default function AttachmentSheet({ isOpen, onClose, onSelect }: AttachmentSheetProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/80 z-40 backdrop-blur-lg"
          />

          <motion.section
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-[3rem] overflow-hidden"
          >
            <div className="mx-auto max-w-lg w-full bg-background backdrop-blur-2xl shadow-[0_-20px_60px_-10px_rgba(0,0,0,0.9)] border-t border-white/5 p-8 pb-16">
              
              <div className="flex justify-center mb-10" onClick={onClose} >
                <div className="w-12 h-1.5 bg-white/10 rounded-full" />
              </div>

              <div className="grid grid-cols-3 gap-y-12 gap-x-6">
                {attachmentOptions.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => onSelect(option.id)}
                      className="flex flex-col items-center gap-4 group"
                    >
                      <div className={`w-16 h-16 rounded-[1.5rem] ${option.bgClass} flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-active:scale-95 border border-white/5 group-hover:border-primary/30`}>
                        <span className={`material-symbols-outlined ${option.colorClass} text-2xl group-hover:scale-110 transition-transform`}>
                          {option.icon}
                        </span>
                      </div>
                      <span className="font-label text-[10px] tracking-[0.2em] text-white/40 uppercase group-hover:text-white transition-colors">
                        {option.label}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
