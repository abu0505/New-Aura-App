import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SnapCapturePhase, SnapCaptureRole } from '../../hooks/useSnapCapture';

interface SnapCaptureOverlayProps {
  phase: SnapCapturePhase;
  role: SnapCaptureRole;
  photosCount: number;
  totalPhotos: number;
  errorMessage: string | null;
  cameraStream: MediaStream | null;
  onCancel: () => void;
}

export default function SnapCaptureOverlay({
  phase,
  role,
  photosCount,
  totalPhotos,
  errorMessage,
  cameraStream,
  onCancel,
}: SnapCaptureOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Attach camera stream to video element for live preview
  useEffect(() => {
    if (role === 'receiver' && cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play().then(() => setShowPreview(true)).catch(() => {});
    } else {
      setShowPreview(false);
    }
  }, [role, cameraStream]);

  const isActive = phase === 'requesting' || phase === 'capturing' || phase === 'completing';
  const isError = phase === 'denied' || phase === 'cancelled';

  if (!isActive && !isError) return null;

  const progressPercent = totalPhotos > 0 ? (photosCount / totalPhotos) * 100 : 0;

  return (
    <AnimatePresence>
      {(isActive || isError) && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 400 }}
          className="absolute top-24 md:top-28 left-1/2 -translate-x-1/2 z-[60]"
        >
          <div
            className={`
              flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-2xl backdrop-blur-xl
              ${isError
                ? 'bg-red-500/10 border-red-500/20 shadow-red-500/10'
                : 'bg-aura-bg-elevated/90 border-primary/20 shadow-primary/10'
              }
            `}
            style={{ minWidth: '240px' }}
          >
            {/* ── Error State ── */}
            {isError && (
              <>
                <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-red-400 text-[18px]">
                    {phase === 'cancelled' ? 'cancel' : 'block'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-300 truncate">
                    {errorMessage || 'Session ended'}
                  </p>
                </div>
              </>
            )}

            {/* ── Requesting State (Initiator) ── */}
            {phase === 'requesting' && role === 'initiator' && (
              <>
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    className="material-symbols-outlined text-primary text-[18px]"
                  >
                    hourglass_empty
                  </motion.span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary truncate">
                    Waiting for partner...
                  </p>
                  <p className="text-[10px] text-aura-text-secondary uppercase tracking-widest">
                    Snap request sent
                  </p>
                </div>
                <button
                  onClick={onCancel}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                >
                  <span className="material-symbols-outlined text-aura-text-secondary text-[16px]">close</span>
                </button>
              </>
            )}

            {/* ── Capturing State (Initiator) ── */}
            {phase === 'capturing' && role === 'initiator' && (
              <>
                {/* Pulsing recording dot */}
                <div className="relative flex-shrink-0">
                  <motion.div
                    animate={{
                      scale: [1, 1.4, 1],
                      opacity: [0.4, 0.1, 0.4],
                    }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="absolute inset-0 rounded-full bg-primary"
                  />
                  <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center relative z-10">
                    <span className="material-symbols-outlined text-primary text-[18px]">
                      photo_camera
                    </span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-primary">
                      Capturing... {photosCount}/{totalPhotos}
                    </p>
                    <span className="text-lg">📸</span>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: 'linear-gradient(90deg, var(--gold), var(--gold-light))' }}
                      initial={{ width: '0%' }}
                      animate={{ width: `${progressPercent}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                </div>
                <button
                  onClick={onCancel}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-red-500/20 flex items-center justify-center transition-colors flex-shrink-0"
                >
                  <span className="material-symbols-outlined text-aura-text-secondary hover:text-red-400 text-[16px]">close</span>
                </button>
              </>
            )}

            {/* ── Capturing State (Receiver) ── */}
            {phase === 'capturing' && role === 'receiver' && (
              <>
                {/* Live camera preview */}
                <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 border border-primary/20 bg-black relative">
                  {showPreview ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                      style={{ transform: 'scaleX(-1)' }} // Mirror front camera
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-primary/40 text-xl">
                        videocam
                      </span>
                    </div>
                  )}
                  {/* Recording dot */}
                  <motion.div
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-primary">
                      📸 {photosCount}/{totalPhotos} captured
                    </p>
                  </div>
                  <p className="text-[10px] text-aura-text-secondary uppercase tracking-widest">
                    Partner is snapping you
                  </p>
                  {/* Progress bar */}
                  <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mt-1.5">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: 'linear-gradient(90deg, var(--gold), var(--gold-light))' }}
                      initial={{ width: '0%' }}
                      animate={{ width: `${progressPercent}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                </div>
                <button
                  onClick={onCancel}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-red-500/20 flex items-center justify-center transition-colors flex-shrink-0"
                  title="Cancel"
                >
                  <span className="material-symbols-outlined text-aura-text-secondary hover:text-red-400 text-[16px]">close</span>
                </button>
              </>
            )}

            {/* ── Completing State ── */}
            {phase === 'completing' && (
              <>
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="material-symbols-outlined text-primary text-[18px]"
                  >
                    sync
                  </motion.span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary truncate">
                    Sending {photosCount} snaps to chat...
                  </p>
                </div>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
