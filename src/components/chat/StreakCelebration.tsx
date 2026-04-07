import { motion, AnimatePresence } from 'framer-motion';

interface StreakCelebrationProps {
  streakCount: number;
  isOpen: boolean;
  onClose: () => void;
}

export default function StreakCelebration({ streakCount, isOpen, onClose }: StreakCelebrationProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] bg-background flex flex-col items-center justify-center p-8 overflow-hidden font-sans"
      >
        {/* Particle/Glow Background */}
        <div className="absolute inset-0 pointer-events-none">
          <motion.div 
            animate={{ 
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3]
            }}
            transition={{ duration: 4, repeat: Infinity }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px]"
          />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center text-center gap-12">
          <motion.div 
            initial={{ scale: 0.5, y: 50, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: "spring", damping: 15, stiffness: 100 }}
            className="flex flex-col items-center"
          >
            <div className="relative mb-8">
               <span className="material-symbols-outlined text-[140px] text-primary drop-shadow-[0_0_30px_var(--gold-glow)]" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
               <motion.div 
                 animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
                 transition={{ duration: 2, repeat: Infinity }}
                 className="absolute inset-0 bg-primary/20 rounded-full blur-3xl -z-10"
               />
            </div>
            
            <h1 className="font-serif italic text-7xl text-primary mb-2 tracking-tighter shadow-black drop-shadow-2xl">
              {streakCount} Days Strong
            </h1>
            <p className="font-label text-xs uppercase tracking-[0.5em] text-white/40 font-black">Our Eternal Flame</p>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="max-w-xs"
          >
            <p className="text-white/60 font-serif italic text-lg leading-relaxed">
              "Every single day is a new verse in our shared poem. Thank you for staying consistent in our sanctuary."
            </p>
          </motion.div>

          <motion.button 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 1.2 }}
            onClick={onClose}
            className="px-12 py-4 bg-white/5 border border-white/10 rounded-full font-label font-bold tracking-[0.2em] uppercase text-[10px] text-white/80 hover:bg-white/10 hover:text-white hover:border-primary/50 transition-all active:scale-95 duration-300 shadow-2xl"
          >
            Keep Glowing
          </motion.button>
        </div>

        {/* Decorative Mural Frames */}
        <div className="absolute top-12 left-12 border-l border-t border-primary/20 w-32 h-32 pointer-events-none"></div>
        <div className="absolute bottom-12 right-12 border-r border-b border-primary/20 w-32 h-32 pointer-events-none"></div>
      </motion.div>
    </AnimatePresence>
  );
}
