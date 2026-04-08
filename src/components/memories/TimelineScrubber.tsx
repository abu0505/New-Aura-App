import React, { useState, useEffect, useRef, useCallback } from 'react';
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

  // Only render for galleries with enough items to scroll
  if (items.length < 5) return null;

  const thumbTop = `${thumbPercent * 100}%`;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 flex flex-col justify-stretch z-40 select-none pt-[1.2rem]"
      aria-label="Timeline scrubber"
    >
      <div
        ref={trackRef}
        className="relative flex-1 w-full cursor-pointer touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-[2px] bg-white/5 rounded-full overflow-hidden">
          <div
            className="absolute top-0 left-0 right-0 bg-[rgba(var(--primary-rgb),_0.3)]"
            style={{ height: thumbTop }}
          />
        </div>

        {/* Premium Morphing Thumb / Drag Handle */}
        <motion.div
           className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full z-10"
           style={{ top: thumbTop }}
           animate={{
             width: 4,
             height: isDragging || showLabel ? 32 : 12,
             backgroundColor: isDragging || showLabel ? 'var(--gold)' : 'rgba(var(--primary-rgb),0.4)',
             boxShadow: isDragging ? '0 0 12px 2px rgba(var(--primary-rgb),0.5)' : 'none',
           }}
           transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        />

        {/* Floating Date Label */}
        <AnimatePresence>
          {showLabel && (
            <motion.div
              key="label"
              initial={{ opacity: 0, x: 20, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.9 }}
              transition={{ duration: 0.2, type: 'spring', stiffness: 400, damping: 25 }}
              className="absolute right-full mr-1 pointer-events-auto cursor-grab active:cursor-grabbing touch-none origin-right"
              style={{
                top: `calc(${thumbTop} - 18px)`,
                transform: 'translateY(-50%)',
              }}
            >
              <div className="whitespace-nowrap bg-aura-bg-elevated/95 backdrop-blur-xl border border-[rgba(var(--primary-rgb),_0.2)] text-[var(--gold)] text-[11px] font-bold uppercase tracking-widest px-4 py-2 rounded-full shadow-[0_10px_30px_rgba(0,0,0,0.8)]">
                {labelText}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
