import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatSettingsContext } from '../../contexts/ChatSettingsContext';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type DrawTool = 'pen' | 'highlighter' | 'eraser' | 'arrow' | 'line' | 'rect' | 'circle' | 'text' | 'laser' | 'hand';

interface DrawStroke {
  id: string;
  tool: DrawTool;
  points: { x: number; y: number }[];
  color: string;
  size: number;
  opacity: number;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  text?: string;
  fontSize?: number;
}

interface Camera {
  x: number;     // pan offset X (screen pixels)
  y: number;     // pan offset Y (screen pixels)
  scale: number; // zoom level (1 = 100%)
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
  { id: 'white',  hex: '#ffffff', label: 'White'  },
  { id: 'gold',   hex: '#e6c487', label: 'Gold'   },
  { id: 'red',    hex: '#FF6B6B', label: 'Red'    },
  { id: 'green',  hex: '#51CF66', label: 'Green'  },
  { id: 'blue',   hex: '#339AF0', label: 'Blue'   },
  { id: 'purple', hex: '#CC5DE8', label: 'Purple' },
  { id: 'orange', hex: '#FF922B', label: 'Orange' },
  { id: 'cyan',   hex: '#22B8CF', label: 'Cyan'   },
  { id: 'pink',   hex: '#F06595', label: 'Pink'   },
  { id: 'yellow', hex: '#FFD43B', label: 'Yellow' },
];

const SIZES = [2, 4, 6, 10, 16];

