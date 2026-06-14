import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CollageFrame {
  id: string;
  colStart: number;
  colEnd: number;
  rowStart: number;
  rowEnd: number;
}

export interface CollageLayoutConfig {
  gridSize: number;
  frames: CollageFrame[];
}

interface CollageBuilderProps {
  onSave: (config: CollageLayoutConfig) => void;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function genId() {
  return Math.random().toString(36).slice(2, 10);
}

const GRID_SIZES = [30, 50, 75, 100];
const FRAME_COLORS = [
  'rgba(212,175,55,0.25)',
  'rgba(99,102,241,0.22)',
  'rgba(236,72,153,0.20)',
  'rgba(34,197,94,0.22)',
  'rgba(249,115,22,0.22)',
  'rgba(14,165,233,0.22)',
];

// ── CollageBuilder ─────────────────────────────────────────────────────────────
export default function CollageBuilder({ onSave, onClose }: CollageBuilderProps) {
  const [gridSize, setGridSize] = useState(50);
  const [frames, setFrames] = useState<CollageFrame[]>([]);
  const [dragging, setDragging] = useState<{ colStart: number; rowStart: number; colEnd: number; rowEnd: number } | null>(null);
  
  // Selection and Resize state
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [resizing, setResizing] = useState<{
    frameId: string;
    handle: 't' | 'b' | 'l' | 'r' | 'tl' | 'tr' | 'bl' | 'br';
    startColStart: number;
    startColEnd: number;
    startRowStart: number;
    startRowEnd: number;
    startCol: number;
    startRow: number;
  } | null>(null);
  const [moving, setMoving] = useState<{
    frameId: string;
    startColStart: number;
    startColEnd: number;
    startRowStart: number;
    startRowEnd: number;
    startCol: number;
    startRow: number;
  } | null>(null);
  const [copiedFrame, setCopiedFrame] = useState<Omit<CollageFrame, 'id'> | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);



