import React, { useState, useRef } from 'react';
import type { TouchEvent, MouseEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  disabled?: boolean;
  triggerSelector?: string;
}

export default function PullToRefresh({ onRefresh, children, disabled = false, triggerSelector }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const isDragging = useRef(false);
  
  const THRESHOLD = 70; // px
  const MAX_PULL = 120; // px
  const RESISTANCE = 0.45;

  const handleStart = (y: number, target: EventTarget) => {
    if (disabled || isRefreshing) return;

    if (triggerSelector && target instanceof Element) {
      const triggerEl = containerRef.current?.querySelector(triggerSelector) || document.querySelector(triggerSelector);
      if (!triggerEl || !triggerEl.contains(target)) {
        return; // touch/mouse down did not originate in the trigger element (e.g. header)
      }
    } else {
      const container = containerRef.current?.querySelector('.overflow-y-auto') || containerRef.current;
      if (container && container.scrollTop !== 0) {
        return;
      }
    }

    startY.current = y;
    isDragging.current = true;
  };

  const handleMove = (y: number, event: any) => {
    if (!isDragging.current || isRefreshing) return;
    const deltaY = y - startY.current;
    
    if (deltaY > 0) {
      // Pulling down
      const distance = Math.min(deltaY * RESISTANCE, MAX_PULL);
      setPullDistance(distance);
      // Prevent browser default pull-to-refresh behavior
      if (event.cancelable) event.preventDefault();
    } else {
      isDragging.current = false;
      setPullDistance(0);
    }
  };

  const handleEnd = async () => {
    if (!isDragging.current || isRefreshing) return;
    isDragging.current = false;

    if (pullDistance >= THRESHOLD) {
      setIsRefreshing(true);
      setPullDistance(THRESHOLD); // hold at threshold while refreshing
      try {
        await onRefresh();
      } catch (err) {
        console.error('PullToRefresh failed:', err);
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  };

  // Touch event handlers
  const onTouchStart = (e: TouchEvent) => handleStart(e.touches[0].clientY, e.target);
  const onTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientY, e);
  const onTouchEnd = () => handleEnd();

  // Mouse event handlers (for desktop drag simulation)
  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) { // left click only
      handleStart(e.clientY, e.target);
    }
  };
  const onMouseMove = (e: MouseEvent) => {
    if (isDragging.current) {
      handleMove(e.clientY, e);
    }
  };
  const onMouseUp = () => handleEnd();
  const onMouseLeave = () => {
    if (isDragging.current) {
      handleEnd();
    }
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full flex flex-col min-h-0"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    >
      {/* Pull down indicator */}
      <AnimatePresence>
        {(pullDistance > 0 || isRefreshing) && (
          <motion.div
            initial={{ opacity: 0, y: -40, x: '-50%' }}
            animate={{ 
              opacity: 1, 
              y: pullDistance, // position relative to pull distance
              rotate: isRefreshing ? 360 : pullDistance * 4 // rotate as you pull
            }}
            exit={{ opacity: 0, y: -40, x: '-50%', transition: { duration: 0.2 } }}
            transition={isRefreshing ? {
              rotate: { repeat: Infinity, duration: 1, ease: 'linear' },
              y: { type: 'spring', damping: 15 }
            } : { type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute left-1/2 top-[76px] z-50 flex items-center justify-center w-10 h-10 rounded-full border border-white/15 shadow-xl backdrop-blur-md"
            style={{
              background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.37), inset 0 1px 1px rgba(255,255,255,0.15)'
            }}
          >
            {isRefreshing ? (
              <span className="material-symbols-outlined text-[var(--gold)] text-xl animate-spin">sync</span>
            ) : (
              <span 
                className="material-symbols-outlined text-[var(--gold)] text-xl transition-transform"
                style={{ 
                  transform: `rotate(${pullDistance >= THRESHOLD ? 180 : 0}deg)`,
                  opacity: Math.min(pullDistance / THRESHOLD, 1)
                }}
              >
                arrow_downward
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {children}
    </div>
  );
}
