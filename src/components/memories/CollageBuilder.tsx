import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useMediaFolders } from '../../hooks/useMediaFolders';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CollageFrame {
  id: string;
  colStart: number;
  colEnd: number;
  rowStart: number;
  rowEnd: number;
  borderRadius?: number;
  zIndex?: number;
}

export interface CollageLayoutConfig {
  gridSize: number;
  frames: CollageFrame[];
  bgColor?: string;
  imageSources?: {
    folders: string[];
    includeFavorites: boolean;
    includeMemories: boolean;
  };
  borderRadius?: number;
}


interface CollageBuilderProps {
  onSave: (config: CollageLayoutConfig) => void;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function isLightColor(hex: string) {
  if (!hex || hex.length < 7) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma > 180;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
}

function hsvToHex(h: number, s: number, v: number): string {
  s /= 100;
  v /= 100;
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  const toHex = (c: number) => {
    const hex = Math.round(c * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number) => {
    const hex = Math.max(0, Math.min(255, c)).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const GRID_SIZES = [30, 50, 75, 100];
const BG_COLORS = [
  { name: 'Warm Cream', value: '#f4f0e6', isLight: true },
  { name: 'Soft Ivory', value: '#faf8f5', isLight: true },
  { name: 'True White', value: '#ffffff', isLight: true },
  { name: 'Pastel Rose', value: '#f5ebe6', isLight: true },
  { name: 'Soft Mint', value: '#e8ece1', isLight: true },
  { name: 'Midnight Dark', value: '#14141d', isLight: false },
  { name: 'Warm Chocolate', value: '#1e1212', isLight: false },
  { name: 'Deep Forest', value: '#121e16', isLight: false },
];
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
  const { folders } = useMediaFolders();
  const [gridSize, setGridSize] = useState(50);
  const [frames, setFrames] = useState<CollageFrame[]>([]);
  const [bgColor, setBgColor] = useState('#f4f0e6');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [dragging, setDragging] = useState<{ colStart: number; rowStart: number; colEnd: number; rowEnd: number } | null>(null);
  
  const [imageSources, setImageSources] = useState<{
    folders: string[];
    includeFavorites: boolean;
    includeMemories: boolean;
  }>({
    folders: [],
    includeFavorites: true,
    includeMemories: true,
  });
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(false);
  const [isChangingRadius, setIsChangingRadius] = useState(false);
  const [isDrawerExpanded, setIsDrawerExpanded] = useState(false);
  const dragControls = useDragControls();

  // Selection and Resize state
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);

  // Reset drawer state when selection changes
  useEffect(() => {
    if (selectedFrameId) {
      setIsDrawerExpanded(false);
    }
  }, [selectedFrameId]);
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
  const selectedFrame = frames.find(f => f.id === selectedFrameId);

  const [isMobile, setIsMobile] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  // Check mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      setIsPanelOpen(!mobile);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const gridRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);



  // ── Grid cell from pointer position ──
  const getCellFromEvent = useCallback((
    e: React.MouseEvent | MouseEvent | React.PointerEvent | PointerEvent,
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

  // ── Resize Pointermove/Pointerup Handler ──
  useEffect(() => {
    if (!resizing) return;

    const handleMouseMoveGlobal = (e: PointerEvent) => {
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

    window.addEventListener('pointermove', handleMouseMoveGlobal);
    window.addEventListener('pointerup', handleMouseUpGlobal);

    return () => {
      window.removeEventListener('pointermove', handleMouseMoveGlobal);
      window.removeEventListener('pointerup', handleMouseUpGlobal);
    };
  }, [resizing, gridSize, getCellFromEvent]);

  // ── Move Pointermove/Pointerup Handler ──
  useEffect(() => {
    if (!moving) return;

    const handleMouseMoveGlobal = (e: PointerEvent) => {
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

    window.addEventListener('pointermove', handleMouseMoveGlobal);
    window.addEventListener('pointerup', handleMouseUpGlobal);

    return () => {
      window.removeEventListener('pointermove', handleMouseMoveGlobal);
      window.removeEventListener('pointerup', handleMouseUpGlobal);
    };
  }, [moving, gridSize, getCellFromEvent]);

  const handleResizeStart = (
    e: React.PointerEvent,
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

  const handleFrameMouseDown = (e: React.PointerEvent, frameId: string) => {
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

  const handleMouseDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setSelectedFrameId(null);
    const cell = getCellFromEvent(e);
    if (!cell) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      console.error('Failed to set pointer capture:', err);
    }

    isDraggingRef.current = true;
    setDragging({ colStart: cell.col, rowStart: cell.row, colEnd: cell.col, rowEnd: cell.row });
  }, [getCellFromEvent]);

  const handleMouseMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current || !dragging) return;
    const cell = getCellFromEvent(e);
    if (!cell) return;
    setDragging(prev => prev ? { ...prev, colEnd: cell.col, rowEnd: cell.row } : null);
  }, [dragging, getCellFromEvent]);

  const handleMouseUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current || !dragging) return;
    isDraggingRef.current = false;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {
      // ignore
    }

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

    const newFrame = { id: genId(), colStart, colEnd, rowStart, rowEnd, borderRadius: 4, zIndex: 10 + frames.length };
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

  const moveLayer = useCallback((frameId: string, direction: 'front' | 'back' | 'forward' | 'backward') => {
    setFrames(prev => {
      // Assign explicit zIndices if missing
      const list = prev.map((f, idx) => ({
        ...f,
        zIndex: f.zIndex !== undefined ? f.zIndex : 10 + idx
      }));

      const sorted = [...list].sort((a, b) => a.zIndex - b.zIndex);
      const targetIdx = sorted.findIndex(f => f.id === frameId);
      if (targetIdx === -1) return prev;

      const [targetFrame] = sorted.splice(targetIdx, 1);

      if (direction === 'front') {
        sorted.push(targetFrame);
      } else if (direction === 'back') {
        sorted.unshift(targetFrame);
      } else if (direction === 'forward') {
        const newIdx = Math.min(sorted.length, targetIdx + 1);
        sorted.splice(newIdx, 0, targetFrame);
      } else if (direction === 'backward') {
        const newIdx = Math.max(0, targetIdx - 1);
        sorted.splice(newIdx, 0, targetFrame);
      }

      return sorted.map((f, idx) => ({
        ...f,
        zIndex: 10 + idx
      }));
    });
  }, []);

  const handleCopy = useCallback((frameId: string) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    setCopiedFrame({
      colStart: frame.colStart,
      colEnd: frame.colEnd,
      rowStart: frame.rowStart,
      rowEnd: frame.rowEnd,
      borderRadius: frame.borderRadius,
      zIndex: frame.zIndex,
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
      borderRadius: copiedFrame.borderRadius,
      zIndex: 10 + frames.length,
    };

    setFrames(prev => [...prev, newFrame]);
    setSelectedFrameId(newFrame.id); // Auto-select pasted frame
  }, [copiedFrame, frames.length]);

  const handleSave = useCallback(() => {
    if (frames.length === 0) return;
    onSave({ gridSize, frames, bgColor, imageSources });
  }, [frames, gridSize, bgColor, imageSources, onSave]);

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
  const frameToStyle = (f: { id?: string; colStart: number; colEnd: number; rowStart: number; rowEnd: number; zIndex?: number }, idx: number) => {
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
      zIndex: isSelected ? 30 : (f.zIndex !== undefined ? f.zIndex : 10 + idx),
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
            <h2 className="text-white font-semibold text-sm md:text-base leading-tight">Collage Builder</h2>
            <p className="text-white/40 text-xs hidden sm:block">Drag on the grid to place image frames</p>
          </div>
        </div>

        {/* Grid Size Selector (Desktop/Tablet) */}
        <div className="hidden md:flex items-center gap-2">
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

        {/* Header Actions (Close Button) */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/8 hover:bg-white/15 text-white/50 hover:text-white flex items-center justify-center transition-all"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      </div>

      {/* ── Main Grid Area ── */}
      <div className="flex-1 relative flex items-center justify-center p-4 sm:p-8 overflow-hidden">
        {/* Mobile Sidebar Toggle Floating Button */}
        {isMobile && (
          <button
            onClick={() => setIsPanelOpen(prev => !prev)}
            className={`absolute top-4 left-4 z-[560] w-10 h-10 rounded-full flex items-center justify-center shadow-lg border backdrop-blur-md transition-all duration-300 active:scale-95 ${
              isPanelOpen 
                ? 'bg-[var(--gold)] text-[#0d0d14] border-[var(--gold)]/20' 
                : 'bg-[#13131e]/90 text-[var(--gold)] border-white/10'
            }`}
            title={isPanelOpen ? "Close panel" : "Open panel"}
          >
            <span className="material-symbols-outlined text-[20px]">
              {isPanelOpen ? 'left_panel_close' : 'left_panel_open'}
            </span>
          </button>
        )}
        {/* Backdrop overlay for mobile drawer setting */}
        {isMobile && isPanelOpen && (
          <div 
            onClick={() => setIsPanelOpen(false)} 
            className="fixed inset-0 bg-black/60 z-[550] backdrop-blur-sm transition-opacity duration-200"
          />
        )}

        {/* Floating Actions Panel */}
        <AnimatePresence>
          {isPanelOpen && (
            <motion.div
              initial={isMobile ? { x: '-100%' } : { opacity: 0, x: -20 }}
              animate={isMobile ? { x: 0 } : { opacity: 1, x: 0 }}
              exit={isMobile ? { x: '-100%' } : { opacity: 0, x: -20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className={
                isMobile
                  ? "fixed top-0 left-0 h-full w-[300px] z-[600] bg-[#13131e]/95 backdrop-blur-3xl border-r border-white/5 p-6 shadow-2xl flex flex-col gap-6 overflow-y-auto text-left scrollbar-hide"
                  : "absolute top-6 left-6 bottom-6 z-40 bg-[#13131e]/90 backdrop-blur-2xl border border-white/5 rounded-[2.5rem] p-6 w-[320px] shadow-2xl flex flex-col gap-6 overflow-y-auto text-left scrollbar-hide"
              }
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-serif italic text-xl text-white">Collage</h3>
                  <p className="font-label text-[10px] uppercase tracking-widest text-white/50">Builder Settings</p>
                </div>
                {isMobile && (
                  <button
                    onClick={() => setIsPanelOpen(false)}
                    className="w-10 h-10 rounded-full bg-white/5 text-white/50 flex items-center justify-center hover:bg-white/10 transition-colors"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                )}
              </div>

              {/* Selected Frame Layer Arrangement */}
              {!isMobile && (
                <div>
                  <div className="flex justify-between items-end mb-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold block">Arrangement</span>
                  <span className="text-[10px] text-[var(--gold)] font-mono font-bold">
                    {selectedFrameId && selectedFrame ? `Layer ${selectedFrame.zIndex !== undefined ? selectedFrame.zIndex - 9 : frames.findIndex(f => f.id === selectedFrameId) + 1}` : 'No Selection'}
                  </span>
                </div>
                <div className={`grid grid-cols-4 gap-2 transition-opacity duration-300 ${!selectedFrameId ? 'opacity-40' : ''}`}>
                  <button
                    disabled={!selectedFrameId}
                    onClick={() => selectedFrameId && moveLayer(selectedFrameId, 'front')}
                    className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl text-[8px] font-bold bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-all border border-white/5 active:scale-95 disabled:cursor-not-allowed"
                    title="Bring to Front"
                  >
                    <span className="material-symbols-outlined text-[16px]">flip_to_front</span>
                    Front
                  </button>
                  <button
                    disabled={!selectedFrameId}
                    onClick={() => selectedFrameId && moveLayer(selectedFrameId, 'forward')}
                    className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl text-[8px] font-bold bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-all border border-white/5 active:scale-95 disabled:cursor-not-allowed"
                    title="Bring Forward"
                  >
                    <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                    Up
                  </button>
                  <button
                    disabled={!selectedFrameId}
                    onClick={() => selectedFrameId && moveLayer(selectedFrameId, 'backward')}
                    className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl text-[8px] font-bold bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-all border border-white/5 active:scale-95 disabled:cursor-not-allowed"
                    title="Send Backward"
                  >
                    <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                    Down
                  </button>
                  <button
                    disabled={!selectedFrameId}
                    onClick={() => selectedFrameId && moveLayer(selectedFrameId, 'back')}
                    className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl text-[8px] font-bold bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-all border border-white/5 active:scale-95 disabled:cursor-not-allowed"
                    title="Send to Back"
                  >
                    <span className="material-symbols-outlined text-[16px]">flip_to_back</span>
                    Back
                  </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between p-4 rounded-3xl bg-white/5 border border-transparent">
                <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold">Canvas Limit</span>
                <span className="text-[10px] text-[var(--gold)] bg-[var(--gold)]/10 px-2 py-1 rounded-full font-bold tracking-widest">
                  {frames.length}/10
                </span>
              </div>

              {/* Background Color Selector */}
              <div>
                <div className="flex justify-between items-end mb-4">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold block">Background</span>
                  <span className="text-[9px] text-[var(--gold)] italic font-mono uppercase tracking-widest">
                    {bgColor}
                  </span>
                </div>

                {/* Preset circles */}
                <div className="grid grid-cols-6 gap-2 mb-3">
                  {BG_COLORS.map(color => {
                    const isSelected = bgColor.toLowerCase() === color.value.toLowerCase();
                    return (
                      <button
                        key={color.value}
                        onClick={() => setBgColor(color.value)}
                        className={`w-8 h-8 md:w-9 md:h-9 rounded-full cursor-pointer relative transition-all mx-auto flex items-center justify-center ${
                          isSelected ? 'scale-110' : 'hover:scale-105 opacity-80 hover:opacity-100'
                        }`}
                        style={{ 
                          backgroundColor: color.value,
                          boxShadow: isSelected ? `0 0 15px ${color.value}66` : 'none',
                          border: isSelected ? `2px solid white` : '2px solid transparent'
                        }}
                        title={color.name}
                      >
                        {isSelected && (
                          <span 
                            className="material-symbols-outlined text-[15px] font-bold"
                            style={{ color: color.isLight ? '#000' : '#fff' }}
                          >
                            check
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {/* Custom Color Selector */}
                  {(() => {
                    const isCurated = BG_COLORS.some(c => c.value.toLowerCase() === bgColor.toLowerCase());
                    const customTextLight = isLightColor(bgColor);
                    return (
                      <button 
                        onClick={() => setShowColorPicker(true)}
                        className={`w-8 h-8 md:w-9 md:h-9 rounded-full cursor-pointer relative transition-all mx-auto flex items-center justify-center ${
                          !isCurated ? 'scale-110' : 'hover:scale-105 opacity-80 hover:opacity-100'
                        }`}
                        style={{ 
                          background: !isCurated ? bgColor : 'conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red)',
                          boxShadow: !isCurated ? `0 0 15px ${bgColor}66` : 'none',
                          border: !isCurated ? `2px solid white` : '2px solid transparent'
                        }}
                        title="Choose custom color"
                      >
                        {!isCurated ? (
                          <span 
                            className="material-symbols-outlined text-[15px] font-bold"
                            style={{ color: customTextLight ? '#000' : '#fff' }}
                          >
                            check
                          </span>
                        ) : (
                          <span className="material-symbols-outlined text-[15px] text-white/90">
                            palette
                          </span>
                        )}
                      </button>
                    );
                  })()}
                </div>
              </div>

              {/* Frame Corners (Border Radius) Selector */}
              {!isMobile && (
                <div>
                  <div className="flex justify-between items-end mb-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold block">Frame Corners</span>
                  <span className="text-[10px] text-[var(--gold)] font-mono font-bold">
                    {selectedFrameId && selectedFrame ? `${selectedFrame.borderRadius !== undefined ? selectedFrame.borderRadius : 4}px` : 'No Frame Selected'}
                  </span>
                </div>
                <div className={`flex items-center gap-3 bg-white/5 border border-white/5 p-4 rounded-3xl transition-opacity duration-300 ${!selectedFrameId ? 'opacity-40' : ''}`}>
                  <span className="material-symbols-outlined text-[18px] text-white/40">rounded_corner</span>
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="2"
                    disabled={!selectedFrameId}
                    value={selectedFrameId && selectedFrame ? (selectedFrame.borderRadius !== undefined ? selectedFrame.borderRadius : 4) : 4}
                    onPointerDown={() => setIsChangingRadius(true)}
                    onPointerUp={() => setIsChangingRadius(false)}
                    onChange={(e) => {
                      const newRadius = Number(e.target.value);
                      setFrames(prev => prev.map(f => {
                        if (f.id === selectedFrameId) {
                          return { ...f, borderRadius: newRadius };
                        }
                        return f;
                      }));
                    }}
                    className="flex-1 accent-[var(--gold)] bg-white/10 h-1 rounded-lg cursor-pointer appearance-none outline-none disabled:cursor-not-allowed"
                  />
                </div>
                  {!selectedFrameId && (
                    <p className="text-[9px] text-white/30 italic mt-1.5 px-2">Select a frame on the canvas to adjust its corners.</p>
                  )}
                </div>
              )}

              {/* Photo Sources Selector */}
              <div>
                <div 
                  onClick={() => setIsSourcesExpanded(!isSourcesExpanded)}
                  className="flex items-center justify-between p-4 rounded-3xl cursor-pointer transition-all border bg-white/5 border-transparent hover:bg-white/10 group mb-2"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold group-hover:text-[var(--gold)] transition-colors">Photo Sources</span>
                    <span className="text-[9px] text-[var(--gold)] italic truncate max-w-[150px]">
                      {(() => {
                        const parts = [];
                        if (imageSources.includeMemories) parts.push("Memories");
                        if (imageSources.includeFavorites) parts.push("Favorites");
                        if (imageSources.folders.length > 0) parts.push(`${imageSources.folders.length} Folder${imageSources.folders.length > 1 ? 's' : ''}`);
                        return parts.join(", ") || "None";
                      })()}
                    </span>
                  </div>
                  <span className={`material-symbols-outlined text-[20px] text-white/50 transition-transform duration-300 ${isSourcesExpanded ? 'rotate-180' : ''}`}>
                    keyboard_arrow_down
                  </span>
                </div>
                
                <AnimatePresence>
                  {isSourcesExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-col gap-3 pt-2 pb-2">
                        {/* Memories Switch */}
                        <div
                          onClick={() => setImageSources(prev => {
                            const next = { ...prev, includeMemories: !prev.includeMemories };
                            if (!next.includeMemories && !next.includeFavorites && next.folders.length === 0) return prev;
                            return next;
                          })}
                          className={`flex justify-between items-center p-4 rounded-3xl cursor-pointer transition-all border ${
                            imageSources.includeMemories ? 'bg-[var(--gold)]/5 border-[var(--gold)]/20' : 'bg-white/5 border-transparent opacity-60 hover:opacity-80'
                          }`}
                        >
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold flex items-center gap-2">
                              <span className="material-symbols-outlined text-[14px]">photo_library</span>
                              Memories
                            </span>
                          </div>
                          <div className={`w-10 h-5 rounded-full relative transition-all duration-500 ${imageSources.includeMemories ? 'bg-[var(--gold)]' : 'bg-black/40'}`}>
                            <div className={`absolute top-1 w-3 h-3 rounded-full transition-all duration-500 ${imageSources.includeMemories ? 'right-1 bg-black shadow-glow' : 'left-1 bg-white/20'}`} />
                          </div>
                        </div>

                        {/* Favorites Switch */}
                        <div
                          onClick={() => setImageSources(prev => {
                            const next = { ...prev, includeFavorites: !prev.includeFavorites };
                            if (!next.includeMemories && !next.includeFavorites && next.folders.length === 0) return prev;
                            return next;
                          })}
                          className={`flex justify-between items-center p-4 rounded-3xl cursor-pointer transition-all border ${
                            imageSources.includeFavorites ? 'bg-[var(--gold)]/5 border-[var(--gold)]/20' : 'bg-white/5 border-transparent opacity-60 hover:opacity-80'
                          }`}
                        >
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold flex items-center gap-2">
                              <span className="material-symbols-outlined text-[14px]">favorite</span>
                              Favorites
                            </span>
                          </div>
                          <div className={`w-10 h-5 rounded-full relative transition-all duration-500 ${imageSources.includeFavorites ? 'bg-[var(--gold)]' : 'bg-black/40'}`}>
                            <div className={`absolute top-1 w-3 h-3 rounded-full transition-all duration-500 ${imageSources.includeFavorites ? 'right-1 bg-black shadow-glow' : 'left-1 bg-white/20'}`} />
                          </div>
                        </div>

                        {/* Folders List */}
                        {folders.length > 0 && (
                          <div className="mt-2 bg-black/20 rounded-3xl p-3 border border-white/5">
                            <span className="text-[9px] text-white/40 uppercase tracking-[0.2em] font-bold block mb-3 px-2">Specific Folders</span>
                            <div className="max-h-[140px] overflow-y-auto flex flex-col gap-2 scrollbar-hide pr-1">
                              {folders.map(folder => {
                                const isSelected = imageSources.folders.includes(folder.id);
                                return (
                                  <div
                                    key={folder.id}
                                    onClick={() => {
                                      setImageSources(prev => {
                                        const nextFolders = isSelected
                                          ? prev.folders.filter(id => id !== folder.id)
                                          : [...prev.folders, folder.id];
                                        const next = { ...prev, folders: nextFolders };
                                        if (!next.includeMemories && !next.includeFavorites && next.folders.length === 0) return prev;
                                        return next;
                                      });
                                    }}
                                    className={`flex justify-between items-center p-3 rounded-2xl cursor-pointer transition-all duration-300 ${
                                      isSelected ? 'bg-[var(--gold)]/10 text-[var(--gold)] shadow-inner shadow-[var(--gold)]/5' : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2.5 truncate">
                                      <span className={`material-symbols-outlined text-[16px] flex-shrink-0 ${isSelected ? 'text-[var(--gold)]' : 'text-white/40'}`}>
                                        {isSelected ? 'folder_open' : 'folder'}
                                      </span>
                                      <span className="text-[10px] uppercase tracking-[0.1em] font-bold truncate">{folder.name}</span>
                                    </div>
                                    <span className={`material-symbols-outlined text-[16px] transition-all duration-300 ${isSelected ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}>
                                      check_circle
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Grid Size Selector (Mobile only) */}
              {isMobile && (
                <div>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold block mb-4">Grid Size</span>
                  <div className="grid grid-cols-2 gap-2">
                    {GRID_SIZES.map(size => (
                      <button
                        key={size}
                        onClick={() => handleGridSizeChange(size)}
                        className={`py-3 rounded-[1.25rem] text-[11px] uppercase tracking-widest font-bold transition-all duration-300 border ${
                          gridSize === size
                            ? 'bg-[var(--gold)]/10 text-[var(--gold)] border-[var(--gold)]/20'
                            : 'bg-white/5 text-white/50 border-transparent hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {size} × {size}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3 pt-2 mt-auto">
                {/* Save Layout Button */}
                <button
                  onClick={handleSave}
                  disabled={frames.length === 0}
                  className={`flex items-center justify-center gap-2 w-full py-4 rounded-3xl text-[11px] uppercase tracking-[0.15em] font-bold transition-all duration-500 ${
                    frames.length > 0
                      ? 'bg-white text-black hover:scale-[1.02] active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.2)]'
                      : 'bg-white/5 text-white/30 cursor-not-allowed'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  Save Collage
                </button>

                {/* Clear All Button */}
                {frames.length > 0 && (
                  <button
                    onClick={() => setFrames([])}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-3xl text-[10px] uppercase tracking-[0.15em] font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors border border-red-500/20 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
                    Clear Canvas
                  </button>
                )}
              </div>

              {/* Selected Frame Controls */}
              {selectedFrameId && !isMobile && (() => {
                const idx = frames.findIndex(f => f.id === selectedFrameId);
                if (idx === -1) return null;
                return (
                  <div className="mt-2 pt-6 border-t border-white/5 flex flex-col gap-3">
                    <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold block text-center">Selected Frame</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => centerFrame(selectedFrameId)}
                        className="flex flex-col items-center justify-center gap-1 py-3 rounded-3xl text-[9px] uppercase tracking-widest font-bold bg-white/5 text-white/80 hover:bg-white/10 hover:text-white transition-all border border-white/5 active:scale-95"
                      >
                        <span className="material-symbols-outlined text-[16px]">filter_center_focus</span>
                        Center
                      </button>
                      <button
                        onClick={() => handleCopy(selectedFrameId)}
                        className="flex flex-col items-center justify-center gap-1 py-3 rounded-3xl text-[9px] uppercase tracking-widest font-bold bg-white/5 text-white/80 hover:bg-white/10 hover:text-white transition-all border border-white/5 active:scale-95"
                      >
                        <span className="material-symbols-outlined text-[16px]">content_copy</span>
                        Copy
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Clipboard Paste Controls */}
              {copiedFrame && (
                <div className="mt-2 pt-6 border-t border-white/5 flex flex-col gap-3">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--gold)] font-bold block text-center">Clipboard Ready</span>
                  <button
                    onClick={handlePaste}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-3xl text-[10px] uppercase tracking-[0.15em] font-bold bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/20 transition-all border border-[var(--gold)]/20 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[16px]">content_paste</span>
                    Paste Frame
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile Bottom Edit Panel for Selected Frame */}
        <AnimatePresence>
          {isMobile && selectedFrameId && !isPanelOpen && (() => {
            const selectedFrame = frames.find(f => f.id === selectedFrameId);
            if (!selectedFrame) return null;
            return (
              <motion.div
                drag="y"
                dragListener={false}
                dragControls={dragControls}
                dragConstraints={isDrawerExpanded ? { top: 0, bottom: 230 } : { top: -230, bottom: 0 }}
                dragElastic={0.1}
                variants={{
                  collapsed: { y: 230 },
                  expanded: { y: 0 }
                }}
                initial="collapsed"
                animate={isDrawerExpanded ? "expanded" : "collapsed"}
                exit="collapsed"
                onDragEnd={(_, info) => {
                  if (isDrawerExpanded) {
                    if (info.offset.y > 50 || info.velocity.y > 300) {
                      setIsDrawerExpanded(false);
                    }
                  } else {
                    if (info.offset.y < -50 || info.velocity.y < -300) {
                      setIsDrawerExpanded(true);
                    }
                  }
                }}
                transition={{ type: 'spring', damping: 25, stiffness: 220 }}
                className="fixed bottom-0 left-0 right-0 h-[290px] z-[550] bg-[#13131e]/95 backdrop-blur-3xl border-t border-white/10 rounded-t-[2.5rem] px-5 pt-2 pb-8 shadow-[0_-20px_40px_rgba(0,0,0,0.5)] flex flex-col gap-4 overflow-hidden"
              >
                {/* Drag handle header */}
                <div
                  onPointerDown={(e) => dragControls.start(e)}
                  onClick={() => setIsDrawerExpanded(!isDrawerExpanded)}
                  className="w-full py-2 flex flex-col items-center cursor-grab active:cursor-grabbing touch-none select-none"
                >
                  <div className="w-12 h-1.5 bg-white/15 rounded-full mb-3 transition-colors hover:bg-white/30" />
                  <div className="flex items-center justify-between w-full px-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold">Edit Frame</span>
                      <span className="material-symbols-outlined text-[16px] text-white/50 transition-transform duration-300" style={{ transform: isDrawerExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                        keyboard_arrow_up
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--gold)] font-mono font-bold bg-[var(--gold)]/10 px-2 py-0.5 rounded-full">
                      Layer {selectedFrame.zIndex !== undefined ? selectedFrame.zIndex - 9 : frames.findIndex(f => f.id === selectedFrameId) + 1}
                    </span>
                  </div>
                </div>

                {/* Arrangement */}
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => moveLayer(selectedFrameId, 'front')}
                    className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl text-[9px] font-bold bg-white/5 text-white/70 hover:bg-white/10 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[18px]">flip_to_front</span>
                    Front
                  </button>
                  <button
                    onClick={() => moveLayer(selectedFrameId, 'forward')}
                    className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl text-[9px] font-bold bg-white/5 text-white/70 hover:bg-white/10 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                    Up
                  </button>
                  <button
                    onClick={() => moveLayer(selectedFrameId, 'backward')}
                    className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl text-[9px] font-bold bg-white/5 text-white/70 hover:bg-white/10 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                    Down
                  </button>
                  <button
                    onClick={() => moveLayer(selectedFrameId, 'back')}
                    className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl text-[9px] font-bold bg-white/5 text-white/70 hover:bg-white/10 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[18px]">flip_to_back</span>
                    Back
                  </button>
                </div>

                {/* Center & Copy */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => centerFrame(selectedFrameId)}
                    className="flex items-center justify-center gap-2 py-3 rounded-2xl text-[10px] font-bold bg-white/5 text-white/80 hover:bg-white/10 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[16px]">filter_center_focus</span>
                    Center
                  </button>
                  <button
                    onClick={() => handleCopy(selectedFrameId)}
                    className="flex items-center justify-center gap-2 py-3 rounded-2xl text-[10px] font-bold bg-white/5 text-white/80 hover:bg-white/10 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[16px]">content_copy</span>
                    Copy
                  </button>
                </div>

                {/* Border Radius Slider */}
                <div className="bg-white/5 border border-white/5 p-3.5 rounded-2xl flex items-center gap-3 mt-1">
                  <span className="material-symbols-outlined text-[18px] text-white/40">rounded_corner</span>
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="2"
                    value={selectedFrame.borderRadius !== undefined ? selectedFrame.borderRadius : 4}
                    onPointerDown={() => setIsChangingRadius(true)}
                    onPointerUp={() => setIsChangingRadius(false)}
                    onChange={(e) => {
                      const newRadius = Number(e.target.value);
                      setFrames(prev => prev.map(f => f.id === selectedFrameId ? { ...f, borderRadius: newRadius } : f));
                    }}
                    className="flex-1 accent-[var(--gold)] bg-white/10 h-1 rounded-lg cursor-pointer appearance-none outline-none"
                  />
                  <span className="text-[10px] text-[var(--gold)] font-mono w-6 text-right">
                    {selectedFrame.borderRadius !== undefined ? selectedFrame.borderRadius : 4}
                  </span>
                </div>
              </motion.div>
            );
          })()}
        </AnimatePresence>

        <div 
          className="relative aspect-[3/4] md:aspect-square w-full md:h-full max-h-full"
          style={{ 
            maxWidth: isMobile ? 'calc(100vw - 32px)' : 'calc(100vh - 180px)',
            maxHeight: isMobile ? 'calc((100vw - 32px) * 4/3)' : 'calc(100vh - 180px)'
          }}
        >
          {/* Corner labels */}
          <div className="absolute -top-5 -left-1 text-[10px] text-white/25 font-mono">0,0</div>
          <div className="absolute -top-5 -right-1 text-[10px] text-white/25 font-mono">{gridSize},0</div>
          <div className="absolute -bottom-5 -left-1 text-[10px] text-white/25 font-mono">0,{gridSize}</div>
          <div className="absolute -bottom-5 -right-1 text-[10px] text-white/25 font-mono">{gridSize},{gridSize}</div>

          {/* Grid canvas */}
          <div
            ref={gridRef}
            className="absolute inset-0 cursor-crosshair rounded-2xl overflow-hidden border border-white/10 touch-none"
            style={{
              backgroundImage: `
                linear-gradient(to right, rgba(154,134,86,0.20) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(154,134,86,0.20) 1px, transparent 1px),
                linear-gradient(to right, rgba(154,134,86,0.06) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(154,134,86,0.06) 1px, transparent 1px)
              `,
              backgroundSize: `${100 / (gridSize / 10)}% ${100 / (gridSize / 10)}%, ${100 / (gridSize / 10)}% ${100 / (gridSize / 10)}%, ${100 / gridSize}% ${100 / gridSize}%, ${100 / gridSize}% ${100 / gridSize}%`,
              backgroundColor: bgColor,
              backgroundRepeat: 'repeat',
              touchAction: 'none'
            }}
            onPointerDown={handleMouseDown}
            onPointerMove={handleMouseMove}
            onPointerUp={handleMouseUp}
            onPointerCancel={(e) => {
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch (err) {}
              isDraggingRef.current = false;
              setDragging(null);
            }}
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
                  onPointerDown={(e) => handleFrameMouseDown(e, f.id)}
                  className={`absolute flex items-start justify-between p-1.5 group/frame transition-all duration-150 touch-none ${
                    isSelected && !isChangingRadius ? 'ring-2 ring-white/20' : ''
                  }`}
                  style={{ 
                    ...frameToStyle(f, idx), 
                    borderRadius: `${f.borderRadius !== undefined ? f.borderRadius : 4}px`, 
                    boxShadow: isSelected && !isChangingRadius ? '0 0 0 2px rgba(255, 255, 255, 0.45), 0 12px 28px rgba(0,0,0,0.5)' : 'none',
                    touchAction: 'none' 
                  }}
                >
                  {/* Frame number badge */}
                  {!isChangingRadius && (
                    <div className="flex items-center gap-1 pointer-events-none">
                      <span className="text-[10px] font-mono font-bold text-white/80 bg-black/30 px-1.5 py-0.5 rounded leading-none">
                        {idx + 1}
                      </span>
                    </div>
                  )}
                  {/* Delete button */}
                  {!isChangingRadius && (
                    <button
                      onPointerDown={(e) => { e.stopPropagation(); deleteFrame(f.id); }}
                      className="w-5 h-5 rounded-full bg-black/40 text-white/60 hover:text-white hover:bg-red-500/60 flex items-center justify-center transition-all opacity-0 group-hover/frame:opacity-100 z-10"
                    >
                      <span className="material-symbols-outlined text-[11px]">close</span>
                    </button>
                  )}
                  {/* Size label */}
                  {!isChangingRadius && (
                    <div className="absolute bottom-1 left-1.5 text-[9px] font-mono text-white/40 pointer-events-none">
                      {f.colEnd - f.colStart}×{f.rowEnd - f.rowStart}
                    </div>
                  )}

                  {/* Center & Copy Toolbar (placed top-left outside of the square) */}
                  {isSelected && !isChangingRadius && (
                    <div 
                      className={`absolute flex items-center gap-1 z-30 bg-[#13131e]/95 border border-white/12 p-0.5 rounded shadow-lg pointer-events-auto ${
                        f.rowStart === 1 ? '-bottom-8 left-0' : '-top-8 left-0'
                      }`}
                    >
                      <button
                        onPointerDown={(e) => { e.stopPropagation(); centerFrame(f.id); }}
                        className="px-1.5 py-0.5 rounded hover:bg-[var(--gold)] hover:text-[#0d0d14] text-white/90 text-[10px] font-semibold flex items-center gap-1 transition-all"
                      >
                        <span className="material-symbols-outlined text-[11px] leading-none">filter_center_focus</span>
                        Center
                      </button>
                      <button
                        onPointerDown={(e) => { e.stopPropagation(); handleCopy(f.id); }}
                        className="px-1.5 py-0.5 rounded hover:bg-[var(--gold)] hover:text-[#0d0d14] text-white/90 text-[10px] font-semibold flex items-center gap-1 transition-all"
                      >
                        <span className="material-symbols-outlined text-[11px] leading-none">content_copy</span>
                        Copy
                      </button>
                    </div>
                  )}

                  {/* Resize Handles */}
                  {isSelected && !isChangingRadius && (
                    <>
                      {/* Corner Handles */}
                      <div
                        onPointerDown={(e) => handleResizeStart(e, f.id, 'tl')}
                        className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full cursor-nwse-resize z-40 shadow-lg transition-transform hover:scale-125 border-2"
                        style={{ borderColor: handleBorderColor }}
                      />
                      <div
                        onPointerDown={(e) => handleResizeStart(e, f.id, 'tr')}
                        className="absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full cursor-nesw-resize z-40 shadow-lg transition-transform hover:scale-125 border-2"
                        style={{ borderColor: handleBorderColor }}
                      />
                      <div
                        onPointerDown={(e) => handleResizeStart(e, f.id, 'bl')}
                        className="absolute bottom-0 left-0 -translate-x-1/2 translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full cursor-nesw-resize z-40 shadow-lg transition-transform hover:scale-125 border-2"
                        style={{ borderColor: handleBorderColor }}
                      />
                      <div
                        onPointerDown={(e) => handleResizeStart(e, f.id, 'br')}
                        className="absolute bottom-0 right-0 translate-x-1/2 translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full cursor-nwse-resize z-40 shadow-lg transition-transform hover:scale-125 border-2"
                        style={{ borderColor: handleBorderColor }}
                      />

                      {/* Edge Handles */}
                      <div
                        onPointerDown={(e) => handleResizeStart(e, f.id, 't')}
                        className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-2 bg-white rounded-full cursor-ns-resize z-40 shadow-md transition-transform hover:scale-125 border"
                        style={{ borderColor: handleBorderColor }}
                      />
                      <div
                        onPointerDown={(e) => handleResizeStart(e, f.id, 'b')}
                        className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-4 h-2 bg-white rounded-full cursor-ns-resize z-40 shadow-md transition-transform hover:scale-125 border"
                        style={{ borderColor: handleBorderColor }}
                      />
                      <div
                        onPointerDown={(e) => handleResizeStart(e, f.id, 'l')}
                        className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 w-2 h-4 bg-white rounded-full cursor-ew-resize z-40 shadow-md transition-transform hover:scale-125 border"
                        style={{ borderColor: handleBorderColor }}
                      />
                      <div
                        onPointerDown={(e) => handleResizeStart(e, f.id, 'r')}
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
                  className="absolute pointer-events-none"
                  style={{
                    left: `${((colStart - 1) / gridSize) * 100}%`,
                    top: `${((rowStart - 1) / gridSize) * 100}%`,
                    width: `${((colEnd - colStart) / gridSize) * 100}%`,
                    height: `${((rowEnd - rowStart) / gridSize) * 100}%`,
                    background: 'rgba(212,175,55,0.15)',
                    border: '1.5px dashed rgba(212,175,55,0.7)',
                    borderRadius: '4px',
                  }}
                >
                  <span className="absolute bottom-1 left-1.5 text-[9px] font-mono text-[var(--gold)]/80">
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
    <>
      <AnimatePresence>{content}</AnimatePresence>
      <AnimatePresence>
        {showColorPicker && (
          <CustomColorPickerModal
            initialColor={bgColor}
            onClose={() => setShowColorPicker(false)}
            onChange={(newHex) => setBgColor(newHex)}
          />
        )}
      </AnimatePresence>
    </>,
    document.body
  );
}

// ── CustomColorPickerModal Component ──────────────────────────────────────────
interface CustomColorPickerModalProps {
  initialColor: string;
  onClose: () => void;
  onChange: (color: string) => void;
}

function CustomColorPickerModal({ initialColor, onClose, onChange }: CustomColorPickerModalProps) {
  const [hsv, setHsv] = useState(() => hexToHsv(initialColor));
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v);
  const { r, g, b } = hexToRgb(currentHex);

  const updateHsv = (newHsv: Partial<{ h: number; s: number; v: number }>) => {
    setHsv(prev => {
      const updated = { ...prev, ...newHsv };
      onChange(hsvToHex(updated.h, updated.s, updated.v));
      return updated;
    });
  };

  // Saturation/Value Dragging
  const handleSvPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}
    handleSvMove(e);
  };

  const handleSvMove = (e: React.PointerEvent | PointerEvent) => {
    if (!svRef.current) return;
    const rect = svRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    const s = Math.round((x / rect.width) * 100);
    const v = Math.round((1 - y / rect.height) * 100);
    updateHsv({ s, v });
  };

  const handleSvPointerMove = (e: React.PointerEvent) => {
    if (e.buttons > 0) {
      handleSvMove(e);
    }
  };

  // Hue Dragging
  const handleHuePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}
    handleHueMove(e);
  };

  const handleHueMove = (e: React.PointerEvent | PointerEvent) => {
    if (!hueRef.current) return;
    const rect = hueRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const h = Math.round((x / rect.width) * 360);
    updateHsv({ h: h === 360 ? 0 : h });
  };

  const handleHuePointerMove = (e: React.PointerEvent) => {
    if (e.buttons > 0) {
      handleHueMove(e);
    }
  };

  // Input Value Syncs
  const handleRgbChange = (channel: 'r' | 'g' | 'b', valStr: string) => {
    const cleanVal = valStr.replace(/\D/g, '');
    const num = Math.min(255, parseInt(cleanVal) || 0);
    const newR = channel === 'r' ? num : r;
    const newG = channel === 'g' ? num : g;
    const newB = channel === 'b' ? num : b;
    const hex = rgbToHex(newR, newG, newB);
    setHsv(hexToHsv(hex));
    onChange(hex);
  };

  const handleHexChange = (hexStr: string) => {
    let cleanHex = hexStr;
    if (!cleanHex.startsWith('#')) {
      cleanHex = '#' + cleanHex;
    }
    if (cleanHex.length <= 7) {
      if (cleanHex.length === 7 && /^#[0-9A-Fa-f]{6}$/.test(cleanHex)) {
        setHsv(hexToHsv(cleanHex));
        onChange(cleanHex);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[700] flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[4px]"
      />

      {/* Popover Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ type: 'spring', damping: 25, stiffness: 250 }}
        className="relative bg-[#13131e] border border-white/10 rounded-[2rem] p-5 w-full max-w-[280px] shadow-2xl flex flex-col gap-4 select-none z-10"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-1">
          <span className="text-white font-semibold text-sm font-serif italic tracking-wide">Custom Color</span>
          <button 
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 text-white/50 flex items-center justify-center hover:bg-white/10 hover:text-white transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        {/* Saturation/Value Area */}
        <div 
          ref={svRef}
          onPointerDown={handleSvPointerDown}
          onPointerMove={handleSvPointerMove}
          className="w-full aspect-[4/3] rounded-2xl relative overflow-hidden cursor-crosshair border border-white/5 touch-none"
          style={{
            backgroundColor: `hsl(${hsv.h}, 100%, 50%)`,
            backgroundImage: `
              linear-gradient(to top, #000, transparent),
              linear-gradient(to right, #fff, transparent)
            `,
          }}
        >
          {/* SV Selector dot */}
          <div 
            className="absolute w-4 h-4 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white shadow-lg pointer-events-none"
            style={{
              left: `${hsv.s}%`,
              bottom: `${hsv.v}%`,
              backgroundColor: currentHex,
              boxShadow: '0 2px 6px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.2)'
            }}
          />
        </div>

        {/* Hue rainbow slider */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center text-[10px] text-white/40 font-mono">
            <span>HUE</span>
            <span>{hsv.h}°</span>
          </div>
          <div 
            ref={hueRef}
            onPointerDown={handleHuePointerDown}
            onPointerMove={handleHuePointerMove}
            className="w-full h-4 rounded-full relative cursor-ew-resize border border-white/5 touch-none"
            style={{
              background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
            }}
          >
            {/* Hue Selector handle */}
            <div 
              className="absolute w-4 h-4 top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white shadow-md pointer-events-none"
              style={{
                left: `${(hsv.h / 360) * 100}%`,
                backgroundColor: `hsl(${hsv.h}, 100%, 50%)`
              }}
            />
          </div>
        </div>

        {/* Inputs section */}
        <div className="flex flex-col gap-2">
          {/* HEX Input */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-white/40 w-8">HEX</span>
            <input 
              type="text"
              value={currentHex.toUpperCase()}
              onChange={(e) => handleHexChange(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-white text-center focus:border-[var(--gold)]/50 focus:outline-none transition-colors"
            />
          </div>

          {/* RGB Inputs */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-white/40 w-8">RGB</span>
            <div className="flex-1 grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center gap-0.5">
                <input 
                  type="text"
                  value={r}
                  onChange={(e) => handleRgbChange('r', e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-1 text-xs font-mono text-white text-center focus:border-[var(--gold)]/50 focus:outline-none transition-colors"
                />
                <span className="text-[8px] font-mono text-white/30">R</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <input 
                  type="text"
                  value={g}
                  onChange={(e) => handleRgbChange('g', e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-1 text-xs font-mono text-white text-center focus:border-[var(--gold)]/50 focus:outline-none transition-colors"
                />
                <span className="text-[8px] font-mono text-white/30">G</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <input 
                  type="text"
                  value={b}
                  onChange={(e) => handleRgbChange('b', e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-1 text-xs font-mono text-white text-center focus:border-[var(--gold)]/50 focus:outline-none transition-colors"
                />
                <span className="text-[8px] font-mono text-white/30">B</span>
              </div>
            </div>
          </div>
        </div>

        {/* Done Button */}
        <button 
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-[var(--gold)] text-[#0d0d14] text-xs font-bold active:scale-[0.98] transition-all hover:brightness-110 shadow-lg shadow-[var(--gold)]/10 mt-1"
        >
          Apply Color
        </button>
      </motion.div>
    </div>
  );
}
