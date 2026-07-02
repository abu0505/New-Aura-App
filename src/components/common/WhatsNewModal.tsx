import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface WhatsNewModalProps {
  currentVersion: string;
}

export default function WhatsNewModal({ currentVersion }: WhatsNewModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const seenVersion = localStorage.getItem('seen_whats_new_version');
    if (seenVersion !== currentVersion) {
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [currentVersion]);

  const handleSkip = () => {
    localStorage.setItem('seen_whats_new_version', currentVersion);
    setIsOpen(false);
  };

  const handleGetStarted = () => {
    localStorage.setItem('seen_whats_new_version', currentVersion);
    // Set walkthrough flag for new feature
    localStorage.setItem('show_save_to_folders_walkthrough', 'true');
    setIsOpen(false);
    
    // Dispatch redirect event
    window.dispatchEvent(new CustomEvent('open-whats-new-feature', { 
      detail: { feature: 'save-to-folders' } 
    }));
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-[12px]">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', duration: 0.5 }}
            style={{
              background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)',
              backdropFilter: 'blur(30px)',
              WebkitBackdropFilter: 'blur(30px)',
            }}
            className="border border-white/15 rounded-[32px] p-6 md:p-8 max-w-md w-full shadow-[0_24px_50px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] relative overflow-hidden max-h-[90vh] flex flex-col"
          >
            {/* Background glowing gradients */}
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-[rgba(var(--primary-rgb),_0.2)] rounded-full blur-3xl pointer-events-none animate-pulse" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-[rgba(var(--primary-rgb),_0.15)] rounded-full blur-3xl pointer-events-none animate-pulse" style={{ animationDelay: '1.5s' }} />

            <div className="relative z-10 flex flex-col items-center text-center w-full max-h-full min-h-0 flex-1">
              {/* Feature Icon */}
              <div 
                style={{
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.15)',
                }}
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 shrink-0"
              >
                <span className="material-symbols-outlined text-3xl text-[var(--gold)]">auto_awesome</span>
              </div>

              <h2 className="font-sans font-bold text-2xl md:text-3xl text-white tracking-tight mb-1 flex items-center gap-1.5 shrink-0">
                What's New! <span className="text-xl md:text-2xl">✨</span>
              </h2>
              <p className="font-sans text-xs tracking-wider text-white/40 mb-6 font-medium shrink-0">
                Version {currentVersion}
              </p>

              {/* Updates List */}
              <div className="w-full text-left space-y-4 mb-6 overflow-y-auto scrollbar-hide flex-1 min-h-0">
                {/* Update 1: Save Media from Chat */}
                <div 
                  style={{
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.15)',
                    backdropFilter: 'blur(30px)',
                    WebkitBackdropFilter: 'blur(30px)',
                  }}
                  className="flex gap-4 p-4 rounded-2xl hover:bg-white/[0.12] hover:border-white/15 transition-all duration-300 group"
                >
                  <div className="p-3 rounded-xl bg-white/5 h-fit text-[var(--gold)] shrink-0 border border-white/5 shadow-inner group-hover:scale-105 transition-transform duration-300">
                    <span className="material-symbols-outlined text-[22px] block">folder_shared</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white/90 mb-1">Save Chat Media to Folders</h3>
                    <p className="text-xs text-white/50 leading-relaxed font-medium">
                      Easily save any photo, video, or multi-media grid directly to your folders from the 3-dots chat menu. Save all images at once with a single click!
                    </p>
                  </div>
                </div>

                {/* Update 2: Frequent & Recent Folders */}
                <div 
                  style={{
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.15)',
                    backdropFilter: 'blur(30px)',
                    WebkitBackdropFilter: 'blur(30px)',
                  }}
                  className="flex gap-4 p-4 rounded-2xl hover:bg-white/[0.12] hover:border-white/15 transition-all duration-300 group"
                >
                  <div className="p-3 rounded-xl bg-white/5 h-fit text-[var(--gold)] shrink-0 border border-white/5 shadow-inner group-hover:scale-105 transition-transform duration-300">
                    <span className="material-symbols-outlined text-[22px] block">folder_open</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white/90 mb-1">Frequent & Recent Folders</h3>
                    <p className="text-xs text-white/50 leading-relaxed font-medium">
                      Folders you add media to are now automatically sorted to the top. Keep your most active and frequent folders easily accessible!
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between w-full gap-4 shrink-0 mt-2">
                <button
                  onClick={handleSkip}
                  className="text-white/50 hover:text-white transition-colors text-xs font-bold uppercase tracking-wider cursor-pointer py-2.5 underline decoration-[var(--gold)]/40 underline-offset-4 hover:decoration-white/60"
                >
                  Skip for now
                </button>
                <button
                  onClick={handleGetStarted}
                  style={{
                    background: 'linear-gradient(135deg, var(--gold-light) 0%, var(--gold) 100%)',
                    boxShadow: '0 8px 20px rgba(var(--primary-rgb), 0.25)',
                  }}
                  className="text-black text-xs uppercase tracking-wider font-bold py-3 px-6 rounded-full transition-all duration-300 hover:shadow-[rgba(var(--primary-rgb),_0.4)] hover:brightness-110 active:scale-[0.98] flex items-center gap-1.5"
                >
                  Get Started
                  <span className="material-symbols-outlined text-[16px] font-bold">chevron_right</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
