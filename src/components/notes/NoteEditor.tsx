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
import { useChatSettingsContext } from '../../contexts/ChatSettingsContext';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Extension } from '@tiptap/core';

// ═══════════════════════════════════════════════════════════════════════════════
// INLINE DRAWING TYPES & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

type InlineDrawTool = 'pen' | 'highlighter' | 'eraser' | 'arrow' | 'double-arrow' | 'line' | 'rect' | 'circle' | 'text' | 'laser' | 'hand';

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
  { id: 'pen',         icon: 'edit',            label: 'Pen'   },
  { id: 'highlighter', icon: 'ink_highlighter', label: 'HL'    },
  { id: 'eraser',      icon: 'ink_eraser',      label: 'Erase' },
  { id: 'text',        icon: 'text_fields',     label: 'Text'  },
  { id: 'hand',        icon: 'back_hand',       label: 'Pan'   },
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
  isInline?: boolean;
}

type BottomPanel = 'none' | 'colors' | 'backgrounds' | 'mood' | 'labels' | 'more';

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// TIPTAP MARKDOWN RENDERING & HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const escapeHtml = (text: string) => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const renderInlineMarkdown = (text: string): string => {
  let rendered = escapeHtml(text);

  // Bold: **text** or __text__
  rendered = rendered.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  rendered = rendered.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  rendered = rendered.replace(/(?<![*_])\*(?![*])(.+?)(?<![*])\*(?![*_])/g, '<em>$1</em>');
  rendered = rendered.replace(/(?<![*_])\_(?![_])(.+?)(?<![_])\_(?![*_])/g, '<em>$1</em>');

  // Strikethrough: ~~text~~
  rendered = rendered.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Inline code: `code`
  rendered = rendered.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Highlight: ==text==
  rendered = rendered.replace(/==(.+?)==/g, '<mark>$1</mark>');

  return rendered;
};

