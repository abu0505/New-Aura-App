import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface MathKeyboardProps {
  onInsert: (symbol: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const MATH_SYMBOLS = [
  // Row 1: Variables & Powers
  { label: 'x', insert: 'x', tooltip: 'Variable x' },
  { label: 'x²', insert: '^2', tooltip: 'Squared' },
  { label: 'x³', insert: '^3', tooltip: 'Cubed' },
  { label: 'xⁿ', insert: '^', tooltip: 'Power' },
  { label: '√', insert: 'sqrt(', tooltip: 'Square root' },
  { label: 'π', insert: 'pi', tooltip: 'Pi (3.14...)' },

  // Row 2: Constants & Trig
  { label: 'e', insert: 'e', tooltip: "Euler's number" },
  { label: 'sin', insert: 'sin(', tooltip: 'Sine' },
  { label: 'cos', insert: 'cos(', tooltip: 'Cosine' },
  { label: 'tan', insert: 'tan(', tooltip: 'Tangent' },
  { label: 'log', insert: 'log(', tooltip: 'Log base 10' },
  { label: 'ln', insert: 'log(', tooltip: 'Natural log' },

  // Row 3: Operations & Brackets
  { label: '|x|', insert: 'abs(', tooltip: 'Absolute value' },
  { label: '(', insert: '(', tooltip: 'Open bracket' },
  { label: ')', insert: ')', tooltip: 'Close bracket' },
  { label: '+', insert: ' + ', tooltip: 'Add' },
  { label: '−', insert: ' - ', tooltip: 'Subtract' },
  { label: '×', insert: '*', tooltip: 'Multiply' },

  // Row 4: More operations
  { label: '÷', insert: '/', tooltip: 'Divide' },
  { label: '1/x', insert: '1/', tooltip: 'Reciprocal' },
  { label: 'ⁿ√', insert: 'nthRoot(', tooltip: 'Nth root' },
  { label: 'asin', insert: 'asin(', tooltip: 'Arc sine' },
  { label: 'acos', insert: 'acos(', tooltip: 'Arc cosine' },
  { label: 'atan', insert: 'atan(', tooltip: 'Arc tangent' },
];

export default function MathKeyboard({ onInsert, isOpen, onToggle }: MathKeyboardProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className="w-full">
      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider text-cyan-400/80 hover:text-cyan-300 hover:bg-cyan-400/10 transition-all active:scale-95"
      >
        <span className="material-symbols-outlined text-sm">calculate</span>
        <span>Math Keyboard</span>
        <span 
          className="material-symbols-outlined text-xs transition-transform duration-300"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          expand_more
        </span>
      </button>

      {/* Keyboard Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-6 gap-1.5 p-3 mt-2 bg-white/[0.02] rounded-2xl border border-white/5">
              {MATH_SYMBOLS.map((sym, idx) => (
                <button
                  key={idx}
                  onClick={() => onInsert(sym.insert)}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className="relative flex items-center justify-center py-2.5 px-1 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 hover:border-cyan-400/30 text-white/80 hover:text-cyan-300 text-sm font-mono transition-all active:scale-90 active:bg-cyan-400/20"
                  title={sym.tooltip}
                >
                  {sym.label}
                  
                  {/* Tooltip */}
                  {hoveredIndex === idx && (
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-black/90 border border-white/10 rounded-lg text-[9px] text-white/70 whitespace-nowrap z-50 pointer-events-none">
                      {sym.tooltip}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
