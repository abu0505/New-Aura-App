import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Preset {
  name: string;
  expressions: string[];
  description?: string;
}

interface PresetCategory {
  title: string;
  weekTag: string;
  icon: string;
  color: string;
  presets: Preset[];
}

const PRESET_CATEGORIES: PresetCategory[] = [
  {
    title: 'Straight Lines',
    weekTag: 'Week 2',
    icon: 'trending_up',
    color: '#c9a96e',
    presets: [
      { name: 'Basic Line', expressions: ['2*x + 3'], description: 'y = 2x + 3' },
      { name: 'Negative Slope', expressions: ['-x + 5'], description: 'y = -x + 5' },
      { name: 'Horizontal Line', expressions: ['4'], description: 'y = 4 (zero slope)' },
      { name: 'Through Origin', expressions: ['3*x'], description: 'y = 3x' },
      { name: 'Parallel Lines', expressions: ['2*x + 1', '2*x - 3'], description: 'Same slope, different intercepts' },
      { name: 'Perpendicular Lines', expressions: ['2*x + 1', '-0.5*x + 3'], description: 'Slopes multiply to -1' },
      { name: 'Line Fitting', expressions: ['x', '1.5*x - 0.5', '0.8*x + 0.3'], description: 'Compare different fits' },
    ],
  },
  {
    title: 'Quadratic Functions',
    weekTag: 'Week 3',
    icon: 'ssid_chart',
    color: '#f43f5e',
    presets: [
      { name: 'Basic Parabola', expressions: ['x^2'], description: 'y = x² (vertex at origin)' },
      { name: 'Opens Down', expressions: ['-x^2 + 4'], description: 'y = -x² + 4 (max at y=4)' },
      { name: 'Shifted Parabola', expressions: ['(x-2)^2 + 1'], description: 'Vertex at (2, 1)' },
      { name: 'With Roots', expressions: ['x^2 - 4*x + 3'], description: 'Roots at x=1 and x=3' },
      { name: 'No Real Roots', expressions: ['x^2 + 2*x + 5'], description: 'Discriminant < 0' },
      { name: 'Vertex Form Compare', expressions: ['x^2', '(x-3)^2', '(x+2)^2 - 1'], description: 'Horizontal & vertical shifts' },
      { name: 'Width Comparison', expressions: ['x^2', '2*x^2', '0.5*x^2'], description: 'Effect of "a" coefficient' },
    ],
  },
  {
    title: 'Polynomials',
    weekTag: 'Week 4',
    icon: 'analytics',
    color: '#3b82f6',
    presets: [
      { name: 'Cubic Basic', expressions: ['x^3'], description: 'y = x³ (odd function)' },
      { name: 'Cubic with Turning Pts', expressions: ['x^3 - 3*x'], description: '2 turning points' },
      { name: 'Quartic', expressions: ['x^4 - 4*x^2'], description: 'y = x⁴ - 4x² (W-shape)' },
      { name: 'Root Multiplicities', expressions: ['(x+2)*(x-1)^2*(x-3)'], description: 'Touch at x=1, cross at x=-2,3' },
      { name: 'End Behavior (Even)', expressions: ['x^4 - 2*x^2 + 1'], description: 'Both ends → +∞' },
      { name: 'End Behavior (Odd)', expressions: ['x^5 - 5*x^3 + 4*x'], description: 'Left → -∞, Right → +∞' },
      { name: 'Polynomial Division', expressions: ['x^3 + 2*x^2 - x - 2', '(x+1)*(x-1)*(x+2)'], description: 'Factored form overlay' },
    ],
  },
  {
    title: 'Exponential Functions',
    weekTag: 'Week 5',
    icon: 'rocket_launch',
    color: '#22c55e',
    presets: [
      { name: 'Exponential Growth', expressions: ['2^x'], description: 'y = 2ˣ' },
      { name: 'Natural Exponential', expressions: ['exp(x)'], description: 'y = eˣ' },
      { name: 'Exponential Decay', expressions: ['(1/2)^x'], description: 'y = (½)ˣ' },
      { name: 'Growth vs Decay', expressions: ['2^x', '(1/2)^x'], description: 'Mirror images' },
      { name: 'Shifted Exponential', expressions: ['2^(x-1) + 3'], description: 'Shifted right 1, up 3' },
      { name: 'Base Comparison', expressions: ['2^x', '3^x', '10^x'], description: 'Different growth rates' },
    ],
  },
  {
    title: 'Logarithmic Functions',
    weekTag: 'Week 6',
    icon: 'stacked_line_chart',
    color: '#a855f7',
    presets: [
      { name: 'Natural Log', expressions: ['log(x)'], description: 'y = ln(x)' },
      { name: 'Log Base 10', expressions: ['log(x)/log(10)'], description: 'y = log₁₀(x)' },
      { name: 'Log Base 2', expressions: ['log(x)/log(2)'], description: 'y = log₂(x)' },
      { name: 'Log vs Exp', expressions: ['log(x)', 'exp(x)', 'x'], description: 'Inverse functions + y=x' },
      { name: 'Shifted Log', expressions: ['log(x + 2) - 1'], description: 'Shift left 2, down 1' },
      { name: 'Log Properties', expressions: ['log(x)', '2*log(x)', 'log(x^2)'], description: '2·ln(x) = ln(x²) — they overlap!' },
    ],
  },
  {
    title: 'Trigonometric',
    weekTag: 'Bonus',
    icon: 'waves',
    color: '#06b6d4',
    presets: [
      { name: 'Sine Wave', expressions: ['sin(x)'], description: 'y = sin(x)' },
      { name: 'Cosine Wave', expressions: ['cos(x)'], description: 'y = cos(x)' },
      { name: 'Sin vs Cos', expressions: ['sin(x)', 'cos(x)'], description: 'Phase shift comparison' },
      { name: 'Tangent', expressions: ['tan(x)'], description: 'y = tan(x) (asymptotes)' },
      { name: 'Amplitude Change', expressions: ['sin(x)', '2*sin(x)', '0.5*sin(x)'], description: 'Effect on amplitude' },
      { name: 'Period Change', expressions: ['sin(x)', 'sin(2*x)', 'sin(0.5*x)'], description: 'Effect on period' },
    ],
  },
  {
    title: 'Calculus Concepts',
    weekTag: 'Week 7-9',
    icon: 'functions',
    color: '#f59e0b',
    presets: [
      { name: 'Limit Visualization', expressions: ['sin(x)/x'], description: 'lim x→0 = 1' },
      { name: 'Continuity Gap', expressions: ['1/(x-2)'], description: 'Discontinuity at x=2' },
      { name: 'f(x) and f\'(x)', expressions: ['x^3 - 3*x', '3*x^2 - 3'], description: 'Function + derivative' },
      { name: 'Critical Points', expressions: ['x^3 - 6*x^2 + 9*x + 1'], description: 'Find maxima/minima from derivative' },
      { name: 'Concavity', expressions: ['x^3', '3*x^2', '6*x'], description: 'f, f\', f\'\' comparison' },
      { name: 'Area Under Curve', expressions: ['x^2'], description: 'Visualize ∫x² dx' },
    ],
  },
];

