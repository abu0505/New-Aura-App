import { useState, useCallback, useEffect } from 'react';
import { parse, compile } from 'mathjs';
import FunctionInput, { FUNCTION_COLORS } from './FunctionInput';
import type { FunctionEntry } from './FunctionInput';
import GraphCanvas from './GraphCanvas';
import PresetPanel from './PresetPanel';
import AnalysisToolbar from './AnalysisToolbar';
import MathKeyboard from './MathKeyboard';
import { motion, AnimatePresence } from 'framer-motion';

interface MathGraphScreenProps {
  onBack?: () => void;
}

// Generate unique ID
let idCounter = 0;
const genId = () => `fn_${Date.now()}_${++idCounter}`;

// Validate expression using mathjs parser
function isValidExpression(expr: string): boolean {
  if (!expr.trim()) return false;
  try {
    // Attempt to parse — if it doesn't throw, it's valid syntax
    parse(expr);
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_DOMAIN: [number, number] = [-10, 10];
const DEFAULT_RANGE: [number, number] = [-10, 10];

export default function MathGraphScreen({ onBack }: MathGraphScreenProps) {
  // Function entries state
  const [functions, setFunctions] = useState<FunctionEntry[]>([
    { id: genId(), expression: '', colorIndex: 0, visible: true, isValid: false },
  ]);
  const [activeInputId, setActiveInputId] = useState<string>(functions[0]?.id || '');

  // Graph settings
  const [domain, setDomain] = useState<[number, number]>(DEFAULT_DOMAIN);
  const [range, setRange] = useState<[number, number]>(DEFAULT_RANGE);
  const [showDerivatives, setShowDerivatives] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridSpacing, setGridSpacing] = useState('auto');

  // Panels
  const [showPresets, setShowPresets] = useState(false);
  const [showMathKeyboard, setShowMathKeyboard] = useState(false);
  
  // Sidebar collapsed state (mobile)
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Expression change handler
  const handleExpressionChange = useCallback((id: string, expression: string) => {
    setFunctions(prev => prev.map(fn => 
      fn.id === id 
        ? { ...fn, expression, isValid: isValidExpression(expression) }
        : fn
    ));
  }, []);

  // Toggle visibility
  const handleToggleVisibility = useCallback((id: string) => {
    setFunctions(prev => prev.map(fn => 
      fn.id === id ? { ...fn, visible: !fn.visible } : fn
    ));
  }, []);

  // Remove function
  const handleRemove = useCallback((id: string) => {
    setFunctions(prev => {
      if (prev.length <= 1) return prev; // Keep at least one
      return prev.filter(fn => fn.id !== id);
    });
  }, []);

  // Add function
  const handleAddFunction = useCallback(() => {
    if (functions.length >= 5) return;
    const newEntry: FunctionEntry = {
      id: genId(),
      expression: '',
      colorIndex: functions.length,
      visible: true,
      isValid: false,
    };
    setFunctions(prev => [...prev, newEntry]);
    setActiveInputId(newEntry.id);
  }, [functions.length]);

  // Focus handler
  const handleFocus = useCallback((id: string) => {
    setActiveInputId(id);
  }, []);

  // Clear all functions
  const handleClearAll = useCallback(() => {
    const first = { id: genId(), expression: '', colorIndex: 0, visible: true, isValid: false };
    setFunctions([first]);
    setActiveInputId(first.id);
    setDomain(DEFAULT_DOMAIN);
    setRange(DEFAULT_RANGE);
  }, []);

  // Load preset
  const handleLoadPreset = useCallback((expressions: string[]) => {
    const newFunctions: FunctionEntry[] = expressions.map((expr, idx) => ({
      id: genId(),
      expression: expr,
      colorIndex: idx,
      visible: true,
      isValid: isValidExpression(expr),
    }));
    setFunctions(newFunctions);
    setActiveInputId(newFunctions[0]?.id || '');
    
    // Auto-adjust domain for trig presets
    const hasTrig = expressions.some(e => /sin|cos|tan/.test(e));
    if (hasTrig) {
      setDomain([-2 * Math.PI - 1, 2 * Math.PI + 1]);
      setRange([-4, 4]);
    } else {
      setDomain(DEFAULT_DOMAIN);
      setRange(DEFAULT_RANGE);
    }
  }, []);

  // Math keyboard symbol insertion
  const handleInsertSymbol = useCallback((symbol: string) => {
    setFunctions(prev => prev.map(fn => {
      if (fn.id === activeInputId) {
        const newExpr = fn.expression + symbol;
        return { ...fn, expression: newExpr, isValid: isValidExpression(newExpr) };
      }
      return fn;
    }));
  }, [activeInputId]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setDomain(prev => {
      const center = 0;
      const halfWidth = (prev[1] - prev[0]) / 4;
      return [center - halfWidth, center + halfWidth];
    });
    setRange(prev => {
      const center = 0;
      const halfHeight = (prev[1] - prev[0]) / 4;
      return [center - halfHeight, center + halfHeight];
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setDomain(prev => {
      const center = 0;
      const halfWidth = (prev[1] - prev[0]);
      return [center - halfWidth, center + halfWidth];
    });
    setRange(prev => {
      const center = 0;
      const halfHeight = (prev[1] - prev[0]);
      return [center - halfHeight, center + halfHeight];
    });
  }, []);

  const handleResetView = useCallback(() => {
    setDomain(DEFAULT_DOMAIN);
    setRange(DEFAULT_RANGE);
  }, []);

  // ── Point & Line Lab Types & States ──
  const [points, setPoints] = useState<{ id: string; x: number; y: number; label: string; isIntersection?: boolean }[]>([]);
  const [lines, setLines] = useState<{ id: string; expression: string; color: string; label: string; fnType?: 'linear' | 'implicit' }[]>([]);
  const [shapes, setShapes] = useState<{
    id: string;
    type: 'segment' | 'triangle' | 'square' | 'polygon';
    pointIds: string[];
    label: string;
    color: string;
    style?: 'solid' | 'dashed';
  }[]>([]);

  const [activeConnectStartPointId, setActiveConnectStartPointId] = useState<string | null>(null);
  const [connectStyle, setConnectStyle] = useState<'solid' | 'dashed'>('solid');

  const [isPlottingMode, setIsPlottingMode] = useState(false);
  const [showPointLab, setShowPointLab] = useState(false);

  // Sub-tabs in Point Lab
  const [labTab, setLabTab] = useState<'line' | 'path' | 'preset'>('line');

  // Path creator state
  const [selectedPathPointIds, setSelectedPathPointIds] = useState<string[]>([]);
  const [pathType, setPathType] = useState<'segment' | 'polygon'>('segment');

  // Preset shapes state
  const [presetShapeType, setPresetShapeType] = useState<'triangle' | 'square' | 'rectangle'>('triangle');
  const [t1X, setT1X] = useState('');
  const [t1Y, setT1Y] = useState('');
  const [t2X, setT2X] = useState('');
  const [t2Y, setT2Y] = useState('');
  const [t3X, setT3X] = useState('');
  const [t3Y, setT3Y] = useState('');
  const [sqCX, setSqCX] = useState('');
  const [sqCY, setSqCY] = useState('');
  const [sqSide, setSqSide] = useState('');
  const [rectCX, setRectCX] = useState('');
  const [rectCY, setRectCY] = useState('');
  const [rectW, setRectW] = useState('');
  const [rectH, setRectH] = useState('');

  // Form inputs
  const [manualX, setManualX] = useState('');
  const [manualY, setManualY] = useState('');
  const [selectedPointId1, setSelectedPointId1] = useState('');
  const [selectedPointId2, setSelectedPointId2] = useState('');
  const [intersectItem1, setIntersectItem1] = useState('');
  const [intersectItem2, setIntersectItem2] = useState('');

  // Dropdown open states
  const [p1DropdownOpen, setP1DropdownOpen] = useState(false);
  const [p2DropdownOpen, setP2DropdownOpen] = useState(false);
  const [i1DropdownOpen, setI1DropdownOpen] = useState(false);
  const [i2DropdownOpen, setI2DropdownOpen] = useState(false);

  const toggleP1Dropdown = useCallback(() => {
    setP1DropdownOpen(prev => !prev);
    setP2DropdownOpen(false);
    setI1DropdownOpen(false);
    setI2DropdownOpen(false);
  }, []);

  const toggleP2Dropdown = useCallback(() => {
    setP2DropdownOpen(prev => !prev);
    setP1DropdownOpen(false);
    setI1DropdownOpen(false);
    setI2DropdownOpen(false);
  }, []);

  const toggleI1Dropdown = useCallback(() => {
    setI1DropdownOpen(prev => !prev);
    setP1DropdownOpen(false);
    setP2DropdownOpen(false);
    setI2DropdownOpen(false);
  }, []);

  const toggleI2Dropdown = useCallback(() => {
    setI2DropdownOpen(prev => !prev);
    setP1DropdownOpen(false);
    setP2DropdownOpen(false);
    setI1DropdownOpen(false);
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!p1DropdownOpen && !p2DropdownOpen && !i1DropdownOpen && !i2DropdownOpen) return;
    const handleCloseAll = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.dropdown-trigger') || target.closest('.dropdown-menu')) {
        return;
      }
      setP1DropdownOpen(false);
      setP2DropdownOpen(false);
      setI1DropdownOpen(false);
      setI2DropdownOpen(false);
    };
    document.addEventListener('click', handleCloseAll);
    return () => document.removeEventListener('click', handleCloseAll);
  }, [p1DropdownOpen, p2DropdownOpen, i1DropdownOpen, i2DropdownOpen]);

  // Graph Click Handler with Snapping and Direct Connection support
  const handleGraphClick = useCallback((x: number, y: number) => {
    // 1. Check if clicked near an existing point first if Point Lab is open
    if (showPointLab) {
      const domainWidth = domain[1] - domain[0];
      const rangeHeight = range[1] - range[0];
      const thresholdX = domainWidth * 0.035;
      const thresholdY = rangeHeight * 0.035;

      const clickedPoint = points.find(
        p => !p.isIntersection && Math.abs(p.x - x) < thresholdX && Math.abs(p.y - y) < thresholdY
      );

      if (clickedPoint) {
        if (!activeConnectStartPointId) {
          // Select start point
          setActiveConnectStartPointId(clickedPoint.id);
        } else {
          if (activeConnectStartPointId === clickedPoint.id) {
            // Deselect if clicked same point
            setActiveConnectStartPointId(null);
          } else {
            // Connect to this point
            const startPoint = points.find(p => p.id === activeConnectStartPointId);
            if (startPoint) {
              const newShape = {
                id: `shape_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                type: 'segment' as const,
                pointIds: [activeConnectStartPointId, clickedPoint.id],
                label: `Line Segment ${startPoint.label}${clickedPoint.label}`,
                color: FUNCTION_COLORS[shapes.length % FUNCTION_COLORS.length].hex,
                style: connectStyle
              };
              setShapes(prev => [...prev, newShape]);
              setActiveConnectStartPointId(null);
            }
          }
        }
        return; // Don't place a new point
      }
    }

    // If clicked empty space, reset selection
    if (activeConnectStartPointId) {
      setActiveConnectStartPointId(null);
    }

    // Only plot new points if click-to-plot mode is active
    if (!isPlottingMode) return;

    let clickX = x;
    let clickY = y;

    if (snapToGrid) {
      if (gridSpacing === '1') {
        clickX = Math.round(x);
        clickY = Math.round(y);
      } else if (gridSpacing === '2') {
        clickX = Math.round(x / 2) * 2;
        clickY = Math.round(y / 2) * 2;
      } else if (gridSpacing === '5') {
        clickX = Math.round(x / 5) * 5;
        clickY = Math.round(y / 5) * 5;
      } else if (gridSpacing === '10') {
        clickX = Math.round(x / 10) * 10;
        clickY = Math.round(y / 10) * 10;
      } else if (gridSpacing === '0.5') {
        clickX = Math.round(x * 2) / 2;
        clickY = Math.round(y * 2) / 2;
      } else {
        // Auto: snap to nearest 0.5, 1, 2, or 5 based on domain width
        const domainWidth = domain[1] - domain[0];
        const step = domainWidth <= 15 ? 0.5 : domainWidth <= 40 ? 1 : domainWidth <= 100 ? 2 : 5;
        clickX = Math.round(x / step) * step;
        clickY = Math.round(y / step) * step;
      }
    }

    // Check if a point already exists at this coordinate to avoid duplicates
    if (points.some(p => Math.abs(p.x - clickX) < 1e-4 && Math.abs(p.y - clickY) < 1e-4)) {
      return;
    }

    const userPoints = points.filter(p => !p.isIntersection);
    const label = String.fromCharCode(65 + (userPoints.length % 26)) + (userPoints.length >= 26 ? Math.floor(userPoints.length / 26) : '');
    const newPoint = {
      id: `point_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      x: parseFloat(clickX.toFixed(3)),
      y: parseFloat(clickY.toFixed(3)),
      label
    };
    setPoints(prev => [...prev, newPoint]);
  }, [isPlottingMode, points, snapToGrid, gridSpacing, domain, range, showPointLab, activeConnectStartPointId, connectStyle, shapes.length]);

  // Add Manual Point
  const handleAddManualPoint = useCallback(() => {
    const x = parseFloat(manualX);
    const y = parseFloat(manualY);
    if (isNaN(x) || isNaN(y)) return;

    const userPoints = points.filter(p => !p.isIntersection);
    const label = String.fromCharCode(65 + (userPoints.length % 26)) + (userPoints.length >= 26 ? Math.floor(userPoints.length / 26) : '');
    const newPoint = {
      id: `point_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      x,
      y,
      label
    };
    setPoints(prev => [...prev, newPoint]);
    setManualX('');
    setManualY('');
  }, [manualX, manualY, points]);

  // Join Points
  const handleJoinPoints = useCallback(() => {
    if (!selectedPointId1 || !selectedPointId2 || selectedPointId1 === selectedPointId2) return;
    const p1 = points.find(p => p.id === selectedPointId1);
    const p2 = points.find(p => p.id === selectedPointId2);
    if (!p1 || !p2) return;

    const lineId = `line_${p1.label}${p2.label}`;
    if (lines.some(l => l.id === lineId)) return;

    let expression = '';
    let displayEq = '';
    let fnType: 'linear' | 'implicit' = 'linear';

    if (Math.abs(p1.x - p2.x) < 1e-5) {
      expression = `x - ${p1.x}`;
      displayEq = `x = ${p1.x}`;
      fnType = 'implicit';
    } else {
      const m = (p2.y - p1.y) / (p2.x - p1.x);
      const c = p1.y - m * p1.x;
      const mVal = parseFloat(m.toFixed(3));
      const cVal = parseFloat(c.toFixed(3));
      expression = `${mVal} * x + ${cVal}`;
      const mStr = mVal === 1 ? 'x' : mVal === -1 ? '-x' : mVal === 0 ? '' : `${mVal}x`;
      const cStr = cVal === 0 ? '' : cVal > 0 ? ` + ${cVal}` : ` - ${Math.abs(cVal)}`;
      displayEq = `y = ${mStr || '0'}${cStr}`;
    }

    const newLine = {
      id: lineId,
      expression,
      color: FUNCTION_COLORS[lines.length % FUNCTION_COLORS.length].hex,
      label: `Line ${p1.label}${p2.label} (${displayEq})`,
      fnType
    };

    setLines(prev => [...prev, newLine]);
    setSelectedPointId1('');
    setSelectedPointId2('');
  }, [selectedPointId1, selectedPointId2, points, lines]);

  // Find Intersections
  const handleFindIntersections = useCallback(() => {
    if (!intersectItem1 || !intersectItem2 || intersectItem1 === intersectItem2) return;

    let expr1 = '';
    let isVertical1 = false;
    let verticalX1 = 0;

    if (intersectItem1.startsWith('fn_')) {
      const fn = functions.find(f => f.id === intersectItem1);
      if (fn && fn.isValid) expr1 = fn.expression;
    } else if (intersectItem1.startsWith('line_')) {
      const ln = lines.find(l => l.id === intersectItem1);
      if (ln) {
        if (ln.fnType === 'implicit') {
          isVertical1 = true;
          verticalX1 = parseFloat(ln.expression.replace('x - ', ''));
        } else {
          expr1 = ln.expression;
        }
      }
    }

    let expr2 = '';
    let isVertical2 = false;
    let verticalX2 = 0;

    if (intersectItem2.startsWith('fn_')) {
      const fn = functions.find(f => f.id === intersectItem2);
      if (fn && fn.isValid) expr2 = fn.expression;
    } else if (intersectItem2.startsWith('line_')) {
      const ln = lines.find(l => l.id === intersectItem2);
      if (ln) {
        if (ln.fnType === 'implicit') {
          isVertical2 = true;
          verticalX2 = parseFloat(ln.expression.replace('x - ', ''));
        } else {
          expr2 = ln.expression;
        }
      }
    }

    if (!expr1 && !isVertical1) return;
    if (!expr2 && !isVertical2) return;

    const foundIntersections: { x: number; y: number }[] = [];

    if (isVertical1 && isVertical2) return;

    if (isVertical1 || isVertical2) {
      const vertX = isVertical1 ? verticalX1 : verticalX2;
      const nonVertExpr = isVertical1 ? expr2 : expr1;
      try {
        const compiled = compile(nonVertExpr);
        const yVal = compiled.evaluate({ x: vertX });
        if (!isNaN(yVal)) {
          foundIntersections.push({ x: vertX, y: parseFloat(yVal.toFixed(3)) });
        }
      } catch (e) {
        console.error(e);
      }
    } else {
      try {
        const code1 = compile(expr1);
        const code2 = compile(expr2);
        const f = (x: number) => {
          try {
            return code1.evaluate({ x }) - code2.evaluate({ x });
          } catch {
            return NaN;
          }
        };

        const xMin = domain[0];
        const xMax = domain[1];
        const steps = 150;
        const stepSize = (xMax - xMin) / steps;

        for (let i = 0; i < steps; i++) {
          const x1 = xMin + i * stepSize;
          const x2 = x1 + stepSize;
          const y1 = f(x1);
          const y2 = f(x2);

          if (isNaN(y1) || isNaN(y2)) continue;

          if (y1 * y2 < 0) {
            let left = x1;
            let right = x2;
            let mid = 0;
            for (let k = 0; k < 20; k++) {
              mid = (left + right) / 2;
              const yMid = f(mid);
              if (Math.abs(yMid) < 1e-6) break;
              if (f(left) * yMid < 0) {
                right = mid;
              } else {
                left = mid;
              }
            }
            const xVal = parseFloat(mid.toFixed(3));
            const yVal = parseFloat(code1.evaluate({ x: mid }).toFixed(3));
            if (!isNaN(yVal)) {
              foundIntersections.push({ x: xVal, y: yVal });
            }
          } else if (Math.abs(y1) < 1e-5) {
            const xVal = parseFloat(x1.toFixed(3));
            const yVal = parseFloat(code1.evaluate({ x: x1 }).toFixed(3));
            if (!isNaN(yVal) && !foundIntersections.some(r => Math.abs(r.x - xVal) < 0.05)) {
              foundIntersections.push({ x: xVal, y: yVal });
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    }

    if (foundIntersections.length > 0) {
      setPoints(prev => {
        const filtered = prev.filter(p => !p.isIntersection);
        const newPoints = [...filtered];
        foundIntersections.forEach((pt, idx) => {
          newPoints.push({
            id: `intersect_${Date.now()}_${idx}`,
            x: pt.x,
            y: pt.y,
            label: `I${idx + 1}`,
            isIntersection: true
          });
        });
        return newPoints;
      });
    }
  }, [intersectItem1, intersectItem2, functions, lines, domain]);

  // Remove Point
  const handleRemovePoint = useCallback((id: string) => {
    setPoints(prev => {
      const point = prev.find(p => p.id === id);
      if (point) {
        setLines(linesPrev => linesPrev.filter(l => !l.id.includes(point.label)));
        setShapes(shapesPrev => shapesPrev.filter(s => !s.pointIds.includes(id)));
      }
      return prev.filter(p => p.id !== id);
    });
  }, []);

  // Remove Line
  const handleRemoveLine = useCallback((id: string) => {
    setLines(prev => prev.filter(l => l.id !== id));
  }, []);

  // Remove Shape
  const handleRemoveShape = useCallback((id: string) => {
    setShapes(prev => prev.filter(s => s.id !== id));
  }, []);

  // Clear Lab
  const handleClearPointLab = useCallback(() => {
    setPoints([]);
    setLines([]);
    setShapes([]);
  }, []);

  // Create Path/Polygon from checked points
  const handleCreatePath = useCallback(() => {
    if (selectedPathPointIds.length < 2) return;
    
    const connectedPoints = selectedPathPointIds
      .map(id => points.find(p => p.id === id))
      .filter((p): p is NonNullable<typeof p> => !!p);
    
    const label = pathType === 'segment'
      ? `Path ${connectedPoints.map(p => p.label).join('-')}`
      : `Polygon ${connectedPoints.map(p => p.label).join('')}`;

    const newShape = {
      id: `shape_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      type: (pathType === 'segment' ? 'segment' : 'polygon') as any,
      pointIds: [...selectedPathPointIds],
      label,
      color: FUNCTION_COLORS[shapes.length % FUNCTION_COLORS.length].hex
    };

    setShapes(prev => [...prev, newShape]);
    setSelectedPathPointIds([]);
  }, [selectedPathPointIds, points, pathType, shapes.length]);

  // Create shape from Preset Coordinates form
  const handleCreatePresetShape = useCallback(() => {
    const currentPoints = [...points];
    const getOrCreatePoint = (xVal: number, yVal: number) => {
      const x = parseFloat(xVal.toFixed(3));
      const y = parseFloat(yVal.toFixed(3));
      const existing = currentPoints.find(p => Math.abs(p.x - x) < 1e-4 && Math.abs(p.y - y) < 1e-4);
      if (existing) return existing.id;

      const userPoints = currentPoints.filter(p => !p.isIntersection);
      const label = String.fromCharCode(65 + (userPoints.length % 26)) + (userPoints.length >= 26 ? Math.floor(userPoints.length / 26) : '');
      const newId = `point_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      const newPoint = { id: newId, x, y, label };
      currentPoints.push(newPoint);
      return newId;
    };

    const createdPointIds: string[] = [];
    let shapeLabel = '';
    let shapeType: 'triangle' | 'square' | 'polygon' = 'triangle';

    if (presetShapeType === 'triangle') {
      const x1 = parseFloat(t1X);
      const y1 = parseFloat(t1Y);
      const x2 = parseFloat(t2X);
      const y2 = parseFloat(t2Y);
      const x3 = parseFloat(t3X);
      const y3 = parseFloat(t3Y);

      if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2) || isNaN(x3) || isNaN(y3)) return;

      const p1Id = getOrCreatePoint(x1, y1);
      const p2Id = getOrCreatePoint(x2, y2);
      const p3Id = getOrCreatePoint(x3, y3);

      createdPointIds.push(p1Id, p2Id, p3Id);
      
      const p1Label = currentPoints.find(p => p.id === p1Id)?.label || 'A';
      const p2Label = currentPoints.find(p => p.id === p2Id)?.label || 'B';
      const p3Label = currentPoints.find(p => p.id === p3Id)?.label || 'C';
      
      shapeLabel = `Triangle ${p1Label}${p2Label}${p3Label}`;
      shapeType = 'triangle';
      
      setT1X(''); setT1Y('');
      setT2X(''); setT2Y('');
      setT3X(''); setT3Y('');
    } else if (presetShapeType === 'square') {
      const cx = parseFloat(sqCX);
      const cy = parseFloat(sqCY);
      const s = parseFloat(sqSide);

      if (isNaN(cx) || isNaN(cy) || isNaN(s) || s <= 0) return;

      const p1Id = getOrCreatePoint(cx - s/2, cy - s/2);
      const p2Id = getOrCreatePoint(cx + s/2, cy - s/2);
      const p3Id = getOrCreatePoint(cx + s/2, cy + s/2);
      const p4Id = getOrCreatePoint(cx - s/2, cy + s/2);

      createdPointIds.push(p1Id, p2Id, p3Id, p4Id);
      shapeLabel = `Square (Center: ${cx},${cy}; Side: ${s})`;
      shapeType = 'square';

      setSqCX(''); setSqCY(''); setSqSide('');
    } else if (presetShapeType === 'rectangle') {
      const cx = parseFloat(rectCX);
      const cy = parseFloat(rectCY);
      const w = parseFloat(rectW);
      const h = parseFloat(rectH);

      if (isNaN(cx) || isNaN(cy) || isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return;

      const p1Id = getOrCreatePoint(cx - w/2, cy - h/2);
      const p2Id = getOrCreatePoint(cx + w/2, cy - h/2);
      const p3Id = getOrCreatePoint(cx + w/2, cy + h/2);
      const p4Id = getOrCreatePoint(cx - w/2, cy + h/2);

      createdPointIds.push(p1Id, p2Id, p3Id, p4Id);
      shapeLabel = `Rectangle (Center: ${cx},${cy}; ${w}x${h})`;
      shapeType = 'square';

      setRectCX(''); setRectCY(''); setRectW(''); setRectH('');
    }

    if (createdPointIds.length > 0) {
      setPoints(currentPoints);
      const newShape = {
        id: `shape_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        type: shapeType,
        pointIds: createdPointIds,
        label: shapeLabel,
        color: FUNCTION_COLORS[shapes.length % FUNCTION_COLORS.length].hex
      };
      setShapes(prev => [...prev, newShape]);
    }
  }, [presetShapeType, t1X, t1Y, t2X, t2Y, t3X, t3Y, sqCX, sqCY, sqSide, rectCX, rectCY, rectW, rectH, points, shapes.length]);

  // Count active functions for display
  const activeFnCount = functions.filter(f => f.visible && f.isValid && f.expression.trim()).length;

  // Resolve shape point coordinates
  const resolvedShapes = shapes.map(shape => ({
    id: shape.id,
    type: shape.type,
    color: shape.color,
    label: shape.label,
    style: shape.style,
    points: shape.pointIds
      .map(pId => points.find(p => p.id === pId))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map(p => ({ x: p.x, y: p.y }))
  })).filter(s => s.points.length > 0);

  return (
    <div className="w-full h-full bg-[var(--bg-primary)] flex flex-col font-sans overflow-hidden relative">
      {/* ═══ Header ═══ */}
      <header className="px-4 lg:px-6 pt-4 lg:pt-6 pb-3 lg:pb-4 flex items-center gap-3 border-b border-white/5 bg-black/20 shrink-0 safe-top z-20">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onBack) {
              onBack();
            } else {
              document.dispatchEvent(new CustomEvent('toggle-nav'));
            }
          }}
          className={`p-2 -ml-2 rounded-full text-[#998f81] hover:text-[var(--gold)] hover:bg-white/5 active:scale-90 transition-all flex items-center justify-center shrink-0 ${onBack ? '' : 'lg:hidden'}`}
        >
          <span className="material-symbols-outlined text-xl">{onBack ? 'arrow_back' : 'menu'}</span>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-serif italic text-xl lg:text-2xl text-[var(--gold)] flex items-center gap-2">
            <span className="material-symbols-outlined text-cyan-400 text-xl">show_chart</span>
            Math Lab
          </h1>
          <p className="font-label text-[9px] lg:text-[10px] uppercase tracking-[0.15em] text-[#998f81] truncate">
            IIT Madras BS Degree • Graph Plotter & Analysis
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Toggle sidebar on mobile */}
          <button
            onClick={() => setSidebarOpen(prev => !prev)}
            className="p-2 rounded-full text-white/40 hover:text-white/70 hover:bg-white/5 transition-all lg:hidden"
            title="Toggle controls"
          >
            <span className="material-symbols-outlined text-lg">{sidebarOpen ? 'left_panel_close' : 'left_panel_open'}</span>
          </button>

          {/* Active functions count badge */}
          {activeFnCount > 0 && (
            <span className="text-[9px] font-bold tracking-wider text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded-full border border-cyan-400/20">
              {activeFnCount} active
            </span>
          )}

          {/* Clear All */}
          <button
            onClick={handleClearAll}
            className="p-2 rounded-full text-white/30 hover:text-red-400/80 hover:bg-red-400/10 transition-all active:scale-90"
            title="Clear all functions"
          >
            <span className="material-symbols-outlined text-lg">delete_sweep</span>
          </button>
        </div>
      </header>

      {/* ═══ Main Content ═══ */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        {/* ── Left Panel: Controls (collapsible on mobile) ── */}
        <div 
          className={`${
            sidebarOpen ? 'flex max-h-[60vh]' : 'hidden max-h-0'
          } lg:flex lg:max-h-none flex-col w-full lg:w-[340px] xl:w-[380px] shrink-0 border-b lg:border-b-0 lg:border-r border-white/5 bg-black/10 overflow-y-auto scrollbar-hide transition-[max-height] duration-300`}
        >
          <div className="flex flex-col w-full">
            {/* Function Inputs Section */}
            <div className="p-3 lg:p-4 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Functions</span>
                {functions.length < 5 && (
                  <button
                    onClick={handleAddFunction}
                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-cyan-400/70 hover:text-cyan-300 transition-colors active:scale-95"
                  >
                    <span className="material-symbols-outlined text-[14px]">add</span>
                    Add
                  </button>
                )}
              </div>

              {functions.map((fn, idx) => (
                <FunctionInput
                  key={fn.id}
                  entry={fn}
                  index={idx}
                  isActive={activeInputId === fn.id}
                  onExpressionChange={handleExpressionChange}
                  onToggleVisibility={handleToggleVisibility}
                  onRemove={handleRemove}
                  onFocus={handleFocus}
                />
              ))}
            </div>

            {/* Separator */}
            <div className="mx-3 lg:mx-4 border-t border-white/5" />

            {/* Math Keyboard */}
            <div className="p-3 lg:p-4">
              <MathKeyboard
                onInsert={handleInsertSymbol}
                isOpen={showMathKeyboard}
                onToggle={() => setShowMathKeyboard(prev => !prev)}
              />
            </div>

            {/* Separator */}
            <div className="mx-3 lg:mx-4 border-t border-white/5" />

            {/* Point & Line Lab Section */}
            <div className="p-3 lg:p-4">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowPointLab(prev => !prev)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider text-cyan-400/80 hover:text-cyan-300 hover:bg-cyan-400/10 transition-all active:scale-95"
                >
                  <span className="material-symbols-outlined text-sm">point_of_sale</span>
                  <span>Point & Line Lab</span>
                  <span 
                    className="material-symbols-outlined text-xs transition-transform duration-300"
                    style={{ transform: showPointLab ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  >
                    expand_more
                  </span>
                </button>

                {showPointLab && (points.length > 0 || lines.length > 0) && (
                  <button
                    onClick={handleClearPointLab}
                    className="text-[9px] font-bold uppercase tracking-wider text-red-400/60 hover:text-red-400 transition-colors"
                  >
                    Clear Lab
                  </button>
                )}
              </div>

              <AnimatePresence>
                {showPointLab && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="space-y-3 mt-2"
                    style={{ overflow: 'visible' }}
                  >
                    {/* Click-to-Plot Toggle */}
                    <button
                      onClick={() => setIsPlottingMode(prev => !prev)}
                      className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                        isPlottingMode
                          ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300 animate-pulse'
                          : 'bg-white/[0.02] border-white/5 hover:border-white/10 text-white/60 hover:text-white/80'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">touch_app</span>
                      {isPlottingMode ? 'Click Graph to Place Points' : 'Activate Click-to-Plot'}
                    </button>

                    {/* Active Connect Start Point Info */}
                    {activeConnectStartPointId && (
                      <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px] animate-pulse">radio_button_checked</span>
                            Connecting Points
                          </span>
                          <button
                            onClick={() => setActiveConnectStartPointId(null)}
                            className="text-[9px] font-bold uppercase tracking-wider text-amber-400/60 hover:text-amber-400 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                        <p className="text-[11px] text-amber-300/80">
                          Click on another point on the graph to connect it from{' '}
                          <span className="font-bold text-amber-400 font-mono">
                            {points.find(p => p.id === activeConnectStartPointId)?.label}
                          </span>
                          .
                        </p>
                      </div>
                    )}

                    {/* Direct Connect Options */}
                    <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-white/30">Line Segment Style</span>
                        <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/5">
                          <button
                            type="button"
                            onClick={() => setConnectStyle('solid')}
                            className={`px-2.5 py-0.5 text-[9px] font-bold uppercase rounded transition-all ${
                              connectStyle === 'solid'
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/20'
                                : 'text-white/30 hover:text-white/50 border border-transparent'
                            }`}
                          >
                            Solid
                          </button>
                          <button
                            type="button"
                            onClick={() => setConnectStyle('dashed')}
                            className={`px-2.5 py-0.5 text-[9px] font-bold uppercase rounded transition-all ${
                              connectStyle === 'dashed'
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/20'
                                : 'text-white/30 hover:text-white/50 border border-transparent'
                            }`}
                          >
                            Dotted
                          </button>
                        </div>
                      </div>
                      <p className="text-[9px] text-white/20 italic leading-relaxed">
                        💡 Tip: Click any point on the graph to set it as start, choose the style above, and click a second point to connect them directly!
                      </p>
                    </div>

                    {/* Manual Point Input */}
                    <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 space-y-2">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">Plot Point Manually</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                          <span className="text-[10px] font-mono text-white/30">X:</span>
                          <input
                            type="text"
                            value={manualX}
                            onChange={(e) => setManualX(e.target.value)}
                            placeholder="0"
                            className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none focus-visible:outline-none focus:ring-0"
                            autoComplete="off"
                          />
                        </div>
                        <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                          <span className="text-[10px] font-mono text-white/30">Y:</span>
                          <input
                            type="text"
                            value={manualY}
                            onChange={(e) => setManualY(e.target.value)}
                            placeholder="0"
                            className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none focus-visible:outline-none focus:ring-0"
                            autoComplete="off"
                          />
                        </div>
                        <button
                          onClick={handleAddManualPoint}
                          className="px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-500/30 hover:border-cyan-400/40 rounded-lg text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition-colors"
                        >
                          Plot
                        </button>
                      </div>
                    </div>

                    {/* Point List */}
                    {points.length > 0 && (
                      <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 space-y-1.5">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">Plotted Points</p>
                        <div className="max-h-[120px] overflow-y-auto space-y-1 pr-1 scrollbar-hide">
                          {points.map((pt) => (
                            <div key={pt.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-[11px] font-mono">
                              <span className={pt.isIntersection ? "text-green-400 font-semibold" : "text-cyan-400 font-semibold"}>
                                {pt.label}({pt.x}, {pt.y})
                              </span>
                              <button
                                onClick={() => handleRemovePoint(pt.id)}
                                className="text-white/25 hover:text-red-400 transition-colors"
                              >
                                <span className="material-symbols-outlined text-[14px]">close</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Lab Sub-Tabs */}
                    <div className="flex items-center bg-black/40 border border-white/5 rounded-lg p-0.5 mt-2">
                      <button
                        type="button"
                        onClick={() => setLabTab('line')}
                        className={`flex-1 text-center py-1.5 text-[9px] font-bold uppercase tracking-wider rounded transition-all outline-none focus:outline-none ${
                          labTab === 'line'
                            ? 'bg-cyan-500/20 text-cyan-300 font-extrabold border border-cyan-500/30'
                            : 'text-white/40 hover:text-white/70 border border-transparent'
                        }`}
                      >
                        Lines
                      </button>
                      <button
                        type="button"
                        onClick={() => setLabTab('path')}
                        className={`flex-1 text-center py-1.5 text-[9px] font-bold uppercase tracking-wider rounded transition-all outline-none focus:outline-none ${
                          labTab === 'path'
                            ? 'bg-cyan-500/20 text-cyan-300 font-extrabold border border-cyan-500/30'
                            : 'text-white/40 hover:text-white/70 border border-transparent'
                        }`}
                      >
                        Join Multi
                      </button>
                      <button
                        type="button"
                        onClick={() => setLabTab('preset')}
                        className={`flex-1 text-center py-1.5 text-[9px] font-bold uppercase tracking-wider rounded transition-all outline-none focus:outline-none ${
                          labTab === 'preset'
                            ? 'bg-cyan-500/20 text-cyan-300 font-extrabold border border-cyan-500/30'
                            : 'text-white/40 hover:text-white/70 border border-transparent'
                        }`}
                      >
                        Shapes
                      </button>
                    </div>

                    {/* Tab 1: Lines (Infinite Lines & Intersections) */}
                    {labTab === 'line' && (
                      <div className="space-y-3">
                        {/* Join Points (Line Creator) */}
                        {points.filter(p => !p.isIntersection).length >= 2 && (
                          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 space-y-2">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">Create Infinite Line</p>
                            <div className="flex items-center gap-2">
                              {/* Custom Dropdown Point 1 */}
                              <div className="relative flex-1">
                                <button
                                  type="button"
                                  onClick={toggleP1Dropdown}
                                  className="dropdown-trigger w-full flex items-center justify-between bg-black/40 border border-white/5 rounded-lg px-2.5 py-1.5 text-xs text-white/70 outline-none text-left focus:border-white/20"
                                >
                                  <span className="truncate">
                                    {selectedPointId1 ? points.find(p => p.id === selectedPointId1)?.label + '(' + points.find(p => p.id === selectedPointId1)?.x + ', ' + points.find(p => p.id === selectedPointId1)?.y + ')' : "Point 1"}
                                  </span>
                                  <span className="material-symbols-outlined text-[14px] text-white/30 shrink-0">expand_more</span>
                                </button>
                                
                                {p1DropdownOpen && (
                                  <div className="dropdown-menu absolute top-full left-0 right-0 mt-1 bg-[#151518] border border-white/10 rounded-xl shadow-2xl z-50 max-h-[160px] overflow-y-auto scrollbar-hide py-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedPointId1('');
                                        setP1DropdownOpen(false);
                                      }}
                                      className="w-full text-left px-3 py-2 text-xs text-white/40 hover:bg-white/[0.04] hover:text-white transition-colors outline-none focus:outline-none"
                                    >
                                      Clear Selection
                                    </button>
                                    {points.filter(p => !p.isIntersection && p.id !== selectedPointId2).map(p => (
                                      <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => {
                                          setSelectedPointId1(p.id);
                                          setP1DropdownOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/[0.04] hover:text-white transition-colors font-mono outline-none focus:outline-none"
                                      >
                                        {p.label}({p.x}, {p.y})
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Custom Dropdown Point 2 */}
                              <div className="relative flex-1">
                                <button
                                  type="button"
                                  onClick={toggleP2Dropdown}
                                  className="dropdown-trigger w-full flex items-center justify-between bg-black/40 border border-white/5 rounded-lg px-2.5 py-1.5 text-xs text-white/70 outline-none text-left focus:border-white/20"
                                >
                                  <span className="truncate">
                                    {selectedPointId2 ? points.find(p => p.id === selectedPointId2)?.label + '(' + points.find(p => p.id === selectedPointId2)?.x + ', ' + points.find(p => p.id === selectedPointId2)?.y + ')' : "Point 2"}
                                  </span>
                                  <span className="material-symbols-outlined text-[14px] text-white/30 shrink-0">expand_more</span>
                                </button>
                                
                                {p2DropdownOpen && (
                                  <div className="dropdown-menu absolute top-full left-0 right-0 mt-1 bg-[#151518] border border-white/10 rounded-xl shadow-2xl z-50 max-h-[160px] overflow-y-auto scrollbar-hide py-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedPointId2('');
                                        setP2DropdownOpen(false);
                                      }}
                                      className="w-full text-left px-3 py-2 text-xs text-white/40 hover:bg-white/[0.04] hover:text-white transition-colors outline-none focus:outline-none"
                                    >
                                      Clear Selection
                                    </button>
                                    {points.filter(p => !p.isIntersection && p.id !== selectedPointId1).map(p => (
                                      <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => {
                                          setSelectedPointId2(p.id);
                                          setP2DropdownOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/[0.04] hover:text-white transition-colors font-mono outline-none focus:outline-none"
                                      >
                                        {p.label}({p.x}, {p.y})
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={handleJoinPoints}
                                disabled={!selectedPointId1 || !selectedPointId2}
                                className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/35 border border-rose-500/30 hover:border-rose-400/40 disabled:opacity-40 disabled:pointer-events-none rounded-lg text-[10px] font-bold uppercase tracking-wider text-rose-300 transition-colors"
                              >
                                Join
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Joined Lines List */}
                        {lines.length > 0 && (
                          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 space-y-1.5">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">Lines</p>
                            <div className="max-h-[100px] overflow-y-auto space-y-1 pr-1 scrollbar-hide">
                              {lines.map((ln) => (
                                <div key={ln.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-[11px] font-mono">
                                  <span className="text-rose-400 truncate flex-1 mr-2" title={ln.label}>
                                    {ln.label}
                                  </span>
                                  <button
                                    onClick={() => handleRemoveLine(ln.id)}
                                    className="text-white/25 hover:text-red-400 transition-colors"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">close</span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Intersection Finder */}
                        {(functions.filter(f => f.visible && f.isValid && f.expression.trim()).length + lines.length) >= 2 && (
                          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 space-y-2">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">Find Intersections</p>
                            <div className="flex items-center gap-2">
                              {/* Custom Dropdown Item 1 */}
                              <div className="relative flex-1">
                                <button
                                  type="button"
                                  onClick={toggleI1Dropdown}
                                  className="dropdown-trigger w-full flex items-center justify-between bg-black/40 border border-white/5 rounded-lg px-2.5 py-1.5 text-xs text-white/70 outline-none text-left focus:border-white/20"
                                >
                                  <span className="truncate">
                                    {intersectItem1 ? (
                                      intersectItem1.startsWith('fn_') 
                                        ? `f${functions.findIndex(f => f.id === intersectItem1) + 1}: ${functions.find(f => f.id === intersectItem1)?.expression}`
                                        : intersectItem1.replace('line_', 'Line ')
                                    ) : "Select Item 1"}
                                  </span>
                                  <span className="material-symbols-outlined text-[14px] text-white/30 shrink-0">expand_more</span>
                                </button>
                                
                                {i1DropdownOpen && (
                                  <div className="dropdown-menu absolute top-full left-0 right-0 mt-1 bg-[#151518] border border-white/10 rounded-xl shadow-2xl z-50 max-h-[160px] overflow-y-auto scrollbar-hide py-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIntersectItem1('');
                                        setI1DropdownOpen(false);
                                      }}
                                      className="w-full text-left px-3 py-2 text-xs text-white/40 hover:bg-white/[0.04] hover:text-white transition-colors outline-none focus:outline-none"
                                    >
                                      Clear Selection
                                    </button>
                                    {functions.filter(f => f.visible && f.isValid && f.expression.trim()).map((f, idx) => (
                                      <button
                                        key={f.id}
                                        type="button"
                                        onClick={() => {
                                          setIntersectItem1(f.id);
                                          setI1DropdownOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/[0.04] hover:text-white transition-colors font-mono outline-none focus:outline-none"
                                      >
                                        f{idx + 1}: {f.expression}
                                      </button>
                                    ))}
                                    {lines.map(l => (
                                      <button
                                        key={l.id}
                                        type="button"
                                        onClick={() => {
                                          setIntersectItem1(l.id);
                                          setI1DropdownOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/[0.04] hover:text-white transition-colors font-mono outline-none focus:outline-none"
                                      >
                                        {l.id.replace('line_', 'Line ')}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Custom Dropdown Item 2 */}
                              <div className="relative flex-1">
                                <button
                                  type="button"
                                  onClick={toggleI2Dropdown}
                                  className="dropdown-trigger w-full flex items-center justify-between bg-black/40 border border-white/5 rounded-lg px-2.5 py-1.5 text-xs text-white/70 outline-none text-left focus:border-white/20"
                                >
                                  <span className="truncate">
                                    {intersectItem2 ? (
                                      intersectItem2.startsWith('fn_') 
                                        ? `f${functions.findIndex(f => f.id === intersectItem2) + 1}: ${functions.find(f => f.id === intersectItem2)?.expression}`
                                        : intersectItem2.replace('line_', 'Line ')
                                    ) : "Select Item 2"}
                                  </span>
                                  <span className="material-symbols-outlined text-[14px] text-white/30 shrink-0">expand_more</span>
                                </button>
                                
                                {i2DropdownOpen && (
                                  <div className="dropdown-menu absolute top-full left-0 right-0 mt-1 bg-[#151518] border border-white/10 rounded-xl shadow-2xl z-50 max-h-[160px] overflow-y-auto scrollbar-hide py-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIntersectItem2('');
                                        setI2DropdownOpen(false);
                                      }}
                                      className="w-full text-left px-3 py-2 text-xs text-white/40 hover:bg-white/[0.04] hover:text-white transition-colors outline-none focus:outline-none"
                                    >
                                      Clear Selection
                                    </button>
                                    {functions.filter(f => f.visible && f.isValid && f.expression.trim()).map((f, idx) => (
                                      <button
                                        key={f.id}
                                        type="button"
                                        onClick={() => {
                                          setIntersectItem2(f.id);
                                          setI2DropdownOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/[0.04] hover:text-white transition-colors font-mono outline-none focus:outline-none"
                                      >
                                        f{idx + 1}: {f.expression}
                                      </button>
                                    ))}
                                    {lines.map(l => (
                                      <button
                                        key={l.id}
                                        type="button"
                                        onClick={() => {
                                          setIntersectItem2(l.id);
                                          setI2DropdownOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/[0.04] hover:text-white transition-colors font-mono outline-none focus:outline-none"
                                      >
                                        {l.id.replace('line_', 'Line ')}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={handleFindIntersections}
                                disabled={!intersectItem1 || !intersectItem2 || intersectItem1 === intersectItem2}
                                className="px-3 py-1.5 bg-green-500/20 hover:bg-green-500/35 border border-green-500/30 hover:border-green-400/40 disabled:opacity-40 disabled:pointer-events-none rounded-lg text-[10px] font-bold uppercase tracking-wider text-green-300 transition-colors"
                              >
                                Solve
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab 2: Join Multi (Path Creator) */}
                    {labTab === 'path' && (
                      <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 space-y-3">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">Join Multiple Points</p>
                        
                        {points.filter(p => !p.isIntersection).length < 2 ? (
                          <p className="text-[10px] text-white/40 italic text-center py-2">
                            Plot at least 2 points to join them
                          </p>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] text-white/45">Select points in connection order:</p>
                              {selectedPathPointIds.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedPathPointIds([])}
                                  className="text-[9px] font-bold uppercase tracking-wider text-red-400/60 hover:text-red-400 transition-colors"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto p-1.5 bg-black/20 rounded-lg border border-white/5 scrollbar-hide">
                              {points.filter(p => !p.isIntersection).map(pt => {
                                const indexInPath = selectedPathPointIds.indexOf(pt.id);
                                const isChecked = indexInPath !== -1;
                                return (
                                  <button
                                    key={pt.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedPathPointIds(prev =>
                                        prev.includes(pt.id)
                                          ? prev.filter(id => id !== pt.id)
                                          : [...prev, pt.id]
                                      );
                                    }}
                                    className={`px-2 py-1 rounded text-[10px] font-mono font-semibold transition-all border ${
                                      isChecked
                                        ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300'
                                        : 'bg-white/[0.02] border-white/5 text-white/50 hover:border-white/10 hover:text-white/70'
                                    }`}
                                  >
                                    {pt.label}
                                    {isChecked && (
                                      <span className="ml-1 bg-cyan-400/20 text-cyan-300 px-1 rounded-full text-[8px] font-bold">
                                        {indexInPath + 1}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            
                            {/* Path Type Selector */}
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-[10px] text-white/40 font-semibold uppercase tracking-wider">Path Type</span>
                              <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/5">
                                <button
                                  type="button"
                                  onClick={() => setPathType('segment')}
                                  className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded ${
                                    pathType === 'segment'
                                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/20'
                                      : 'text-white/30 hover:text-white/50 border border-transparent'
                                  }`}
                                >
                                  Open Segment
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPathType('polygon')}
                                  className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded ${
                                    pathType === 'polygon'
                                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/20'
                                      : 'text-white/30 hover:text-white/50 border border-transparent'
                                  }`}
                                >
                                  Closed Polygon
                                </button>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={handleCreatePath}
                              disabled={selectedPathPointIds.length < 2}
                              className="w-full py-2 bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-500/30 hover:border-cyan-400/40 disabled:opacity-40 disabled:pointer-events-none rounded-lg text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition-colors"
                            >
                              Join Checked Points
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {/* Tab 3: Shapes (Preset Shapes Coordinates Forms) */}
                    {labTab === 'preset' && (
                      <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 space-y-3">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">Draw Preset Shapes</p>
                        
                        {/* Preset Type Selector */}
                        <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/5">
                          {(['triangle', 'square', 'rectangle'] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setPresetShapeType(t)}
                              className={`flex-1 text-center py-1 text-[9px] font-bold uppercase rounded transition-all ${
                                presetShapeType === t
                                  ? 'bg-cyan-500/20 text-cyan-300 font-extrabold border border-cyan-500/30'
                                  : 'text-white/40 hover:text-white/70 border border-transparent'
                              }`}
                            >
                              {t === 'triangle' ? 'Triangle' : t === 'square' ? 'Square' : 'Rectangle'}
                            </button>
                          ))}
                        </div>

                        {/* Triangle Inputs */}
                        {presetShapeType === 'triangle' && (
                          <div className="space-y-2">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-white/20">Vertex Coordinates</p>
                            <div className="flex gap-2">
                              <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                <span className="text-[10px] font-mono text-white/30">A X:</span>
                                <input
                                  type="text" value={t1X} onChange={(e) => setT1X(e.target.value)} placeholder="0"
                                  className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                                />
                              </div>
                              <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                <span className="text-[10px] font-mono text-white/30">A Y:</span>
                                <input
                                  type="text" value={t1Y} onChange={(e) => setT1Y(e.target.value)} placeholder="0"
                                  className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                <span className="text-[10px] font-mono text-white/30">B X:</span>
                                <input
                                  type="text" value={t2X} onChange={(e) => setT2X(e.target.value)} placeholder="3"
                                  className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                                />
                              </div>
                              <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                <span className="text-[10px] font-mono text-white/30">B Y:</span>
                                <input
                                  type="text" value={t2Y} onChange={(e) => setT2Y(e.target.value)} placeholder="0"
                                  className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                <span className="text-[10px] font-mono text-white/30">C X:</span>
                                <input
                                  type="text" value={t3X} onChange={(e) => setT3X(e.target.value)} placeholder="0"
                                  className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                                />
                              </div>
                              <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                <span className="text-[10px] font-mono text-white/30">C Y:</span>
                                <input
                                  type="text" value={t3Y} onChange={(e) => setT3Y(e.target.value)} placeholder="4"
                                  className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Square Inputs */}
                        {presetShapeType === 'square' && (
                          <div className="space-y-2">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-white/20">Square Setup</p>
                            <div className="flex gap-2">
                              <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                <span className="text-[10px] font-mono text-white/30">Center X:</span>
                                <input
                                  type="text" value={sqCX} onChange={(e) => setSqCX(e.target.value)} placeholder="0"
                                  className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                                />
                              </div>
                              <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                <span className="text-[10px] font-mono text-white/30">Center Y:</span>
                                <input
                                  type="text" value={sqCY} onChange={(e) => setSqCY(e.target.value)} placeholder="0"
                                  className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                              <span className="text-[10px] font-mono text-white/30">Side Length:</span>
                              <input
                                type="text" value={sqSide} onChange={(e) => setSqSide(e.target.value)} placeholder="4"
                                className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                              />
                            </div>
                          </div>
                        )}

                        {/* Rectangle Inputs */}
                        {presetShapeType === 'rectangle' && (
                          <div className="space-y-2">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-white/20">Rectangle Setup</p>
                            <div className="flex gap-2">
                              <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                <span className="text-[10px] font-mono text-white/30">Center X:</span>
                                <input
                                  type="text" value={rectCX} onChange={(e) => setRectCX(e.target.value)} placeholder="0"
                                  className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                                />
                              </div>
                              <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                <span className="text-[10px] font-mono text-white/30">Center Y:</span>
                                <input
                                  type="text" value={rectCY} onChange={(e) => setRectCY(e.target.value)} placeholder="0"
                                  className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                <span className="text-[10px] font-mono text-white/30">Width:</span>
                                <input
                                  type="text" value={rectW} onChange={(e) => setRectW(e.target.value)} placeholder="6"
                                  className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                                />
                              </div>
                              <div className="flex-1 flex items-center gap-1 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                <span className="text-[10px] font-mono text-white/30">Height:</span>
                                <input
                                  type="text" value={rectH} onChange={(e) => setRectH(e.target.value)} placeholder="4"
                                  className="w-full bg-transparent text-xs font-mono text-white/85 outline-none focus:outline-none"
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={handleCreatePresetShape}
                          className="w-full py-2 bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-500/30 hover:border-cyan-400/40 rounded-lg text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition-colors"
                        >
                          Draw Shape
                        </button>
                      </div>
                    )}

                    {/* Shapes List */}
                    {shapes.length > 0 && (
                      <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 space-y-1.5">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">Shapes & Paths</p>
                        <div className="max-h-[100px] overflow-y-auto space-y-1 pr-1 scrollbar-hide">
                          {shapes.map((sh) => (
                            <div key={sh.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-[11px] font-mono">
                              <span className="truncate flex-1 mr-2" style={{ color: sh.color }}>
                                {sh.label}
                              </span>
                              <button
                                onClick={() => handleRemoveShape(sh.id)}
                                className="text-white/25 hover:text-red-400 transition-colors outline-none focus:outline-none"
                              >
                                <span className="material-symbols-outlined text-[14px]">close</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Separator */}
            <div className="mx-3 lg:mx-4 border-t border-white/5" />

            {/* Presets */}
            <div className="p-3 lg:p-4">
              <PresetPanel
                onLoadPreset={handleLoadPreset}
                isOpen={showPresets}
                onToggle={() => setShowPresets(prev => !prev)}
              />
            </div>

            {/* Expression Hints */}
            <div className="p-3 lg:p-4 pt-0">
              <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-white/25 mb-2">Quick Examples</p>
                <div className="flex flex-wrap gap-1.5">
                  {['x^2', 'sin(x)', '2*x + 1', 'exp(x)', 'log(x)', 'abs(x)', 'x^3 - 3*x', 'sqrt(x)'].map(expr => (
                    <button
                      key={expr}
                      onClick={() => {
                        handleExpressionChange(activeInputId, expr);
                      }}
                      className="px-2 py-1 rounded-md bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 hover:border-white/10 text-[10px] font-mono text-white/40 hover:text-white/70 transition-all active:scale-95"
                    >
                      {expr}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right Panel: Graph + Toolbar ── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Analysis Toolbar */}
          <div className="shrink-0 px-3 lg:px-4 py-2 lg:py-3 border-b border-white/5 bg-black/10 overflow-x-auto scrollbar-hide">
            <AnalysisToolbar
              showDerivatives={showDerivatives}
              showGrid={showGrid}
              snapToGrid={snapToGrid}
              onToggleSnapToGrid={() => setSnapToGrid(prev => !prev)}
              gridSpacing={gridSpacing}
              onGridSpacingChange={setGridSpacing}
              onToggleDerivatives={() => setShowDerivatives(prev => !prev)}
              onToggleGrid={() => setShowGrid(prev => !prev)}
              onResetView={handleResetView}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              domain={domain}
              range={range}
              onDomainChange={setDomain}
              onRangeChange={setRange}
            />
          </div>

          {/* Graph Canvas */}
          <div className="flex-1 p-2 lg:p-4 min-h-0">
            <GraphCanvas
              functions={functions}
              showDerivatives={showDerivatives}
              showGrid={showGrid}
              gridSpacing={gridSpacing}
              domain={domain}
              range={range}
              points={points}
              lines={lines}
              shapes={resolvedShapes}
              selectedPointId={activeConnectStartPointId || undefined}
              isPlottingMode={isPlottingMode}
              onDomainChange={(d) => setDomain(d)}
              onGraphClick={handleGraphClick}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
