import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Note, ChecklistItem, NoteColor, NoteMood } from '../../hooks/useNotes';
import { NOTE_COLORS, NOTE_BACKGROUNDS, MOOD_CONFIG } from '../../hooks/useNotes';
import { getStoredKeyPair, decodeBase64, encodeBase64, encryptMessage } from '../../lib/encryption';
import { useMedia } from '../../hooks/useMedia';
import nacl from 'tweetnacl';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { supabase } from '../../lib/supabase';

// ═══════════════════════════════════════════════════════════════════════════════
// INLINE DRAWING TYPES & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

type InlineDrawTool = 'pen' | 'highlighter' | 'eraser' | 'arrow' | 'double-arrow' | 'line' | 'rect' | 'circle' | 'text' | 'laser';

interface InlineDrawStroke {
  id: string;
  tool: InlineDrawTool;
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

const INLINE_TOOLS: { id: InlineDrawTool; icon: string; label: string }[] = [
  { id: 'pen', icon: 'edit', label: 'Pen' },
  { id: 'highlighter', icon: 'ink_highlighter', label: 'Highlighter' },
  { id: 'eraser', icon: 'ink_eraser', label: 'Eraser' },
  { id: 'text', icon: 'text_fields', label: 'Text' },
  { id: 'laser', icon: 'flare', label: 'Laser' },
];

const SHAPE_TOOLS: { id: InlineDrawTool; icon: string; label: string }[] = [
  { id: 'rect', icon: 'rectangle', label: 'Rectangle' },
  { id: 'circle', icon: 'circle', label: 'Circle' },
  { id: 'line', icon: 'horizontal_rule', label: 'Line' },
];

const ARROW_TOOLS: { id: InlineDrawTool; icon: string; label: string }[] = [
  { id: 'arrow', icon: 'east', label: 'Arrow' },
  { id: 'double-arrow', icon: 'sync_alt', label: 'Double Arrow' },
];

const INLINE_DRAW_COLORS = [
  { id: 'white', hex: '#ffffff', label: 'White' },
  { id: 'gold', hex: '#e6c487', label: 'Gold' },
  { id: 'red', hex: '#FF6B6B', label: 'Red' },
  { id: 'green', hex: '#51CF66', label: 'Green' },
  { id: 'blue', hex: '#339AF0', label: 'Blue' },
  { id: 'purple', hex: '#CC5DE8', label: 'Purple' },
  { id: 'orange', hex: '#FF922B', label: 'Orange' },
  { id: 'cyan', hex: '#22B8CF', label: 'Cyan' },
  { id: 'yellow', hex: '#FFD43B', label: 'Yellow' },
];

const INLINE_DRAW_SIZES = [2, 4, 6, 10, 16];

// Helper to strip HTML tags for plain text conversions
const getPlainText = (html: string) => {
  if (!html) return '';
  let text = html
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, ' • ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<h1>/gi, '\n')
    .replace(/<\/h1>/gi, '\n')
    .replace(/<h2>/gi, '\n')
    .replace(/<\/h2>/gi, '\n')
    .replace(/<h3>/gi, '\n')
    .replace(/<\/h3>/gi, '\n');

  text = text.replace(/<[^>]*>/g, '');

  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
};

const ACCENT_COLORS = [
  { id: 'gold', hex: '#e6c487', label: 'Aura Gold' },
  { id: 'emerald', hex: '#6ECB8A', label: 'Emerald' },
  { id: 'sapphire', hex: '#7C9AF2', label: 'Sapphire Blue' },
  { id: 'rose', hex: '#D4A0A0', label: 'Rose' },
  { id: 'purple', hex: '#C084FC', label: 'Neon Purple' },
  { id: 'sky', hex: '#38BDF8', label: 'Sky Blue' },
];

interface NoteEditorProps {
  note: Note;
  onUpdate: (id: string, changes: Partial<Note>) => void;
  onClose: () => void;
  onTrash: (id: string) => void;
  onDuplicate: (id: string) => void;
  onTogglePin: (id: string) => void;
  onAddChecklistItem: (noteId: string, text?: string) => void;
  onUpdateChecklistItem: (noteId: string, itemId: string, changes: Partial<ChecklistItem>) => void;
  onRemoveChecklistItem: (noteId: string, itemId: string) => void;
  labels: string[];
  onToggleLabel: (noteId: string, label: string) => void;
  onAddLabel: (label: string) => void;
  onDeleteLabel: (label: string) => void;
}

type BottomPanel = 'none' | 'colors' | 'backgrounds' | 'mood' | 'labels' | 'more';

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE MARKDOWN RENDERING (Typora-style)
// ═══════════════════════════════════════════════════════════════════════════════
//
// When the user types markdown (e.g., **bold**, *italic*, ## heading) and
// presses Enter or moves the cursor away, the current line auto-renders.
// When the cursor comes back to that line, it shows raw markdown again.
//
// Implementation: We work at the block/line level. On 'input' and 'keyup',
// we check the current paragraph. If cursor is NOT inside a rendered block,
// we render it. If cursor IS inside a rendered block, we un-render it.
// ═══════════════════════════════════════════════════════════════════════════════

// Markdown patterns to detect and render inline
const MD_INLINE_RULES: { pattern: RegExp; replace: string }[] = [
  // Bold: **text** or __text__
  { pattern: /\*\*(.+?)\*\*/g, replace: '<strong>$1</strong>' },
  { pattern: /__(.+?)__/g, replace: '<strong>$1</strong>' },
  // Italic: *text* or _text_
  { pattern: /(?<![*_])\*(?![*])(.+?)(?<![*])\*(?![*_])/g, replace: '<em>$1</em>' },
  { pattern: /(?<![*_])_(?![_])(.+?)(?<![_])_(?![*_])/g, replace: '<em>$1</em>' },
  // Strikethrough: ~~text~~
  { pattern: /~~(.+?)~~/g, replace: '<del>$1</del>' },
  // Inline code: `code`
  { pattern: /`([^`]+)`/g, replace: '<code style="background:rgba(0,0,0,0.3);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:0.8em;color:#4ade80;">$1</code>' },
  // Highlight: ==text==
  { pattern: /==(.+?)==/g, replace: '<mark style="background:rgba(255,213,79,0.25);color:#FFD54F;padding:1px 3px;border-radius:3px;">$1</mark>' },
];

// Block-level patterns (applied to entire paragraph text)
const MD_BLOCK_RULES: { pattern: RegExp; tag: string; attrs?: string }[] = [
  { pattern: /^### (.+)$/, tag: 'h3' },
  { pattern: /^## (.+)$/, tag: 'h2' },
  { pattern: /^# (.+)$/, tag: 'h1' },
  { pattern: /^> (.+)$/, tag: 'blockquote' },
  { pattern: /^---$/, tag: 'hr' },
];

// Convert a line of raw markdown text into rendered HTML
// Returns blockTag when the element's tag itself should change (e.g. p → h2)
const renderMarkdownLine = (text: string): { html: string; isBlock: boolean; blockTag?: string } => {
  // Check block-level patterns
  for (const rule of MD_BLOCK_RULES) {
    const match = text.match(rule.pattern);
    if (match) {
      if (rule.tag === 'hr') {
        return { html: '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:8px 0;">', isBlock: true };
      }
      let inner = match[1];
      // Apply inline rules to the captured content
      for (const inlineRule of MD_INLINE_RULES) {
        inner = inner.replace(inlineRule.pattern, inlineRule.replace);
      }
      // Return inner HTML only — the caller will change the element's tag
      return { html: inner, isBlock: true, blockTag: rule.tag };
    }
  }

  // Apply inline rules only
  let rendered = text;
  let changed = false;
  for (const rule of MD_INLINE_RULES) {
    const newText = rendered.replace(rule.pattern, rule.replace);
    if (newText !== rendered) changed = true;
    rendered = newText;
  }

  return { html: rendered, isBlock: changed };
};

// Check if a paragraph element contains rendered markdown (has HTML children beyond text)
const isRenderedMarkdown = (el: HTMLElement): boolean => {
  return el.hasAttribute('data-md-rendered');
};

// Get raw markdown from a rendered element
const getRawMarkdown = (el: HTMLElement): string => {
  return el.getAttribute('data-md-raw') || el.textContent || '';
};

// ═══════════════════════════════════════════════════════════════════════════════
// DRAWING PREVIEW (mini canvas)
// ═══════════════════════════════════════════════════════════════════════════════

function DrawingPreview({ strokes }: { strokes: any[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !strokes.length) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const w = parent.clientWidth;
    const h = parent.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.save();

    strokes.forEach(stroke => {
      if (!stroke || !stroke.tool) return;
      if (stroke.tool === 'laser') return;

      ctx.save();
      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = stroke.size * 3;
      } else if (stroke.tool === 'highlighter') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.strokeStyle = stroke.color || '#fff';
        ctx.lineWidth = stroke.size * 4;
        ctx.globalAlpha = 0.35;
      } else {
        ctx.strokeStyle = stroke.color || '#fff';
        ctx.lineWidth = stroke.size || 2;
        ctx.globalAlpha = stroke.opacity || 1;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.tool === 'text' && stroke.text) {
        ctx.fillStyle = stroke.color || '#fff';
        ctx.font = `${stroke.fontSize || 18}px 'Inter', sans-serif`;
        ctx.fillText(stroke.text, stroke.startX || 0, stroke.startY || 0);
      } else if (['arrow', 'double-arrow', 'line', 'rect', 'circle'].includes(stroke.tool) && stroke.startX !== undefined) {
        ctx.beginPath();
        if (stroke.tool === 'rect') {
          const x = Math.min(stroke.startX, stroke.endX);
          const y = Math.min(stroke.startY, stroke.endY);
          ctx.strokeRect(x, y, Math.abs(stroke.endX - stroke.startX), Math.abs(stroke.endY - stroke.startY));
        } else if (stroke.tool === 'circle') {
          const cx = (stroke.startX + stroke.endX) / 2;
          const cy = (stroke.startY + stroke.endY) / 2;
          const rx = Math.abs(stroke.endX - stroke.startX) / 2;
          const ry = Math.abs(stroke.endY - stroke.startY) / 2;
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.moveTo(stroke.startX, stroke.startY);
          ctx.lineTo(stroke.endX, stroke.endY);
          ctx.stroke();
          if (stroke.tool === 'arrow' || stroke.tool === 'double-arrow') {
            const headLen = Math.max(stroke.size * 4, 12);
            const angle = Math.atan2(stroke.endY - stroke.startY, stroke.endX - stroke.startX);

            // End arrowhead
            ctx.beginPath();
            ctx.moveTo(stroke.endX, stroke.endY);
            ctx.lineTo(stroke.endX - headLen * Math.cos(angle - Math.PI / 6), stroke.endY - headLen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(stroke.endX, stroke.endY);
            ctx.lineTo(stroke.endX - headLen * Math.cos(angle + Math.PI / 6), stroke.endY - headLen * Math.sin(angle + Math.PI / 6));
            ctx.stroke();

            // Start arrowhead (for double-arrow)
            if (stroke.tool === 'double-arrow') {
              ctx.beginPath();
              ctx.moveTo(stroke.startX, stroke.startY);
              ctx.lineTo(stroke.startX + headLen * Math.cos(angle - Math.PI / 6), stroke.startY + headLen * Math.sin(angle - Math.PI / 6));
              ctx.moveTo(stroke.startX, stroke.startY);
              ctx.lineTo(stroke.startX + headLen * Math.cos(angle + Math.PI / 6), stroke.startY + headLen * Math.sin(angle + Math.PI / 6));
              ctx.stroke();
            }
          }
        }
      } else if (stroke.points && stroke.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length - 1; i++) {
          const mx = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
          const my = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
          ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, mx, my);
        }
        ctx.lineTo(stroke.points[stroke.points.length - 1].x, stroke.points[stroke.points.length - 1].y);
        ctx.stroke();
      } else if (stroke.points && stroke.points.length === 1) {
        // Draw a single dot
        ctx.beginPath();
        ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    });

    ctx.restore();
  }, [strokes]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

export default function NoteEditor({
  note,
  onUpdate,
  onClose,
  onTrash,
  onDuplicate,
  onTogglePin,
  onAddChecklistItem,
  onUpdateChecklistItem,
  onRemoveChecklistItem,
  labels,
  onToggleLabel,
  onAddLabel,
  onDeleteLabel,
}: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>('none');
  const [newLabelText, setNewLabelText] = useState('');
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [decryptedBg, setDecryptedBg] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showColorMenu, setShowColorMenu] = useState(false);
  // ═══ INLINE DRAWING STATE ═══
  const [drawMode, setDrawMode] = useState(false);
  const [drawTool, setDrawTool] = useState<InlineDrawTool>('pen');
  const [drawColor, setDrawColor] = useState('#ffffff');
  const [drawSize, setDrawSize] = useState(4);
  const [drawStrokes, setDrawStrokes] = useState<InlineDrawStroke[]>(() => {
    const data = note.drawingData as InlineDrawStroke[] || [];
    return data.filter(s => s && s.tool && s.points);
  });
  const [drawUndoStack, setDrawUndoStack] = useState<InlineDrawStroke[][]>([]);
  const [drawRedoStack, setDrawRedoStack] = useState<InlineDrawStroke[][]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showDrawColors, setShowDrawColors] = useState(false);
  const [showDrawSizes, setShowDrawSizes] = useState(false);
  const [showDrawShapes, setShowDrawShapes] = useState(false);
  const [showDrawArrows, setShowDrawArrows] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textPos, setTextPos] = useState<{ x: number; y: number } | null>(null);
  const laserPointsRef = useRef<{ x: number; y: number; time: number }[]>([]);

  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawContainerRef = useRef<HTMLDivElement>(null);
  const currentDrawStrokeRef = useRef<InlineDrawStroke | null>(null);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const drawStrokesRef = useRef(drawStrokes);
  useEffect(() => { drawStrokesRef.current = drawStrokes; }, [drawStrokes]);
  const [activeStyles, setActiveStyles] = useState({
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    paragraph: true,
    h1: false,
    h2: false,
    h3: false,
    blockquote: false,
    code: false,
    ul: false,
    ol: false,
  });

  const colorStyle = NOTE_COLORS[note.color];
  const bgPattern = NOTE_BACKGROUNDS[note.background];
  const moodStyle = note.mood ? MOOD_CONFIG[note.mood] : null;

  // Lazy-loaded and lazy-decrypted memories background picker
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();

  interface MemoryMetadata {
    id: string;
    media_url: string;
    media_key: string;
    media_nonce: string;
    sender_public_key: string | null;
    type: string;
  }

  const [memoriesList, setMemoriesList] = useState<MemoryMetadata[]>([]);
  const [decryptedUrls, setDecryptedUrls] = useState<Record<string, { blobUrl?: string; loading?: boolean; error?: boolean }>>({});
  const [hasMoreMemories, setHasMoreMemories] = useState(true);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const metadataPageRef = useRef(1);

  const decryptionObserverRef = useRef<IntersectionObserver | null>(null);
  const sentinelObserverRef = useRef<IntersectionObserver | null>(null);
  const decryptingIdsRef = useRef<Set<string>>(new Set());
  const generatedBlobUrlsRef = useRef<Set<string>>(new Set());
  const observedIdsRef = useRef<Set<string>>(new Set());
  const decryptionQueueRef = useRef<MemoryMetadata[]>([]);
  const isProcessingQueueRef = useRef(false);
  const decryptedIdsRef = useRef<Set<string>>(new Set());

  // Cleanup decrypted blob URLs on close or unmount
  const cleanupMemories = useCallback(() => {
    generatedBlobUrlsRef.current.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error('Failed to revoke blob URL:', e);
      }
    });
    generatedBlobUrlsRef.current.clear();

    decryptionObserverRef.current?.disconnect();
    sentinelObserverRef.current?.disconnect();
    decryptionObserverRef.current = null;
    sentinelObserverRef.current = null;

    decryptingIdsRef.current.clear();
    observedIdsRef.current.clear();
    decryptedIdsRef.current.clear();
    decryptionQueueRef.current = [];
    isProcessingQueueRef.current = false;

    setMemoriesList([]);
    setDecryptedUrls({});
    setHasMoreMemories(true);
    metadataPageRef.current = 1;
    setLoadingMetadata(false);
  }, []);

  useEffect(() => {
    if (bottomPanel !== 'backgrounds') {
      cleanupMemories();
    }
  }, [bottomPanel, cleanupMemories]);

  useEffect(() => {
    return () => {
      cleanupMemories();
    };
  }, [cleanupMemories]);

  // Fetch a page of memories metadata
  const fetchMemoriesPage = useCallback(async (page: number, force = false) => {
    if (!user || !partner) return;
    if (!force && (!hasMoreMemories || loadingMetadata)) return;
    setLoadingMetadata(true);

    const LIMIT = 15;
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id, media_url, media_key, media_nonce, sender_public_key, type')
        .not('media_url', 'is', null)
        .in('type', ['image', 'gif'])
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partner.id}),and(sender_id.eq.${partner.id},receiver_id.eq.${user.id})`)
        .order('created_at', { ascending: false })
        .range((page - 1) * LIMIT, page * LIMIT - 1);

      if (error) throw error;

      const newItems = (data || []) as MemoryMetadata[];
      setMemoriesList(prev => {
        const filtered = newItems.filter(item => !prev.some(p => p.id === item.id));
        return [...prev, ...filtered];
      });
      setHasMoreMemories(newItems.length === LIMIT);
      metadataPageRef.current = page;
    } catch (err) {
      console.error('Failed to fetch memories metadata:', err);
    } finally {
      setLoadingMetadata(false);
    }
  }, [user, partner, hasMoreMemories, loadingMetadata]);

  // Initial load
  useEffect(() => {
    if (bottomPanel === 'backgrounds' && user && partner) {
      fetchMemoriesPage(1, true);
    }
  }, [bottomPanel, user, partner]);

  // Decrypt memory item
  const decryptMemory = useCallback(async (item: MemoryMetadata) => {
    if (!partner?.public_key) return;
    if (decryptingIdsRef.current.has(item.id) || decryptedIdsRef.current.has(item.id)) return;

    decryptingIdsRef.current.add(item.id);
    setDecryptedUrls(prev => ({
      ...prev,
      [item.id]: { loading: true }
    }));

    try {
      const blob = await getDecryptedBlob(
        item.media_url,
        item.media_key,
        item.media_nonce,
        partner.public_key,
        item.sender_public_key,
        undefined,
        item.type
      );

      if (blob) {
        const url = URL.createObjectURL(blob);
        generatedBlobUrlsRef.current.add(url);
        decryptedIdsRef.current.add(item.id);

        setDecryptedUrls(prev => ({
          ...prev,
          [item.id]: { blobUrl: url, loading: false }
        }));
      } else {
        setDecryptedUrls(prev => ({
          ...prev,
          [item.id]: { error: true, loading: false }
        }));
      }
    } catch (err) {
      console.error('Failed to decrypt memory item:', err);
      setDecryptedUrls(prev => ({
        ...prev,
        [item.id]: { error: true, loading: false }
      }));
    } finally {
      decryptingIdsRef.current.delete(item.id);
    }
  }, [partner, getDecryptedBlob]);

  const processDecryptionQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    if (decryptionQueueRef.current.length === 0) return;

    isProcessingQueueRef.current = true;

    const item = decryptionQueueRef.current.shift();
    if (item) {
      const alreadyDone = decryptedIdsRef.current.has(item.id) || decryptingIdsRef.current.has(item.id);
      if (!alreadyDone) {
        // Defer decryption to a browser-idle or macro-task schedule to keep layout/rendering at 60fps
        await new Promise<void>(resolve => {
          const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 16));
          schedule(() => resolve());
        });
        await decryptMemory(item);
      }
    }

    isProcessingQueueRef.current = false;
    processDecryptionQueue();
  }, [decryptMemory]);

  const queueDecryption = useCallback((item: MemoryMetadata) => {
    if (decryptedIdsRef.current.has(item.id) || decryptingIdsRef.current.has(item.id)) return;
    if (decryptionQueueRef.current.some(q => q.id === item.id)) return;

    decryptionQueueRef.current.push(item);
    processDecryptionQueue();
  }, [processDecryptionQueue]);

  // Register observer for lazy decryption
  const registerDecryptionObserver = useCallback((node: HTMLButtonElement | null, item: MemoryMetadata) => {
    if (!node) return;
    if (observedIdsRef.current.has(item.id)) return;

    if (!decryptionObserverRef.current) {
      decryptionObserverRef.current = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('data-id');
            setMemoriesList(currentList => {
              const found = currentList.find(m => m.id === id);
              if (found) {
                queueDecryption(found);
              }
              return currentList;
            });
          }
        });
      }, {
        root: null,
        rootMargin: '150px',
        threshold: 0.01
      });
    }

    observedIdsRef.current.add(item.id);
    decryptionObserverRef.current.observe(node);
  }, [queueDecryption]);

  // Register observer for infinite scroll metadata loading
  const registerSentinelObserver = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;

    sentinelObserverRef.current?.disconnect();
    sentinelObserverRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        const nextPage = metadataPageRef.current + 1;
        fetchMemoriesPage(nextPage);
      }
    }, {
      root: null,
      rootMargin: '100px',
      threshold: 0.01
    });

    sentinelObserverRef.current.observe(node);
  }, [fetchMemoriesPage]);

  // Auto-save with debounce
  const debouncedSave = useCallback((updates: Partial<Note>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onUpdate(note.id, updates);
    }, 400);
  }, [note.id, onUpdate]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Scroll toolbar to make colors visible when opened
  useEffect(() => {
    if (showColorMenu && toolbarRef.current) {
      setTimeout(() => {
        if (toolbarRef.current) {
          toolbarRef.current.scrollTo({
            left: toolbarRef.current.scrollWidth,
            behavior: 'smooth'
          });
        }
      }, 150);
    }
  }, [showColorMenu]);

  // Decrypt custom background image if present
  // Supports both legacy (inline ciphertext) and new (Cloudinary URL) formats
  useEffect(() => {
    const customBg = note.customBg;
    if (!customBg) {
      setDecryptedBg(null);
      return;
    }
    let isMounted = true;
    let blobUrl: string | null = null;
    const decryptData = async () => {
      try {
        const keys = getStoredKeyPair();
        if (!keys) return;

        // New format: { url, nonce } — fetch encrypted bytes from Cloudinary then decrypt
        if ('url' in customBg && (customBg as any).url) {
          const response = await fetch((customBg as any).url);
          const arrayBuffer = await response.arrayBuffer();
          const cipherBytes = new Uint8Array(arrayBuffer);
          const decrypted = nacl.secretbox.open(
            cipherBytes,
            decodeBase64(customBg.nonce),
            keys.secretKey
          );
          if (decrypted && isMounted) {
            // The decrypted bytes are the original image file bytes
            const blob = new Blob([decrypted as unknown as BlobPart]);
            blobUrl = URL.createObjectURL(blob);
            setDecryptedBg(blobUrl);
          }
          return;
        }

        // Legacy format: { ciphertext, nonce } — inline base64 in DB
        if ('ciphertext' in customBg && (customBg as any).ciphertext) {
          const decrypted = nacl.secretbox.open(
            decodeBase64((customBg as any).ciphertext),
            decodeBase64(customBg.nonce),
            keys.secretKey
          );
          if (decrypted && isMounted) {
            const text = new TextDecoder().decode(decrypted);
            setDecryptedBg(text);
          }
        }
      } catch (e) {
        console.error('Failed to decrypt custom background image:', e);
      }
    };
    decryptData();
    return () => {
      isMounted = false;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [
    note.customBg?.nonce,
    (note.customBg as any)?.url,
    (note.customBg as any)?.ciphertext
  ]);

  const [isBgUploading, setIsBgUploading] = useState(false);

  // Handle local background image upload — encrypts raw file bytes and uploads to Cloudinary
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Image size should be less than 5MB');
      return;
    }

    try {
      setIsBgUploading(true);
      const keys = getStoredKeyPair();
      if (!keys) {
        alert('Encryption keys not found. Please setup your PIN/keys.');
        return;
      }

      // Read file as raw bytes
      const arrayBuffer = await file.arrayBuffer();
      const dataUint8 = new Uint8Array(arrayBuffer);

      // Encrypt the raw image bytes with secretbox (symmetric, using our secret key)
      const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
      const encrypted = nacl.secretbox(dataUint8, nonce, keys.secretKey);

      // Upload encrypted bytes to Cloudinary as raw file (Cloudinary sees unreadable data)
      const formData = new FormData();
      formData.append('file', new Blob([encrypted as unknown as BlobPart]), 'note_bg.enc');
      formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/raw/upload`,
        { method: 'POST', body: formData }
      );
      if (!response.ok) throw new Error('Cloudinary upload failed');
      const result = await response.json();

      // Store only { url, nonce } in DB — ~100 bytes vs ~300KB+ before
      const customBg = {
        url: result.secure_url,
        nonce: encodeBase64(nonce)
      };

      onUpdate(note.id, { customBg });
    } catch (err) {
      console.error('Encryption/upload failed:', err);
      alert('Failed to encrypt and upload image.');
    } finally {
      setIsBgUploading(false);
    }
  };

  // Save on close
  const handleClose = () => {
    // Auto-save drawing data if in draw mode
    if (drawMode && drawStrokes.length > 0) {
      onUpdate(note.id, { drawingData: drawStrokes });
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      onUpdate(note.id, { title, content });
    }
    onClose();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // INLINE DRAWING: Canvas setup, pointer handlers, rendering
  // ═══════════════════════════════════════════════════════════════════════════

  // Setup / resize the inline drawing canvas
  const resizeDrawCanvas = useCallback(() => {
    const container = drawContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    [drawCanvasRef, drawOverlayCanvasRef].forEach(ref => {
      const canvas = ref.current;
      if (!canvas) return;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }, []);

  // Draw a single stroke
  const drawInlineStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: InlineDrawStroke) => {
    if (!stroke || !stroke.tool) return;
    if (stroke.tool === 'laser') return;

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
    } else {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.globalAlpha = stroke.opacity;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if ((stroke.tool === 'arrow' || stroke.tool === 'double-arrow') && stroke.startX !== undefined) {
      const headLen = Math.max(stroke.size * 4, 12);
      const angle = Math.atan2(stroke.endY! - stroke.startY!, stroke.endX! - stroke.startX);

      // Main line
      ctx.beginPath();
      ctx.moveTo(stroke.startX, stroke.startY!);
      ctx.lineTo(stroke.endX!, stroke.endY!);
      ctx.stroke();

      // End arrowhead
      ctx.beginPath();
      ctx.moveTo(stroke.endX!, stroke.endY!);
      ctx.lineTo(stroke.endX! - headLen * Math.cos(angle - Math.PI / 6), stroke.endY! - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(stroke.endX!, stroke.endY!);
      ctx.lineTo(stroke.endX! - headLen * Math.cos(angle + Math.PI / 6), stroke.endY! - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();

      // Start arrowhead (for double-arrow)
      if (stroke.tool === 'double-arrow') {
        ctx.beginPath();
        ctx.moveTo(stroke.startX, stroke.startY!);
        ctx.lineTo(stroke.startX + headLen * Math.cos(angle - Math.PI / 6), stroke.startY! + headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(stroke.startX, stroke.startY!);
        ctx.lineTo(stroke.startX + headLen * Math.cos(angle + Math.PI / 6), stroke.startY! + headLen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
      }
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
    } else if (stroke.points && stroke.points.length > 1) {
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
    } else if (stroke.points && stroke.points.length === 1) {
      // Draw a single dot
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, []);

  // Redraw all strokes
  const redrawInlineCanvas = useCallback(() => {
    const canvas = drawCanvasRef.current;
    const container = drawContainerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    drawStrokesRef.current.forEach(stroke => {
      drawInlineStroke(ctx, stroke);
    });
  }, [drawInlineStroke]);

  // Resize & redraw when entering draw mode or strokes change
  // Resize canvas when entering draw mode or on window resize ONLY — do NOT depend on
  // drawStrokes here because resizing always clears the canvas, which would erase every stroke.
  useEffect(() => {
    if (drawMode) {
      resizeDrawCanvas();
      redrawInlineCanvas();
      const handleResize = () => { resizeDrawCanvas(); redrawInlineCanvas(); };
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, [drawMode, resizeDrawCanvas, redrawInlineCanvas]);

  // Redraw (without resize) whenever strokes state changes — e.g. after pointer-up commits a stroke
  useEffect(() => {
    if (drawMode) {
      redrawInlineCanvas();
    }
  }, [drawStrokes, drawMode, redrawInlineCanvas]);

  // Laser animation loop
  useEffect(() => {
    if (!drawMode) return;
    let animationFrameId: number;

    const animateLaser = () => {
      const now = Date.now();
      // Keep points from last 300ms
      laserPointsRef.current = laserPointsRef.current.filter(p => now - p.time < 300);

      const overlayCanvas = drawOverlayCanvasRef.current;
      if (overlayCanvas) {
        const ctx = overlayCanvas.getContext('2d');
        if (ctx) {
          const rect = overlayCanvas.getBoundingClientRect();
          ctx.clearRect(0, 0, rect.width, rect.height);

          // Render current shape preview if it's active
          if (isDrawing && currentDrawStrokeRef.current && ['arrow', 'double-arrow', 'line', 'rect', 'circle'].includes(drawTool)) {
            drawInlineStroke(ctx, currentDrawStrokeRef.current);
          }

          // Render laser points
          if (laserPointsRef.current.length > 0) {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (let i = 0; i < laserPointsRef.current.length - 1; i++) {
              const p1 = laserPointsRef.current[i];
              const p2 = laserPointsRef.current[i + 1];
              const age = now - p1.time;
              const opacity = Math.max(0, 1 - age / 300);
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.strokeStyle = `rgba(255, 64, 64, ${opacity})`;
              ctx.lineWidth = drawSize * 1.5;
              ctx.stroke();
            }
          }
        }
      }

      animationFrameId = requestAnimationFrame(animateLaser);
    };

    animateLaser();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [drawMode, drawSize, isDrawing, drawTool, drawInlineStroke]);

  // Pointer handlers for inline drawing
  const getDrawPos = (e: React.PointerEvent): { x: number; y: number } => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleDrawPointerDown = (e: React.PointerEvent) => {
    if (!drawMode) return;
    setIsDrawing(true);
    const pos = getDrawPos(e);

    if (drawTool === 'text') {
      setTextPos(pos);
      setIsDrawing(false);
      return;
    }

    if (drawTool === 'laser') return;

    // Save state for undo
    setDrawUndoStack(prev => [...prev, [...drawStrokesRef.current]]);
    setDrawRedoStack([]);

    if (['arrow', 'double-arrow', 'line', 'rect', 'circle'].includes(drawTool)) {
      shapeStartRef.current = pos;
      currentDrawStrokeRef.current = {
        id: crypto.randomUUID(),
        tool: drawTool,
        points: [],
        color: drawColor,
        size: drawSize,
        opacity: 1,
        startX: pos.x,
        startY: pos.y,
        endX: pos.x,
        endY: pos.y,
      };
    } else {
      currentDrawStrokeRef.current = {
        id: crypto.randomUUID(),
        tool: drawTool,
        points: [pos],
        color: drawColor,
        size: drawSize,
        opacity: drawTool === 'highlighter' ? 0.35 : 1,
      };
    }

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleDrawPointerMove = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    const pos = getDrawPos(e);

    if (drawTool === 'laser') {
      laserPointsRef.current.push({ ...pos, time: Date.now() });
      return;
    }

    if (!currentDrawStrokeRef.current) return;

    if (['arrow', 'double-arrow', 'line', 'rect', 'circle'].includes(drawTool)) {
      currentDrawStrokeRef.current.endX = pos.x;
      currentDrawStrokeRef.current.endY = pos.y;
    } else {
      currentDrawStrokeRef.current.points.push(pos);

      // Draw everything: saved strokes + current stroke on main canvas
      const canvas = drawCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          redrawInlineCanvas();
          drawInlineStroke(ctx, currentDrawStrokeRef.current);
        }
      }
    }
  };

  const handleDrawPointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (drawTool === 'laser') return;

    if (currentDrawStrokeRef.current) {
      // Allow saving shape if moved, or single-point dot for pen
      const stroke = currentDrawStrokeRef.current;
      currentDrawStrokeRef.current = null;
      setDrawStrokes(prev => [...prev, stroke]);
    } else {
      setDrawUndoStack(prev => prev.slice(0, -1));
    }

    const overlayCanvas = drawOverlayCanvasRef.current;
    if (overlayCanvas) {
      const ctx = overlayCanvas.getContext('2d');
      if (ctx) {
        const rect = overlayCanvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
      }
    }
  };

  const handleTextSubmit = () => {
    if (!textInput.trim() || !textPos) return;

    setDrawUndoStack(prev => [...prev, [...drawStrokesRef.current]]);
    setDrawRedoStack([]);

    const textStroke: InlineDrawStroke = {
      id: crypto.randomUUID(),
      tool: 'text',
      points: [],
      color: drawColor,
      size: drawSize,
      opacity: 1,
      startX: textPos.x,
      startY: textPos.y,
      text: textInput,
      fontSize: drawSize * 5,
    };

    setDrawStrokes(prev => [...prev, textStroke]);
    setTextInput('');
    setTextPos(null);
  };

  const drawUndo = useCallback(() => {
    if (drawUndoStack.length === 0) return;
    const prevState = drawUndoStack[drawUndoStack.length - 1];
    setDrawRedoStack(prev => [...prev, [...drawStrokesRef.current]]);
    setDrawStrokes(prevState);
    setDrawUndoStack(prev => prev.slice(0, -1));
  }, [drawUndoStack]);

  const drawRedo = useCallback(() => {
    if (drawRedoStack.length === 0) return;
    const nextState = drawRedoStack[drawRedoStack.length - 1];
    setDrawUndoStack(prev => [...prev, [...drawStrokesRef.current]]);
    setDrawStrokes(nextState);
    setDrawRedoStack(prev => prev.slice(0, -1));
  }, [drawRedoStack]);

  const drawClearAll = () => {
    if (drawStrokesRef.current.length === 0) return;
    setDrawUndoStack(prev => [...prev, [...drawStrokesRef.current]]);
    setDrawRedoStack([]);
    setDrawStrokes([]);
  };

  const toggleDrawMode = () => {
    if (drawMode) {
      // Exiting draw mode — save drawing data
      onUpdate(note.id, { drawingData: drawStrokes.length > 0 ? drawStrokes : null });
    }
    setDrawMode(!drawMode);
    setShowDrawColors(false);
    setShowDrawSizes(false);
  };

  // Keyboard shortcuts for draw mode
  useEffect(() => {
    if (!drawMode) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); drawUndo(); }
        if (e.key === 'y') { e.preventDefault(); drawRedo(); }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [drawMode, drawUndo, drawRedo]);

  // Initialize contentEditable content on mount
  useEffect(() => {
    if (contentEditableRef.current && !note.isChecklist) {
      contentEditableRef.current.innerHTML = note.content || '';
    }
  }, []);

  const updateActiveStyles = useCallback(() => {
    if (typeof document === 'undefined') return;
    setActiveStyles({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strikeThrough: document.queryCommandState('strikeThrough'),
      paragraph: document.queryCommandValue('formatBlock') === 'p' || document.queryCommandValue('formatBlock') === 'div' || !document.queryCommandValue('formatBlock'),
      h1: document.queryCommandValue('formatBlock') === 'h1',
      h2: document.queryCommandValue('formatBlock') === 'h2',
      h3: document.queryCommandValue('formatBlock') === 'h3',
      blockquote: document.queryCommandValue('formatBlock') === 'blockquote',
      code: document.queryCommandValue('formatBlock') === 'pre',
      ul: document.queryCommandState('insertUnorderedList'),
      ol: document.queryCommandState('insertOrderedList'),
    });
  }, []);

  const [selectionDetails, setSelectionDetails] = useState<{
    text: string;
    x: number;
    y: number;
    show: boolean;
  }>({ text: '', x: 0, y: 0, show: false });

  const handleSelectionChange = useCallback(() => {
    updateActiveStyles();

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.toString().trim() === '') {
      setSelectionDetails(prev => prev.show ? { ...prev, show: false } : prev);
      return;
    }

    const selectedText = selection.toString();

    if (
      contentEditableRef.current &&
      (contentEditableRef.current.contains(selection.anchorNode) ||
        contentEditableRef.current.contains(selection.focusNode))
    ) {
      try {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        const tooltipWidthEstimate = 120;
        const rightEdgeLimit = window.innerWidth - 16;
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        let x = rect.right;
        // If placing it centered at rect.right extends beyond the right edge limit, place it at rect.left instead
        if (rect.right + tooltipWidthEstimate / 2 > rightEdgeLimit) {
          x = rect.left;
          // Ensure it doesn't clip off the left edge either
          if (x - tooltipWidthEstimate / 2 < 16) {
            x = Math.max(tooltipWidthEstimate / 2 + 16, rect.left);
          }
        }

        // Position below on mobile/touch to avoid system menu, above on desktop
        const y = isTouchDevice
          ? rect.bottom + 12
          : Math.max(10, rect.top - 45);

        setSelectionDetails({
          text: selectedText,
          x,
          y,
          show: true
        });
      } catch (e) {
        // Safe fallback
      }
    } else {
      setSelectionDetails(prev => prev.show ? { ...prev, show: false } : prev);
    }
  }, [updateActiveStyles]);

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [handleSelectionChange]);

  const handleSendHighlightToChat = async () => {
    if (!selectionDetails.text.trim() || !user || !partner || !partner.public_key) return;

    try {
      const myKeyPair = getStoredKeyPair();
      if (!myKeyPair) {
        alert('Encryption keys not found. Please setup your PIN/keys.');
        return;
      }

      const noteColor = note.color || 'default';
      const noteCustomColor = note.customColor || 'none';
      const messageText = `[NOTE_HIGHLIGHT:color=${noteColor}&customColor=${noteCustomColor}]:${selectionDetails.text.trim()}`;
      const encrypted = encryptMessage(messageText, decodeBase64(partner.public_key), myKeyPair.secretKey);
      const ciphertext = encrypted.ciphertext;
      const nonce = encrypted.nonce;
      const myPublicKeyStr = encodeBase64(myKeyPair.publicKey);
      const msgId = crypto.randomUUID();

      const { error } = await supabase
        .from('messages')
        .insert({
          id: msgId,
          sender_id: user.id,
          receiver_id: partner.id,
          encrypted_content: ciphertext,
          nonce: nonce,
          type: 'text',
          sender_public_key: myPublicKeyStr,
        });

      if (error) throw error;

      // Silently invoke push notification
      try {
        const { data: { session: freshSession } } = await supabase.auth.getSession();
        if (freshSession) {
          supabase.functions.invoke('send-push', {
            body: {
              record: {
                id: msgId,
                sender_id: user.id,
                receiver_id: partner.id,
              }
            }
          }).then();
        }
      } catch (err) {
        // Ignore push failures
      }

      // Close editor
      onClose();
      // Switch tab to chat
      document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'chat' }));
    } catch (err) {
      console.error('Failed to send note highlight to chat:', err);
      alert('Failed to send highlight to chat.');
    }
  };

  // Focus title if empty, else focus content
  useEffect(() => {
    setTimeout(() => {
      if (!note.title && titleRef.current) {
        titleRef.current.focus();
      } else if (contentEditableRef.current) {
        contentEditableRef.current.focus();
        const el = contentEditableRef.current;
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(el);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }, 100);
  }, []);

  const handleFormat = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
    contentEditableRef.current?.focus();
    updateActiveStyles();
  };

  const handleBlockFormat = (tag: string) => {
    const currentBlock = document.queryCommandValue('formatBlock');
    const targetTag = currentBlock === tag ? 'p' : tag;
    document.execCommand('formatBlock', false, `<${targetTag}>`);
    contentEditableRef.current?.focus();
    updateActiveStyles();
  };

  const handleTextColor = (color: string) => {
    document.execCommand('foreColor', false, color);
    setShowColorMenu(false);
    contentEditableRef.current?.focus();
    updateActiveStyles();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const node = range.startContainer;

      let currentElement: HTMLElement | null = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;

      while (currentElement && currentElement !== contentEditableRef.current) {
        const tagName = currentElement.tagName.toLowerCase();

        if (tagName === 'pre') {
          const textVal = currentElement.textContent || '';
          if (textVal.replace(/\u200B/g, '').trim() === '') {
            e.preventDefault();
            document.execCommand('formatBlock', false, '<p>');
            updateActiveStyles();
            return;
          }

          let isLineEmpty = false;

          if (node.nodeType === Node.TEXT_NODE) {
            const offset = range.startOffset;
            const textContent = node.textContent || '';
            if (offset > 0) {
              if (textContent[offset - 1] === '\n') {
                isLineEmpty = true;
              }
            } else {
              let prev = node.previousSibling;
              while (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent === '') {
                prev = prev.previousSibling;
              }
              if (!prev || (prev.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName.toLowerCase() === 'br') || (prev.nodeType === Node.TEXT_NODE && prev.textContent?.endsWith('\n'))) {
                isLineEmpty = true;
              }
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const offset = range.startOffset;
            const childNodes = node.childNodes;
            if (offset === 0) {
              isLineEmpty = true;
            } else {
              let prev: ChildNode | null = childNodes[offset - 1] || null;
              while (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent === '') {
                prev = prev.previousSibling;
              }
              if (!prev || (prev.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName.toLowerCase() === 'br') || (prev.nodeType === Node.TEXT_NODE && prev.textContent?.endsWith('\n'))) {
                isLineEmpty = true;
              }
            }
          }

          if (isLineEmpty) {
            const clone = range.cloneRange();
            clone.selectNodeContents(currentElement);
            clone.setStart(range.endContainer, range.endOffset);
            const isNearEnd = clone.toString().trim() === '';

            if (isNearEnd) {
              e.preventDefault();

              let html = currentElement.innerHTML;
              html = html.replace(/(<br\s*\/?>|\n|\s)+$/, '');
              currentElement.innerHTML = html;

              const p = document.createElement('p');
              p.innerHTML = '<br>';
              currentElement.parentNode?.insertBefore(p, currentElement.nextSibling);

              const newRange = document.createRange();
              const newSelection = window.getSelection();
              newRange.selectNodeContents(p);
              newRange.collapse(true);
              newSelection?.removeAllRanges();
              newSelection?.addRange(newRange);

              updateActiveStyles();
              return;
            }
          }
          break;
        }

        if (tagName === 'blockquote' || tagName === 'li') {
          const text = (currentElement.textContent || '').replace(/\u200B/g, '').trim();
          if (text === '') {
            e.preventDefault();

            // If it's a list item (li), turn off list mode
            if (tagName === 'li') {
              const isOL = document.queryCommandState('insertOrderedList');
              if (isOL) {
                document.execCommand('insertOrderedList', false);
              } else {
                document.execCommand('insertUnorderedList', false);
              }
            } else {
              // Convert blockquote block to paragraph
              document.execCommand('formatBlock', false, '<p>');
            }

            updateActiveStyles();
            return;
          }
          break;
        }
        currentElement = currentElement.parentElement;
      }
    }
  };

  // ═══ LIVE MARKDOWN: Render/un-render paragraphs based on cursor ═══
  const handleLiveMarkdown = useCallback(() => {
    const editor = contentEditableRef.current;
    if (!editor || note.isChecklist) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const cursorNode = range.startContainer;
    const cursorOffset = range.startOffset;

    // Find the block-level element the cursor is in
    let cursorBlock: HTMLElement | null = null;
    let node: Node | null = cursorNode;
    while (node && node !== editor) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (['p', 'div', 'h1', 'h2', 'h3', 'blockquote', 'pre', 'li'].includes(tag)) {
          cursorBlock = el;
          break;
        }
      }
      node = node.parentNode;
    }

    // Process all direct children of the editor
    // Use a snapshot since we may modify the DOM
    const children = Array.from(editor.children);
    for (const child of children) {
      const el = child as HTMLElement;

      if (el === cursorBlock) {
        // Cursor IS in this block: un-render to show raw markdown
        if (isRenderedMarkdown(el)) {
          const raw = getRawMarkdown(el);

          // Create a fresh <p> with raw text (regardless of current tag)
          const p = document.createElement('p');
          p.textContent = raw;
          el.replaceWith(p);

          // Restore cursor position in the new element
          try {
            const newRange = document.createRange();
            const textNode = p.firstChild || p;
            const maxOffset = textNode.textContent?.length || 0;
            newRange.setStart(textNode, Math.min(cursorOffset, maxOffset));
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
          } catch (e) { /* safe */ }

          // Update cursorBlock reference to the new element
          cursorBlock = p;
        }
      } else {
        // Cursor is NOT in this block: try to render markdown
        if (!isRenderedMarkdown(el)) {
          const rawText = el.textContent || '';
          if (!rawText.trim()) continue;

          const { html, isBlock, blockTag } = renderMarkdownLine(rawText);
          if (isBlock || html !== rawText) {
            if (blockTag) {
              // Block-level: change the element's tag (e.g., <p> → <h2>)
              const newEl = document.createElement(blockTag);
              newEl.setAttribute('data-md-raw', rawText);
              newEl.setAttribute('data-md-rendered', 'true');
              newEl.innerHTML = html;
              el.replaceWith(newEl);
            } else {
              // Inline-only: keep the same element, just update innerHTML
              el.setAttribute('data-md-raw', rawText);
              el.setAttribute('data-md-rendered', 'true');
              el.innerHTML = html;
            }
          }
        }
      }
    }
  }, [note.isChecklist]);

  // Debounced live markdown on cursor movement / input
  const mdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerLiveMarkdown = useCallback(() => {
    if (mdTimerRef.current) clearTimeout(mdTimerRef.current);
    mdTimerRef.current = setTimeout(handleLiveMarkdown, 80);
  }, [handleLiveMarkdown]);

  useEffect(() => {
    return () => { if (mdTimerRef.current) clearTimeout(mdTimerRef.current); };
  }, []);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    debouncedSave({ title: val, content });
  };

  const handleContentChange = (val: string) => {
    setContent(val);
    debouncedSave({ title, content: val });
    triggerLiveMarkdown();
  };

  const togglePanel = (panel: BottomPanel) => {
    setBottomPanel(prev => prev === panel ? 'none' : panel);
  };

  const handleColorChange = (color: NoteColor) => {
    onUpdate(note.id, { color, customColor: null });
  };

  const handleMoodChange = (mood: NoteMood | null) => {
    onUpdate(note.id, { mood: note.mood === mood ? null : mood });
  };

  const toggleChecklist = () => {
    if (!note.isChecklist) {
      // Convert HTML content to plain text lines
      const plainText = getPlainText(content);
      const lines = plainText.split('\n').map(l => l.trim()).filter(Boolean);
      const items: ChecklistItem[] = lines.map(line => ({
        id: crypto.randomUUID(),
        text: line,
        checked: false,
      }));
      onUpdate(note.id, { isChecklist: true, checklist: items.length ? items : [{ id: crypto.randomUUID(), text: '', checked: false }], content: '' });
      setContent('');
    } else {
      // Convert checklist back to HTML
      const text = note.checklist.map(i => `<p>${i.text}</p>`).join('');
      onUpdate(note.id, { isChecklist: false, content: text, checklist: [] });
      setContent(text);
      setTimeout(() => {
        if (contentEditableRef.current) {
          contentEditableRef.current.innerHTML = text;
        }
      }, 50);
    }
  };

  const handleChecklistKeyDown = (e: React.KeyboardEvent, item: ChecklistItem, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onAddChecklistItem(note.id, '');
      // Focus new item after render
      setTimeout(() => {
        const inputs = document.querySelectorAll<HTMLInputElement>('.checklist-input');
        inputs[index + 1]?.focus();
      }, 50);
    } else if (e.key === 'Backspace' && !item.text) {
      e.preventDefault();
      onRemoveChecklistItem(note.id, item.id);
      // Focus previous item
      setTimeout(() => {
        const inputs = document.querySelectorAll<HTMLInputElement>('.checklist-input');
        inputs[Math.max(0, index - 1)]?.focus();
      }, 50);
    }
  };

  const handleAddLabelSubmit = () => {
    if (!newLabelText.trim()) return;
    onAddLabel(newLabelText.trim());
    onToggleLabel(note.id, newLabelText.trim());
    setNewLabelText('');
  };



  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Selection Tooltip */}
      {selectionDetails.show && (
        <div
          className="fixed z-[300] -translate-x-1/2 flex items-center bg-zinc-950/95 backdrop-blur-md border border-white/10 rounded-full px-3.5 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.5)] pointer-events-auto"
          style={{
            left: `${selectionDetails.x}px`,
            top: `${selectionDetails.y}px`,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleSendHighlightToChat}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--gold)] hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'wght' 700" }}>forum</span>
            <span>Send to Chat</span>
          </button>
        </div>
      )}

      {/* Editor card */}
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 30 }}
        transition={{ type: 'spring', damping: 28, stiffness: 350 }}
        className="relative z-10 w-full max-w-lg mx-4 max-h-[95dvh] flex flex-col rounded-3xl overflow-hidden shadow-2xl"
        style={{
          background: note.customColor || colorStyle.bg,
          border: `1px solid ${note.customColor ? `${note.customColor}44` : colorStyle.border}`,
          backgroundImage: decryptedBg
            ? `linear-gradient(rgba(12, 12, 20, 0.5), rgba(12, 12, 20, 0.65)), url(${decryptedBg})`
            : (bgPattern.pattern || undefined),
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backdropFilter: 'blur(40px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mood gradient overlay */}
        {moodStyle && !decryptedBg && note.background === 'none' && (
          <div className="absolute inset-0 pointer-events-none rounded-3xl" style={{ backgroundImage: moodStyle.gradient }} />
        )}

        {/* Header */}
        <div className="relative z-[1] flex items-center justify-between px-4 pt-4 pb-2 shrink-0 gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button
              onClick={handleClose}
              className="-ml-1 w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors shrink-0"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>arrow_back</span>
            </button>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Title"
              className="flex-1 bg-transparent text-[var(--text-primary)] text-base font-semibold placeholder:text-white/20 focus:outline-none min-w-0"
              style={{ outline: 'none', boxShadow: 'none' }}
            />
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {moodStyle && (
              <div className="w-9 h-9 flex items-center justify-center text-lg select-none cursor-default" title={moodStyle.label}>
                {moodStyle.emoji}
              </div>
            )}
            <button
              onClick={() => onTogglePin(note.id)}
              className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${note.isPinned ? 'text-[var(--gold)]' : 'text-white/40 hover:text-white/70'
                }`}
              title={note.isPinned ? 'Unpin' : 'Pin'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px', fontVariationSettings: note.isPinned ? "'FILL' 1" : '' }}>push_pin</span>
            </button>
            <button
              onClick={() => togglePanel('more')}
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>more_vert</span>
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="relative z-[1] flex-1 overflow-y-auto px-4 mb-4 scrollbar-hide">

          {/* Content or Checklist */}
          {note.isChecklist ? (
            <div className="flex flex-col gap-0.5">
              {note.checklist.map((item, idx) => (
                <div key={item.id} className="flex items-center gap-2 group/item py-1">
                  <button
                    onClick={() => onUpdateChecklistItem(note.id, item.id, { checked: !item.checked })}
                    className="shrink-0 flex items-center justify-center"
                  >
                    <span className={`material-symbols-outlined text-lg ${item.checked ? 'text-[var(--gold)]/60' : 'text-white/25'
                      }`} style={{ fontSize: '20px', display: 'block', lineHeight: '1' }}>
                      {item.checked ? 'check_box' : 'check_box_outline_blank'}
                    </span>
                  </button>
                  <input
                    value={item.text}
                    onChange={(e) => onUpdateChecklistItem(note.id, item.id, { text: e.target.value })}
                    onKeyDown={(e) => handleChecklistKeyDown(e, item, idx)}
                    placeholder="List item"
                    className={`checklist-input flex-1 bg-transparent text-sm focus:outline-none placeholder:text-white/15 ${item.checked ? 'line-through text-white/30' : 'text-[var(--text-primary)]'
                      }`}
                    style={{ outline: 'none', boxShadow: 'none' }}
                  />
                  <button
                    onClick={() => onRemoveChecklistItem(note.id, item.id)}
                    className="opacity-0 group-hover/item:opacity-100 w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 text-white/25 hover:text-white/50 transition-all shrink-0"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', display: 'block', lineHeight: '1' }}>close</span>
                  </button>
                </div>
              ))}
              <button
                onClick={() => onAddChecklistItem(note.id, '')}
                className="flex items-center gap-2 py-2 text-white/25 hover:text-white/40 transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
                <span className="text-xs">Add item</span>
              </button>
            </div>
          ) : (
            <>
              {/* Rich editor stylesheet */}
              <style>{`
                .rich-editor h1 {
                  font-family: serif;
                  font-size: 1.25rem;
                  font-weight: 600;
                  color: var(--gold);
                  margin-top: 1rem;
                  margin-bottom: 0.5rem;
                }
                .rich-editor h2 {
                  font-family: serif;
                  font-size: 1.125rem;
                  font-weight: 600;
                  color: rgba(255, 255, 255, 0.9);
                  margin-top: 0.75rem;
                  margin-bottom: 0.375rem;
                }
                .rich-editor h3 {
                  font-size: 1rem;
                  font-weight: 600;
                  color: rgba(255, 255, 255, 0.8);
                  margin-top: 0.5rem;
                  margin-bottom: 0.25rem;
                }
                .rich-editor p {
                  font-size: 0.875rem;
                  line-height: 1.625;
                  color: rgba(255, 255, 255, 0.7);
                  margin-bottom: 0.5rem;
                }
                .rich-editor blockquote {
                  border-left: 3px solid var(--gold);
                  padding-left: 0.75rem;
                  font-style: italic;
                  margin: 0.75rem 0;
                  color: rgba(255, 255, 255, 0.6);
                  background: rgba(255, 255, 255, 0.03);
                  padding-top: 0.25rem;
                  padding-bottom: 0.25rem;
                  padding-right: 0.5rem;
                  border-radius: 0 0.5rem 0.5rem 0;
                }
                .rich-editor pre {
                  font-family: monospace;
                  font-size: 0.75rem;
                  background: rgba(0, 0, 0, 0.3);
                  color: #4ade80;
                  padding: 0.75rem;
                  border-radius: 0.75rem;
                  margin: 0.75rem 0;
                  overflow-x: auto;
                  border: 1px solid rgba(255, 255, 255, 0.05);
                }
                .rich-editor ul {
                  list-style-type: disc;
                  padding-left: 1.25rem;
                  margin-bottom: 0.5rem;
                }
                .rich-editor ol {
                  list-style-type: decimal;
                  padding-left: 1.25rem;
                  margin-bottom: 0.5rem;
                }
                .rich-editor li {
                  font-size: 0.875rem;
                  color: rgba(255, 255, 255, 0.7);
                  margin-bottom: 0.25rem;
                }
                .rich-editor:empty:before {
                  content: attr(placeholder);
                  color: rgba(255, 255, 255, 0.2);
                  cursor: text;
                  pointer-events: none;
                  display: block;
                }
              `}</style>

              {/* ═══ CONDITIONAL TOOLBAR: Draw Mode vs Format Mode ═══ */}
              {drawMode ? (
                /* ── DRAW MODE TOOLBAR ── */
                <div className="pb-2 mb-3 border-b border-white/5 shrink-0">
                  <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
                    {/* Tools from INLINE_TOOLS */}
                    {INLINE_TOOLS.map(t => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setDrawTool(t.id);
                          setShowDrawShapes(false);
                          setShowDrawArrows(false);
                          setShowDrawColors(false);
                          setShowDrawSizes(false);
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl transition-all shrink-0 ${drawTool === t.id
                            ? 'bg-white/10 text-[var(--gold)]'
                            : 'text-white/35 hover:text-white/60 hover:bg-white/5'
                          }`}
                        title={t.label}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{t.icon}</span>
                        <span className="text-[8px] font-bold uppercase tracking-wider hidden sm:inline">{t.label}</span>
                      </button>
                    ))}

                    <div className="h-4 w-[1px] bg-white/10 mx-1 shrink-0" />

                    {/* Color toggle */}
                    <button
                      onClick={() => { setShowDrawColors(!showDrawColors); setShowDrawSizes(false); }}
                      className={`p-1.5 rounded-lg transition-all shrink-0 ${showDrawColors ? 'bg-white/10' : 'hover:bg-white/5'
                        }`}
                      title="Color"
                    >
                      <div className="w-5 h-5 rounded-full border-2 border-white/20" style={{ backgroundColor: drawColor }} />
                    </button>

                    {/* Size toggle */}
                    <button
                      onClick={() => { setShowDrawSizes(!showDrawSizes); setShowDrawColors(false); setShowDrawShapes(false); setShowDrawArrows(false); }}
                      className={`p-1.5 rounded-lg transition-all shrink-0 flex items-center gap-1 ${showDrawSizes ? 'bg-white/10 text-[var(--gold)]' : 'text-white/35 hover:text-white/60 hover:bg-white/5'
                        }`}
                      title="Size"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>line_weight</span>
                      <span className="text-[9px] font-bold text-white/30">{drawSize}px</span>
                    </button>

                    {/* Shapes toggle */}
                    <button
                      onClick={() => { setShowDrawShapes(!showDrawShapes); setShowDrawColors(false); setShowDrawSizes(false); setShowDrawArrows(false); }}
                      className={`p-1.5 rounded-lg transition-all shrink-0 flex items-center gap-1 ${showDrawShapes || SHAPE_TOOLS.some(t => t.id === drawTool) ? 'bg-white/10 text-[var(--gold)]' : 'text-white/35 hover:text-white/60 hover:bg-white/5'
                        }`}
                      title="Shapes"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>category</span>
                      <span className="text-[8px] font-bold uppercase tracking-wider hidden sm:inline">Shapes</span>
                    </button>

                    {/* Arrows toggle */}
                    <button
                      onClick={() => { setShowDrawArrows(!showDrawArrows); setShowDrawColors(false); setShowDrawSizes(false); setShowDrawShapes(false); }}
                      className={`p-1.5 rounded-lg transition-all shrink-0 flex items-center gap-1 ${showDrawArrows || ARROW_TOOLS.some(t => t.id === drawTool) ? 'bg-white/10 text-[var(--gold)]' : 'text-white/35 hover:text-white/60 hover:bg-white/5'
                        }`}
                      title="Arrows"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>trending_flat</span>
                      <span className="text-[8px] font-bold uppercase tracking-wider hidden sm:inline">Arrows</span>
                    </button>

                    <div className="h-4 w-[1px] bg-white/10 mx-1 shrink-0" />

                    {/* Undo */}
                    <button
                      onClick={drawUndo}
                      disabled={drawUndoStack.length === 0}
                      className="p-1.5 rounded-lg hover:bg-white/5 text-white/40 hover:text-white/70 transition-colors disabled:opacity-20 disabled:cursor-default shrink-0"
                      title="Undo"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>undo</span>
                    </button>
                    {/* Redo */}
                    <button
                      onClick={drawRedo}
                      disabled={drawRedoStack.length === 0}
                      className="p-1.5 rounded-lg hover:bg-white/5 text-white/40 hover:text-white/70 transition-colors disabled:opacity-20 disabled:cursor-default shrink-0"
                      title="Redo"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>redo</span>
                    </button>
                    {/* Clear */}
                    <button
                      onClick={drawClearAll}
                      disabled={drawStrokes.length === 0}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-colors disabled:opacity-20 disabled:cursor-default shrink-0"
                      title="Clear All"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete_sweep</span>
                    </button>

                    <div className="h-4 w-[1px] bg-white/10 mx-1 shrink-0" />

                    {/* Done (exit draw mode) */}
                    <button
                      onClick={toggleDrawMode}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[var(--gold)] text-black text-[9px] font-bold uppercase tracking-[0.12em] hover:brightness-110 transition-all shrink-0"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span>
                      Done
                    </button>
                  </div>

                  {/* Color picker row */}
                  <AnimatePresence>
                    {showDrawColors && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-2 pt-2 overflow-x-auto scrollbar-hide">
                          {INLINE_DRAW_COLORS.map(c => (
                            <button
                              key={c.id}
                              onClick={() => setDrawColor(c.hex)}
                              className={`w-7 h-7 rounded-full border-2 transition-all hover:scale-110 shrink-0 flex items-center justify-center ${drawColor === c.hex ? 'border-white scale-110 shadow-lg' : 'border-white/15'
                                }`}
                              style={{ backgroundColor: c.hex }}
                              title={c.label}
                            >
                              {drawColor === c.hex && (
                                <span className="material-symbols-outlined text-black/80" style={{ fontSize: '12px' }}>check</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Size picker row */}
                  <AnimatePresence>
                    {showDrawSizes && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-3 pt-2 justify-center">
                          {INLINE_DRAW_SIZES.map(s => (
                            <button
                              key={s}
                              onClick={() => setDrawSize(s)}
                              className={`flex items-center justify-center transition-all hover:scale-110 ${drawSize === s ? 'ring-2 ring-[var(--gold)] ring-offset-2 ring-offset-transparent' : ''
                                } rounded-full`}
                              title={`Size ${s}`}
                            >
                              <div
                                className="rounded-full"
                                style={{
                                  width: `${s * 2 + 6}px`,
                                  height: `${s * 2 + 6}px`,
                                  backgroundColor: drawColor,
                                }}
                              />
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Shapes picker row */}
                  <AnimatePresence>
                    {showDrawShapes && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-2 pt-2 justify-center">
                          {SHAPE_TOOLS.map(t => (
                            <button
                              key={t.id}
                              onClick={() => setDrawTool(t.id)}
                              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl transition-all ${drawTool === t.id
                                  ? 'bg-white/10 text-[var(--gold)] ring-1 ring-[var(--gold)]/50'
                                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                                }`}
                              title={t.label}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{t.icon}</span>
                              <span className="text-[10px] font-bold uppercase tracking-wider">{t.label}</span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Arrows picker row */}
                  <AnimatePresence>
                    {showDrawArrows && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-2 pt-2 justify-center">
                          {ARROW_TOOLS.map(t => (
                            <button
                              key={t.id}
                              onClick={() => setDrawTool(t.id)}
                              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl transition-all ${drawTool === t.id
                                  ? 'bg-white/10 text-[var(--gold)] ring-1 ring-[var(--gold)]/50'
                                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                                }`}
                              title={t.label}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{t.icon}</span>
                              <span className="text-[10px] font-bold uppercase tracking-wider">{t.label}</span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                /* ── FORMAT MODE TOOLBAR (original) ── */
                <div ref={toolbarRef} className="flex items-center gap-1 pb-2 mb-3 border-b border-white/5 overflow-x-auto scrollbar-hide shrink-0">
                  <button
                    type="button"
                    onClick={() => handleFormat('bold')}
                    className={`p-1.5 rounded-lg transition-colors shrink-0 ${activeStyles.bold ? 'bg-white/15 text-[var(--gold)] font-bold' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    title="Bold (Ctrl+B)"
                  >
                    <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_bold</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormat('italic')}
                    className={`p-1.5 rounded-lg transition-colors shrink-0 ${activeStyles.italic ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    title="Italic (Ctrl+I)"
                  >
                    <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_italic</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormat('underline')}
                    className={`p-1.5 rounded-lg transition-colors shrink-0 ${activeStyles.underline ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    title="Underline (Ctrl+U)"
                  >
                    <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_underlined</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormat('strikeThrough')}
                    className={`p-1.5 rounded-lg transition-colors shrink-0 ${activeStyles.strikeThrough ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    title="Strikethrough"
                  >
                    <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_strikethrough</span>
                  </button>

                  <div className="h-4 w-[1px] bg-white/10 mx-1 shrink-0" />

                  <button
                    type="button"
                    onClick={() => handleBlockFormat('p')}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${activeStyles.paragraph ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    title="Normal Text"
                  >
                    Txt
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBlockFormat('h1')}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${activeStyles.h1 ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    title="Heading 1"
                  >
                    H1
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBlockFormat('h2')}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${activeStyles.h2 ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    title="Heading 2"
                  >
                    H2
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBlockFormat('h3')}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${activeStyles.h3 ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    title="Heading 3"
                  >
                    H3
                  </button>

                  <div className="h-4 w-[1px] bg-white/10 mx-1 shrink-0" />

                  <button
                    type="button"
                    onClick={() => handleFormat('insertUnorderedList')}
                    className={`p-1.5 rounded-lg transition-colors shrink-0 ${activeStyles.ul ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    title="Bullet List"
                  >
                    <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_list_bulleted</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormat('insertOrderedList')}
                    className={`p-1.5 rounded-lg transition-colors shrink-0 ${activeStyles.ol ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    title="Numbered List"
                  >
                    <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_list_numbered</span>
                  </button>

                  <div className="h-4 w-[1px] bg-white/10 mx-1 shrink-0" />

                  <button
                    type="button"
                    onClick={() => handleBlockFormat('blockquote')}
                    className={`p-1.5 rounded-lg transition-colors shrink-0 ${activeStyles.blockquote ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    title="Quote Block"
                  >
                    <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_quote</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBlockFormat('pre')}
                    className={`p-1.5 rounded-lg transition-colors shrink-0 ${activeStyles.code ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    title="Code Block"
                  >
                    <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>code</span>
                  </button>

                  <div className="h-4 w-[1px] bg-white/10 mx-1 shrink-0" />

                  {/* Text Color Picker Trigger & Inline Color Selection */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowColorMenu(!showColorMenu)}
                      className={`p-1.5 rounded-lg transition-colors flex items-center gap-0.5 ${showColorMenu ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                        }`}
                      title="Text Color"
                    >
                      <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_color_text</span>
                      <span
                        className="material-symbols-outlined block transition-transform duration-200"
                        style={{ fontSize: '14px', transform: showColorMenu ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                      >
                        arrow_drop_down
                      </span>
                    </button>

                    <AnimatePresence>
                      {showColorMenu && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8, x: -15 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.8, x: -15 }}
                          transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                          className="flex items-center gap-1.5 shrink-0 pl-1"
                        >
                          {[
                            { name: 'Default', value: '#ffffff' },
                            { name: 'Gold', value: '#D4AF37' },
                            { name: 'Red', value: '#F28B82' },
                            { name: 'Green', value: '#CCFF90' },
                            { name: 'Blue', value: '#CBF0F8' },
                            { name: 'Purple', value: '#D7AEFB' }
                          ].map(c => (
                            <button
                              key={c.name}
                              type="button"
                              onClick={() => handleTextColor(c.value)}
                              className="w-6 h-6 rounded-full border border-white/20 hover:scale-115 active:scale-95 transition-all shrink-0 shadow-md"
                              style={{ backgroundColor: c.value }}
                              title={c.name}
                            />
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* Content editable + inline drawing overlay */}
              <div ref={drawContainerRef} className="relative">
                {/* Content editable editor div */}
                <div
                  ref={contentEditableRef}
                  contentEditable={!drawMode}
                  suppressContentEditableWarning
                  onInput={(e) => handleContentChange(e.currentTarget.innerHTML)}
                  onKeyUp={() => { updateActiveStyles(); triggerLiveMarkdown(); }}
                  onClick={() => { if (!drawMode) { updateActiveStyles(); triggerLiveMarkdown(); } }}
                  onKeyDown={handleKeyDown}
                  className={`rich-editor w-full bg-transparent text-[var(--text-primary)] text-sm placeholder:text-white/20 focus:outline-none min-h-[150px] leading-relaxed ${drawMode ? 'cursor-default pointer-events-none select-none' : 'cursor-text'
                    }`}
                  style={{ outline: 'none' }}
                  {...{ placeholder: "Note" }}
                />

                {/* Inline drawing canvas overlay */}
                {drawMode && (
                  <>
                    <canvas
                      ref={drawCanvasRef}
                      className="absolute inset-0 z-[5]"
                      style={{ touchAction: 'none', cursor: drawTool === 'eraser' ? 'crosshair' : drawTool === 'text' ? 'text' : 'default' }}
                      onPointerDown={handleDrawPointerDown}
                      onPointerMove={handleDrawPointerMove}
                      onPointerUp={handleDrawPointerUp}
                      onPointerLeave={handleDrawPointerUp}
                    />
                    <canvas
                      ref={drawOverlayCanvasRef}
                      className="absolute inset-0 z-[6] pointer-events-none"
                    />

                    <AnimatePresence>
                      {textPos && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          className="absolute z-[10]"
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
                              style={{ color: drawColor, fontSize: `${drawSize * 3}px`, outline: 'none', boxShadow: 'none' }}
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
                  </>
                )}

                {/* Show existing drawing strokes as overlay when NOT in draw mode */}
                {!drawMode && drawStrokes.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none z-[3]">
                    <DrawingPreview strokes={drawStrokes} />
                  </div>
                )}
              </div>
            </>
          )}



          {/* Labels display */}
          {note.labels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {note.labels.map(label => (
                <span
                  key={label}
                  className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/5 text-white/50 border border-white/8 flex items-center gap-1"
                >
                  {label}
                  <button
                    onClick={() => onToggleLabel(note.id, label)}
                    className="hover:text-red-400 transition-colors"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>close</span>
                  </button>
                </span>
              ))}
            </div>
          )}


        </div>

        {/* Bottom toolbar */}
        <div className="relative z-[1] border-t border-white/5 shrink-0">
          {/* Panels */}
          <AnimatePresence>
            {bottomPanel !== 'none' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="p-3">
                  {/* Colors panel */}
                  {bottomPanel === 'colors' && (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30 mb-2">Color</p>
                      <div className="flex gap-2 overflow-x-auto scrollbar-hide py-2 items-center">
                        {/* 1. Custom Color Picker */}
                        <div
                          className={`relative w-8 h-8 rounded-full overflow-hidden border-2 transition-all flex items-center justify-center hover:scale-110 flex-shrink-0 ${note.customColor ? 'border-white/80 scale-110' : 'border-dashed border-white/30 hover:border-white/50'
                            }`}
                          style={{ backgroundColor: note.customColor || 'transparent' }}
                        >
                          {!note.customColor && (
                            <span className="material-symbols-outlined text-white/50 pointer-events-none" style={{ fontSize: '16px' }}>colorize</span>
                          )}
                          {note.customColor && (
                            <span className="material-symbols-outlined text-black/80 font-bold" style={{ fontSize: '14px' }}>check</span>
                          )}
                          <input
                            type="color"
                            value={note.customColor || '#ffffff'}
                            onChange={(e) => {
                              onUpdate(note.id, { customColor: e.target.value });
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            title="Choose Custom Color"
                          />
                        </div>

                        {/* Divider */}
                        <div className="w-[1px] h-5 bg-white/10 shrink-0 mx-0.5" />

                        {/* 2. Standard Note Colors */}
                        {(Object.keys(NOTE_COLORS) as NoteColor[]).map(color => (
                          <button
                            key={color}
                            onClick={() => handleColorChange(color)}
                            className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 flex-shrink-0 ${note.color === color && !note.customColor ? 'border-white/60 scale-110' : 'border-transparent'
                              }`}
                            style={{ background: NOTE_COLORS[color].bg }}
                            title={NOTE_COLORS[color].label}
                          >
                            {note.color === color && !note.customColor && (
                              <span className="material-symbols-outlined text-white/80" style={{ fontSize: '14px' }}>check</span>
                            )}
                          </button>
                        ))}

                        {/* Divider */}
                        <div className="w-[1px] h-5 bg-white/10 shrink-0 mx-0.5" />

                        {/* 3. App Signature Accent Colors */}
                        {ACCENT_COLORS.map(color => {
                          const isSelected = note.customColor?.toLowerCase() === color.hex.toLowerCase();
                          return (
                            <button
                              key={color.id}
                              onClick={() => onUpdate(note.id, { customColor: color.hex })}
                              className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 flex-shrink-0 ${isSelected ? 'border-white/80 scale-110' : 'border-transparent'
                                }`}
                              style={{ backgroundColor: color.hex }}
                              title={color.label}
                            >
                              {isSelected && (
                                <span className="material-symbols-outlined text-black/80 font-bold" style={{ fontSize: '14px' }}>check</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Backgrounds panel */}
                  {bottomPanel === 'backgrounds' && (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30 mb-3">Background</p>

                      {/* Row 1: Upload custom image FIRST */}
                      <div className="flex items-center gap-2 mb-3">
                        {/* Hidden file input */}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="hidden"
                        />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isBgUploading}
                          className={`w-14 h-14 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition-all hover:scale-105 flex-shrink-0 ${note.customBg ? 'border-[var(--gold)] scale-105' : 'border-dashed border-white/30 hover:border-white/50'
                            } bg-white/5 ${isBgUploading ? 'opacity-50 cursor-wait' : ''}`}
                          title="Upload Custom Background"
                        >
                          {isBgUploading ? (
                            <span className="animate-spin material-symbols-outlined text-white/60" style={{ fontSize: '22px' }}>progress_activity</span>
                          ) : (
                            <span className="material-symbols-outlined text-white/60" style={{ fontSize: '22px' }}>add_photo_alternate</span>
                          )}
                          <span className="text-[7px] text-white/40 font-medium">{isBgUploading ? 'Uploading...' : note.customBg ? 'Change' : 'Upload'}</span>
                        </button>

                        {note.customBg && (
                          <button
                            onClick={() => onUpdate(note.id, { customBg: null, background: 'none' })}
                            className="w-14 h-14 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/15 transition-all hover:scale-105 flex flex-col items-center justify-center gap-0.5 flex-shrink-0"
                            title="Remove custom background"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
                            <span className="text-[7px] text-red-400/80">Remove</span>
                          </button>
                        )}
                      </div>

                      {/* Row 2: Memories photos — horizontal scroll */}
                      {memoriesList.length > 0 && (
                        <div className="mb-3">
                          <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-white/20 mb-1.5">
                            <span className="material-symbols-outlined align-middle mr-1" style={{ fontSize: '10px' }}>auto_stories</span>
                            From Memories
                          </p>
                          <div
                            className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 items-center"
                            style={{
                              WebkitOverflowScrolling: 'touch',
                              willChange: 'scroll-position',
                              transform: 'translateZ(0)',
                            }}
                          >
                            {memoriesList.map((item) => {
                              const decrypted = decryptedUrls[item.id];
                              const blobUrl = decrypted?.blobUrl;
                              const isLoading = decrypted?.loading;

                              return (
                                <button
                                  key={item.id}
                                  data-id={item.id}
                                  ref={(node) => registerDecryptionObserver(node, item)}
                                  disabled={isLoading || !blobUrl}
                                  onClick={async () => {
                                    if (!blobUrl) return;
                                    try {
                                      const keys = getStoredKeyPair();
                                      if (!keys) return;
                                      setIsBgUploading(true);

                                      // Fetch the decrypted blob, get raw image bytes
                                      const res = await fetch(blobUrl);
                                      const blob = await res.blob();
                                      const arrayBuffer = await blob.arrayBuffer();
                                      const dataUint8 = new Uint8Array(arrayBuffer);

                                      // Encrypt raw bytes with secretbox
                                      const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
                                      const encrypted = nacl.secretbox(dataUint8, nonce, keys.secretKey);

                                      // Upload encrypted bytes to Cloudinary
                                      const formData = new FormData();
                                      formData.append('file', new Blob([encrypted as unknown as BlobPart]), 'note_bg.enc');
                                      formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
                                      const uploadRes = await fetch(
                                        `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/raw/upload`,
                                        { method: 'POST', body: formData }
                                      );
                                      if (!uploadRes.ok) throw new Error('Cloudinary upload failed');
                                      const uploadResult = await uploadRes.json();

                                      onUpdate(note.id, {
                                        customBg: { url: uploadResult.secure_url, nonce: encodeBase64(nonce) }
                                      });
                                    } catch (err) {
                                      console.error('Failed to use memory as background:', err);
                                    } finally {
                                      setIsBgUploading(false);
                                    }
                                  }}
                                  className={`w-14 h-14 rounded-xl flex-shrink-0 overflow-hidden border-2 transition-all hover:scale-105 hover:border-white/40 relative flex items-center justify-center ${note.customBg ? 'border-white/10' : 'border-transparent'
                                    } bg-white/5`}
                                  style={{
                                    transform: 'translate3d(0, 0, 0)',
                                    backfaceVisibility: 'hidden',
                                    WebkitBackfaceVisibility: 'hidden',
                                    contentVisibility: 'auto' as any,
                                  }}
                                  title="Use as background"
                                >
                                  {blobUrl ? (
                                    <img
                                      src={blobUrl}
                                      alt="Memory"
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    /* Spinner / skeleton placeholder */
                                    <div className="w-full h-full flex items-center justify-center bg-white/5 animate-pulse">
                                      <span className="material-symbols-outlined text-white/20 animate-spin" style={{ fontSize: '18px' }}>
                                        progress_activity
                                      </span>
                                    </div>
                                  )}
                                </button>
                              );
                            })}

                            {/* Sentinel for infinite scroll */}
                            {hasMoreMemories && (
                              <div
                                ref={registerSentinelObserver}
                                className="w-14 h-14 rounded-xl flex-shrink-0 flex items-center justify-center bg-white/5 border border-dashed border-white/20"
                              >
                                <span className="material-symbols-outlined text-white/20 animate-spin" style={{ fontSize: '18px' }}>
                                  progress_activity
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}


                    </div>
                  )}

                  {/* Mood panel */}
                  {bottomPanel === 'mood' && (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30 mb-2">How are you feeling?</p>
                      <div className="flex flex-wrap gap-2">
                        {(Object.keys(MOOD_CONFIG) as NoteMood[]).map(mood => (
                          <button
                            key={mood}
                            onClick={() => handleMoodChange(mood)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-full border transition-all hover:scale-105 ${note.mood === mood
                                ? 'border-white/30 bg-white/10'
                                : 'border-white/8 bg-white/3 hover:border-white/15'
                              }`}
                          >
                            <span className="text-base">{MOOD_CONFIG[mood].emoji}</span>
                            <span className="text-[10px] font-medium text-white/50">{MOOD_CONFIG[mood].label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Labels panel */}
                  {bottomPanel === 'labels' && (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30 mb-2">Labels</p>
                      <div className="flex items-center gap-2 mb-3">
                        <input
                          value={newLabelText}
                          onChange={(e) => setNewLabelText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddLabelSubmit()}
                          placeholder="Create new label..."
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/70 placeholder:text-white/20 focus:outline-none focus:border-white/20"
                          style={{ outline: 'none', boxShadow: 'none' }}
                        />
                        <button
                          onClick={handleAddLabelSubmit}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
                        </button>
                      </div>
                      {labels.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {labels.map(label => {
                            const isActive = note.labels.includes(label);
                            return (
                              <div
                                key={label}
                                className={`flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-all ${isActive
                                    ? 'bg-[var(--gold)]/15 text-[var(--gold)] border-[var(--gold)]/30'
                                    : 'bg-white/5 text-white/40 border-white/8 hover:border-white/15'
                                  }`}
                              >
                                <button onClick={() => onToggleLabel(note.id, label)} className="flex items-center gap-1">
                                  {isActive && <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>check</span>}
                                  {label}
                                </button>
                                <div className="w-[1px] h-3 bg-current opacity-20 mx-0.5" />
                                <button
                                  onClick={() => {
                                    if (window.confirm(`Delete label "${label}" globally?`)) {
                                      onDeleteLabel(label);
                                    }
                                  }}
                                  className="flex items-center justify-center w-4 h-4 rounded-full hover:bg-red-500/20 text-current hover:text-red-400 transition-colors"
                                  title="Delete label globally"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>close</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* More panel */}
                  {bottomPanel === 'more' && (
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => { onDuplicate(note.id); onClose(); }}
                        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left hover:bg-white/5 transition-colors"
                      >
                        <span className="material-symbols-outlined text-white/40" style={{ fontSize: '18px' }}>content_copy</span>
                        <span className="text-xs text-white/60">Make a copy</span>
                      </button>
                      <button
                        onClick={toggleChecklist}
                        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left hover:bg-white/5 transition-colors"
                      >
                        <span className="material-symbols-outlined text-white/40" style={{ fontSize: '18px' }}>
                          {note.isChecklist ? 'notes' : 'checklist'}
                        </span>
                        <span className="text-xs text-white/60">
                          {note.isChecklist ? 'Convert to text' : 'Convert to checklist'}
                        </span>
                      </button>
                      <button
                        onClick={() => { onTrash(note.id); onClose(); }}
                        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left hover:bg-red-500/10 transition-colors"
                      >
                        <span className="material-symbols-outlined text-red-400/60" style={{ fontSize: '18px' }}>delete</span>
                        <span className="text-xs text-red-400/60">Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Toolbar buttons */}
          <div className="flex items-center justify-between px-2 py-2">
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => togglePanel('colors')}
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${bottomPanel === 'colors' ? 'text-[var(--gold)]' : 'text-white/40'
                  }`}
                title="Colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>palette</span>
              </button>
              <button
                onClick={() => togglePanel('backgrounds')}
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${bottomPanel === 'backgrounds' ? 'text-[var(--gold)]' : 'text-white/40'
                  }`}
                title="Backgrounds"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>image</span>
              </button>
              <button
                onClick={() => togglePanel('mood')}
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${bottomPanel === 'mood' ? 'text-[var(--gold)]' : 'text-white/40'
                  }`}
                title="Mood"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>mood</span>
              </button>
              <button
                onClick={() => togglePanel('labels')}
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${bottomPanel === 'labels' ? 'text-[var(--gold)]' : 'text-white/40'
                  }`}
                title="Labels"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>label</span>
              </button>
              <button
                onClick={toggleChecklist}
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${note.isChecklist ? 'text-[var(--gold)]' : 'text-white/40'
                  }`}
                title={note.isChecklist ? 'Convert to text' : 'Convert to checklist'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>checklist</span>
              </button>
              <button
                onClick={toggleDrawMode}
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${drawMode ? 'text-[var(--gold)] bg-white/10' : 'text-white/40 hover:text-[var(--gold)]'
                  }`}
                title={drawMode ? 'Exit Draw Mode' : 'Draw on Note'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>draw</span>
              </button>
            </div>

            <button
              onClick={handleClose}
              className="px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.15em] text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </motion.div>

      {/* Drawing canvas is now inline — no full-screen overlay needed */}
    </motion.div>
  );
}
