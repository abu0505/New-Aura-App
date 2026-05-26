import { motion, AnimatePresence } from 'framer-motion';

interface SnapCaptureConsentModalProps {
  isOpen: boolean;
  onAgree: () => void;
  onDisagree: () => void;
}

export default function SnapCaptureConsentModal({ isOpen, onAgree, onDisagree }: SnapCaptureConsentModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-xl z-[200]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 40 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="fixed inset-0 flex items-center justify-center z-[201] p-6"
          >
            <div className="w-full max-w-md bg-aura-bg-elevated/95 backdrop-blur-2xl rounded-3xl border border-white/10 shadow-[0_32px_128px_-16px_rgba(0,0,0,0.8)] overflow-hidden">
              {/* Header Glow */}
              <div className="relative h-32 flex items-center justify-center overflow-hidden">
                {/* Animated gradient background */}
                <div
                  className="absolute inset-0 opacity-40"
                  style={{
                    background: 'radial-gradient(ellipse at center, var(--gold-light) 0%, transparent 70%)',
                  }}
                />
                {/* Pulsing camera icon */}
                <motion.div
                  animate={{
                    scale: [1, 1.1, 1],
                    opacity: [0.8, 1, 0.8],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="relative z-10 w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30 shadow-[0_0_40px_rgba(201,169,110,0.3)]"
                >
                  <span className="material-symbols-outlined text-4xl text-primary">
                    photo_camera
                  </span>
                </motion.div>
              </div>

              {/* Content */}
              <div className="px-8 pb-8 -mt-2">
                <h2 className="font-serif text-2xl text-primary text-center mb-2 tracking-wide">
                  Surprise Snaps
                </h2>
                <p className="text-aura-text-secondary text-center text-sm mb-6 leading-relaxed">
                  This feature lets your partner remotely capture photos from your front camera as a fun surprise — and vice versa!
                </p>

                {/* Feature Details */}
                <div className="space-y-3 mb-8">
                  {[
                    { icon: 'timer', text: 'Photos are taken every 5 seconds (max 10)' },
                    { icon: 'videocam', text: "You'll see a live camera preview during capture" },
                    { icon: 'lock', text: 'All photos are end-to-end encrypted' },
                    { icon: 'cancel', text: 'You can cancel anytime mid-session' },
                    { icon: 'chat_bubble', text: 'Photos appear as messages in your chat' },
                  ].map((item, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 + i * 0.07 }}
                      className="flex items-start gap-3"
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="material-symbols-outlined text-primary text-[16px]">
                          {item.icon}
                        </span>
                      </div>
                      <p className="text-aura-text-primary text-sm leading-relaxed">{item.text}</p>
                    </motion.div>
                  ))}
                </div>

                {/* Info note */}
                <div className="bg-primary/5 border border-primary/15 rounded-xl px-4 py-3 mb-6">
                  <p className="text-[11px] text-aura-text-secondary leading-relaxed text-center">
                    <span className="text-primary font-bold">Note:</span> Both you and your partner need to agree for this feature to work. If either of you declines, the feature will be disabled.
                  </p>
                </div>

                {/* Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={onDisagree}
                    className="flex-1 py-3.5 rounded-2xl border border-white/10 text-aura-text-secondary font-label text-sm uppercase tracking-widest hover:bg-white/5 active:scale-[0.97] transition-all"
                  >
                    No Thanks
                  </button>
                  <button
                    onClick={onAgree}
                    className="flex-1 py-3.5 rounded-2xl text-sm font-label uppercase tracking-widest font-bold active:scale-[0.97] transition-all relative overflow-hidden"
                    style={{
                      background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-light) 100%)',
                      color: 'var(--bg-primary)',
                    }}
                  >
                    {/* Shimmer effect */}
                    <motion.div
                      className="absolute inset-0 opacity-30"
                      style={{
                        background: 'linear-gradient(90deg, transparent 0%, white 50%, transparent 100%)',
                      }}
                      animate={{ x: ['-100%', '100%'] }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'linear', repeatDelay: 1 }}
                    />
                    <span className="relative z-10">I Agree ✨</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
