import { useRef, useEffect } from 'react';

const FUNCTION_COLORS = [
  { hex: '#c9a96e', name: 'Gold' },
  { hex: '#f43f5e', name: 'Rose' },
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#22c55e', name: 'Green' },
  { hex: '#a855f7', name: 'Purple' },
];

export interface FunctionEntry {
  id: string;
  expression: string;
  colorIndex: number;
  visible: boolean;
  isValid: boolean;
}

interface FunctionInputProps {
  entry: FunctionEntry;
  index: number;
  isActive: boolean;
  onExpressionChange: (id: string, expression: string) => void;
  onToggleVisibility: (id: string) => void;
  onRemove: (id: string) => void;
  onFocus: (id: string) => void;
  onInsertSymbol?: string; // when this changes, insert at cursor
}

export { FUNCTION_COLORS };

export default function FunctionInput({ 
  entry, 
  index, 
  isActive,
  onExpressionChange, 
  onToggleVisibility, 
  onRemove,
  onFocus,
}: FunctionInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const color = FUNCTION_COLORS[entry.colorIndex % FUNCTION_COLORS.length];

  // Expose input ref for symbol insertion
  useEffect(() => {
    if (isActive && inputRef.current) {
      // Don't force focus on mount — only when user explicitly selects
    }
  }, [isActive]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputRef.current?.blur();
    }
  };

  return (
    <div 
      className={`group flex items-center gap-2 px-3 py-2 rounded-xl transition-all duration-200 ${
        isActive 
          ? 'bg-white/[0.06] border border-white/10' 
          : 'bg-white/[0.02] border border-transparent hover:border-white/5'
      }`}
      onClick={() => {
        onFocus(entry.id);
        inputRef.current?.focus();
      }}
    >
      {/* Color Indicator */}
      <div 
        className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white/10 transition-shadow"
        style={{ 
          backgroundColor: entry.visible ? color.hex : 'transparent',
          borderColor: color.hex,
          border: entry.visible ? 'none' : `2px solid ${color.hex}`,
          boxShadow: entry.visible ? `0 0 8px ${color.hex}40` : 'none',
        }}
      />

      {/* Function Label */}
      <span className="text-[11px] font-mono text-white/40 shrink-0 w-8">
        f{index + 1}=
      </span>

      {/* Expression Input */}
      <input
        ref={inputRef}
        type="text"
        value={entry.expression}
        onChange={(e) => onExpressionChange(entry.id, e.target.value)}
        onFocus={() => onFocus(entry.id)}
        onKeyDown={handleKeyDown}
        placeholder="e.g. x^2 + 2x - 3"
        className={`flex-1 bg-transparent text-sm font-mono outline-none focus:outline-none focus-visible:outline-none focus:ring-0 placeholder-white/20 transition-colors min-w-0 ${
          !entry.expression 
            ? 'text-white/60' 
            : entry.isValid 
              ? 'text-white/90' 
              : 'text-red-400'
        }`}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
      />

      {/* Validation Indicator */}
      {entry.expression && (
        <span className={`text-[10px] shrink-0 ${entry.isValid ? 'text-green-400/60' : 'text-red-400/60'}`}>
          {entry.isValid ? '✓' : '✗'}
        </span>
      )}

      {/* Visibility Toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisibility(entry.id);
        }}
        className={`p-1 rounded-lg transition-all shrink-0 ${
          entry.visible 
            ? 'text-white/50 hover:text-white/80 hover:bg-white/5' 
            : 'text-white/20 hover:text-white/40 hover:bg-white/5'
        }`}
        title={entry.visible ? 'Hide function' : 'Show function'}
      >
        <span className="material-symbols-outlined text-[16px]">
          {entry.visible ? 'visibility' : 'visibility_off'}
        </span>
      </button>

      {/* Remove Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(entry.id);
        }}
        className="p-1 rounded-lg text-white/20 hover:text-red-400/80 hover:bg-red-400/10 transition-all shrink-0 opacity-0 group-hover:opacity-100"
        title="Remove function"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}