const processBlockMarkdown = (editor: any, pos: number): boolean => {
  const { state } = editor;
  const { doc } = state;
  const $pos = doc.resolve(pos);
  const parentNode = $pos.parent;

  // We only parse paragraphs for block-level markdown conversion
  if (parentNode.type.name !== 'paragraph') {
    return false;
  }

  const text = parentNode.textContent;
  if (!text) return false;

  const start = $pos.before();
  const end = $pos.after();

  // 1. Check block rules
  // Heading 1
  let match = text.match(/^# (.+)$/);
  if (match) {
    const html = `<h1>${renderInlineMarkdown(match[1])}</h1>`;
    editor.commands.insertContentAt({ from: start, to: end }, html);
    return true;
  }

  // Heading 2
  match = text.match(/^## (.+)$/);
  if (match) {
    const html = `<h2>${renderInlineMarkdown(match[1])}</h2>`;
    editor.commands.insertContentAt({ from: start, to: end }, html);
    return true;
  }

  // Heading 3
  match = text.match(/^### (.+)$/);
  if (match) {
    const html = `<h3>${renderInlineMarkdown(match[1])}</h3>`;
    editor.commands.insertContentAt({ from: start, to: end }, html);
    return true;
  }

  // Blockquote
  match = text.match(/^> (.+)$/);
  if (match) {
    const html = `<blockquote>${renderInlineMarkdown(match[1])}</blockquote>`;
    editor.commands.insertContentAt({ from: start, to: end }, html);
    return true;
  }

  // Bullet list
  match = text.match(/^[-*] (.+)$/);
  if (match) {
    const html = `<ul><li>${renderInlineMarkdown(match[1])}</li></ul>`;
    editor.commands.insertContentAt({ from: start, to: end }, html);
    return true;
  }

  // Ordered list
  match = text.match(/^1\. (.+)$/);
  if (match) {
    const html = `<ol><li>${renderInlineMarkdown(match[1])}</li></ol>`;
    editor.commands.insertContentAt({ from: start, to: end }, html);
    return true;
  }

  // Code block
  match = text.match(/^```([\s\S]*?)```$/s) || text.match(/^```([\s\S]*?)$/s);
  if (match) {
    const codeContent = match[1] || '';
    const html = `<pre><code>${escapeHtml(codeContent)}</code></pre>`;
    editor.commands.insertContentAt({ from: start, to: end }, html);
    return true;
  }

  // 2. Check inline-only rules
  const html = renderInlineMarkdown(text);
  if (html !== text) {
    const pHtml = `<p>${html}</p>`;
    editor.commands.insertContentAt({ from: start, to: end }, pHtml);
    return true;
  }

  return false;
};

const convertHtmlToMarkdown = (html: string): string => {
  if (!html) return '';
  let md = html;

  // Headings
  md = md.replace(/<h1>(.*?)<\/h1>/gi, '# $1\n');
  md = md.replace(/<h2>(.*?)<\/h2>/gi, '## $1\n');
  md = md.replace(/<h3>(.*?)<\/h3>/gi, '### $1\n');

  // Lists (bullets and numbered)
  md = md.replace(/<li>(.*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?ul>/gi, '');
  md = md.replace(/<\/?ol>/gi, '');

  // Bold & Strong
  md = md.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b>(.*?)<\/b>/gi, '**$1**');

  // Italics & Emphasized
  md = md.replace(/<em>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i>(.*?)<\/i>/gi, '*$1*');

  // Underline
  md = md.replace(/<u>(.*?)<\/u>/gi, '_$1_');

  // Code block
  md = md.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n');

  // Paragraphs and breaks
  md = md.replace(/<p>(.*?)<\/p>/gi, '$1\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags
  md = md.replace(/<[^>]*>/g, '');

  // Unescape standard HTML entities
  md = md
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'");

  return md.trim();
};

const convertMarkdownToHtml = (md: string): string => {
  if (!md) return '';
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;
  let inCodeBlock = false;
  let codeContent = '';

  for (let line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html += `<pre><code>${escapeHtml(codeContent.trim())}</code></pre>`;
        inCodeBlock = false;
        codeContent = '';
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + '\n';
      continue;
    }

    if (line.startsWith('# ')) {
      if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; listType = null; }
      html += `<h1>${renderInlineMarkdown(line.slice(2))}</h1>`;
      continue;
    }
    if (line.startsWith('## ')) {
      if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; listType = null; }
      html += `<h2>${renderInlineMarkdown(line.slice(3))}</h2>`;
      continue;
    }
    if (line.startsWith('### ')) {
      if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; listType = null; }
      html += `<h3>${renderInlineMarkdown(line.slice(4))}</h3>`;
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      if (inList && listType !== 'ul') {
        html += '</ol>';
        inList = false;
      }
      if (!inList) {
        html += '<ul>';
        inList = true;
        listType = 'ul';
      }
      html += `<li>${renderInlineMarkdown(bulletMatch[1])}</li>`;
      continue;
    }

    const numberMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberMatch) {
      if (inList && listType !== 'ol') {
        html += '</ul>';
        inList = false;
      }
      if (!inList) {
        html += '<ol>';
        inList = true;
        listType = 'ol';
      }
      html += `<li>${renderInlineMarkdown(numberMatch[2])}</li>`;
      continue;
    }

    if (inList) {
      html += listType === 'ul' ? '</ul>' : '</ol>';
      inList = false;
      listType = null;
    }

    if (line.trim() === '') {
      html += '<p></p>';
    } else {
      html += `<p>${renderInlineMarkdown(line)}</p>`;
    }
  }

  if (inList) {
    html += listType === 'ul' ? '</ul>' : '</ol>';
  }
  if (inCodeBlock && codeContent) {
    html += `<pre><code>${escapeHtml(codeContent.trim())}</code></pre>`;
  }

  return html;
};

const EnterKeyHandler = Extension.create({
  name: 'enterKeyHandler',
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from } = selection;

        // Case 1: Cursor is in a code block
        if ($from.parent.type.name === 'codeBlock') {
          const textContent = $from.parent.textContent;
          const posInNode = selection.from - $from.start();
          const textBeforeCursor = textContent.slice(0, posInNode);
          const lastLine = textBeforeCursor.split('\n').pop() || '';

          if (lastLine.trim() === '```') {
            // Exit code block when user types ``` and presses Enter
            const from = selection.from - lastLine.length;
            const to = selection.from;

            editor.chain()
              .deleteRange({ from, to })
              .exitCode()
              .run();

            return true;
          }
          return false;
        }

        // Case 2: Cursor is in standard paragraph or other block
        processBlockMarkdown(editor, selection.from);
        
        // Return false to let default Enter key handling (splitBlock) run
        return false;
      },
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// DRAWING PREVIEW (mini canvas)
// ═══════════════════════════════════════════════════════════════════════════════

function DrawingPreview({
  strokes,
  originalWidth,
  originalHeight
}: {
  strokes: any[];
  originalWidth?: number | null;
  originalHeight?: number | null;
}) {
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

    // Calculate scale factor relative to original drawing width
    const scale = (originalWidth && originalWidth > 0) ? (w / originalWidth) : 1;

    ctx.save();

    strokes.forEach(stroke => {
      if (!stroke || !stroke.tool) return;
      if (stroke.tool === 'laser') return;

      const scaledSize = stroke.size * scale;

      ctx.save();
      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = scaledSize * 3;
      } else if (stroke.tool === 'highlighter') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.strokeStyle = stroke.color || '#fff';
        ctx.lineWidth = scaledSize * 4;
        ctx.globalAlpha = 0.35;
      } else {
        ctx.strokeStyle = stroke.color || '#fff';
        ctx.lineWidth = scaledSize || 2;
        ctx.globalAlpha = stroke.opacity || 1;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.tool === 'text' && stroke.text) {
        ctx.fillStyle = stroke.color || '#fff';
        const fontSize = (stroke.fontSize || 18) * scale;
        ctx.font = `${fontSize}px 'Inter', sans-serif`;
        ctx.fillText(stroke.text, (stroke.startX || 0) * scale, (stroke.startY || 0) * scale);
      } else if (['arrow', 'double-arrow', 'line', 'rect', 'circle'].includes(stroke.tool) && stroke.startX !== undefined) {
        ctx.beginPath();
        const startX = stroke.startX * scale;
        const startY = stroke.startY * scale;
        const endX = stroke.endX * scale;
        const endY = stroke.endY * scale;

        if (stroke.tool === 'rect') {
          const x = Math.min(startX, endX);
          const y = Math.min(startY, endY);
          ctx.strokeRect(x, y, Math.abs(endX - startX), Math.abs(endY - startY));
        } else if (stroke.tool === 'circle') {
          const cx = (startX + endX) / 2;
          const cy = (startY + endY) / 2;
          const rx = Math.abs(endX - startX) / 2;
          const ry = Math.abs(endY - startY) / 2;
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();
          if (stroke.tool === 'arrow' || stroke.tool === 'double-arrow') {
            const headLen = Math.max(scaledSize * 4, 12);
            const angle = Math.atan2(endY - startY, endX - startX);

            // End arrowhead
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(endX - headLen * Math.cos(angle - Math.PI / 6), endY - headLen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(endX, endY);
            ctx.lineTo(endX - headLen * Math.cos(angle + Math.PI / 6), endY - headLen * Math.sin(angle + Math.PI / 6));
            ctx.stroke();

            // Start arrowhead (for double-arrow)
            if (stroke.tool === 'double-arrow') {
              ctx.beginPath();
              ctx.moveTo(startX, startY);
              ctx.lineTo(startX + headLen * Math.cos(angle - Math.PI / 6), startY + headLen * Math.sin(angle - Math.PI / 6));
              ctx.moveTo(startX, startY);
              ctx.lineTo(startX + headLen * Math.cos(angle + Math.PI / 6), startY + headLen * Math.sin(angle + Math.PI / 6));
              ctx.stroke();
            }
          }
        }
      } else if (stroke.points && stroke.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x * scale, stroke.points[0].y * scale);
        for (let i = 1; i < stroke.points.length - 1; i++) {
          const mx = ((stroke.points[i].x + stroke.points[i + 1].x) / 2) * scale;
          const my = ((stroke.points[i].y + stroke.points[i + 1].y) / 2) * scale;
          ctx.quadraticCurveTo(stroke.points[i].x * scale, stroke.points[i].y * scale, mx, my);
        }
        ctx.lineTo(stroke.points[stroke.points.length - 1].x * scale, stroke.points[stroke.points.length - 1].y * scale);
        ctx.stroke();
      } else if (stroke.points && stroke.points.length === 1) {
        // Draw a single dot
        ctx.beginPath();
        ctx.arc(stroke.points[0].x * scale, stroke.points[0].y * scale, scaledSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    });

    ctx.restore();
  }, [strokes, originalWidth, originalHeight]);

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
  isInline,
}: NoteEditorProps) {
  const { settings } = useChatSettingsContext();
  const appAccentColor = settings?.accent_color || '#e6c487';

  const [title, setTitle] = useState(note.title);
  const [isStealthActive, setIsStealthActive] = useState(() => {
    return typeof window !== 'undefined' && localStorage.getItem('aura_stealth_mode') === 'true';
  });

  useEffect(() => {
    const handleStealthChange = () => {
      setIsStealthActive(localStorage.getItem('aura_stealth_mode') === 'true');
    };
    window.addEventListener('stealth-mode-change', handleStealthChange);
    return () => window.removeEventListener('stealth-mode-change', handleStealthChange);
  }, []);

  const [content, setContent] = useState(note.content);
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>('none');
  const [newLabelText, setNewLabelText] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [showEditorTooltip, setShowEditorTooltip] = useState(false);

  useEffect(() => {
    const show = localStorage.getItem('show_raw_note_walkthrough') === 'true';
    if (show) {
      setShowEditorTooltip(true);
    }
  }, []);

  const dismissTooltip = () => {
    localStorage.removeItem('show_raw_note_walkthrough');
    setShowEditorTooltip(false);
    window.dispatchEvent(new Event('dismiss-raw-note-walkthrough'));
  };

  useEffect(() => {
    if (note.isRaw && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [content, note.isRaw]);
  const [decryptedBg, setDecryptedBg] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showColorMenu, setShowColorMenu] = useState(false);

  // Auto-save with debounce
  const debouncedSave = useCallback((updates: Partial<Note>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onUpdate(note.id, updates);
    }, 400);
  }, [note.id, onUpdate]);
  // ═══ INLINE DRAWING STATE ═══
  const [drawMode, setDrawMode] = useState(false);
  const [drawTool, setDrawTool] = useState<InlineDrawTool>('pen');
  const [drawColor, setDrawColor] = useState('#ffffff');
  const [drawSize, setDrawSize] = useState(4);
  const [drawStrokes, setDrawStrokes] = useState<InlineDrawStroke[]>(() => {
    const data = note.drawingData;
    if (data && !Array.isArray(data) && Array.isArray(data.strokes)) {
      return data.strokes.filter((s: any) => s && s.tool && s.points);
    }
    const arrayData = data as InlineDrawStroke[] || [];
    return arrayData.filter(s => s && s.tool && s.points);
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

  // ── Inline Drawing Camera (infinite canvas) ──────────────────────────────
  const inlineCamRef       = useRef({ x: 0, y: 0, scale: 1 });
  const [inlineCamera, setInlineCamera] = useState({ x: 0, y: 0, scale: 1 });
  const inlineIsPanningRef = useRef(false);
  const inlinePanStartRef  = useRef({ clientX: 0, clientY: 0, camX: 0, camY: 0 });
  const inlineLastTouchRef = useRef<{ cx: number; cy: number; dist: number } | null>(null);
  const drawToolRef        = useRef<InlineDrawTool>('pen');
  useEffect(() => { drawToolRef.current = drawTool; }, [drawTool]);
  const drawColorRef = useRef(drawColor);
  useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);
  const drawSizeRef = useRef(drawSize);
  useEffect(() => { drawSizeRef.current = drawSize; }, [drawSize]);
  const isInlineDrawingRef = useRef(false);

  const applyInlineCamera = useCallback((cam: { x: number; y: number; scale: number }) => {
    inlineCamRef.current = cam;
    setInlineCamera({ ...cam });
  }, []);

  const inlineScreenToWorld = useCallback((sx: number, sy: number) => {
    const { x, y, scale } = inlineCamRef.current;
    return { x: (sx - x) / scale, y: (sy - y) / scale };
  }, []);

  const inlineZoomAtPoint = useCallback((newScale: number, sx: number, sy: number) => {
    const clamped = Math.min(20, Math.max(0.05, newScale));
    const { x, y, scale } = inlineCamRef.current;
    const wx = (sx - x) / scale;
    const wy = (sy - y) / scale;
    applyInlineCamera({ x: sx - wx * clamped, y: sy - wy * clamped, scale: clamped });
  }, [applyInlineCamera]);

  const inlineFitToContent = useCallback(() => {
    if (drawStrokesRef.current.length === 0) { applyInlineCamera({ x: 0, y: 0, scale: 1 }); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    drawStrokesRef.current.forEach(s => {
      s.points.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
      if (s.startX !== undefined) {
        minX = Math.min(minX, s.startX, s.endX ?? s.startX);
        minY = Math.min(minY, s.startY ?? 0, s.endY ?? s.startY ?? 0);
        maxX = Math.max(maxX, s.startX, s.endX ?? s.startX);
        maxY = Math.max(maxY, s.startY ?? 0, s.endY ?? s.startY ?? 0);
      }
    });
    if (!isFinite(minX)) { applyInlineCamera({ x: 0, y: 0, scale: 1 }); return; }
    const container = drawContainerRef.current;
    if (!container) return;
    const { width: w, height: h } = container.getBoundingClientRect();
    const pad = 40;
    const cW = maxX - minX || 1;
    const cH = maxY - minY || 1;
    const newScale = Math.min(2, (w - pad * 2) / cW, (h - pad * 2) / cH);
    applyInlineCamera({
      x: w / 2 - ((minX + maxX) / 2) * newScale,
      y: h / 2 - ((minY + maxY) / 2) * newScale,
      scale: newScale,
    });
  }, [applyInlineCamera]);

  const savedCanvasSize = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const data = note.drawingData;
    if (data && !Array.isArray(data) && typeof data.canvasWidth === 'number' && typeof data.canvasHeight === 'number') {
      savedCanvasSize.current = { width: data.canvasWidth, height: data.canvasHeight };
    } else {
      savedCanvasSize.current = null;
    }
  }, [note.drawingData]);

  const [containerWidth, setContainerWidth] = useState<number>(0);
  const drawWidthRef = useRef<number>(0);

  useEffect(() => {
    if (!drawContainerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    resizeObserver.observe(drawContainerRef.current);
    return () => resizeObserver.disconnect();
  }, []);
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

  const updateActiveStyles = useCallback((editorInstance: any) => {
    if (!editorInstance) return;
    setActiveStyles({
      bold: editorInstance.isActive('bold'),
      italic: editorInstance.isActive('italic'),
      underline: editorInstance.isActive('underline'),
      strikeThrough: editorInstance.isActive('strike'),
      paragraph: editorInstance.isActive('paragraph'),
      h1: editorInstance.isActive('heading', { level: 1 }),
      h2: editorInstance.isActive('heading', { level: 2 }),
      h3: editorInstance.isActive('heading', { level: 3 }),
      blockquote: editorInstance.isActive('blockquote'),
      code: editorInstance.isActive('codeBlock'),
      ul: editorInstance.isActive('bulletList'),
      ol: editorInstance.isActive('orderedList'),
    });
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({
        placeholder: 'Note',
      }),
      TextStyle,
      Color,
      EnterKeyHandler,
    ],
    content: note.content || '',
    editorProps: {
      attributes: {
        class: 'ProseMirror rich-editor focus:outline-none min-h-[150px] leading-relaxed',
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Tab') {
          const { state } = view;
          const { selection } = state;
          const { $from } = selection;

          // Don't intercept Tab inside code block or if selection is not empty (standard behavior)
          if (!selection.empty || $from.parent.type.name === 'codeBlock') {
            return false;
          }

          // Check if inside a list item to allow nested list indentation (sinkListItem)
          let isListItem = false;
          let depth = $from.depth;
          while (depth > 0) {
            if ($from.node(depth).type.name === 'listItem') {
              isListItem = true;
              break;
            }
            depth--;
          }
          if (isListItem) {
            return false;
          }

          event.preventDefault();

          if ($from.parent.type.name === 'paragraph') {
            const textContent = $from.parent.textContent;
            const posInNode = selection.from - $from.start();
            const textBeforeCursor = textContent.slice(0, posInNode);

            // Check if the text before cursor is a markdown prefix
            let matched = false;
            let html = '';
            
            if (textBeforeCursor === '-' || textBeforeCursor === '*') {
              html = '<ul><li></li></ul>';
              matched = true;
            } else if (textBeforeCursor === '1.') {
              html = '<ol><li></li></ol>';
              matched = true;
            } else if (textBeforeCursor === '#') {
              html = '<h1></h1>';
              matched = true;
            } else if (textBeforeCursor === '##') {
              html = '<h2></h2>';
              matched = true;
            } else if (textBeforeCursor === '###') {
              html = '<h3></h3>';
              matched = true;
            } else if (textBeforeCursor === '>') {
              html = '<blockquote></blockquote>';
              matched = true;
            }

            if (matched) {
              const start = $from.before();
              const end = $from.after();
              if (editor) {
                editor.commands.insertContentAt({ from: start, to: end }, html);
                editor.commands.focus();
              }
              return true;
            }
          }

          // Default: Insert 4 spaces
          if (editor) {
            editor.commands.insertContent('    ');
          }
          return true;
        }

        return false;
      }
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      setContent(html);
      debouncedSave({ content: html });
    },
    onSelectionUpdate: ({ editor }) => {
      updateActiveStyles(editor);
    },
    onTransaction: ({ editor }) => {
      updateActiveStyles(editor);
    },
  });

  const lastNoteIdRef = useRef(note.id);
  const lastIsRawRef = useRef(note.isRaw);

  useEffect(() => {
    if (note.id !== lastNoteIdRef.current) {
      lastNoteIdRef.current = note.id;
      lastIsRawRef.current = note.isRaw;
      setContent(note.content || '');
      if (editor) {
        editor.commands.setContent(note.content || '');
      }
    } else if (note.isRaw !== lastIsRawRef.current) {
      lastIsRawRef.current = note.isRaw;
      setContent(note.content || '');
      if (editor) {
        editor.commands.setContent(note.content || '');
      }
    }
  }, [note.id, note.isRaw, editor]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(!drawMode);
    }
  }, [drawMode, editor]);

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
      const container = drawContainerRef.current;
      const rect = container ? container.getBoundingClientRect() : null;
      const drawingData = {
        strokes: drawStrokes,
        canvasWidth: rect ? rect.width : 0,
        canvasHeight: rect ? rect.height : 0
      };
      onUpdate(note.id, { drawingData });
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

  // Setup / resize the inline drawing canvas (world-coord strokes never need pixel-scaling)
  const resizeDrawCanvas = useCallback(() => {
    const container = drawContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    [drawCanvasRef, drawOverlayCanvasRef].forEach(ref => {
      const canvas = ref.current;
      if (!canvas) return;
      canvas.width  = rect.width  * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width  = `${rect.width}px`;
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

  // ── Inline dot grid (Excalidraw style) ────────────────────────────────
  const drawInlineDotGrid = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const cam = inlineCamRef.current;
    const gs = 40;
    const worldLeft   = -cam.x / cam.scale;
    const worldTop    = -cam.y / cam.scale;
    const worldRight  = (w - cam.x) / cam.scale;
    const worldBottom = (h - cam.y) / cam.scale;
    const startX = Math.floor(worldLeft  / gs) * gs;
    const startY = Math.floor(worldTop   / gs) * gs;
    const dotR  = Math.max(0.6, Math.min(2, cam.scale));
    const alpha = Math.min(0.25, Math.max(0.04, cam.scale * 0.12));
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

  // Redraw all strokes (with infinite-canvas camera transform)
  const redrawInlineCanvas = useCallback(() => {
    const canvas = drawCanvasRef.current;
    const container = drawContainerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Draw dot grid (screen space, camera-aware)
    drawInlineDotGrid(ctx, rect.width, rect.height);

    // Apply camera transform; draw all strokes in world space
    const cam = inlineCamRef.current;
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.scale, cam.scale);
    drawStrokesRef.current.forEach(stroke => {
      drawInlineStroke(ctx, stroke);
    });
    ctx.restore();
  }, [drawInlineStroke, drawInlineDotGrid]);

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

  // Redraw (without resize) whenever strokes or camera change
  useEffect(() => {
    if (drawMode) {
      redrawInlineCanvas();
    }
  }, [drawStrokes, inlineCamera, drawMode, redrawInlineCanvas]);

  // Laser animation loop (camera-aware)
  useEffect(() => {
    if (!drawMode) return;
    let animationFrameId: number;

    const GLOW_COLOR = drawColor === '#ffffff' ? appAccentColor : drawColor;
    const CORE_COLOR = '#FFFFFF';
    const LIFESPAN   = 1000;

    const animateLaser = () => {
      const now = Date.now();
      laserPointsRef.current = laserPointsRef.current.filter(p => now - p.time < LIFESPAN);
      const points = laserPointsRef.current;

      const overlayCanvas = drawOverlayCanvasRef.current;
      if (overlayCanvas) {
        const ctx = overlayCanvas.getContext('2d');
        if (ctx) {
          const rect = overlayCanvas.getBoundingClientRect();
          ctx.clearRect(0, 0, rect.width, rect.height);

          const cam = inlineCamRef.current;

          // Render current shape preview with camera transform
          if (isDrawing && currentDrawStrokeRef.current && ['arrow', 'double-arrow', 'line', 'rect', 'circle'].includes(drawTool)) {
            ctx.save();
            ctx.translate(cam.x, cam.y);
            ctx.scale(cam.scale, cam.scale);
            drawInlineStroke(ctx, currentDrawStrokeRef.current);
            ctx.restore();
          }

          // Render laser trail with camera transform (laser points are world coords)
          if (points.length >= 2) {
            const newestAge = now - points[points.length - 1].time;
            const alpha = Math.max(0, 1 - newestAge / LIFESPAN);

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.lineCap  = 'round';
            ctx.lineJoin = 'round';
            ctx.translate(cam.x, cam.y);
            ctx.scale(cam.scale, cam.scale);

            const buildFullPath = () => {
              ctx.beginPath();
              ctx.moveTo(points[0].x, points[0].y);
              for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
            };

            buildFullPath();
            ctx.strokeStyle = GLOW_COLOR;
            ctx.lineWidth   = drawSize * 3;
            ctx.shadowColor = GLOW_COLOR;
            ctx.shadowBlur  = 18;
            ctx.stroke();

            buildFullPath();
            ctx.strokeStyle = CORE_COLOR;
            ctx.lineWidth   = drawSize * 0.9;
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur  = 0;
            ctx.stroke();

            ctx.restore();
          }

          // Render laser dot at the pointer tip if currently drawing (pointer down)
          if (points.length >= 1 && isInlineDrawingRef.current && drawTool === 'laser') {
            const tip = points[points.length - 1];
            ctx.save();
            ctx.translate(cam.x, cam.y);
            ctx.scale(cam.scale, cam.scale);
            
            ctx.beginPath();
            ctx.arc(tip.x, tip.y, drawSize * 1.5, 0, Math.PI * 2);
            ctx.fillStyle = GLOW_COLOR;
            ctx.shadowColor = GLOW_COLOR;
            ctx.shadowBlur = 15;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(tip.x, tip.y, drawSize * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = CORE_COLOR;
            ctx.shadowBlur = 0;
            ctx.fill();
            
            ctx.restore();
          }
        }
      }

      animationFrameId = requestAnimationFrame(animateLaser);
    };

    animateLaser();
    return () => cancelAnimationFrame(animationFrameId);
  }, [drawMode, drawSize, isDrawing, drawTool, drawInlineStroke, drawColor, appAccentColor]);


  // Pointer helpers: screen pos (for UI) and world pos (for strokes)
  const getDrawScreenPos = (e: React.PointerEvent): { x: number; y: number } => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const getDrawPos = (e: React.PointerEvent): { x: number; y: number } => {
    const sp = getDrawScreenPos(e);
    return inlineScreenToWorld(sp.x, sp.y); // returns WORLD coords
  };

  const handleDrawPointerDown = (e: React.PointerEvent) => {
    if (!drawMode) return;

    // Middle-mouse or hand tool → pan
    if (e.button === 1 || drawToolRef.current === 'hand') {
      inlineIsPanningRef.current = true;
      inlinePanStartRef.current = { clientX: e.clientX, clientY: e.clientY, camX: inlineCamRef.current.x, camY: inlineCamRef.current.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (drawTool === 'text') {
      setTextPos(getDrawScreenPos(e)); // screen coords for UI overlay
      return;
    }

    isInlineDrawingRef.current = true;
    setIsDrawing(true);
    const pos = getDrawPos(e); // WORLD coords

    if (drawTool === 'laser') {
      laserPointsRef.current = [{ ...pos, time: Date.now() }];
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    setDrawUndoStack(prev => [...prev, [...drawStrokesRef.current]]);
    setDrawRedoStack([]);

    if (['arrow', 'double-arrow', 'line', 'rect', 'circle'].includes(drawTool)) {
      shapeStartRef.current = pos;
      currentDrawStrokeRef.current = {
        id: crypto.randomUUID(),
        tool: drawTool,
        points: [],
        color: drawColorRef.current,
        size: drawSizeRef.current,
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
        color: drawColorRef.current,
        size: drawSizeRef.current,
        opacity: drawTool === 'highlighter' ? 0.35 : 1,
      };
    }

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleDrawPointerMove = (e: React.PointerEvent) => {
    // Handle panning (even when not drawing)
    if (inlineIsPanningRef.current) {
      const dx = e.clientX - inlinePanStartRef.current.clientX;
      const dy = e.clientY - inlinePanStartRef.current.clientY;
      applyInlineCamera({ x: inlinePanStartRef.current.camX + dx, y: inlinePanStartRef.current.camY + dy, scale: inlineCamRef.current.scale });
      return;
    }

    if (!isInlineDrawingRef.current) return;
    const pos = getDrawPos(e); // WORLD coords

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

      const canvas = drawCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          redrawInlineCanvas();
          // Draw current stroke in world space with camera transform
          const cam = inlineCamRef.current;
          ctx.save();
          ctx.translate(cam.x, cam.y);
          ctx.scale(cam.scale, cam.scale);
          drawInlineStroke(ctx, currentDrawStrokeRef.current);
          ctx.restore();
        }
      }
    }
  };

  const handleDrawPointerUp = () => {
    inlineIsPanningRef.current = false;
    if (!isInlineDrawingRef.current) return;
    setIsDrawing(false);
    isInlineDrawingRef.current = false;

    if (drawTool === 'laser') return;

    if (currentDrawStrokeRef.current) {
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

  // Scroll-wheel zoom + two-finger pan/pinch on inline canvas
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas || !drawMode) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        inlineZoomAtPoint(inlineCamRef.current.scale * factor, mx, my);
      } else {
        const { x, y, scale } = inlineCamRef.current;
        applyInlineCamera({ x: x - e.deltaX, y: y - e.deltaY, scale });
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0], t2 = e.touches[1];
        inlineLastTouchRef.current = {
          cx: (t1.clientX + t2.clientX) / 2,
          cy: (t1.clientY + t2.clientY) / 2,
          dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && inlineLastTouchRef.current) {
        e.preventDefault();
        const t1 = e.touches[0], t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const cx = (t1.clientX + t2.clientX) / 2;
        const cy = (t1.clientY + t2.clientY) / 2;
        const rect = canvas.getBoundingClientRect();
        const scx = cx - rect.left;
        const scy = cy - rect.top;
        const dx = cx - inlineLastTouchRef.current.cx;
        const dy = cy - inlineLastTouchRef.current.cy;
        const scaleFactor = dist / inlineLastTouchRef.current.dist;
        const newScale = Math.min(20, Math.max(0.05, inlineCamRef.current.scale * scaleFactor));
        const cam = inlineCamRef.current;
        const wx = (scx - cam.x) / cam.scale;
        const wy = (scy - cam.y) / cam.scale;
        applyInlineCamera({ x: scx - wx * newScale + dx, y: scy - wy * newScale + dy, scale: newScale });
        inlineLastTouchRef.current = { cx, cy, dist };
      }
    };

    const onTouchEnd = () => { inlineLastTouchRef.current = null; };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   onTouchEnd);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove',  onTouchMove);
      canvas.removeEventListener('touchend',   onTouchEnd);
    };
  }, [drawMode, applyInlineCamera, inlineZoomAtPoint]);

  const handleTextSubmit = () => {
    if (!textInput.trim() || !textPos) return;

    // textPos is in screen coords; convert to world coords for stroke storage
    const worldPos = inlineScreenToWorld(textPos.x, textPos.y);

    setDrawUndoStack(prev => [...prev, [...drawStrokesRef.current]]);
    setDrawRedoStack([]);

    const textStroke: InlineDrawStroke = {
      id: crypto.randomUUID(),
      tool: 'text',
      points: [],
      color: drawColor,
      size: drawSize,
      opacity: 1,
      startX: worldPos.x,
      startY: worldPos.y,
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

  const toggleDrawMode = (isLaser: boolean | React.MouseEvent = false) => {
    const actualIsLaser = typeof isLaser === 'boolean' ? isLaser : false;
    if (drawMode) {
      // Exiting draw mode — save drawing data
      const container = drawContainerRef.current;
      const rect = container ? container.getBoundingClientRect() : null;
      const drawingData = drawStrokes.length > 0 ? {
        strokes: drawStrokes,
        canvasWidth: rect ? rect.width : 0,
        canvasHeight: rect ? rect.height : 0
      } : null;
      onUpdate(note.id, { drawingData });
      drawWidthRef.current = 0; // Reset width ref when exiting
    } else {
      // If active tool was laser and we are entering normal draw mode, set it to pen
      if (!actualIsLaser && drawTool === 'laser') {
        setDrawTool('pen');
      }
      // Entering draw mode — scale existing strokes to current container size
      const container = drawContainerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const currentWidth = rect.width;
        const savedWidth = savedCanvasSize.current?.width || 0;
        if (savedWidth > 0 && currentWidth !== savedWidth) {
          const scale = currentWidth / savedWidth;
          // Scale existing strokes in drawStrokes state
          setDrawStrokes(prev => prev.map(stroke => {
            const scaledPoints = stroke.points.map(p => ({ x: p.x * scale, y: p.y * scale }));
            const updated: InlineDrawStroke = {
              ...stroke,
              points: scaledPoints,
              size: stroke.size * scale,
            };
            if (stroke.startX !== undefined) updated.startX = stroke.startX * scale;
            if (stroke.startY !== undefined) updated.startY = stroke.startY * scale;
            if (stroke.endX !== undefined) updated.endX = stroke.endX * scale;
            if (stroke.endY !== undefined) updated.endY = stroke.endY * scale;
            if (stroke.fontSize !== undefined) updated.fontSize = stroke.fontSize * scale;
            return updated;
          }));
        }
        drawWidthRef.current = currentWidth;
      }
    }
    setDrawMode(!drawMode);
    setShowDrawColors(false);
    setShowDrawSizes(false);
  };

  const toggleLaserMode = () => {
    if (drawMode) {
      if (drawTool === 'laser') {
        toggleDrawMode(true);
      } else {
        setDrawTool('laser');
      }
    } else {
      setDrawTool('laser');
      toggleDrawMode(true);
    }
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


  const [selectionDetails, setSelectionDetails] = useState<{
    text: string;
    x: number;
    y: number;
    show: boolean;
  }>({ text: '', x: 0, y: 0, show: false });

  const handleSelectionChange = useCallback(() => {
    if (editor) {
      updateActiveStyles(editor);
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.toString().trim() === '') {
      setSelectionDetails(prev => prev.show ? { ...prev, show: false } : prev);
      return;
    }

    const selectedText = selection.toString();

    if (
      editor &&
      editor.view.dom &&
      (editor.view.dom.contains(selection.anchorNode) ||
        editor.view.dom.contains(selection.focusNode))
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
  }, [editor, updateActiveStyles]);

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

  // Focus title if empty, else focus editor
  useEffect(() => {
    setTimeout(() => {
      if (!note.title && titleRef.current) {
        titleRef.current.focus();
      } else if (editor) {
        editor.commands.focus('end');
      }
    }, 100);
  }, [editor]);

  const handleFormat = (command: string) => {
    if (!editor) return;
    if (command === 'bold') {
      editor.chain().focus().toggleBold().run();
    } else if (command === 'italic') {
      editor.chain().focus().toggleItalic().run();
    } else if (command === 'underline') {
      editor.chain().focus().toggleUnderline().run();
    } else if (command === 'strikeThrough') {
      editor.chain().focus().toggleStrike().run();
    } else if (command === 'insertUnorderedList') {
      editor.chain().focus().toggleBulletList().run();
    } else if (command === 'insertOrderedList') {
      editor.chain().focus().toggleOrderedList().run();
    }
  };

  const handleBlockFormat = (tag: string) => {
    if (!editor) return;
    if (tag === 'p') {
      editor.chain().focus().setParagraph().run();
    } else if (tag === 'h1') {
      editor.chain().focus().toggleHeading({ level: 1 }).run();
    } else if (tag === 'h2') {
      editor.chain().focus().toggleHeading({ level: 2 }).run();
    } else if (tag === 'h3') {
      editor.chain().focus().toggleHeading({ level: 3 }).run();
    } else if (tag === 'blockquote') {
      editor.chain().focus().toggleBlockquote().run();
    } else if (tag === 'pre') {
      editor.chain().focus().toggleCodeBlock().run();
    }
  };

  const handleTextColor = (color: string) => {
    if (!editor) return;
    editor.chain().focus().setColor(color).run();
    setShowColorMenu(false);
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    debouncedSave({ title: val });
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
        if (editor) {
          editor.commands.setContent(text);
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
      initial={!isInline ? { x: '100%' } : undefined}
      animate={!isInline ? { x: 0 } : undefined}
      exit={!isInline ? { x: '100%' } : undefined}
      transition={!isInline ? { type: 'spring', damping: 26, stiffness: 220 } : undefined}
      className={isInline ? "w-full h-full flex flex-col relative" : "fixed inset-0 z-[200] flex flex-col bg-[var(--bg-primary)]"}
    >
      {/* Selection Tooltip */}
      {selectionDetails.show && !isStealthActive && (
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
      <div
        className="relative z-10 w-full h-full flex flex-col overflow-hidden"
        style={{
          background: note.customColor || colorStyle.bg,
          border: isInline ? `1px solid ${note.customColor ? `${note.customColor}44` : colorStyle.border}` : 'none',
          backgroundImage: isStealthActive
            ? undefined
            : decryptedBg
              ? `linear-gradient(rgba(12, 12, 20, 0.5), rgba(12, 12, 20, 0.65)), url(${decryptedBg})`
              : (bgPattern.pattern || undefined),
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backdropFilter: 'blur(40px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mood gradient overlay */}
        {moodStyle && !decryptedBg && note.background === 'none' && !isStealthActive && (
          <div className="absolute inset-0 pointer-events-none rounded-3xl" style={{ backgroundImage: moodStyle.gradient }} />
        )}

        {/* Header */}
        <div className={`relative z-[1] flex items-center justify-between px-4 pb-2 shrink-0 gap-3 ${!isInline ? 'safe-top safe-pt' : 'pt-4'}`}>
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
            <div className="relative">
              <button
                onClick={() => {
                  const newIsRaw = !note.isRaw;
                  if (newIsRaw) {
                    const converted = convertHtmlToMarkdown(content || '');
                    onUpdate(note.id, { isRaw: true, content: converted });
                    setContent(converted);
                    if (editor) editor.commands.setContent(converted);
                  } else {
                    const converted = convertMarkdownToHtml(content || '');
                    onUpdate(note.id, { isRaw: false, content: converted });
                    setContent(converted);
                    if (editor) editor.commands.setContent(converted);
                  }
                }}
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${note.isRaw ? 'text-[var(--gold)] animate-pulse' : 'text-white/40 hover:text-white/70'
                  }`}
                title={note.isRaw ? 'Rich Text Mode' : 'Raw Text Mode'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>code</span>
              </button>

              {/* Contextual Tooltip */}
              <AnimatePresence>
                {showEditorTooltip && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    className="absolute right-0 top-11 z-[60] w-64 p-3 rounded-xl bg-zinc-900 border border-white/10 shadow-2xl text-left"
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--gold)] flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs">info</span>
                        Raw Text Option
                      </span>
                      <button 
                        onClick={dismissTooltip}
                        className="text-white/40 hover:text-white text-xs underline cursor-pointer"
                      >
                        Got it
                      </button>
                    </div>
                    <p className="text-[11px] text-white/75 leading-relaxed font-normal">
                      Turn this ON to disable automatic formatting (like bullet lists). Your note will stay in raw text view for all users.
                    </p>
                    {/* Tooltip triangle */}
                    <div className="absolute right-3.5 -top-1 w-2.5 h-2.5 bg-zinc-900 border-t border-l border-white/10 rotate-45" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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

        {/* Conditional Toolbar: Draw Mode vs Format Mode (Fixed below Header, outside scrollable container) */}
        {!note.isChecklist && (
          <div className="relative z-[2] px-4 pb-2 border-b border-white/5 bg-transparent shrink-0">
            {drawMode ? (
              /* ── DRAW MODE TOOLBAR ── */
              <div className="flex flex-col gap-1.5">
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
            ) : note.isRaw ? (
              /* ── RAW MODE TOOLBAR ── */
              <div className="flex items-center gap-1.5 py-1.5 text-white/40 text-xs shrink-0 select-none">
                <span className="material-symbols-outlined text-[var(--gold)] animate-pulse" style={{ fontSize: '18px' }}>code</span>
                <span className="font-sans text-[10px] font-bold uppercase tracking-wider text-white/60">Raw Mode Active</span>
                <span className="text-[10px] text-white/25">— plain text editing active</span>
              </div>
            ) : (
              /* ── FORMAT MODE TOOLBAR (original) ── */
              <div ref={toolbarRef} className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
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
          </div>
        )}

        {/* Scrollable content */}
        <div className="relative z-[1] flex-1 overflow-y-auto px-4 mb-4 scrollbar-hide flex flex-col">

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
                .rich-editor {
                  outline: none;
                  min-height: 150px;
                }
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
                .rich-editor pre code {
                  background: transparent;
                  padding: 0;
                  border-radius: 0;
                  color: inherit;
                  font-size: inherit;
                }
                .rich-editor code {
                  background: rgba(255, 255, 255, 0.1);
                  padding: 2px 6px;
                  border-radius: 4px;
                  font-family: monospace;
                  font-size: inherit;
                  color: var(--gold);
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
                .rich-editor li p {
                  margin: 0;
                  display: inline;
                }
                .rich-editor p.is-empty::before,
                .rich-editor p.is-editor-empty::before {
                  content: attr(data-placeholder);
                  color: rgba(255, 255, 255, 0.2);
                  float: left;
                  height: 0;
                  pointer-events: none;
                }
              `}</style>



              {/* Content editable + inline drawing overlay */}
              <div
                ref={drawContainerRef}
                className="relative flex-1 flex flex-col"
                style={{
                  minHeight: drawMode
                    ? (savedCanvasSize.current && containerWidth > 0
                      ? `${Math.max(500, savedCanvasSize.current.height * (containerWidth / savedCanvasSize.current.width))}px`
                      : '100%')
                    : (savedCanvasSize.current && containerWidth > 0
                      ? `${savedCanvasSize.current.height * (containerWidth / savedCanvasSize.current.width)}px`
                      : 'auto')
                }}
              >
                {/* Content editable editor div */}
                <div
                  className={`w-full bg-transparent text-[var(--text-primary)] text-sm focus:outline-none min-h-[150px] leading-relaxed ${drawMode ? 'cursor-default pointer-events-none select-none' : 'cursor-text'
                    }`}
                >
                  {note.isRaw ? (
                    <textarea
                      ref={textareaRef}
                      value={content || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setContent(val);
                        debouncedSave({ content: val });
                      }}
                      placeholder="Note"
                      className="w-full bg-transparent text-[var(--text-primary)] text-sm focus:outline-none min-h-[250px] leading-relaxed resize-none border-0 outline-none p-0 focus:ring-0"
                    />
                  ) : (
                    <EditorContent editor={editor} />
                  )}
                </div>

                {/* Inline drawing canvas overlay */}
                {drawMode && (
                  <>
                    <canvas
                      ref={drawCanvasRef}
                      className="absolute inset-0 z-[5]"
                      style={{
                        touchAction: 'none',
                        cursor: drawTool === 'hand' ? 'grab' : drawTool === 'eraser' ? 'cell' : drawTool === 'text' ? 'text' : 'crosshair',
                      }}
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

                    {/* Zoom controls (bottom-right corner of canvas) */}
                    <div className="absolute bottom-3 right-3 z-[10] flex items-center gap-0.5 bg-black/50 backdrop-blur-md border border-white/10 rounded-xl px-1 py-1 shadow-xl">
                      <button
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); const c = drawContainerRef.current; if (!c) return; const { width: w, height: h } = c.getBoundingClientRect(); inlineZoomAtPoint(inlineCamRef.current.scale / 1.25, w / 2, h / 2); }}
                        className="w-6 h-6 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/70 transition-all flex items-center justify-center"
                        title="Zoom Out"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>remove</span>
                      </button>
                      <button
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); applyInlineCamera({ x: 0, y: 0, scale: 1 }); }}
                        className="min-w-[38px] text-[9px] font-bold tabular-nums text-white/40 hover:text-white/70 transition-colors text-center px-1 rounded-lg hover:bg-white/10"
                        title="Reset (100%)"
                      >
                        {Math.round(inlineCamera.scale * 100)}%
                      </button>
                      <button
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); const c = drawContainerRef.current; if (!c) return; const { width: w, height: h } = c.getBoundingClientRect(); inlineZoomAtPoint(inlineCamRef.current.scale * 1.25, w / 2, h / 2); }}
                        className="w-6 h-6 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/70 transition-all flex items-center justify-center"
                        title="Zoom In"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>add</span>
                      </button>
                      <div className="w-px h-3 bg-white/15 mx-0.5" />
                      <button
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); inlineFitToContent(); }}
                        className="w-6 h-6 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/70 transition-all flex items-center justify-center"
                        title="Fit to Content"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>fit_screen</span>
                      </button>
                    </div>

                    {/* Pan mode badge */}
                    {drawTool === 'hand' && (
                      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[10] pointer-events-none">
                        <div className="flex items-center gap-1 bg-[var(--gold)]/15 border border-[var(--gold)]/25 text-[var(--gold)] text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full backdrop-blur-sm">
                          <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>back_hand</span>
                          Pan
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Show existing drawing strokes as overlay when NOT in draw mode */}
                {!drawMode && drawStrokes.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none z-[3]">
                    <DrawingPreview
                      strokes={drawStrokes}
                      originalWidth={savedCanvasSize.current?.width}
                      originalHeight={savedCanvasSize.current?.height}
                    />
                  </div>
                )}
              </div>
            </>
          )}



          {/* Labels display */}
          {note.labels.filter(l => l !== '__secret__').length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {note.labels.filter(l => l !== '__secret__').map(label => (
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
                  {bottomPanel === 'backgrounds' && !isStealthActive && (
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
                      {labels.filter(l => l !== '__secret__').length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {labels.filter(l => l !== '__secret__').map(label => {
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
              {!isStealthActive && (
                <button
                  onClick={() => togglePanel('backgrounds')}
                  className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${bottomPanel === 'backgrounds' ? 'text-[var(--gold)]' : 'text-white/40'
                    }`}
                  title="Backgrounds"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>image</span>
                </button>
              )}
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
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${drawMode && drawTool !== 'laser' ? 'text-[var(--gold)] bg-white/10' : 'text-white/40 hover:text-[var(--gold)]'
                  }`}
                title={drawMode && drawTool !== 'laser' ? 'Exit Draw Mode' : 'Draw on Note'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>draw</span>
              </button>
              <button
                onClick={toggleLaserMode}
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${drawMode && drawTool === 'laser' ? 'text-[var(--gold)] bg-white/10' : 'text-white/40 hover:text-[var(--gold)]'
                  }`}
                title={drawMode && drawTool === 'laser' ? 'Exit Laser Mode' : 'Laser Pointer'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>flare</span>
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
      </div>

      {/* Drawing canvas is now inline — no full-screen overlay needed */}
    </motion.div>
  );
}
