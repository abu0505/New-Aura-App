import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Note, ChecklistItem, NoteColor, NoteMood } from '../../hooks/useNotes';
import { NOTE_COLORS, NOTE_BACKGROUNDS, MOOD_CONFIG } from '../../hooks/useNotes';
import { getStoredKeyPair, decodeBase64, encodeBase64 } from '../../lib/encryption';
import { useMedia } from '../../hooks/useMedia';
import nacl from 'tweetnacl';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { supabase } from '../../lib/supabase';

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
  onArchive: (id: string) => void;
  onDuplicate: (id: string) => void;
  onTogglePin: (id: string) => void;
  onAddChecklistItem: (noteId: string, text?: string) => void;
  onUpdateChecklistItem: (noteId: string, itemId: string, changes: Partial<ChecklistItem>) => void;
  onRemoveChecklistItem: (noteId: string, itemId: string) => void;
  labels: string[];
  onToggleLabel: (noteId: string, label: string) => void;
  onAddLabel: (label: string) => void;
}

type BottomPanel = 'none' | 'colors' | 'backgrounds' | 'mood' | 'labels' | 'more';

export default function NoteEditor({
  note,
  onUpdate,
  onClose,
  onTrash,
  onArchive,
  onDuplicate,
  onTogglePin,
  onAddChecklistItem,
  onUpdateChecklistItem,
  onRemoveChecklistItem,
  labels,
  onToggleLabel,
  onAddLabel,
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
  useEffect(() => {
    const customBg = note.customBg;
    if (!customBg) {
      setDecryptedBg(null);
      return;
    }
    let isMounted = true;
    const decryptData = async () => {
      try {
        const keys = getStoredKeyPair();
        if (!keys) return;
        
        const decrypted = nacl.secretbox.open(
          decodeBase64(customBg.ciphertext),
          decodeBase64(customBg.nonce),
          keys.secretKey
        );
        
        if (decrypted && isMounted) {
          const text = new TextDecoder().decode(decrypted);
          setDecryptedBg(text);
        }
      } catch (e) {
        console.error('Failed to decrypt custom background image:', e);
      }
    };
    decryptData();
    return () => { isMounted = false; };
  }, [note.customBg]);

  // Handle local background image upload & encryption
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Image size should be less than 5MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = event.target?.result;
      if (typeof result !== 'string') return;

      try {
        const keys = getStoredKeyPair();
        if (!keys) {
          alert('Encryption keys not found. Please setup your PIN/keys.');
          return;
        }

        const encoder = new TextEncoder();
        const dataUint8 = encoder.encode(result);

        const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
        const encrypted = nacl.secretbox(dataUint8, nonce, keys.secretKey);

        const customBg = {
          ciphertext: encodeBase64(encrypted),
          nonce: encodeBase64(nonce)
        };

        onUpdate(note.id, { customBg });
      } catch (err) {
        console.error('Encryption failed:', err);
        alert('Failed to encrypt and save image.');
      }
    };
    reader.readAsDataURL(file);
  };

  // Save on close
  const handleClose = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      onUpdate(note.id, { title, content });
    }
    onClose();
  };

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

  useEffect(() => {
    const handler = () => {
      updateActiveStyles();
    };
    document.addEventListener('selectionchange', handler);
    return () => {
      document.removeEventListener('selectionchange', handler);
    };
  }, [updateActiveStyles]);

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

  const handleTitleChange = (val: string) => {
    setTitle(val);
    debouncedSave({ title: val, content });
  };

  const handleContentChange = (val: string) => {
    setContent(val);
    debouncedSave({ title, content: val });
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

  // Time since creation
  const timeAgo = (() => {
    const diff = Date.now() - new Date(note.updatedAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  })();

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

      {/* Editor card */}
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 30 }}
        transition={{ type: 'spring', damping: 28, stiffness: 350 }}
        className="relative z-10 w-full max-w-lg mx-4 max-h-[85dvh] flex flex-col rounded-3xl overflow-hidden shadow-2xl"
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
        {moodStyle && (
          <div className="absolute inset-0 pointer-events-none rounded-3xl" style={{ backgroundImage: moodStyle.gradient }} />
        )}

        {/* Header */}
        <div className="relative z-[1] flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
          <button
            onClick={handleClose}
            className="-ml-1 w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>arrow_back</span>
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onTogglePin(note.id)}
              className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${
                note.isPinned ? 'text-[var(--gold)]' : 'text-white/40 hover:text-white/70'
              }`}
              title={note.isPinned ? 'Unpin' : 'Pin'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px', fontVariationSettings: note.isPinned ? "'FILL' 1" : '' }}>push_pin</span>
            </button>
            <button
              onClick={() => { onArchive(note.id); onClose(); }}
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
              title={note.isArchived ? 'Unarchive' : 'Archive'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{note.isArchived ? 'unarchive' : 'archive'}</span>
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
        <div className="relative z-[1] flex-1 overflow-y-auto px-4 pb-4 scrollbar-hide">
          {/* Mood badge */}
          {moodStyle && (
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-lg">{moodStyle.emoji}</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">{moodStyle.label}</span>
            </div>
          )}

          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Title"
            className="w-full bg-transparent text-[var(--text-primary)] text-lg font-semibold placeholder:text-white/20 focus:outline-none mb-2"
            style={{ outline: 'none', boxShadow: 'none' }}
          />

          {/* Content or Checklist */}
          {note.isChecklist ? (
            <div className="flex flex-col gap-0.5">
              {note.checklist.map((item, idx) => (
                <div key={item.id} className="flex items-start gap-2 group/item py-1">
                  <button
                    onClick={() => onUpdateChecklistItem(note.id, item.id, { checked: !item.checked })}
                    className="mt-0.5 shrink-0"
                  >
                    <span className={`material-symbols-outlined text-lg ${
                      item.checked ? 'text-[var(--gold)]/60' : 'text-white/25'
                    }`} style={{ fontSize: '20px' }}>
                      {item.checked ? 'check_box' : 'check_box_outline_blank'}
                    </span>
                  </button>
                  <input
                    value={item.text}
                    onChange={(e) => onUpdateChecklistItem(note.id, item.id, { text: e.target.value })}
                    onKeyDown={(e) => handleChecklistKeyDown(e, item, idx)}
                    placeholder="List item"
                    className={`checklist-input flex-1 bg-transparent text-sm focus:outline-none placeholder:text-white/15 ${
                      item.checked ? 'line-through text-white/30' : 'text-[var(--text-primary)]'
                    }`}
                    style={{ outline: 'none', boxShadow: 'none' }}
                  />
                  <button
                    onClick={() => onRemoveChecklistItem(note.id, item.id)}
                    className="opacity-0 group-hover/item:opacity-100 p-1 rounded-full hover:bg-white/10 text-white/25 hover:text-white/50 transition-all shrink-0"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
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

              {/* Notion-style Toolbar */}
              <div ref={toolbarRef} className="flex items-center gap-1 pb-2 mb-3 border-b border-white/5 overflow-x-auto scrollbar-hide shrink-0">
                <button
                  type="button"
                  onClick={() => handleFormat('bold')}
                  className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                    activeStyles.bold ? 'bg-white/15 text-[var(--gold)] font-bold' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                  title="Bold (Ctrl+B)"
                >
                  <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_bold</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFormat('italic')}
                  className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                    activeStyles.italic ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                  title="Italic (Ctrl+I)"
                >
                  <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_italic</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFormat('underline')}
                  className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                    activeStyles.underline ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                  title="Underline (Ctrl+U)"
                >
                  <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_underlined</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFormat('strikeThrough')}
                  className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                    activeStyles.strikeThrough ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                  title="Strikethrough"
                >
                  <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_strikethrough</span>
                </button>

                <div className="h-4 w-[1px] bg-white/10 mx-1 shrink-0" />

                <button
                  type="button"
                  onClick={() => handleBlockFormat('p')}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${
                    activeStyles.paragraph ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                  title="Normal Text"
                >
                  Txt
                </button>
                <button
                  type="button"
                  onClick={() => handleBlockFormat('h1')}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${
                    activeStyles.h1 ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                  title="Heading 1"
                >
                  H1
                </button>
                <button
                  type="button"
                  onClick={() => handleBlockFormat('h2')}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${
                    activeStyles.h2 ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                  title="Heading 2"
                >
                  H2
                </button>
                <button
                  type="button"
                  onClick={() => handleBlockFormat('h3')}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${
                    activeStyles.h3 ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                  title="Heading 3"
                >
                  H3
                </button>

                <div className="h-4 w-[1px] bg-white/10 mx-1 shrink-0" />

                <button
                  type="button"
                  onClick={() => handleFormat('insertUnorderedList')}
                  className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                    activeStyles.ul ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                  title="Bullet List"
                >
                  <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_list_bulleted</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFormat('insertOrderedList')}
                  className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                    activeStyles.ol ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                  title="Numbered List"
                >
                  <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_list_numbered</span>
                </button>

                <div className="h-4 w-[1px] bg-white/10 mx-1 shrink-0" />

                <button
                  type="button"
                  onClick={() => handleBlockFormat('blockquote')}
                  className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                    activeStyles.blockquote ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                  title="Quote Block"
                >
                  <span className="material-symbols-outlined block" style={{ fontSize: '18px' }}>format_quote</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleBlockFormat('pre')}
                  className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                    activeStyles.code ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
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
                    className={`p-1.5 rounded-lg transition-colors flex items-center gap-0.5 ${
                      showColorMenu ? 'bg-white/15 text-[var(--gold)]' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
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

              {/* Content editable editor div */}
              <div
                ref={contentEditableRef}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => handleContentChange(e.currentTarget.innerHTML)}
                onKeyUp={updateActiveStyles}
                onClick={updateActiveStyles}
                onKeyDown={handleKeyDown}
                className="rich-editor w-full bg-transparent text-[var(--text-primary)] text-sm placeholder:text-white/20 focus:outline-none min-h-[150px] leading-relaxed cursor-text"
                style={{ outline: 'none' }}
                {...{ placeholder: "Note" }}
              />
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

          {/* Edited timestamp */}
          <p className="text-[10px] text-white/20 mt-4">Edited {timeAgo}</p>
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
                          className={`relative w-8 h-8 rounded-full overflow-hidden border-2 transition-all flex items-center justify-center hover:scale-110 flex-shrink-0 ${
                            note.customColor ? 'border-white/80 scale-110' : 'border-dashed border-white/30 hover:border-white/50'
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
                            className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 flex-shrink-0 ${
                              note.color === color && !note.customColor ? 'border-white/60 scale-110' : 'border-transparent'
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
                              className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 flex-shrink-0 ${
                                isSelected ? 'border-white/80 scale-110' : 'border-transparent'
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
                          className={`w-14 h-14 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition-all hover:scale-105 flex-shrink-0 ${
                            note.customBg ? 'border-[var(--gold)] scale-105' : 'border-dashed border-white/30 hover:border-white/50'
                          } bg-white/5`}
                          title="Upload Custom Background"
                        >
                          <span className="material-symbols-outlined text-white/60" style={{ fontSize: '22px' }}>add_photo_alternate</span>
                          <span className="text-[7px] text-white/40 font-medium">{note.customBg ? 'Change' : 'Upload'}</span>
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
                                      
                                      // Convert blobUrl → dataURL via canvas/FileReader
                                      const res = await fetch(blobUrl);
                                      const blob = await res.blob();
                                      const dataUrl: string = await new Promise((resolve, reject) => {
                                        const reader = new FileReader();
                                        reader.onload = (ev) => resolve(ev.target?.result as string);
                                        reader.onerror = reject;
                                        reader.readAsDataURL(blob);
                                      });
                                      
                                      const encoder = new TextEncoder();
                                      const dataUint8 = encoder.encode(dataUrl);
                                      const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
                                      const encrypted = nacl.secretbox(dataUint8, nonce, keys.secretKey);
                                      
                                      onUpdate(note.id, {
                                        customBg: { ciphertext: encodeBase64(encrypted), nonce: encodeBase64(nonce) }
                                      });
                                    } catch (err) {
                                      console.error('Failed to use memory as background:', err);
                                    }
                                  }}
                                  className={`w-14 h-14 rounded-xl flex-shrink-0 overflow-hidden border-2 transition-all hover:scale-105 hover:border-white/40 relative flex items-center justify-center ${
                                    note.customBg ? 'border-white/10' : 'border-transparent'
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
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-full border transition-all hover:scale-105 ${
                              note.mood === mood
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
                              <button
                                key={label}
                                onClick={() => onToggleLabel(note.id, label)}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-all ${
                                  isActive
                                    ? 'bg-[var(--gold)]/15 text-[var(--gold)] border-[var(--gold)]/30'
                                    : 'bg-white/5 text-white/40 border-white/8 hover:border-white/15'
                                }`}
                              >
                                {isActive && <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>check</span>}
                                {label}
                              </button>
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
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${
                  bottomPanel === 'colors' ? 'text-[var(--gold)]' : 'text-white/40'
                }`}
                title="Colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>palette</span>
              </button>
              <button
                onClick={() => togglePanel('backgrounds')}
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${
                  bottomPanel === 'backgrounds' ? 'text-[var(--gold)]' : 'text-white/40'
                }`}
                title="Backgrounds"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>image</span>
              </button>
              <button
                onClick={() => togglePanel('mood')}
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${
                  bottomPanel === 'mood' ? 'text-[var(--gold)]' : 'text-white/40'
                }`}
                title="Mood"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>mood</span>
              </button>
              <button
                onClick={() => togglePanel('labels')}
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${
                  bottomPanel === 'labels' ? 'text-[var(--gold)]' : 'text-white/40'
                }`}
                title="Labels"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>label</span>
              </button>
              <button
                onClick={toggleChecklist}
                className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors ${
                  note.isChecklist ? 'text-[var(--gold)]' : 'text-white/40'
                }`}
                title={note.isChecklist ? 'Convert to text' : 'Convert to checklist'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>checklist</span>
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
    </motion.div>
  );
}
