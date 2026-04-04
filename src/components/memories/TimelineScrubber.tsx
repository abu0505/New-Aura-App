import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TimelineItem {
  created_at: string;
}

interface TimelineScrubberProps {
  items: TimelineItem[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function getDateLabel(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export default function TimelineScrubber({ items, scrollContainerRef }: TimelineScrubberProps) {
  const [thumbPercent, setThumbPercent] = useState(0);   // 0-1
  const [isDragging, setIsDragging] = useState(false);
  const [showLabel, setShowLabel] = useState(false);
  const [labelText, setLabelText] = useState('');
  const trackRef = useRef<HTMLDivElement>(null);
  const labelHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Build a sorted date range from the items ──────────────────────────
  const sortedDates = items
    .map(i => new Date(i.created_at).getTime())
    .filter(t => !isNaN(t))
    .sort((a, b) => a - b);

  const oldest = sortedDates[0] ?? 0;
  const newest = sortedDates[sortedDates.length - 1] ?? 0;
  const span = newest - oldest || 1;

  // Convert scroll position → timestamp string
  const scrollPercentToDate = useCallback(
    (pct: number): Date => {
      // Items are newest-first so pct=0 is newest, pct=1 is oldest
      const ts = newest - pct * span;
      return new Date(ts);
    },
    [newest, span],
  );

  // ── Sync thumb when user scrolls normally ────────────────────────────
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      if (isDragging) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) return;
      const pct = scrollTop / maxScroll;
      setThumbPercent(pct);

      const date = scrollPercentToDate(pct);
      setLabelText(getDateLabel(date));
      setShowLabel(true);

      if (labelHideTimerRef.current) clearTimeout(labelHideTimerRef.current);
      labelHideTimerRef.current = setTimeout(() => setShowLabel(false), 1200);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (labelHideTimerRef.current) clearTimeout(labelHideTimerRef.current);
    };
  }, [scrollContainerRef, isDragging, scrollPercentToDate]);

  // ── Pointer events on the scrubber track ────────────────────────────
  const applyDragPct = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      const container = scrollContainerRef.current;
      if (!track || !container) return;

      const rect = track.getBoundingClientRect();
      const raw = (clientY - rect.top) / rect.height;
      const pct = Math.max(0, Math.min(1, raw));

      setThumbPercent(pct);
      const date = scrollPercentToDate(pct);
      setLabelText(getDateLabel(date));
      setShowLabel(true);

      // Programmatically scroll the container
      const { scrollHeight, clientHeight } = container;
      const maxScroll = scrollHeight - clientHeight;
      container.scrollTop = pct * maxScroll;
    },
    [scrollContainerRef, scrollPercentToDate],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDragging(true);
      applyDragPct(e.clientY);
    },
    [applyDragPct],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      applyDragPct(e.clientY);
    },
    [isDragging, applyDragPct],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    if (labelHideTimerRef.current) clearTimeout(labelHideTimerRef.current);
    labelHideTimerRef.current = setTimeout(() => setShowLabel(false), 1500);
  }, []);

  // Only render for galleries with enough items
  if (items.length < 20) return null;

  const thumbTop = `${thumbPercent * 100}%`;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-8 flex flex-col items-center justify-stretch py-4 z-20 select-none"
      aria-label="Timeline scrubber"
    >
      {/* Track */}
      <div
        ref={trackRef}
        className="relative flex-1 w-1 rounded-full bg-white/5 cursor-pointer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: 'none' }}
      >
        {/* Active fill */}
        <div
          className="absolute top-0 left-0 right-0 rounded-full bg-[#e6c487]/30 transition-all duration-75"
          style={{ height: thumbTop }}
        />

        {/* Thumb */}
        <motion.div
          className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-lg cursor-grab active:cursor-grabbing"
          style={{ top: thumbTop }}
          animate={{
            width: isDragging ? 14 : 8,
            height: isDragging ? 14 : 8,
            backgroundColor: isDragging ? '#e6c487' : 'rgba(230,196,135,0.6)',
            boxShadow: isDragging ? '0 0 8px 2px rgba(230,196,135,0.4)' : 'none',
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      </div>

      {/* Date Label */}
      <AnimatePresence>
        {showLabel && (
          <motion.div
            key="label"
            initial={{ opacity: 0, x: 8, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 8, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            className="absolute right-9 pointer-events-none"
            style={{
              top: `clamp(1rem, calc(${thumbTop} + 1rem), calc(100% - 1.5rem))`,
              transform: 'translateY(-50%)',
            }}
          >
            <div className="whitespace-nowrap bg-[#1b1b23]/90 backdrop-blur-md border border-[#e6c487]/20 text-[#e6c487] text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg shadow-xl">
              {labelText}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
