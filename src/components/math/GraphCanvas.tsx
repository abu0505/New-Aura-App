import { useEffect, useRef, useCallback, useState } from 'react';
import functionPlot from 'function-plot';
import type { FunctionEntry } from './FunctionInput';
import { FUNCTION_COLORS } from './FunctionInput';

interface PlottedPoint {
  id: string;
  x: number;
  y: number;
  label: string;
  isIntersection?: boolean;
}

interface PlottedLine {
  id: string;
  expression: string;
  color: string;
  fnType?: 'linear' | 'implicit';
  label: string;
}

export interface PlottedShape {
  id: string;
  type: 'segment' | 'triangle' | 'square' | 'polygon';
  points: { x: number; y: number }[];
  color: string;
  label: string;
  style?: 'solid' | 'dashed';
}

interface GraphCanvasProps {
  functions: FunctionEntry[];
  showDerivatives: boolean;
  showGrid: boolean;
  gridSpacing?: string;
  domain?: [number, number];
  range?: [number, number];
  points?: PlottedPoint[];
  lines?: PlottedLine[];
  shapes?: PlottedShape[];
  selectedPointId?: string;
  isPlottingMode?: boolean;
  onCoordinateHover?: (x: number, y: number) => void;
  onDomainChange?: (domain: [number, number]) => void;
  onGraphClick?: (x: number, y: number) => void;
}

function getAutoGridStep(min: number, max: number): number {
  const span = max - min;
  const rawStep = span / 12;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;

  let step;
  if (normalized < 1.5) step = 1;
  else if (normalized < 3) step = 2;
  else if (normalized < 7) step = 5;
  else step = 10;

  return step * magnitude;
}

