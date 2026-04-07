import { motion } from 'framer-motion';

export default function TypingIndicator() {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 10 }}
      className="flex items-center gap-1.5 bg-aura-bg-elevated border border-white/5 shadow-xl px-4 py-3 rounded-2xl rounded-bl-sm w-fit my-2"
    >
      <motion.div 
        animate={{ y: [0, -5, 0] }} 
        transition={{ repeat: Infinity, duration: 0.6, ease: "easeInOut", delay: 0 }}
        className="w-2 h-2 bg-primary rounded-full"
      />
      <motion.div 
        animate={{ y: [0, -5, 0] }} 
        transition={{ repeat: Infinity, duration: 0.6, ease: "easeInOut", delay: 0.15 }}
        className="w-2 h-2 bg-primary rounded-full"
      />
      <motion.div 
        animate={{ y: [0, -5, 0] }} 
        transition={{ repeat: Infinity, duration: 0.6, ease: "easeInOut", delay: 0.3 }}
        className="w-2 h-2 bg-primary opacity-50 rounded-full"
      />
    </motion.div>
  );
}
