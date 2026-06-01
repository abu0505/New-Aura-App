import { useState, useRef, useEffect } from 'react';
import { motion, useAnimationControls } from 'framer-motion';

interface SlidingNameProps {
  name: string;
  className?: string;
  textClassName?: string;
}

/**
 * SlidingName - AURA premium text slider for long display names.
 * When clicked, if the name overflows its container, it slides right-to-left once,
 * loops off-screen, and slides back in from the right to rest at its original position.
 */
export default function SlidingName({ name, className = '', textClassName = '' }: SlidingNameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const controls = useAnimationControls();
  const [isAnimating, setIsAnimating] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAnimating) return;

    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const containerWidth = container.offsetWidth;
    const textWidth = text.scrollWidth;

    // Only animate if the text overflows the container
    if (textWidth <= containerWidth) return;

    setIsAnimating(true);

    const speed = 70; // comfortable reading speed (pixels per second)
    const duration1 = textWidth / speed;
    const duration2 = containerWidth / speed;

    // Wait one frame to ensure React has removed the truncate classes and the full text width is rendered
    requestAnimationFrame(async () => {
      try {
        // Phase 1: Slide left until text is fully off-screen to the left
        await controls.start({
          x: -textWidth,
          transition: { duration: duration1, ease: 'linear' }
        });

        // Phase 2: Teleport instantly to the right side of the container
        controls.set({ x: containerWidth });

        // Phase 3: Slide back in from the right edge and ease into the original position (x: 0)
        await controls.start({
          x: 0,
          transition: { duration: duration2, ease: 'easeOut' }
        });
      } catch (error) {
        console.error('Sliding name animation failed:', error);
      } finally {
        setIsAnimating(false);
      }
    });
  };

  // Reset position if the name changes
  useEffect(() => {
    controls.set({ x: 0 });
    setIsAnimating(false);
  }, [name, controls]);

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className={`overflow-hidden cursor-pointer select-none relative max-w-full ${className}`}
    >
      <motion.span
        ref={textRef}
        animate={controls}
        initial={{ x: 0 }}
        className={`inline-block whitespace-nowrap ${textClassName} ${isAnimating ? 'overflow-hidden' : 'truncate w-full'}`}
        style={{ display: 'inline-block' }}
      >
        {name}
      </motion.span>
    </div>
  );
}