export default function GraphCanvas({
  functions,
  showDerivatives,
  showGrid,
  gridSpacing = 'auto',
  domain = [-10, 10],
  range = [-10, 10],
  points = [],
  lines = [],
  shapes = [],
  selectedPointId,
  isPlottingMode = false,
  onCoordinateHover,
  onDomainChange,
  onGraphClick,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotInstanceRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const [error, setError] = useState<string | null>(null);
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number } | null>(null);

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Build & render the plot
  const renderPlot = useCallback(() => {
    if (!containerRef.current || dimensions.width === 0) return;

    // Clear previous instance
    const container = containerRef.current;
    container.innerHTML = '';

    // Build data array from visible, valid functions
    const data: any[] = [];

    // Generate custom grid lines
    if (showGrid) {
      let step = parseFloat(gridSpacing);
      if (gridSpacing === 'auto' || isNaN(step) || step <= 0) {
        step = getAutoGridStep(domain[0], domain[1]);
      }

      if (step > 0) {
        // Adjust step if it would create too many lines to avoid lagging
        const domainSpan = domain[1] - domain[0];
        const rangeSpan = range[1] - range[0];
        while ((domainSpan / step + rangeSpan / step) > 80) {
          step *= 2; // scale up step size dynamically
        }

        // Vertical Grid Lines
        const xStart = Math.ceil(domain[0] / step) * step;
        const xEnd = Math.floor(domain[1] / step) * step;
        for (let xVal = xStart; xVal <= xEnd; xVal += step) {
          if (Math.abs(xVal) < 1e-5) continue; // skip y-axis
          data.push({
            points: [[xVal, range[0]], [xVal, range[1]]],
            fnType: 'points',
            graphType: 'polyline',
            color: 'rgba(255,255,255,0.06)',
            attr: {
              'stroke-width': 0.8,
              'stroke-dasharray': '2,4',
            },
            skipTip: true,
          });
        }

        // Horizontal Grid Lines
        const yStart = Math.ceil(range[0] / step) * step;
        const yEnd = Math.floor(range[1] / step) * step;
        for (let yVal = yStart; yVal <= yEnd; yVal += step) {
          if (Math.abs(yVal) < 1e-5) continue; // skip x-axis
          data.push({
            points: [[domain[0], yVal], [domain[1], yVal]],
            fnType: 'points',
            graphType: 'polyline',
            color: 'rgba(255,255,255,0.06)',
            attr: {
              'stroke-width': 0.8,
              'stroke-dasharray': '2,4',
            },
            skipTip: true,
          });
        }
      }
    }

    // Core origin axis lines (x=0 and y=0) to show quadrants clearly
    data.push({
      fn: '0',
      graphType: 'polyline',
      color: 'rgba(255,255,255,0.25)',
      attr: {
        'stroke-width': 1.5,
      },
      sampler: 'builtIn',
      nSamples: 2,
      skipTip: true,
    });

    data.push({
      fn: 'x',
      fnType: 'implicit',
      color: 'rgba(255,255,255,0.25)',
      attr: {
        'stroke-width': 1.5,
      },
      sampler: 'interval',
      skipTip: true,
    });

    functions.forEach((fn) => {
      if (!fn.visible || !fn.isValid || !fn.expression.trim()) return;

      const color = FUNCTION_COLORS[fn.colorIndex % FUNCTION_COLORS.length].hex;

      // Main function
      data.push({
        fn: fn.expression,
        graphType: 'polyline',
        color: color,
        attr: {
          'stroke-width': 2.5,
        },
        sampler: 'builtIn',
        nSamples: 2000,
      });

      // Derivative overlay
      if (showDerivatives) {
        data.push({
          fn: fn.expression,
          derivative: { fn: fn.expression, updateOnMouseMove: false },
          graphType: 'polyline',
          color: color,
          attr: {
            'stroke-width': 1.5,
            'stroke-dasharray': '6,4',
            'opacity': 0.5,
          },
          sampler: 'builtIn',
          nSamples: 1500,
          skipTip: true,
        });
      }
    });

    // Add plotted lines
    if (lines && lines.length > 0) {
      lines.forEach(line => {
        data.push({
          fn: line.expression,
          fnType: line.fnType || 'linear',
          graphType: 'polyline',
          color: line.color,
          attr: {
            'stroke-width': 2.5,
            'stroke-dasharray': '5,5',
          },
          sampler: line.fnType === 'implicit' ? 'interval' : 'builtIn',
        });
      });
    }

    // Add plotted shapes (segments, triangles, polygons)
    if (shapes && shapes.length > 0) {
      shapes.forEach(shape => {
        if (!shape.points || shape.points.length < 2) return;
        const pointsList = [...shape.points];
        if (shape.type !== 'segment' && pointsList.length > 2) {
          pointsList.push(shape.points[0]); // Close the shape loop
        }
        data.push({
          points: pointsList.map(p => [p.x, p.y]),
          fnType: 'points',
          graphType: 'polyline',
          color: shape.color,
          attr: {
            'stroke-width': 2.5,
            'stroke-dasharray': shape.style === 'dashed' ? '5,5' : 'none',
          },
          skipTip: true,
        });
      });
    }

    // Add plotted points
    if (points && points.length > 0) {
      const userPoints = points.filter(p => !p.isIntersection);
      const intersectionPoints = points.filter(p => p.isIntersection);

      if (userPoints.length > 0) {
        data.push({
          points: userPoints.map(p => [p.x, p.y]),
          fnType: 'points',
          graphType: 'scatter',
          color: '#06b6d4', // Cyan
          attr: {
            r: 5,
          }
        });

        // Add highlight ring for selected point
        if (selectedPointId) {
          const selPoint = userPoints.find(p => p.id === selectedPointId);
          if (selPoint) {
            data.push({
              points: [[selPoint.x, selPoint.y]],
              fnType: 'points',
              graphType: 'scatter',
              color: '#f59e0b', // Gold / Amber
              attr: {
                r: 9,
                'stroke-width': 2,
                fill: 'none',
              },
              skipTip: true
            });
          }
        }
      }

      if (intersectionPoints.length > 0) {
        data.push({
          points: intersectionPoints.map(p => [p.x, p.y]),
          fnType: 'points',
          graphType: 'scatter',
          color: '#22c55e', // Green
          attr: {
            r: 6,
          }
        });
      }
    }

    if (data.length === 0) {
      // Still render empty grid
      data.push({
        fn: '0',
        graphType: 'polyline',
        color: 'transparent',
        nSamples: 2,
      });
    }

    try {
      const fnPlot = (functionPlot as any).default || functionPlot;
      const instance = fnPlot({
        target: container,
        width: dimensions.width,
        height: dimensions.height,
        xAxis: {
          domain: domain,
          label: 'x',
        },
        yAxis: {
          domain: range,
          label: 'y',
        },
        grid: false,
        disableZoom: false,
        data: data,
        tip: {
          xLine: true,
          yLine: true,
        },
      });

      plotInstanceRef.current = instance;

      // Listen for programmatic pan/zoom domain changes
      instance.on('all:zoom', (d: any) => {
        if (d?.xDomain && onDomainChange) {
          onDomainChange(d.xDomain);
        }
      });

      setError(null);
    } catch (err: any) {
      console.error('[GraphCanvas] Render error:', err);
      setError(err.message || 'Could not render graph');
    }
  }, [functions, showDerivatives, showGrid, gridSpacing, domain, range, dimensions, onDomainChange, shapes, selectedPointId]);

  useEffect(() => {
    renderPlot();
  }, [renderPlot]);

  // Mouse move and click tracking for coordinate display & plotting
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /**
     * Convert screen (client) coordinates to math coordinates.
     *
     * KEY INSIGHT: function-plot renders all content inside a <g> element with
     * transform="translate(marginLeft, marginTop)". Its d3 scales (xScale, yScale)
     * operate in THIS GROUP's local coordinate system:
     *   xScale: [0 … plotWidth]  → [xMin … xMax]
     *   yScale: [plotHeight … 0] → [yMin … yMax]
     *
     * So we must use getScreenCTM() on the CONTENT GROUP (not the SVG root)
     * to convert screen pixels → group-local coords that the scales expect.
     */
    const screenToMath = (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svgEl = container.querySelector('svg') as SVGSVGElement | null;
      if (!svgEl) return null;

      const instance = plotInstanceRef.current;

      // ── Method 1: Content-group CTM + d3 scales (pixel-perfect) ──
      if (instance?.meta?.xScale?.invert && instance?.meta?.yScale?.invert) {
        try {
          // Find function-plot's content group — the <g> with translate(margin) transform.
          // function-plot uses class "top-group-container" on this element.
          let contentGroup: SVGGElement | null =
            svgEl.querySelector('g.top-group-container') as SVGGElement | null;

          // Fallback: first direct <g> child of SVG that has a translate transform
          if (!contentGroup) {
            for (const child of svgEl.children) {
              if (child.tagName === 'g' && child.getAttribute('transform')?.includes('translate')) {
                contentGroup = child as SVGGElement;
                break;
              }
            }
          }

          const targetEl = contentGroup || svgEl;
          const ctm = (targetEl as SVGGraphicsElement).getScreenCTM();
          if (ctm) {
            const pt = svgEl.createSVGPoint();
            pt.x = clientX;
            pt.y = clientY;
            // This converts screen coords → group-local coords,
            // automatically subtracting the translate(margin) offset
            const localPt = pt.matrixTransform(ctm.inverse());

            const xVal = instance.meta.xScale.invert(localPt.x);
            const yVal = instance.meta.yScale.invert(localPt.y);

            if (xVal >= domain[0] && xVal <= domain[1] &&
                yVal >= range[0] && yVal <= range[1]) {
              return {
                x: parseFloat(xVal.toFixed(3)),
                y: parseFloat(yVal.toFixed(3)),
              };
            }
          }
        } catch (err) {
          console.error('[GraphCanvas] SVG coordinate transform error:', err);
        }
      }

      // ── Method 2: Parse SVG structure to find margins, then map manually ──
      try {
        const ctm = svgEl.getScreenCTM();
        if (!ctm) return null;
        const pt = svgEl.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const svgPt = pt.matrixTransform(ctm.inverse());

        // Read the actual margin from the content group's translate transform
        let marginLeft = 30, marginTop = 20;
        const firstG = svgEl.querySelector('g[transform]');
        if (firstG) {
          const t = firstG.getAttribute('transform') || '';
          const m = t.match(/translate\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*\)/);
          if (m) {
            marginLeft = parseFloat(m[1]);
            marginTop = parseFloat(m[2]);
          }
        }

        // Read SVG internal dimensions
        const svgW = parseFloat(svgEl.getAttribute('width') || String(dimensions.width));
        const svgH = parseFloat(svgEl.getAttribute('height') || String(dimensions.height));
        const marginRight = 30;
        const marginBottom = 20;
        const plotW = svgW - marginLeft - marginRight;
        const plotH = svgH - marginTop - marginBottom;

        const localX = svgPt.x - marginLeft;
        const localY = svgPt.y - marginTop;

        if (localX < 0 || localX > plotW || localY < 0 || localY > plotH) {
          return null;
        }

        return {
          x: parseFloat((domain[0] + (localX / plotW) * (domain[1] - domain[0])).toFixed(3)),
          y: parseFloat((range[1] - (localY / plotH) * (range[1] - range[0])).toFixed(3)),
        };
      } catch (err) {
        console.error('[GraphCanvas] fallback coordinate error:', err);
      }

      return null;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const coords = screenToMath(e.clientX, e.clientY);
      if (coords) {
        setHoverCoords(coords);
        onCoordinateHover?.(coords.x, coords.y);
      } else {
        setHoverCoords(null);
      }
    };

    const handleMouseClick = (e: MouseEvent) => {
      if (!onGraphClick) return;
      const coords = screenToMath(e.clientX, e.clientY);
      if (coords) {
        onGraphClick(coords.x, coords.y);
      }
    };

    const handleMouseLeave = () => {
      setHoverCoords(null);
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('click', handleMouseClick);
    container.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('click', handleMouseClick);
      container.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [domain, range, dimensions, onCoordinateHover, onGraphClick]);

  // Apply custom styles to the SVG after render
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const timer = setTimeout(() => {
      // Style the SVG for dark theme
      const svg = container.querySelector('svg');
      if (!svg) return;

      // Background
      svg.style.background = 'transparent';

      // Grid lines
      const gridLines = svg.querySelectorAll('.grid line, .grid path');
      gridLines.forEach((line: any) => {
        line.style.stroke = 'rgba(255,255,255,0.06)';
      });

      // Axis lines
      const axisLines = svg.querySelectorAll('.x.axis line, .y.axis line, .x.axis path, .y.axis path');
      axisLines.forEach((line: any) => {
        line.style.stroke = 'rgba(255,255,255,0.2)';
      });

      // Axis text/labels
      const axisText = svg.querySelectorAll('.x.axis text, .y.axis text');
      axisText.forEach((text: any) => {
        text.style.fill = 'rgba(255,255,255,0.45)';
        text.style.fontSize = '11px';
        text.style.fontFamily = "'JetBrains Mono', monospace";
      });

      // Tip lines (crosshair)
      const tipLines = svg.querySelectorAll('.tip line');
      tipLines.forEach((line: any) => {
        line.style.stroke = 'rgba(255,255,255,0.15)';
        line.style.strokeDasharray = '4,3';
      });

      // Remove the function-plot footer/watermark if any
      const annotations = svg.querySelectorAll('.annotations');
      annotations.forEach((a: any) => a.remove());

      // Ensure all colored lines keep their stroke color and are not overridden by generic CSS rules
      const coloredElements = svg.querySelectorAll('[stroke]');
      coloredElements.forEach((el: any) => {
        const attrStroke = el.getAttribute('stroke');
        if (attrStroke && attrStroke !== 'none' && attrStroke !== 'transparent') {
          if (el.closest('.axis') || el.closest('.grid')) return;
          el.style.stroke = attrStroke;
          
          const attrStrokeWidth = el.getAttribute('stroke-width');
          if (attrStrokeWidth) {
            el.style.strokeWidth = attrStrokeWidth;
          }
        }
      });

      // Render custom point labels on the graph
      const marginLeft = 55;
      const marginTop = 20;
      const marginRight = 15;
      const marginBottom = 45;

      const plotWidth = dimensions.width - marginLeft - marginRight;
      const plotHeight = dimensions.height - marginTop - marginBottom;

      let labelsGroup = svg.querySelector('.custom-labels');
      if (labelsGroup) {
        labelsGroup.innerHTML = '';
      } else {
        labelsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        labelsGroup.setAttribute('class', 'custom-labels');
        svg.appendChild(labelsGroup);
      }

      if (points && points.length > 0) {
        points.forEach(p => {
          const xRatio = (p.x - domain[0]) / (domain[1] - domain[0]);
          const yRatio = (range[1] - p.y) / (range[1] - range[0]);
          
          if (xRatio >= 0 && xRatio <= 1 && yRatio >= 0 && yRatio <= 1) {
            const screenX = marginLeft + xRatio * plotWidth;
            const screenY = marginTop + yRatio * plotHeight;

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(screenX + 7));
            text.setAttribute('y', String(screenY - 7));
            text.setAttribute('fill', p.isIntersection ? '#4ade80' : '#22d3ee');
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('font-size', '12px');
            text.setAttribute('font-family', "'JetBrains Mono', monospace, sans-serif");
            text.setAttribute('style', 'text-shadow: 0px 1px 2px rgba(0,0,0,0.8); pointer-events: none;');
            text.textContent = p.label;
            labelsGroup.appendChild(text);
          }
        });
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [functions, showDerivatives, showGrid, domain, range, dimensions, points]);

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden bg-[var(--bg-primary)] border border-white/5">
      {/* Graph Container */}
      <div
        ref={containerRef}
        className="w-full h-full graph-canvas-container"
        style={{ cursor: isPlottingMode ? 'cell' : 'crosshair' }}
      />

      {/* Coordinate Display */}
      {hoverCoords && (
        <div className="absolute bottom-3 right-3 px-3 py-1.5 bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg text-[11px] font-mono text-white/70 pointer-events-none z-10">
          ({hoverCoords.x}, {hoverCoords.y})
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-20">
          <div className="px-4 py-3 bg-red-500/10 border border-red-400/30 rounded-xl text-red-300 text-xs text-center max-w-xs">
            <span className="material-symbols-outlined text-base block mb-1">error</span>
            {error}
          </div>
        </div>
      )}

      {/* Empty State */}
      {functions.filter(f => f.visible && f.isValid && f.expression.trim()).length === 0 && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-center">
            <span className="material-symbols-outlined text-3xl text-white/10 block mb-2">show_chart</span>
            <p className="text-[11px] text-white/20 uppercase tracking-wider">
              Enter a function to plot
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
