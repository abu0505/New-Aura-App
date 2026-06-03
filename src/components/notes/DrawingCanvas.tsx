import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatSettingsContext } from '../../contexts/ChatSettingsContext';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type DrawTool = 'pen' | 'highlighter' | 'eraser' | 'arrow' | 'line' | 'rect' | 'circle' | 'text' | 'laser';

interface DrawStroke {
  id: string;
  tool: DrawTool;
  points: { x: number; y: number }[];
  color: string;
  size: number;
  opacity: number;
  // For shapes
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  // For text
  text?: string;
  fontSize?: number;
}

interface DrawingCanvasProps {
  drawingData: DrawStroke[] | null;
  onSave: (data: DrawStroke[]) => void;
  onClose: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const DRAW_COLORS = [
  { id: 'white', hex: '#ffffff', label: 'White' },
  { id: 'gold', hex: '#e6c487', label: 'Gold' },
  { id: 'red', hex: '#FF6B6B', label: 'Red' },
  { id: 'green', hex: '#51CF66', label: 'Green' },
  { id: 'blue', hex: '#339AF0', label: 'Blue' },
  { id: 'purple', hex: '#CC5DE8', label: 'Purple' },
  { id: 'orange', hex: '#FF922B', label: 'Orange' },
  { id: 'cyan', hex: '#22B8CF', label: 'Cyan' },
  { id: 'pink', hex: '#F06595', label: 'Pink' },
  { id: 'yellow', hex: '#FFD43B', label: 'Yellow' },
];

const SIZES = [2, 4, 6, 10, 16];

const TOOLS: { id: DrawTool; icon: string; label: string }[] = [
  { id: 'pen', icon: 'edit', label: 'Pen' },
  { id: 'highlighter', icon: 'ink_highlighter', label: 'Highlighter' },
  { id: 'eraser', icon: 'ink_eraser', label: 'Eraser' },
  { id: 'arrow', icon: 'north_east', label: 'Arrow' },
  { id: 'line', icon: 'horizontal_rule', label: 'Line' },
  { id: 'rect', icon: 'rectangle', label: 'Rectangle' },
  { id: 'circle', icon: 'circle', label: 'Circle' },
  { id: 'text', icon: 'text_fields', label: 'Text' },
  { id: 'laser', icon: 'flare', label: 'Laser' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function DrawingCanvas({ drawingData, onSave, onClose }: DrawingCanvasProps) {
  const { settings } = useChatSettingsContext();
  const appAccentColor = settings?.accent_color || '#e6c487';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [tool, setTool] = useState<DrawTool>('pen');
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(4);
  const [strokes, setStrokes] = useState<DrawStroke[]>(drawingData || []);
  const [undoStack, setUndoStack] = useState<DrawStroke[][]>([]);
  const [redoStack, setRedoStack] = useState<DrawStroke[][]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textPos, setTextPos] = useState<{ x: number; y: number } | null>(null);
  const laserPointsRef = useRef<{ x: number; y: number; time: number }[]>([]);

  const currentStrokeRef = useRef<DrawStroke | null>(null);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const strokesRef = useRef(strokes);

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  // ── Canvas setup ────────────────────────────────────────────────────
  const getCanvasSize = useCallback(() => {
    if (!containerRef.current) return { w: 400, h: 500 };
    const rect = containerRef.current.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }, []);

  const resizeCanvas = useCallback(() => {
    const { w, h } = getCanvasSize();
    const dpr = window.devicePixelRatio || 1;
    [canvasRef, overlayCanvasRef].forEach(ref => {
      const canvas = ref.current;
      if (!canvas) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }, [getCanvasSize]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  // ── Rendering ─────────────────────────────────────────────────────
  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: DrawStroke) => {
    ctx.save();

    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = stroke.size * 3;
    } else if (stroke.tool === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size * 4;
      ctx.globalAlpha = 0.35;
    } else if (stroke.tool === 'pen' || stroke.tool === 'laser') {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.globalAlpha = stroke.opacity;
    } else {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.globalAlpha = stroke.opacity;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Shapes
    if (stroke.tool === 'arrow' && stroke.startX !== undefined) {
      drawArrow(ctx, stroke.startX, stroke.startY!, stroke.endX!, stroke.endY!, stroke.size);
    } else if (stroke.tool === 'line' && stroke.startX !== undefined) {
      ctx.beginPath();
      ctx.moveTo(stroke.startX, stroke.startY!);
      ctx.lineTo(stroke.endX!, stroke.endY!);
      ctx.stroke();
    } else if (stroke.tool === 'rect' && stroke.startX !== undefined) {
      const x = Math.min(stroke.startX, stroke.endX!);
      const y = Math.min(stroke.startY!, stroke.endY!);
      const w = Math.abs(stroke.endX! - stroke.startX);
      const h = Math.abs(stroke.endY! - stroke.startY!);
      ctx.strokeRect(x, y, w, h);
    } else if (stroke.tool === 'circle' && stroke.startX !== undefined) {
      const cx = (stroke.startX + stroke.endX!) / 2;
      const cy = (stroke.startY! + stroke.endY!) / 2;
      const rx = Math.abs(stroke.endX! - stroke.startX) / 2;
      const ry = Math.abs(stroke.endY! - stroke.startY!) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (stroke.tool === 'text' && stroke.text) {
      ctx.fillStyle = stroke.color;
      ctx.font = `${stroke.fontSize || 18}px 'Inter', sans-serif`;
      ctx.globalAlpha = stroke.opacity;
      ctx.fillText(stroke.text, stroke.startX || 0, stroke.startY || 0);
    } else if (stroke.points.length > 1) {
      // Freehand: smooth with quadratic curves
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const mx = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
        const my = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, mx, my);
      }
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }

    ctx.restore();
  }, []);

  const drawArrow = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, lineWidth: number) => {
    const headLen = Math.max(lineWidth * 4, 12);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    // Line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h } = getCanvasSize();
    ctx.clearRect(0, 0, w, h);

    strokesRef.current.forEach(stroke => {
      if (stroke.tool !== 'laser') drawStroke(ctx, stroke);
    });
  }, [drawStroke, getCanvasSize]);

