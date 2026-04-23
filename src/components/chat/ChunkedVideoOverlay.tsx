/**
 * ChunkedVideoOverlay.tsx
 *
 * A premium UI overlay rendered on top of the video thumbnail while a chunked
 * video is being uploaded (sender-side) or while chunks are buffering (receiver-side).
 *
 * Features:
 *  - Diagonal shimmer sweep (uses accent CSS variable for colour)
 *  - Animated status text: fade-up entry / fade-up exit via Framer Motion AnimatePresence
 *  - Semi-transparent dark scrim so text is always legible over the thumbnail
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

interface ChunkedVideoOverlayProps {
  /** The current status text, e.g. 'Uploading chunk 2 of 8...' */
  status: string;
  /** If true, the shimmer/overlay fades out smoothly */
  isDone?: boolean;
  /** If true, displays the overlay in an error state (red text, no shimmer animation) */
  isError?: boolean;
}

export default function ChunkedVideoOverlay({ status, isDone = false, isError = false }: ChunkedVideoOverlayProps) {
  // We keep track of the PREVIOUS and CURRENT status text so AnimatePresence
  // can fade one out while fading the next one in.
  const [displayedStatus, setDisplayedStatus] = useState(status);
  const prevStatusRef = useRef(status);

  useEffect(() => {
    if (status !== prevStatusRef.current) {
      prevStatusRef.current = status;
      // Small delay so the exit animation of the old text finishes before we swap
      const t = setTimeout(() => setDisplayedStatus(status), 180);
      return () => clearTimeout(t);
    }
  }, [status]);

  if (isDone) return null;

  return (
    <motion.div
      className={`absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl overflow-hidden ${!isError ? 'chunk-shimmer' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Dark scrim */}
      <div className="absolute inset-0 bg-black/55 rounded-2xl" />

      {/* Content above scrim */}
      <div className="relative z-10 flex flex-col items-center justify-center gap-3 px-4 text-center h-full">
        {/* Animated status text */}
        <AnimatePresence mode="wait">
          <motion.span
            key={displayedStatus}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="text-[11px] font-semibold tracking-wide drop-shadow"
            style={{ 
              color: isError ? '#ff4d4d' : 'var(--gold-light)', 
              textShadow: isError ? '0 1px 4px rgba(255,0,0,0.4)' : '0 1px 4px rgba(0,0,0,0.8)' 
            }}
          >
            {displayedStatus}
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