  // ── Grid cell from mouse position ──
  const getCellFromEvent = useCallback((
    e: React.MouseEvent | MouseEvent,
    clamp = false
  ): { col: number; row: number } | null => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    let col = Math.floor((relX / rect.width) * gridSize) + 1;
    let row = Math.floor((relY / rect.height) * gridSize) + 1;
    if (clamp) {
      col = Math.max(1, Math.min(col, gridSize));
      row = Math.max(1, Math.min(row, gridSize));
      return { col, row };
    }
    if (col < 1 || col > gridSize || row < 1 || row > gridSize) return null;
    return { col, row };
  }, [gridSize]);

  // ── Resize Mousemove/Mouseup Handler ──
  useEffect(() => {
    if (!resizing) return;

    const handleMouseMoveGlobal = (e: MouseEvent) => {
      const cell = getCellFromEvent(e, true);
      if (!cell) return;

      const dCol = cell.col - resizing.startCol;
      const dRow = cell.row - resizing.startRow;

      let colStart = resizing.startColStart;
      let colEnd = resizing.startColEnd;
      let rowStart = resizing.startRowStart;
      let rowEnd = resizing.startRowEnd;

      const minSize = 2;

      // Adjust column boundaries
      if (resizing.handle.includes('l')) {
        colStart = resizing.startColStart + dCol;
        colStart = Math.max(1, Math.min(colStart, resizing.startColEnd - minSize));
      } else if (resizing.handle.includes('r')) {
        colEnd = resizing.startColEnd + dCol;
        colEnd = Math.max(resizing.startColStart + minSize, Math.min(colEnd, gridSize + 1));
      }

      // Adjust row boundaries
      if (resizing.handle.includes('t')) {
        rowStart = resizing.startRowStart + dRow;
        rowStart = Math.max(1, Math.min(rowStart, resizing.startRowEnd - minSize));
      } else if (resizing.handle.includes('b')) {
        rowEnd = resizing.startRowEnd + dRow;
        rowEnd = Math.max(resizing.startRowStart + minSize, Math.min(rowEnd, gridSize + 1));
      }

      setFrames(prev => prev.map(f => {
        if (f.id !== resizing.frameId) return f;
        return { ...f, colStart, colEnd, rowStart, rowEnd };
      }));
    };

    const handleMouseUpGlobal = () => {
      setResizing(null);
    };

    window.addEventListener('mousemove', handleMouseMoveGlobal);
    window.addEventListener('mouseup', handleMouseUpGlobal);

    return () => {
      window.removeEventListener('mousemove', handleMouseMoveGlobal);
      window.removeEventListener('mouseup', handleMouseUpGlobal);
    };
  }, [resizing, gridSize, getCellFromEvent]);

  // ── Move Mousemove/Mouseup Handler ──
  useEffect(() => {
    if (!moving) return;

    const handleMouseMoveGlobal = (e: MouseEvent) => {
      const cell = getCellFromEvent(e, true);
      if (!cell) return;

      const dCol = cell.col - moving.startCol;
      const dRow = cell.row - moving.startRow;

      const width = moving.startColEnd - moving.startColStart;
      const height = moving.startRowEnd - moving.startRowStart;

      let colStart = moving.startColStart + dCol;
      let colEnd = colStart + width;
      let rowStart = moving.startRowStart + dRow;
      let rowEnd = rowStart + height;

      // Snapped translation within boundaries
      if (colStart < 1) {
        colStart = 1;
        colEnd = colStart + width;
      }
      if (colEnd > gridSize + 1) {
        colEnd = gridSize + 1;
        colStart = colEnd - width;
      }

      if (rowStart < 1) {
        rowStart = 1;
        rowEnd = rowStart + height;
      }
      if (rowEnd > gridSize + 1) {
        rowEnd = gridSize + 1;
        rowStart = rowEnd - height;
      }

      setFrames(prev => prev.map(f => {
        if (f.id !== moving.frameId) return f;
        return { ...f, colStart, colEnd, rowStart, rowEnd };
      }));
    };

    const handleMouseUpGlobal = () => {
      setMoving(null);
    };

    window.addEventListener('mousemove', handleMouseMoveGlobal);
    window.addEventListener('mouseup', handleMouseUpGlobal);

    return () => {
      window.removeEventListener('mousemove', handleMouseMoveGlobal);
      window.removeEventListener('mouseup', handleMouseUpGlobal);
    };
  }, [moving, gridSize, getCellFromEvent]);

  const handleResizeStart = (
    e: React.MouseEvent,
    frameId: string,
    handle: 't' | 'b' | 'l' | 'r' | 'tl' | 'tr' | 'bl' | 'br'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const cell = getCellFromEvent(e, true);
    if (!cell) return;

    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;

    setResizing({
      frameId,
      handle,
      startColStart: frame.colStart,
      startColEnd: frame.colEnd,
      startRowStart: frame.rowStart,
      startRowEnd: frame.rowEnd,
      startCol: cell.col,
      startRow: cell.row,
    });
  };

  const handleFrameMouseDown = (e: React.MouseEvent, frameId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedFrameId(frameId);

    const cell = getCellFromEvent(e, true);
    if (!cell) return;

    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;

    setMoving({
      frameId,
      startColStart: frame.colStart,
      startColEnd: frame.colEnd,
      startRowStart: frame.rowStart,
      startRowEnd: frame.rowEnd,
      startCol: cell.col,
      startRow: cell.row,
    });
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setSelectedFrameId(null);
    const cell = getCellFromEvent(e);
    if (!cell) return;
    isDraggingRef.current = true;
    setDragging({ colStart: cell.col, rowStart: cell.row, colEnd: cell.col, rowEnd: cell.row });
  }, [getCellFromEvent]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current || !dragging) return;
    const cell = getCellFromEvent(e);
    if (!cell) return;
    setDragging(prev => prev ? { ...prev, colEnd: cell.col, rowEnd: cell.row } : null);
  }, [dragging, getCellFromEvent]);

  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current || !dragging) return;
    isDraggingRef.current = false;

    const colStart = Math.min(dragging.colStart, dragging.colEnd);
    const colEnd = Math.max(dragging.colStart, dragging.colEnd) + 1;
    const rowStart = Math.min(dragging.rowStart, dragging.rowEnd);
    const rowEnd = Math.max(dragging.rowStart, dragging.rowEnd) + 1;

    // Minimum 2x2 cells
    if ((colEnd - colStart) < 2 || (rowEnd - rowStart) < 2) {
      setDragging(null);
      return;
    }

    if (frames.length >= 10) {
      setDragging(null);
      return;
    }

    const newFrame = { id: genId(), colStart, colEnd, rowStart, rowEnd };
    setFrames(prev => [...prev, newFrame]);
    setSelectedFrameId(newFrame.id); // Auto-select newly created frame
    setDragging(null);
  }, [dragging, frames.length]);

  const deleteFrame = useCallback((id: string) => {
    setFrames(prev => prev.filter(f => f.id !== id));
    setSelectedFrameId(prev => prev === id ? null : prev);
  }, []);

  const centerFrame = useCallback((id: string) => {
    setFrames(prev => prev.map(f => {
      if (f.id !== id) return f;
      const width = f.colEnd - f.colStart;
      const height = f.rowEnd - f.rowStart;
      
      const newColStart = Math.floor((gridSize + 1 - width) / 2) + 1;
      const newColEnd = newColStart + width;
      
      const newRowStart = Math.floor((gridSize + 1 - height) / 2) + 1;
      const newRowEnd = newRowStart + height;
      
      return {
        ...f,
        colStart: newColStart,
        colEnd: newColEnd,
        rowStart: newRowStart,
        rowEnd: newRowEnd
      };
    }));
  }, [gridSize]);

  const handleCopy = useCallback((frameId: string) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    setCopiedFrame({
      colStart: frame.colStart,
      colEnd: frame.colEnd,
      rowStart: frame.rowStart,
      rowEnd: frame.rowEnd,
    });
  }, [frames]);

  const handlePaste = useCallback(() => {
    if (!copiedFrame) return;
    if (frames.length >= 10) return;

    const newFrame = {
      id: genId(),
      colStart: copiedFrame.colStart,
      colEnd: copiedFrame.colEnd,
      rowStart: copiedFrame.rowStart,
      rowEnd: copiedFrame.rowEnd,
    };

    setFrames(prev => [...prev, newFrame]);
    setSelectedFrameId(newFrame.id); // Auto-select pasted frame
  }, [copiedFrame, frames.length]);

  const handleSave = useCallback(() => {
    if (frames.length === 0) return;
    onSave({ gridSize, frames });
  }, [frames, gridSize, onSave]);

  const handleGridSizeChange = (size: number) => {
    setGridSize(size);
    setFrames([]);
    setDragging(null);
    setSelectedFrameId(null);
    setResizing(null);
    setMoving(null);
    setCopiedFrame(null);
  };

  // Keyboard shortcuts and nudging
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      // If no frame is selected, ignore other shortcuts
      if (!selectedFrameId) return;

      const frameIndex = frames.findIndex(f => f.id === selectedFrameId);
      if (frameIndex === -1) return;

      // Ctrl+C / Cmd+C: Copy
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopy(selectedFrameId);
        return;
      }

      // Ctrl+V / Cmd+V: Paste
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePaste();
        return;
      }

      // Delete or Backspace: Delete frame
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteFrame(selectedFrameId);
        return;
      }

      // 'c' or 'C': Center frame
      if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        centerFrame(selectedFrameId);
        return;
      }

      // Arrow keys: Move or Resize
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = 1;

        setFrames(prev => prev.map(f => {
          if (f.id !== selectedFrameId) return f;

          let { colStart, colEnd, rowStart, rowEnd } = f;
          const width = colEnd - colStart;
          const height = rowEnd - rowStart;

          if (e.shiftKey) {
            // Resize (adjust right/bottom edge)
            if (e.key === 'ArrowRight') {
              colEnd = Math.min(gridSize + 1, colEnd + step);
            } else if (e.key === 'ArrowLeft') {
              colEnd = Math.max(colStart + 2, colEnd - step);
            } else if (e.key === 'ArrowDown') {
              rowEnd = Math.min(gridSize + 1, rowEnd + step);
            } else if (e.key === 'ArrowUp') {
              rowEnd = Math.max(rowStart + 2, rowEnd - step);
            }
          } else {
            // Move entire frame
            if (e.key === 'ArrowRight') {
              colStart = Math.min(gridSize + 1 - width, colStart + step);
              colEnd = colStart + width;
            } else if (e.key === 'ArrowLeft') {
              colStart = Math.max(1, colStart - step);
              colEnd = colStart + width;
            } else if (e.key === 'ArrowDown') {
              rowStart = Math.min(gridSize + 1 - height, rowStart + step);
              rowEnd = rowStart + height;
            } else if (e.key === 'ArrowUp') {
              rowStart = Math.max(1, rowStart - step);
              rowEnd = rowStart + height;
            }
          }

          return { ...f, colStart, colEnd, rowStart, rowEnd };
        }));
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, selectedFrameId, copiedFrame, frames, handleCopy, handlePaste, centerFrame, deleteFrame, gridSize]);

  // ── Percentage positions for frame preview overlay ──
  const frameToStyle = (f: { id?: string; colStart: number; colEnd: number; rowStart: number; rowEnd: number }, idx: number) => {
    const left = ((f.colStart - 1) / gridSize) * 100;
    const top = ((f.rowStart - 1) / gridSize) * 100;
    const width = ((f.colEnd - f.colStart) / gridSize) * 100;
    const height = ((f.rowEnd - f.rowStart) / gridSize) * 100;
    const isSelected = selectedFrameId === f.id;
    return {
      left: `${left}%`,
      top: `${top}%`,
      width: `${width}%`,
      height: `${height}%`,
      background: FRAME_COLORS[idx % FRAME_COLORS.length],
      border: `2px solid ${FRAME_COLORS[idx % FRAME_COLORS.length].replace('0.25', '0.8').replace('0.22', '0.8').replace('0.20', '0.8')}`,
      boxShadow: isSelected ? '0 0 0 2px rgba(255, 255, 255, 0.45), 0 12px 28px rgba(0,0,0,0.5)' : 'none',
      zIndex: isSelected ? 30 : 10,
    };
  };

  const content = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[500] bg-[#0d0d14] flex flex-col select-none"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 bg-[#13131e] shrink-0">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[var(--gold)]">dashboard_customize</span>
          <div>
            <h2 className="text-white font-semibold text-base leading-tight">Collage Builder</h2>
            <p className="text-white/40 text-xs">Drag on the grid to place image frames</p>
          </div>
        </div>

        {/* Grid Size Selector */}
        <div className="flex items-center gap-2">
          <span className="text-white/40 text-xs mr-1">Grid</span>
          {GRID_SIZES.map(size => (
            <button
              key={size}
              onClick={() => handleGridSizeChange(size)}
              className={`px-3 py-1 rounded-full text-xs font-mono font-bold transition-all duration-200 ${
                gridSize === size
                  ? 'bg-[var(--gold)] text-[#0d0d14]'
                  : 'bg-white/8 text-white/50 hover:bg-white/15 hover:text-white'
              }`}
            >
              {size}×{size}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <span className={`text-xs font-mono px-2 py-0.5 rounded ${frames.length > 0 ? 'text-[var(--gold)] bg-[var(--gold)]/10' : 'text-white/30'}`}>
            {frames.length} frame{frames.length !== 1 ? 's' : ''} placed
          </span>
          {selectedFrameId && (
            <>
              <button
                onClick={() => centerFrame(selectedFrameId)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/8 text-white/80 hover:bg-white/15 hover:text-white transition-all border border-white/8 active:scale-95"
              >
                <span className="material-symbols-outlined text-[13px]">filter_center_focus</span>
                Center
              </button>
              <button
                onClick={() => handleCopy(selectedFrameId)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/8 text-white/80 hover:bg-white/15 hover:text-white transition-all border border-white/8 active:scale-95"
              >
                <span className="material-symbols-outlined text-[13px]">content_copy</span>
                Copy
              </button>
            </>
          )}
          {copiedFrame && (
            <button
              onClick={handlePaste}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/20 transition-all border border-[var(--gold)]/20 active:scale-95"
            >
              <span className="material-symbols-outlined text-[13px]">content_paste</span>
              Paste
            </button>
          )}
          {frames.length > 0 && (
            <button
              onClick={() => setFrames([])}
              className="text-xs text-white/40 hover:text-red-400 transition-colors px-2 py-1 rounded"
            >
              Clear all
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={frames.length === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 ${
              frames.length > 0
                ? 'bg-[var(--gold)] text-[#0d0d14] hover:brightness-110 active:scale-95'
                : 'bg-white/8 text-white/30 cursor-not-allowed'
            }`}
          >
            <span className="material-symbols-outlined text-base">check</span>
            Save Layout
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/8 hover:bg-white/15 text-white/50 hover:text-white flex items-center justify-center transition-all"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      </div>

      {/* ── Main Grid Area ── */}
      <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
        <div className="relative aspect-[3/4] h-full max-h-full" style={{ maxWidth: 'calc(100% * 3/4)' }}>
          {/* Corner labels */}
          <div className="absolute -top-5 -left-1 text-[10px] text-white/25 font-mono">0,0</div>
          <div className="absolute -top-5 -right-1 text-[10px] text-white/25 font-mono">{gridSize},0</div>
          <div className="absolute -bottom-5 -left-1 text-[10px] text-white/25 font-mono">0,{gridSize}</div>
          <div className="absolute -bottom-5 -right-1 text-[10px] text-white/25 font-mono">{gridSize},{gridSize}</div>

          {/* Grid canvas */}
          <div
            ref={gridRef}
            className="absolute inset-0 cursor-crosshair rounded-2xl overflow-hidden border border-white/10"
            style={{
              backgroundImage: `
                linear-gradient(to right, rgba(154,134,86,0.20) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(154,134,86,0.20) 1px, transparent 1px),
                linear-gradient(to right, rgba(154,134,86,0.06) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(154,134,86,0.06) 1px, transparent 1px)
              `,
              backgroundSize: `${100 / (gridSize / 10)}% ${100 / (gridSize / 10)}%, ${100 / (gridSize / 10)}% ${100 / (gridSize / 10)}%, ${100 / gridSize}% ${100 / gridSize}%, ${100 / gridSize}% ${100 / gridSize}%`,
              background: '#1a1a26',
              backgroundRepeat: 'repeat',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              if (isDraggingRef.current) {
                isDraggingRef.current = false;
                setDragging(null);
              }
            }}
          >
            {/* Grid lines overlay */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: `
                  linear-gradient(to right, rgba(154,134,86,0.18) 1px, transparent 1px),
                  linear-gradient(to bottom, rgba(154,134,86,0.18) 1px, transparent 1px)
                `,
                backgroundSize: `${100 / gridSize * 10}% ${100 / gridSize * 10}%, ${100 / gridSize * 10}% ${100 / gridSize * 10}%`,
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: `
                  linear-gradient(to right, rgba(154,134,86,0.06) 1px, transparent 1px),
                  linear-gradient(to bottom, rgba(154,134,86,0.06) 1px, transparent 1px)
                `,
                backgroundSize: `${100 / gridSize}% ${100 / gridSize}%, ${100 / gridSize}% ${100 / gridSize}%`,
              }}
            />

            {/* Placed frames */}
            {frames.map((f, idx) => {
              const isSelected = selectedFrameId === f.id;
              const handleBorderColor = FRAME_COLORS[idx % FRAME_COLORS.length]
                .replace('0.25', '1')
                .replace('0.22', '1')
                .replace('0.20', '1');

              return (
                <div
                  key={f.id}
                  onMouseDown={(e) => handleFrameMouseDown(e, f.id)}
                  className={`absolute rounded-[3px] flex items-start justify-between p-1.5 group/frame transition-all duration-150 ${
                    isSelected ? 'ring-2 ring-white/20' : ''
                  }`}
                  style={frameToStyle(f, idx)}
                >
                  {/* Frame number badge */}
                  <div className="flex items-center gap-1 pointer-events-none">
                    <span className="text-[10px] font-mono font-bold text-white/80 bg-black/30 px-1.5 py-0.5 rounded leading-none">
                      {idx + 1}
                    </span>
                  </div>
                  {/* Delete button */}
                  <button
                    onMouseDown={(e) => { e.stopPropagation(); deleteFrame(f.id); }}
                    className="w-5 h-5 rounded-full bg-black/40 text-white/60 hover:text-white hover:bg-red-500/60 flex items-center justify-center transition-all opacity-0 group-hover/frame:opacity-100 z-10"
                  >
                    <span className="material-symbols-outlined text-[11px]">close</span>
                  </button>
                  {/* Size label */}
                  <div className="absolute bottom-1 right-1.5 text-[9px] font-mono text-white/40 pointer-events-none">
                    {f.colEnd - f.colStart}×{f.rowEnd - f.rowStart}
                  </div>

                  {/* Center & Copy Toolbar (placed top-left outside of the square) */}
                  {isSelected && (
                    <div 
                      className={`absolute flex items-center gap-1 z-30 bg-[#13131e]/95 border border-white/12 p-0.5 rounded shadow-lg pointer-events-auto ${
                        f.rowStart === 1 ? '-bottom-8 left-0' : '-top-8 left-0'
                      }`}
                    >
                      <button
                        onMouseDown={(e) => { e.stopPropagation(); centerFrame(f.id); }}
                        className="px-1.5 py-0.5 rounded hover:bg-[var(--gold)] hover:text-[#0d0d14] text-white/90 text-[10px] font-semibold flex items-center gap-1 transition-all"
                      >
                        <span className="material-symbols-outlined text-[11px] leading-none">filter_center_focus</span>
                        Center
                      </button>
                      <button
                        onMouseDown={(e) => { e.stopPropagation(); handleCopy(f.id); }}
                        className="px-1.5 py-0.5 rounded hover:bg-[var(--gold)] hover:text-[#0d0d14] text-white/90 text-[10px] font-semibold flex items-center gap-1 transition-all"
                      >
                        <span className="material-symbols-outlined text-[11px] leading-none">content_copy</span>
                        Copy
                      </button>
                    </div>
                  )}

                  {/* Resize Handles */}
                  {isSelected && (
                    <>
                      {/* Corner Handles */}
                      <div
                        onMouseDown={(e) => handleResizeStart(e, f.id, 'tl')}
                        className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full cursor-nwse-resize z-40 shadow-lg transition-transform hover:scale-125 border-2"
                        style={{ borderColor: handleBorderColor }}
                      />
                      <div
                        onMouseDown={(e) => handleResizeStart(e, f.id, 'tr')}
                        className="absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full cursor-nesw-resize z-40 shadow-lg transition-transform hover:scale-125 border-2"
                        style={{ borderColor: handleBorderColor }}
                      />
                      <div
                        onMouseDown={(e) => handleResizeStart(e, f.id, 'bl')}
                        className="absolute bottom-0 left-0 -translate-x-1/2 translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full cursor-nesw-resize z-40 shadow-lg transition-transform hover:scale-125 border-2"
                        style={{ borderColor: handleBorderColor }}
                      />
                      <div
                        onMouseDown={(e) => handleResizeStart(e, f.id, 'br')}
                        className="absolute bottom-0 right-0 translate-x-1/2 translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full cursor-nwse-resize z-40 shadow-lg transition-transform hover:scale-125 border-2"
                        style={{ borderColor: handleBorderColor }}
                      />

                      {/* Edge Handles */}
                      <div
                        onMouseDown={(e) => handleResizeStart(e, f.id, 't')}
                        className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-2 bg-white rounded-full cursor-ns-resize z-40 shadow-md transition-transform hover:scale-125 border"
                        style={{ borderColor: handleBorderColor }}
                      />
                      <div
                        onMouseDown={(e) => handleResizeStart(e, f.id, 'b')}
                        className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-4 h-2 bg-white rounded-full cursor-ns-resize z-40 shadow-md transition-transform hover:scale-125 border"
                        style={{ borderColor: handleBorderColor }}
                      />
                      <div
                        onMouseDown={(e) => handleResizeStart(e, f.id, 'l')}
                        className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 w-2 h-4 bg-white rounded-full cursor-ew-resize z-40 shadow-md transition-transform hover:scale-125 border"
                        style={{ borderColor: handleBorderColor }}
                      />
                      <div
                        onMouseDown={(e) => handleResizeStart(e, f.id, 'r')}
                        className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-2 h-4 bg-white rounded-full cursor-ew-resize z-40 shadow-md transition-transform hover:scale-125 border"
                        style={{ borderColor: handleBorderColor }}
                      />
                    </>
                  )}
                </div>
              );
            })}

            {/* Live drag preview */}
            {dragging && (() => {
              const colStart = Math.min(dragging.colStart, dragging.colEnd);
              const colEnd = Math.max(dragging.colStart, dragging.colEnd) + 1;
              const rowStart = Math.min(dragging.rowStart, dragging.rowEnd);
              const rowEnd = Math.max(dragging.rowStart, dragging.rowEnd) + 1;
              return (
                <div
                  className="absolute rounded-[3px] pointer-events-none"
                  style={{
                    left: `${((colStart - 1) / gridSize) * 100}%`,
                    top: `${((rowStart - 1) / gridSize) * 100}%`,
                    width: `${((colEnd - colStart) / gridSize) * 100}%`,
                    height: `${((rowEnd - rowStart) / gridSize) * 100}%`,
                    background: 'rgba(212,175,55,0.15)',
                    border: '1.5px dashed rgba(212,175,55,0.7)',
                  }}
                >
                  <span className="absolute top-1 left-1.5 text-[9px] font-mono text-[var(--gold)]/80">
                    {colEnd - colStart}×{rowEnd - rowStart}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ── Footer hint ── */}
      <div className="text-center pb-4 text-white/25 text-xs font-mono shrink-0">
        Click and drag to draw • Click a frame to select & resize (Ctrl+C to Copy, Ctrl+V to Paste) • Click × to delete • Max 10 frames
      </div>
    </motion.div>
  );

  return createPortal(
    <AnimatePresence>{content}</AnimatePresence>,
    document.body
  );
}