const TOOLS: { id: DrawTool; icon: string; label: string }[] = [
  { id: 'pen',         icon: 'edit',             label: 'Pen'   },
  { id: 'highlighter', icon: 'ink_highlighter',  label: 'HL'    },
  { id: 'eraser',      icon: 'ink_eraser',       label: 'Erase' },
  { id: 'arrow',       icon: 'north_east',       label: 'Arrow' },
  { id: 'line',        icon: 'horizontal_rule',  label: 'Line'  },
  { id: 'rect',        icon: 'rectangle',        label: 'Rect'  },
  { id: 'circle',      icon: 'circle',           label: 'Circle'},
  { id: 'text',        icon: 'text_fields',      label: 'Text'  },
  { id: 'laser',       icon: 'flare',            label: 'Laser' },
  { id: 'hand',        icon: 'back_hand',        label: 'Pan'   },
];

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const GRID_DOT_SPACING = 40; // world units between dots

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function DrawingCanvas({ drawingData, onSave, onClose }: DrawingCanvasProps) {
  const { settings } = useChatSettingsContext();
  const appAccentColor = settings?.accent_color || '#e6c487';

  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef     = useRef<HTMLDivElement>(null);

  // ── Camera ──────────────────────────────────────────────────────────────────
  // cameraRef is used inside event handlers / animation loops (always fresh).
  // camera state is used only to re-render the zoom % badge in the UI.
  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });

  const applyCamera = useCallback((cam: Camera) => {
    cameraRef.current = cam;
    setCamera({ ...cam });
  }, []);

  // ── Pan / touch refs ────────────────────────────────────────────────────────
  const isPanningRef     = useRef(false);
  const panStartRef      = useRef({ clientX: 0, clientY: 0, camX: 0, camY: 0 });
  const lastTouchRef     = useRef<{ cx: number; cy: number; dist: number } | null>(null);
  const spaceHeldRef     = useRef(false);
  const toolBeforeSpRef  = useRef<DrawTool>('pen');

  // ── Drawing state ────────────────────────────────────────────────────────────
  const [tool, setTool]   = useState<DrawTool>('pen');
  const toolRef           = useRef<DrawTool>('pen');
  useEffect(() => { toolRef.current = tool; }, [tool]);

  const [color, setColor] = useState('#ffffff');
  const colorRef          = useRef('#ffffff');
  useEffect(() => { colorRef.current = color; }, [color]);

  const [size, setSize]   = useState(4);
  const sizeRef           = useRef(4);
  useEffect(() => { sizeRef.current = size; }, [size]);

  const [strokes, setStrokes]           = useState<DrawStroke[]>(drawingData || []);
  const [undoStack, setUndoStack]       = useState<DrawStroke[][]>([]);
  const [redoStack, setRedoStack]       = useState<DrawStroke[][]>([]);
  const [isDrawing, setIsDrawing]       = useState(false);
  const isDrawingRef                    = useRef(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSizePicker,  setShowSizePicker]  = useState(false);
  const [textInput, setTextInput]       = useState('');
  // textWorldPos: position in WORLD coords where user tapped for text tool
  const [textWorldPos, setTextWorldPos] = useState<{ x: number; y: number } | null>(null);
  const laserPointsRef                  = useRef<{ x: number; y: number; time: number }[]>([]);
  const currentStrokeRef                = useRef<DrawStroke | null>(null);
  const strokesRef                      = useRef(strokes);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  // ── Coordinate helpers ───────────────────────────────────────────────────────

  /** Convert screen (canvas-relative) pixel → world coordinate */
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const { x, y, scale } = cameraRef.current;
    return { x: (sx - x) / scale, y: (sy - y) / scale };
  }, []);

  /** Convert world coordinate → screen (canvas-relative) pixel */
  const worldToScreen = useCallback((wx: number, wy: number) => {
    const { x, y, scale } = cameraRef.current;
    return { x: wx * scale + x, y: wy * scale + y };
  }, []);

  // ── Canvas setup ─────────────────────────────────────────────────────────────

  const getCanvasSize = useCallback(() => {
    if (!containerRef.current) return { w: 800, h: 600 };
    const r = containerRef.current.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }, []);

  const resizeCanvas = useCallback(() => {
    const { w, h } = getCanvasSize();
    const dpr = window.devicePixelRatio || 1;
    [canvasRef, overlayCanvasRef].forEach(ref => {
      const c = ref.current;
      if (!c) return;
      c.width  = w * dpr;
      c.height = h * dpr;
      c.style.width  = `${w}px`;
      c.style.height = `${h}px`;
      const ctx = c.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }, [getCanvasSize]);

  // ── Dot grid (Excalidraw / Notion style) ─────────────────────────────────────

  const drawDotGrid = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, cam: Camera) => {
    const gs = GRID_DOT_SPACING;
    const worldLeft   = -cam.x / cam.scale;
    const worldTop    = -cam.y / cam.scale;
    const worldRight  = (w - cam.x) / cam.scale;
    const worldBottom = (h - cam.y) / cam.scale;

    const startX = Math.floor(worldLeft  / gs) * gs;
    const startY = Math.floor(worldTop   / gs) * gs;

    // Dot radius and opacity adapt to zoom so they always look good
    const dotR  = Math.max(0.6, Math.min(2, cam.scale));
    const alpha = Math.min(0.3, Math.max(0.04, cam.scale * 0.12));
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;

    for (let wx = startX; wx <= worldRight  + gs; wx += gs) {
      for (let wy = startY; wy <= worldBottom + gs; wy += gs) {
        const sx = wx * cam.scale + cam.x;
        const sy = wy * cam.scale + cam.y;
        if (sx < -4 || sx > w + 4 || sy < -4 || sy > h + 4) continue;
        ctx.beginPath();
        ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, []);

  // ── Stroke rendering ──────────────────────────────────────────────────────────
  // All drawing is in WORLD coords; caller must set ctx.translate/scale first.

  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number,
    x2: number, y2: number,
    lw: number,
  ) => {
    const headLen = Math.max(lw * 4, 12);
    const angle   = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };

  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: DrawStroke) => {
    ctx.save();

    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth   = stroke.size * 3;
    } else if (stroke.tool === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth   = stroke.size * 4;
      ctx.globalAlpha = 0.35;
    } else {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth   = stroke.size;
      ctx.globalAlpha = stroke.opacity;
    }

    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'arrow' && stroke.startX !== undefined) {
      drawArrow(ctx, stroke.startX, stroke.startY!, stroke.endX!, stroke.endY!, stroke.size);
    } else if (stroke.tool === 'line' && stroke.startX !== undefined) {
      ctx.beginPath(); ctx.moveTo(stroke.startX, stroke.startY!); ctx.lineTo(stroke.endX!, stroke.endY!); ctx.stroke();
    } else if (stroke.tool === 'rect' && stroke.startX !== undefined) {
      const x = Math.min(stroke.startX, stroke.endX!);
      const y = Math.min(stroke.startY!, stroke.endY!);
      ctx.strokeRect(x, y, Math.abs(stroke.endX! - stroke.startX), Math.abs(stroke.endY! - stroke.startY!));
    } else if (stroke.tool === 'circle' && stroke.startX !== undefined) {
      const cx = (stroke.startX + stroke.endX!) / 2;
      const cy = (stroke.startY! + stroke.endY!) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(stroke.endX! - stroke.startX) / 2, Math.abs(stroke.endY! - stroke.startY!) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (stroke.tool === 'text' && stroke.text) {
      ctx.fillStyle   = stroke.color;
      ctx.font        = `${stroke.fontSize || 18}px 'Inter', sans-serif`;
      ctx.globalAlpha = stroke.opacity;
      ctx.fillText(stroke.text, stroke.startX || 0, stroke.startY || 0);
    } else if (stroke.points.length > 1) {
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
    } else if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = stroke.color; ctx.fill();
    }

    ctx.restore();
  }, []);

  // ── Full redraw ───────────────────────────────────────────────────────────────

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h } = getCanvasSize();
    const cam = cameraRef.current;

    ctx.clearRect(0, 0, w, h);
    drawDotGrid(ctx, w, h, cam);

    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.scale, cam.scale);
    strokesRef.current.forEach(s => { if (s.tool !== 'laser') drawStroke(ctx, s); });
    ctx.restore();
  }, [drawStroke, drawDotGrid, getCanvasSize]);

  // Redraw whenever strokes or camera change
  useEffect(() => { redrawAll(); }, [strokes, camera, redrawAll]);

  // Resize on mount and window resize
  useEffect(() => {
    resizeCanvas();
    const onResize = () => { resizeCanvas(); redrawAll(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [resizeCanvas, redrawAll]);

  // ── Zoom helpers ──────────────────────────────────────────────────────────────

  const zoomAtPoint = useCallback((newScale: number, sx: number, sy: number) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    const { x, y, scale } = cameraRef.current;
    const wx = (sx - x) / scale;
    const wy = (sy - y) / scale;
    applyCamera({ x: sx - wx * clamped, y: sy - wy * clamped, scale: clamped });
  }, [applyCamera]);

  const getViewCenter = useCallback((): [number, number] => {
    const { w, h } = getCanvasSize();
    return [w / 2, h / 2];
  }, [getCanvasSize]);

  const fitToContent = useCallback(() => {
    if (strokesRef.current.length === 0) { applyCamera({ x: 0, y: 0, scale: 1 }); return; }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    strokesRef.current.forEach(s => {
      s.points.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
      if (s.startX !== undefined) {
        minX = Math.min(minX, s.startX, s.endX ?? s.startX);
        minY = Math.min(minY, s.startY ?? 0, s.endY ?? s.startY ?? 0);
        maxX = Math.max(maxX, s.startX, s.endX ?? s.startX);
        maxY = Math.max(maxY, s.startY ?? 0, s.endY ?? s.startY ?? 0);
      }
    });
    if (!isFinite(minX)) { applyCamera({ x: 0, y: 0, scale: 1 }); return; }

    const pad = 80;
    const { w, h } = getCanvasSize();
    const cW = maxX - minX || 1;
    const cH = maxY - minY || 1;
    const newScale = Math.min(3, (w - pad * 2) / cW, (h - pad * 2) / cH);
    applyCamera({
      x: w / 2 - ((minX + maxX) / 2) * newScale,
      y: h / 2 - ((minY + maxY) / 2) * newScale,
      scale: newScale,
    });
  }, [getCanvasSize, applyCamera]);

  // ── Scroll-wheel zoom ─────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Ctrl+scroll or trackpad pinch → zoom; plain scroll → pan
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        zoomAtPoint(cameraRef.current.scale * factor, mx, my);
      } else {
        // Pan with scroll
        const { x, y, scale } = cameraRef.current;
        applyCamera({ x: x - e.deltaX, y: y - e.deltaY, scale });
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAtPoint, applyCamera]);

  // ── Pinch-zoom / two-finger pan (touch) ───────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0], t2 = e.touches[1];
        lastTouchRef.current = {
          cx: (t1.clientX + t2.clientX) / 2,
          cy: (t1.clientY + t2.clientY) / 2,
          dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && lastTouchRef.current) {
        e.preventDefault();
        const t1 = e.touches[0], t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const cx   = (t1.clientX + t2.clientX) / 2;
        const cy   = (t1.clientY + t2.clientY) / 2;
        const rect = canvas.getBoundingClientRect();
        const scx  = cx - rect.left;
        const scy  = cy - rect.top;
        const dx   = cx - lastTouchRef.current.cx;
        const dy   = cy - lastTouchRef.current.cy;

        const scaleFactor = dist / lastTouchRef.current.dist;
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cameraRef.current.scale * scaleFactor));
        const cam = cameraRef.current;
        const wx = (scx - cam.x) / cam.scale;
        const wy = (scy - cam.y) / cam.scale;

        applyCamera({ x: scx - wx * newScale + dx, y: scy - wy * newScale + dy, scale: newScale });
        lastTouchRef.current = { cx, cy, dist };
      }
    };

    const onTouchEnd = () => { lastTouchRef.current = null; };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   onTouchEnd);
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove',  onTouchMove);
      canvas.removeEventListener('touchend',   onTouchEnd);
    };
  }, [applyCamera]);

  // ── Undo / Redo ────────────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const prevState = prev[prev.length - 1];
      setRedoStack(r => [...r, [...strokesRef.current]]);
      setStrokes(prevState);
      return prev.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev;
      const nextState = prev[prev.length - 1];
      setUndoStack(u => [...u, [...strokesRef.current]]);
      setStrokes(nextState);
      return prev.slice(0, -1);
    });
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.matches?.('input, textarea, [contenteditable]')) return;

      // Space → temporary hand/pan tool
      if (e.code === 'Space' && !spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = true;
        toolBeforeSpRef.current = toolRef.current;
        setTool('hand');
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); undo(); }
        if (e.key === 'y') { e.preventDefault(); redo(); }
        if (e.key === '0') { e.preventDefault(); applyCamera({ x: 0, y: 0, scale: 1 }); }
        if (e.key === 'f') { e.preventDefault(); fitToContent(); }
        if (e.key === '=') { e.preventDefault(); const [cx, cy] = getViewCenter(); zoomAtPoint(cameraRef.current.scale * 1.2, cx, cy); }
        if (e.key === '-') { e.preventDefault(); const [cx, cy] = getViewCenter(); zoomAtPoint(cameraRef.current.scale * 0.8, cx, cy); }
      }

      // H key → hand tool
      if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey) {
        setTool(t => t === 'hand' ? 'pen' : 'hand');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spaceHeldRef.current) {
        spaceHeldRef.current = false;
        setTool(toolBeforeSpRef.current);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
    };
  }, [undo, redo, applyCamera, fitToContent, zoomAtPoint, getViewCenter]);

  // ── Pointer helpers ───────────────────────────────────────────────────────────

  const getScreenPos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const getWorldPos = (e: React.PointerEvent) => {
    const sp = getScreenPos(e);
    return screenToWorld(sp.x, sp.y);
  };

  // ── Pointer down ──────────────────────────────────────────────────────────────

  const handlePointerDown = (e: React.PointerEvent) => {
    // Middle-mouse or hand tool → pan
    if (e.button === 1 || toolRef.current === 'hand') {
      isPanningRef.current = true;
      panStartRef.current  = { clientX: e.clientX, clientY: e.clientY, camX: cameraRef.current.x, camY: cameraRef.current.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (toolRef.current === 'text') {
      const wp = getWorldPos(e);
      setTextWorldPos(wp);
      return;
    }

    isDrawingRef.current = true;
    setIsDrawing(true);
    const pos = getWorldPos(e); // ← WORLD coords stored

    if (toolRef.current === 'laser') {
      laserPointsRef.current = [{ ...pos, time: Date.now() }];
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    setUndoStack(prev => [...prev, [...strokesRef.current]]);
    setRedoStack([]);

    if (['arrow', 'line', 'rect', 'circle'].includes(toolRef.current)) {
      currentStrokeRef.current = {
        id: crypto.randomUUID(), tool: toolRef.current,
        points: [], color: colorRef.current, size: sizeRef.current, opacity: 1,
        startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y,
      };
    } else {
      currentStrokeRef.current = {
        id: crypto.randomUUID(), tool: toolRef.current,
        points: [pos], color: colorRef.current, size: sizeRef.current,
        opacity: toolRef.current === 'highlighter' ? 0.35 : 1,
      };
    }

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  // ── Pointer move ──────────────────────────────────────────────────────────────

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      applyCamera({ x: panStartRef.current.camX + dx, y: panStartRef.current.camY + dy, scale: cameraRef.current.scale });
      return;
    }

    if (!isDrawingRef.current) return;
    const pos = getWorldPos(e); // ← WORLD coords

    if (toolRef.current === 'laser') {
      laserPointsRef.current.push({ ...pos, time: Date.now() });
      return;
    }

    if (!currentStrokeRef.current) return;

    if (['arrow', 'line', 'rect', 'circle'].includes(toolRef.current)) {
      currentStrokeRef.current.endX = pos.x;
      currentStrokeRef.current.endY = pos.y;

      // Shape preview on overlay canvas (with camera transform)
      const oc = overlayCanvasRef.current;
      if (oc) {
        const ctx = oc.getContext('2d');
        if (ctx) {
          const { w, h } = getCanvasSize();
          const cam = cameraRef.current;
          ctx.clearRect(0, 0, w, h);
          ctx.save();
          ctx.translate(cam.x, cam.y);
          ctx.scale(cam.scale, cam.scale);
          drawStroke(ctx, currentStrokeRef.current);
          ctx.restore();
        }
      }
    } else {
      currentStrokeRef.current.points.push(pos);

      // Incremental draw (with camera transform)
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const pts = currentStrokeRef.current.points;
          if (pts.length >= 2) {
            const cam = cameraRef.current;
            ctx.save();
            ctx.translate(cam.x, cam.y);
            ctx.scale(cam.scale, cam.scale);
            drawStroke(ctx, { ...currentStrokeRef.current, points: pts.slice(-3) });
            ctx.restore();
          }
        }
      }
    }
  };

  // ── Pointer up ────────────────────────────────────────────────────────────────

  const handlePointerUp = () => {
    isPanningRef.current = false;
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    setIsDrawing(false);

    if (toolRef.current === 'laser') return;

    if (currentStrokeRef.current) {
      setStrokes(prev => [...prev, currentStrokeRef.current!]);
      currentStrokeRef.current = null;
    }

    // Clear overlay
    const oc = overlayCanvasRef.current;
    if (oc) {
      const ctx = oc.getContext('2d');
      if (ctx) { const { w, h } = getCanvasSize(); ctx.clearRect(0, 0, w, h); }
    }
  };

  // ── Laser pointer animation ───────────────────────────────────────────────────

  useEffect(() => {
    if (tool !== 'laser') return;
    const oc = overlayCanvasRef.current;
    if (!oc) return;
    const ctx = oc.getContext('2d');
    if (!ctx) return;

    const GLOW_COLOR = colorRef.current === '#ffffff' ? appAccentColor : colorRef.current;
    const LIFESPAN   = 1000;
    let af: number;

    const animate = () => {
      const now = Date.now();
      laserPointsRef.current = laserPointsRef.current.filter(p => now - p.time < LIFESPAN);
      const pts = laserPointsRef.current;
      const { w, h } = getCanvasSize();
      const cam = cameraRef.current;

      ctx.clearRect(0, 0, w, h);

      if (pts.length >= 2) {
        const newestAge = now - pts[pts.length - 1].time;
        const alpha = Math.max(0, 1 - newestAge / LIFESPAN);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.translate(cam.x, cam.y);
        ctx.scale(cam.scale, cam.scale);

        const buildPath = () => {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        };

        buildPath();
        ctx.strokeStyle = GLOW_COLOR;
        ctx.lineWidth   = sizeRef.current * 3;
        ctx.shadowColor = GLOW_COLOR;
        ctx.shadowBlur  = 18;
        ctx.stroke();

        buildPath();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth   = sizeRef.current * 0.9;
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur  = 0;
        ctx.stroke();

        ctx.restore();
      }

      af = requestAnimationFrame(animate);
    };

    af = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(af);
  }, [tool, appAccentColor, getCanvasSize]);

  // ── Text submit ───────────────────────────────────────────────────────────────

  const handleTextSubmit = () => {
    if (!textInput.trim() || !textWorldPos) return;
    setUndoStack(prev => [...prev, [...strokesRef.current]]);
    setRedoStack([]);
    setStrokes(prev => [...prev, {
      id: crypto.randomUUID(), tool: 'text',
      points: [], color: colorRef.current, size: sizeRef.current, opacity: 1,
      startX: textWorldPos.x, startY: textWorldPos.y,
      text: textInput, fontSize: sizeRef.current * 5,
    }]);
    setTextInput('');
    setTextWorldPos(null);
  };

  // ── Clear all ─────────────────────────────────────────────────────────────────

  const clearAll = () => {
    if (strokesRef.current.length === 0) return;
    setUndoStack(prev => [...prev, [...strokesRef.current]]);
    setRedoStack([]);
    setStrokes([]);
  };

  const handleSave = () => { onSave(strokes); onClose(); };

  // ── Derived UI values ─────────────────────────────────────────────────────────

  const textScreenPos = textWorldPos ? worldToScreen(textWorldPos.x, textWorldPos.y) : null;

  const cursorClass = (() => {
    if (tool === 'hand') return isPanningRef.current ? 'cursor-grabbing' : 'cursor-grab';
    if (tool === 'eraser') return 'cursor-cell';
    if (tool === 'text')   return 'cursor-text';
    return 'cursor-crosshair';
  })();

  const zoomPct = Math.round(camera.scale * 100);

  // ── JSX ───────────────────────────────────────────────────────────────────────

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
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/5 text-white/40 hover:text-white/70 transition-colors">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
          </button>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/25">Draw</span>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={undo} disabled={undoStack.length === 0}
            className="p-2 rounded-xl hover:bg-white/5 text-white/40 hover:text-white/70 transition-colors disabled:opacity-20 disabled:cursor-default"
            title="Undo (Ctrl+Z)">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>undo</span>
          </button>
          <button onClick={redo} disabled={redoStack.length === 0}
            className="p-2 rounded-xl hover:bg-white/5 text-white/40 hover:text-white/70 transition-colors disabled:opacity-20 disabled:cursor-default"
            title="Redo (Ctrl+Y)">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>redo</span>
          </button>
          <div className="w-px h-5 bg-white/10 mx-1" />
          <button onClick={clearAll} disabled={strokes.length === 0}
            className="p-2 rounded-xl hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-colors disabled:opacity-20 disabled:cursor-default"
            title="Clear All">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>delete_sweep</span>
          </button>
          <div className="w-px h-5 bg-white/10 mx-1" />
          <button onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--gold)] text-black text-[10px] font-bold uppercase tracking-[0.15em] hover:brightness-110 transition-all">
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check</span>
            Done
          </button>
        </div>
      </div>

      {/* ═══ CANVAS AREA ═══ */}
      <div ref={containerRef} className={`flex-1 relative overflow-hidden ${cursorClass}`} style={{ touchAction: 'none' }}>

        {/* Main canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 z-[1]"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />

        {/* Overlay canvas (shape preview + laser) */}
        <canvas ref={overlayCanvasRef} className="absolute inset-0 z-[2] pointer-events-none" />

        {/* Text input overlay — positioned at world coord converted to screen */}
        <AnimatePresence>
          {textScreenPos && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="absolute z-[10]"
              style={{ left: textScreenPos.x, top: textScreenPos.y - 10 }}
            >
              <div className="flex items-center gap-1.5 bg-zinc-900/95 border border-white/15 rounded-xl px-3 py-2 shadow-2xl backdrop-blur-md">
                <input
                  autoFocus
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  handleTextSubmit();
                    if (e.key === 'Escape') { setTextWorldPos(null); setTextInput(''); }
                  }}
                  placeholder="Type text..."
                  className="bg-transparent text-white/80 text-sm focus:outline-none w-40"
                  style={{ color, fontSize: `${size * 3}px`, outline: 'none', boxShadow: 'none' }}
                />
                <button onClick={handleTextSubmit} className="p-1 rounded-lg bg-[var(--gold)] text-black hover:brightness-110 transition-all">
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check</span>
                </button>
                <button onClick={() => { setTextWorldPos(null); setTextInput(''); }} className="p-1 rounded-lg hover:bg-white/10 text-white/40 transition-all">
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Zoom controls (bottom-right) ── */}
        <div className="absolute bottom-4 right-4 z-[10] flex items-center gap-0.5 bg-[#12121f]/80 backdrop-blur-md border border-white/10 rounded-2xl px-1.5 py-1 shadow-2xl">
          <button
            onClick={() => { const [cx, cy] = getViewCenter(); zoomAtPoint(cameraRef.current.scale / 1.25, cx, cy); }}
            className="w-7 h-7 rounded-lg hover:bg-white/8 text-white/45 hover:text-white/75 transition-all flex items-center justify-center"
            title="Zoom Out (Ctrl+-)">
            <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>remove</span>
          </button>

          <button
            onClick={() => applyCamera({ x: 0, y: 0, scale: 1 })}
            className="min-w-[46px] text-center text-[10px] font-bold tabular-nums text-white/45 hover:text-white/75 transition-colors px-1 py-1 rounded-lg hover:bg-white/8"
            title="Reset Zoom (Ctrl+0)">
            {zoomPct}%
          </button>

          <button
            onClick={() => { const [cx, cy] = getViewCenter(); zoomAtPoint(cameraRef.current.scale * 1.25, cx, cy); }}
            className="w-7 h-7 rounded-lg hover:bg-white/8 text-white/45 hover:text-white/75 transition-all flex items-center justify-center"
            title="Zoom In (Ctrl+=)">
            <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>add</span>
          </button>

          <div className="w-px h-4 bg-white/12 mx-0.5" />

          <button
            onClick={fitToContent}
            className="w-7 h-7 rounded-lg hover:bg-white/8 text-white/45 hover:text-white/75 transition-all flex items-center justify-center"
            title="Fit to Content (Ctrl+F)">
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>fit_screen</span>
          </button>

          <button
            onClick={() => applyCamera({ x: 0, y: 0, scale: 1 })}
            className="w-7 h-7 rounded-lg hover:bg-white/8 text-white/45 hover:text-white/75 transition-all flex items-center justify-center"
            title="Reset View (Ctrl+0)">
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>home</span>
          </button>
        </div>

        {/* ── Hint bar (centre bottom) ── */}
        {tool !== 'hand' && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[10] pointer-events-none select-none">
            <p className="text-[9px] text-white/18 tracking-wider font-medium whitespace-nowrap">
              Hold <span className="bg-white/10 text-white/30 px-1.5 py-0.5 rounded font-bold">Space</span> or press <span className="bg-white/10 text-white/30 px-1.5 py-0.5 rounded font-bold">H</span> to pan
              &nbsp;·&nbsp; Ctrl+Scroll to zoom &nbsp;·&nbsp; Two-finger pinch & drag
            </p>
          </div>
        )}

        {/* Pan mode overlay indicator */}
        {tool === 'hand' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[10] pointer-events-none">
            <div className="flex items-center gap-1.5 bg-[var(--gold)]/10 border border-[var(--gold)]/30 text-[var(--gold)] text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full backdrop-blur-sm">
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>back_hand</span>
              Pan Mode
            </div>
          </div>
        )}
      </div>

      {/* ═══ BOTTOM TOOLBAR ═══ */}
      <div className="bg-[#12121f] border-t border-white/5 shrink-0 safe-bottom">
        {/* Color picker */}
        <AnimatePresence>
          {showColorPicker && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-2.5 overflow-x-auto scrollbar-hide">
                {DRAW_COLORS.map(c => (
                  <button key={c.id} onClick={() => setColor(c.hex)}
                    className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 shrink-0 flex items-center justify-center ${color === c.hex ? 'border-white scale-110 shadow-lg' : 'border-white/15'}`}
                    style={{ backgroundColor: c.hex }} title={c.label}>
                    {color === c.hex && <span className="material-symbols-outlined text-black/80" style={{ fontSize: '14px' }}>check</span>}
                  </button>
                ))}
                <div className="relative w-8 h-8 rounded-full border-2 border-dashed border-white/30 hover:border-white/50 overflow-hidden shrink-0 flex items-center justify-center">
                  <span className="material-symbols-outlined text-white/50 pointer-events-none" style={{ fontSize: '16px' }}>colorize</span>
                  <input type="color" value={color} onChange={e => setColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" title="Custom Color" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Size picker */}
        <AnimatePresence>
          {showSizePicker && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-4 justify-center">
                {SIZES.map(s => (
                  <button key={s} onClick={() => setSize(s)}
                    className={`flex items-center justify-center transition-all hover:scale-110 ${size === s ? 'ring-2 ring-[var(--gold)] ring-offset-2 ring-offset-[#12121f]' : ''} rounded-full`}
                    title={`Size ${s}`}>
                    <div className="rounded-full" style={{ width: `${s * 2 + 8}px`, height: `${s * 2 + 8}px`, backgroundColor: color }} />
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tools row */}
        <div className="flex items-center gap-1 px-2 py-2 overflow-x-auto scrollbar-hide">
          {TOOLS.map(t => (
            <button key={t.id} onClick={() => setTool(t.id)}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl transition-all shrink-0 ${
                tool === t.id ? 'bg-white/10 text-[var(--gold)]' : 'text-white/35 hover:text-white/60 hover:bg-white/5'
              }`}
              title={t.id === 'hand' ? 'Pan (H or hold Space)' : t.label}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{t.icon}</span>
              <span className="text-[8px] font-bold uppercase tracking-wider">{t.label}</span>
            </button>
          ))}

          <div className="w-px h-8 bg-white/10 mx-1 shrink-0" />

          {/* Color swatch */}
          <button onClick={() => { setShowColorPicker(!showColorPicker); setShowSizePicker(false); }}
            className={`p-2 rounded-xl transition-all shrink-0 ${showColorPicker ? 'bg-white/10' : 'hover:bg-white/5'}`} title="Color">
            <div className="w-6 h-6 rounded-full border-2 border-white/20" style={{ backgroundColor: color }} />
          </button>

          {/* Size */}
          <button onClick={() => { setShowSizePicker(!showSizePicker); setShowColorPicker(false); }}
            className={`p-2 rounded-xl transition-all shrink-0 flex items-center gap-1 ${showSizePicker ? 'bg-white/10 text-[var(--gold)]' : 'text-white/35 hover:text-white/60 hover:bg-white/5'}`}
            title="Brush Size">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>line_weight</span>
            <span className="text-[9px] font-bold text-white/30">{size}px</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default memo(DrawingCanvas);