  useEffect(() => { redrawAll(); }, [strokes, redrawAll]);

  // ── Laser pointer animation ───────────────────────────────────────
  useEffect(() => {
    if (tool !== 'laser') return;

    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    // App accent gold — glow colour; white — core line
    const GLOW_COLOR = color === '#ffffff' ? appAccentColor : color;
    const CORE_COLOR = '#FFFFFF';
    const LIFESPAN   = 1000;

    let animFrame: number;
    const animate = () => {
      const now = Date.now();
      laserPointsRef.current = laserPointsRef.current.filter(p => now - p.time < LIFESPAN);
      const points = laserPointsRef.current;

      const { w, h } = getCanvasSize();
      ctx.clearRect(0, 0, w, h);

      if (points.length >= 2) {
        // Fade is driven by the NEWEST point so the trail stays fully bright
        // while the pointer is moving and fades 1 s after it stops.
        const newestAge = now - points[points.length - 1].time;
        const alpha = Math.max(0, 1 - newestAge / LIFESPAN);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.lineCap  = 'round';
        ctx.lineJoin = 'round';

        // Helper: build the entire trail as ONE continuous path.
        // Stroking once means shadowBlur is applied once to the whole
        // shape — not per-segment — so the glow never multiplies at joints.
        const buildFullPath = () => {
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
          }
        };

        // Pass 1 — wide gold glow (shadow applied once to the full path)
        buildFullPath();
        ctx.strokeStyle = GLOW_COLOR;
        ctx.lineWidth   = size * 3;
        ctx.shadowColor = GLOW_COLOR;
        ctx.shadowBlur  = 18;
        ctx.stroke();

        // Pass 2 — tight bright core (no shadow so it stays sharp white)
        buildFullPath();
        ctx.strokeStyle = CORE_COLOR;
        ctx.lineWidth   = size * 0.9;
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur  = 0;
        ctx.stroke();

        ctx.restore();
      }



      animFrame = requestAnimationFrame(animate);
    };

    animFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrame);
  }, [tool, size, color, appAccentColor, getCanvasSize]);

  // ── Pointer event handlers ─────────────────────────────────────────
  const getPos = (e: React.PointerEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'clientX' in e ? e.clientX : e.touches[0].clientX;
    const clientY = 'clientY' in e ? e.clientY : e.touches[0].clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (tool === 'text') {
      const pos = getPos(e);
      setTextPos(pos);
      return;
    }

    setIsDrawing(true);
    const pos = getPos(e);

    if (tool === 'laser') {
      laserPointsRef.current = [{ ...pos, time: Date.now() }];
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    // Save state for undo
    setUndoStack(prev => [...prev, [...strokesRef.current]]);
    setRedoStack([]);

    if (['arrow', 'line', 'rect', 'circle'].includes(tool)) {
      shapeStartRef.current = pos;
      currentStrokeRef.current = {
        id: crypto.randomUUID(),
        tool,
        points: [],
        color,
        size,
        opacity: 1,
        startX: pos.x,
        startY: pos.y,
        endX: pos.x,
        endY: pos.y,
      };
    } else {
      currentStrokeRef.current = {
        id: crypto.randomUUID(),
        tool,
        points: [pos],
        color,
        size,
        opacity: tool === 'highlighter' ? 0.35 : 1,
      };
    }

    // Capture pointer for smooth drawing
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    const pos = getPos(e);

    if (tool === 'laser') {
      laserPointsRef.current.push({ ...pos, time: Date.now() });
      return;
    }

    if (!currentStrokeRef.current) return;

    if (['arrow', 'line', 'rect', 'circle'].includes(tool)) {
      currentStrokeRef.current.endX = pos.x;
      currentStrokeRef.current.endY = pos.y;

      // Draw shape preview on overlay canvas
      const overlayCanvas = overlayCanvasRef.current;
      if (overlayCanvas) {
        const ctx = overlayCanvas.getContext('2d');
        if (ctx) {
          const { w, h } = getCanvasSize();
          ctx.clearRect(0, 0, w, h);
          drawStroke(ctx, currentStrokeRef.current);
        }
      }
    } else {
      currentStrokeRef.current.points.push(pos);

      // Draw incrementally on main canvas for freehand
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const points = currentStrokeRef.current.points;
          if (points.length >= 2) {
            drawStroke(ctx, {
              ...currentStrokeRef.current,
              points: points.slice(-3), // draw only recent segment
            });
          }
        }
      }
    }
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (tool === 'laser') return;

    if (currentStrokeRef.current) {
      setStrokes(prev => [...prev, currentStrokeRef.current!]);
      currentStrokeRef.current = null;
    }

    // Clear overlay
    const overlayCanvas = overlayCanvasRef.current;
    if (overlayCanvas) {
      const ctx = overlayCanvas.getContext('2d');
      if (ctx) {
        const { w, h } = getCanvasSize();
        ctx.clearRect(0, 0, w, h);
      }
    }
  };

  // ── Text input handler ────────────────────────────────────────────
  const handleTextSubmit = () => {
    if (!textInput.trim() || !textPos) return;

    setUndoStack(prev => [...prev, [...strokesRef.current]]);
    setRedoStack([]);

    const textStroke: DrawStroke = {
      id: crypto.randomUUID(),
      tool: 'text',
      points: [],
      color,
      size,
      opacity: 1,
      startX: textPos.x,
      startY: textPos.y,
      text: textInput,
      fontSize: size * 5,
    };

    setStrokes(prev => [...prev, textStroke]);
    setTextInput('');
    setTextPos(null);
  };

  // ── Undo / Redo ───────────────────────────────────────────────────
  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prevState = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev, [...strokesRef.current]]);
    setStrokes(prevState);
    setUndoStack(prev => prev.slice(0, -1));
  }, [undoStack]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextState = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev, [...strokesRef.current]]);
    setStrokes(nextState);
    setRedoStack(prev => prev.slice(0, -1));
  }, [redoStack]);

  // ── Clear all ─────────────────────────────────────────────────────
  const clearAll = () => {
    if (strokesRef.current.length === 0) return;
    setUndoStack(prev => [...prev, [...strokesRef.current]]);
    setRedoStack([]);
    setStrokes([]);
  };

  // ── Save & Close ──────────────────────────────────────────────────
  const handleSave = () => {
    onSave(strokes);
    onClose();
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); undo(); }
        if (e.key === 'y') { e.preventDefault(); redo(); }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [undo, redo]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[250] flex flex-col bg-[#0c0c14]"
    >
      {/* ═══ TOP BAR ═══ */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#12121f] border-b border-white/5 shrink-0 safe-top safe-pt">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/5 text-white/40 hover:text-white/70 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
          </button>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/25">Draw</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Undo / Redo */}
          <button
            onClick={undo}
            disabled={undoStack.length === 0}
            className="p-2 rounded-xl hover:bg-white/5 text-white/40 hover:text-white/70 transition-colors disabled:opacity-20 disabled:cursor-default"
            title="Undo (Ctrl+Z)"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>undo</span>
          </button>
          <button
            onClick={redo}
            disabled={redoStack.length === 0}
            className="p-2 rounded-xl hover:bg-white/5 text-white/40 hover:text-white/70 transition-colors disabled:opacity-20 disabled:cursor-default"
            title="Redo (Ctrl+Y)"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>redo</span>
          </button>

          <div className="w-px h-5 bg-white/10 mx-1" />

          {/* Clear */}
          <button
            onClick={clearAll}
            disabled={strokes.length === 0}
            className="p-2 rounded-xl hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-colors disabled:opacity-20 disabled:cursor-default"
            title="Clear All"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>delete_sweep</span>
          </button>

          <div className="w-px h-5 bg-white/10 mx-1" />

          {/* Save */}
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--gold)] text-black text-[10px] font-bold uppercase tracking-[0.15em] hover:brightness-110 transition-all"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check</span>
            Done
          </button>
        </div>
      </div>

      {/* ═══ CANVAS AREA ═══ */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden cursor-crosshair" style={{ touchAction: 'none' }}>
        {/* Grid pattern background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
            `,
            backgroundSize: '24px 24px',
          }}
        />

        {/* Main canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />

        {/* Overlay canvas (shape preview + laser) */}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 pointer-events-none"
        />

        {/* Text input overlay */}
        <AnimatePresence>
          {textPos && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="absolute z-10"
              style={{ left: textPos.x, top: textPos.y - 10 }}
            >
              <div className="flex items-center gap-1.5 bg-zinc-900/95 border border-white/15 rounded-xl px-3 py-2 shadow-2xl backdrop-blur-md">
                <input
                  autoFocus
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTextSubmit();
                    if (e.key === 'Escape') setTextPos(null);
                  }}
                  placeholder="Type text..."
                  className="bg-transparent text-white/80 text-sm focus:outline-none w-40"
                  style={{ color, fontSize: `${size * 3}px`, outline: 'none', boxShadow: 'none' }}
                />
                <button
                  onClick={handleTextSubmit}
                  className="p-1 rounded-lg bg-[var(--gold)] text-black hover:brightness-110 transition-all"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check</span>
                </button>
                <button
                  onClick={() => setTextPos(null)}
                  className="p-1 rounded-lg hover:bg-white/10 text-white/40 transition-all"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ═══ BOTTOM TOOLBAR ═══ */}
      <div className="bg-[#12121f] border-t border-white/5 shrink-0 safe-bottom">
        {/* Color & Size pickers */}
        <AnimatePresence>
          {showColorPicker && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 py-3 flex items-center gap-2.5 overflow-x-auto scrollbar-hide">
                {DRAW_COLORS.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setColor(c.hex)}
                    className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 shrink-0 ${
                      color === c.hex ? 'border-white scale-110 shadow-lg' : 'border-white/15'
                    }`}
                    style={{ backgroundColor: c.hex }}
                    title={c.label}
                  >
                    {color === c.hex && (
                      <span className="material-symbols-outlined text-black/80" style={{ fontSize: '14px' }}>check</span>
                    )}
                  </button>
                ))}
                {/* Custom color picker */}
                <div className="relative w-8 h-8 rounded-full border-2 border-dashed border-white/30 hover:border-white/50 overflow-hidden shrink-0 flex items-center justify-center">
                  <span className="material-symbols-outlined text-white/50 pointer-events-none" style={{ fontSize: '16px' }}>colorize</span>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    title="Custom Color"
                  />
                </div>
              </div>
            </motion.div>
          )}

          {showSizePicker && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 py-3 flex items-center gap-4 justify-center">
                {SIZES.map(s => (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    className={`flex items-center justify-center transition-all hover:scale-110 ${
                      size === s ? 'ring-2 ring-[var(--gold)] ring-offset-2 ring-offset-[#12121f]' : ''
                    } rounded-full`}
                    title={`Size ${s}`}
                  >
                    <div
                      className="rounded-full"
                      style={{
                        width: `${s * 2 + 8}px`,
                        height: `${s * 2 + 8}px`,
                        backgroundColor: color,
                      }}
                    />
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tools row */}
        <div className="flex items-center gap-1 px-2 py-2 overflow-x-auto scrollbar-hide">
          {TOOLS.map(t => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl transition-all shrink-0 ${
                tool === t.id
                  ? 'bg-white/10 text-[var(--gold)]'
                  : 'text-white/35 hover:text-white/60 hover:bg-white/5'
              }`}
              title={t.label}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{t.icon}</span>
              <span className="text-[8px] font-bold uppercase tracking-wider">{t.label}</span>
            </button>
          ))}

          <div className="w-px h-8 bg-white/10 mx-1 shrink-0" />

          {/* Color toggle */}
          <button
            onClick={() => { setShowColorPicker(!showColorPicker); setShowSizePicker(false); }}
            className={`p-2 rounded-xl transition-all shrink-0 ${
              showColorPicker ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
            title="Color"
          >
            <div className="w-6 h-6 rounded-full border-2 border-white/20" style={{ backgroundColor: color }} />
          </button>

          {/* Size toggle */}
          <button
            onClick={() => { setShowSizePicker(!showSizePicker); setShowColorPicker(false); }}
            className={`p-2 rounded-xl transition-all shrink-0 flex items-center gap-1 ${
              showSizePicker ? 'bg-white/10 text-[var(--gold)]' : 'text-white/35 hover:text-white/60 hover:bg-white/5'
            }`}
            title="Brush Size"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>line_weight</span>
            <span className="text-[9px] font-bold text-white/30">{size}px</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default memo(DrawingCanvas);
