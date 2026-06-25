import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface AnalysisToolbarProps {
  showDerivatives: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  onToggleSnapToGrid: () => void;
  gridSpacing: string;
  onGridSpacingChange: (spacing: string) => void;
  onToggleDerivatives: () => void;
  onToggleGrid: () => void;
  onResetView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  domain: [number, number];
  range: [number, number];
  onDomainChange: (domain: [number, number]) => void;
  onRangeChange: (range: [number, number]) => void;
}

export default function AnalysisToolbar({
  showDerivatives,
  showGrid,
  snapToGrid,
  onToggleSnapToGrid,
  gridSpacing,
  onGridSpacingChange,
  onToggleDerivatives,
  onToggleGrid,
  onResetView,
  onZoomIn,
  onZoomOut,
  domain,
  range,
  onDomainChange,
  onRangeChange,
}: AnalysisToolbarProps) {

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Toggle Buttons Row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Derivative Toggle */}
        <ToggleButton
          active={showDerivatives}
          onClick={onToggleDerivatives}
          icon="timeline"
          label="f'(x)"
          tooltip="Show derivative curves (dashed)"
          activeColor="#f59e0b"
        />

        {/* Grid Toggle */}
        <ToggleButton
          active={showGrid}
          onClick={onToggleGrid}
          icon="grid_on"
          label="Grid"
          tooltip="Toggle grid lines"
          activeColor="#06b6d4"
        />

        {/* Snap to Grid Toggle */}
        <ToggleButton
          active={snapToGrid}
          onClick={onToggleSnapToGrid}
          icon="adjust"
          label="Snap"
          tooltip="Snap points to nearest grid/integer values"
          activeColor="#22c55e"
        />
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-white/10 mx-1" />

      {/* Grid Spacing Option Selector */}
      <div className="flex items-center gap-1 bg-white/[0.02] border border-white/5 rounded-lg p-0.5">
        {['auto', '1', '2', '5'].map((sp) => (
          <button
            key={sp}
            onClick={() => onGridSpacingChange(sp)}
            className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider rounded transition-all outline-none focus:outline-none ${
              gridSpacing === sp
                ? 'bg-cyan-500/20 text-cyan-300 font-extrabold border border-cyan-500/30'
                : 'text-white/40 hover:text-white/70 hover:bg-white/5 border border-transparent'
            }`}
          >
            {sp === 'auto' ? 'Auto' : `${sp} U`}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-white/10 mx-1" />

      {/* Zoom Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onZoomIn}
          className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/5 transition-all active:scale-90"
          title="Zoom in"
        >
          <span className="material-symbols-outlined text-[18px]">zoom_in</span>
        </button>
        <button
          onClick={onZoomOut}
          className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/5 transition-all active:scale-90"
          title="Zoom out"
        >
          <span className="material-symbols-outlined text-[18px]">zoom_out</span>
        </button>
        <button
          onClick={onResetView}
          className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/5 transition-all active:scale-90"
          title="Reset view to default"
        >
          <span className="material-symbols-outlined text-[18px]">center_focus_strong</span>
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-white/10 mx-1" />

      {/* Domain/Range Quick Inputs */}
      <div className="flex items-center gap-2 flex-wrap">
        <DomainInput 
          label="x" 
          min={domain[0]} 
          max={domain[1]} 
          onMinChange={(v) => onDomainChange([v, domain[1]])}
          onMaxChange={(v) => onDomainChange([domain[0], v])}
        />
        <DomainInput 
          label="y" 
          min={range[0]} 
          max={range[1]} 
          onMinChange={(v) => onRangeChange([v, range[1]])}
          onMaxChange={(v) => onRangeChange([range[0], v])}
        />
      </div>
    </div>
  );
}

// ── Toggle Button Sub-component ──
interface ToggleButtonProps {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  tooltip: string;
  activeColor: string;
}

function ToggleButton({ active, onClick, icon, label, tooltip, activeColor }: ToggleButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
        active
          ? 'border'
          : 'text-white/40 hover:text-white/60 bg-white/[0.02] hover:bg-white/[0.04] border border-transparent'
      }`}
      style={active ? {
        color: activeColor,
        backgroundColor: `${activeColor}15`,
        borderColor: `${activeColor}30`,
      } : undefined}
      title={tooltip}
    >
      <span className="material-symbols-outlined text-[14px]">{icon}</span>
      <span>{label}</span>
    </motion.button>
  );
}

// ── Domain/Range Input Sub-component ──
interface DomainInputProps {
  label: string;
  min: number;
  max: number;
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
}

function DomainInput({ label, min, max, onMinChange, onMaxChange }: DomainInputProps) {
  const [minStr, setMinStr] = useState(min.toString());
  const [maxStr, setMaxStr] = useState(max.toString());

  // Sync with prop updates (e.g. zooming)
  useEffect(() => {
    setMinStr(min.toString());
  }, [min]);

  useEffect(() => {
    setMaxStr(max.toString());
  }, [max]);

  const handleMinBlur = () => {
    const val = parseFloat(minStr);
    if (!isNaN(val) && val < max) {
      onMinChange(val);
    } else {
      setMinStr(min.toString()); // Revert to valid prop val
    }
  };

  const handleMaxBlur = () => {
    const val = parseFloat(maxStr);
    if (!isNaN(val) && val > min) {
      onMaxChange(val);
    } else {
      setMaxStr(max.toString()); // Revert to valid prop val
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, type: 'min' | 'max') => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (type === 'min') {
        handleMinBlur();
      } else {
        handleMaxBlur();
      }
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-mono text-white/30">{label}:</span>
      <input
        type="text"
        value={minStr}
        onChange={(e) => setMinStr(e.target.value)}
        onBlur={handleMinBlur}
        onKeyDown={(e) => handleKeyDown(e, 'min')}
        className="w-12 px-1.5 py-1 bg-white/[0.04] border border-white/5 rounded text-[10px] font-mono text-white/60 outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus:border-white/20 text-center"
        autoComplete="off"
      />
      <span className="text-white/20 text-[10px]">→</span>
      <input
        type="text"
        value={maxStr}
        onChange={(e) => setMaxStr(e.target.value)}
        onBlur={handleMaxBlur}
        onKeyDown={(e) => handleKeyDown(e, 'max')}
        className="w-12 px-1.5 py-1 bg-white/[0.04] border border-white/5 rounded text-[10px] font-mono text-white/60 outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus:border-white/20 text-center"
        autoComplete="off"
      />
    </div>
  );
}
