import { motion, AnimatePresence } from 'framer-motion';
import { useStreak } from '../../contexts/StreakContext';

interface StreakBadgeProps {
  /** 'compact' for mobile header pill, 'full' for desktop header */
  variant?: 'compact' | 'full';
}

export default function StreakBadge({ variant = 'compact' }: StreakBadgeProps) {
  const { streakCount, streakAtRisk, mySnappedToday, partnerSnappedToday } = useStreak();

  // Don't show badge if no streak exists
  if (streakCount === 0 && !streakAtRisk) return null;

  // Determine state
  const bothSnapped = mySnappedToday && partnerSnappedToday;
  const isAtRisk = streakAtRisk && streakCount > 0;
  const iWaitingForPartner = isAtRisk && mySnappedToday && !partnerSnappedToday;
  const partnerWaitingForMe = isAtRisk && !mySnappedToday && partnerSnappedToday;
  const neitherSnapped = !mySnappedToday && !partnerSnappedToday;

  if (variant === 'compact') {
    return (
      <AnimatePresence mode="wait">
        {isAtRisk ? (
          // ── AT RISK: Hourglass warning ──────────────────────────────────────
          <motion.div
            key="at-risk"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 200 }}
            className="relative flex items-center gap-1.5 cursor-default"
            title={
              partnerWaitingForMe
                ? '⏳ Snap now to save your streak!'
                : iWaitingForPartner
                ? '⏳ Waiting for partner to snap...'
                : '⏳ Streak at risk!'
            }
          >
            {/* Pulsing outer ring — only when the current user needs to act */}
            {partnerWaitingForMe && (
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{
                  background: 'radial-gradient(circle, rgba(251,146,60,0.3) 0%, transparent 70%)',
                }}
                animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}

            <div
              className={`relative flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold font-label uppercase tracking-wider transition-all duration-300 ${
                partnerWaitingForMe
                  ? 'bg-orange-500/20 border-orange-400/50 text-orange-300'
                  : 'bg-orange-500/10 border-orange-400/20 text-orange-400/70'
              }`}
            >
              {/* Animated hourglass icon */}
              <motion.span
                className="text-base leading-none"
                animate={partnerWaitingForMe ? { rotate: [0, 180, 180, 0] } : {}}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.5 }}
                style={{ display: 'inline-block' }}
              >
                ⏳
              </motion.span>
              <span className="text-[10px]">{streakCount}</span>
              {partnerWaitingForMe && (
                <motion.span
                  className="text-[9px] font-black hidden sm:inline"
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                >
                  SNAP!
                </motion.span>
              )}
            </div>
          </motion.div>
        ) : (
          // ── NORMAL: Fire badge ─────────────────────────────────────────────
          <motion.div
            key="normal"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 200 }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 cursor-default"
            title={
              bothSnapped
                ? `🔥 Both snapped today! ${streakCount} day streak`
                : neitherSnapped
                ? `🔥 ${streakCount} day streak — snap to keep it alive!`
                : mySnappedToday
                ? `🔥 You snapped! Waiting for partner. ${streakCount} day streak`
                : `🔥 ${streakCount} day streak`
            }
          >
            <motion.span
              className="text-base leading-none"
              animate={bothSnapped ? { scale: [1, 1.2, 1] } : {}}
              transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}
              style={{ display: 'inline-block' }}
            >
              🔥
            </motion.span>
            <span className="text-[10px] font-bold text-primary font-label uppercase tracking-wider">
              {streakCount}
            </span>
            {bothSnapped && (
              <motion.span
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                className="text-[9px] text-primary/60 font-black overflow-hidden whitespace-nowrap hidden sm:inline"
              >
                ✓
              </motion.span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // ── FULL VARIANT (desktop header) ────────────────────────────────────────────
  return (
    <AnimatePresence mode="wait">
      {isAtRisk ? (
        <motion.div
          key="at-risk-full"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative flex items-center gap-2 cursor-default"
          title={partnerWaitingForMe ? 'Snap now to save your streak!' : 'Waiting for partner to snap'}
        >
          {partnerWaitingForMe && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(251,146,60,0.25) 0%, transparent 70%)' }}
              animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 1.8, repeat: Infinity }}
            />
          )}
          <div
            className={`relative flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold font-label uppercase tracking-wider ${
              partnerWaitingForMe
                ? 'bg-orange-500/15 border-orange-400/40 text-orange-300'
                : 'bg-orange-500/8 border-orange-400/15 text-orange-400/60'
            }`}
          >
            <motion.span
              className="text-lg leading-none"
              animate={partnerWaitingForMe ? { rotate: [0, 180, 180, 0] } : {}}
              transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 0.5 }}
              style={{ display: 'inline-block' }}
            >
              ⏳
            </motion.span>
            <span>{streakCount} Days</span>
            {partnerWaitingForMe && (
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="text-orange-200 font-black"
              >
                Snap Now!
              </motion.span>
            )}
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="normal-full"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 cursor-default"
          title={
            bothSnapped
              ? `Both snapped today! 🔥 ${streakCount} day streak`
              : `🔥 ${streakCount} day streak`
          }
        >
          <motion.span
            className="text-lg leading-none"
            animate={bothSnapped ? { scale: [1, 1.2, 1] } : {}}
            transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 2 }}
            style={{ display: 'inline-block' }}
          >
            🔥
          </motion.span>
          <span className="text-xs font-bold text-primary font-label uppercase tracking-wider">
            {streakCount} Days
          </span>
          {bothSnapped && (
            <span className="text-[10px] text-primary/50 font-black">✓ Safe</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