interface PresetPanelProps {
  onLoadPreset: (expressions: string[]) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export default function PresetPanel({ onLoadPreset, isOpen, onToggle }: PresetPanelProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const toggleCategory = (title: string) => {
    setExpandedCategory(prev => prev === title ? null : title);
  };

  return (
    <div className="w-full">
      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider text-amber-400/80 hover:text-amber-300 hover:bg-amber-400/10 transition-all active:scale-95"
      >
        <span className="material-symbols-outlined text-sm">auto_awesome</span>
        <span>IIT Madras Presets</span>
        <span 
          className="material-symbols-outlined text-xs transition-transform duration-300"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          expand_more
        </span>
      </button>

      {/* Presets Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1 max-h-[300px] overflow-y-auto scrollbar-hide pr-1">
              {PRESET_CATEGORIES.map((category) => (
                <div key={category.title} className="rounded-xl overflow-hidden">
                  {/* Category Header */}
                  <button
                    onClick={() => toggleCategory(category.title)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 bg-white/[0.02] hover:bg-white/[0.04] transition-all rounded-xl"
                  >
                    <div 
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${category.color}15` }}
                    >
                      <span 
                        className="material-symbols-outlined text-[16px]"
                        style={{ color: category.color }}
                      >
                        {category.icon}
                      </span>
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <span className="text-[12px] font-semibold text-white/80">{category.title}</span>
                    </div>
                    <span 
                      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                      style={{ 
                        color: category.color, 
                        backgroundColor: `${category.color}15` 
                      }}
                    >
                      {category.weekTag}
                    </span>
                    <span 
                      className="material-symbols-outlined text-xs text-white/30 transition-transform duration-200 shrink-0"
                      style={{ transform: expandedCategory === category.title ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    >
                      expand_more
                    </span>
                  </button>

                  {/* Presets List */}
                  <AnimatePresence>
                    {expandedCategory === category.title && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="pl-4 pr-2 py-1 space-y-0.5">
                          {category.presets.map((preset, idx) => (
                            <button
                              key={idx}
                              onClick={() => onLoadPreset(preset.expressions)}
                              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-all group text-left"
                            >
                              <span className="text-[10px] text-white/20 font-mono w-4 shrink-0">{idx + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-semibold text-white/70 group-hover:text-white/90 transition-colors truncate">
                                  {preset.name}
                                </p>
                                {preset.description && (
                                  <p className="text-[9px] text-white/30 font-mono truncate mt-0.5">
                                    {preset.description}
                                  </p>
                                )}
                              </div>
                              <span className="material-symbols-outlined text-[14px] text-white/10 group-hover:text-white/40 transition-colors shrink-0">
                                add_circle
                              </span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
