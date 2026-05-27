import { memo, useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { Note } from '../../hooks/useNotes';
import { NOTE_COLORS, NOTE_BACKGROUNDS, MOOD_CONFIG } from '../../hooks/useNotes';
import { getStoredKeyPair, decodeBase64 } from '../../lib/encryption';
import nacl from 'tweetnacl';

// Helper to strip HTML tags for plain text card previews
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
    .trim();
};

interface NoteCardProps {
  note: Note;
  viewMode: 'grid' | 'list';
  onOpen: (note: Note) => void;
  onPin: (id: string) => void;
  onArchive: (id: string) => void;
  onTrash: (id: string) => void;
  onRestore?: (id: string) => void;
  onDeletePermanently?: (id: string) => void;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
  selectionMode?: boolean;
}

function NoteCard({
  note,
  viewMode,
  onOpen,
  onPin,
  onArchive,
  onTrash,
  onRestore,
  onDeletePermanently,
  isSelected,
  onSelect,
  selectionMode,
}: NoteCardProps) {
  const [showActions, setShowActions] = useState(false);
  const [decryptedBg, setDecryptedBg] = useState<string | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const colorStyle = NOTE_COLORS[note.color];
  const bgPattern = NOTE_BACKGROUNDS[note.background];
  const moodStyle = note.mood ? MOOD_CONFIG[note.mood] : null;

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
        console.error('Failed to decrypt note custom background:', e);
      }
    };
    decryptData();
    return () => { isMounted = false; };
  }, [note.customBg]);

  const isEmpty = !note.title && !note.content && note.checklist.length === 0;

  // Checklist summary
  const checkedCount = note.checklist.filter(i => i.checked).length;
  const totalChecklist = note.checklist.length;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressRef.current = setTimeout(() => {
      navigator.vibrate?.(10);
      onSelect?.(note.id);
    }, 600);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPos.current) return;
    const dx = e.touches[0].clientX - touchStartPos.current.x;
    const dy = e.touches[0].clientY - touchStartPos.current.y;
    if (Math.hypot(dx, dy) > 10 && longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    touchStartPos.current = null;
  };

  const handleClick = () => {
    if (selectionMode) {
      onSelect?.(note.id);
    } else {
      onOpen(note);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className={`group relative rounded-2xl cursor-pointer overflow-hidden transition-all duration-200 ${
        viewMode === 'list' ? 'w-full' : ''
      } ${isSelected ? 'ring-2 ring-[var(--gold)] ring-offset-2 ring-offset-[var(--bg-primary)]' : ''}`}
      style={{
        background: note.customColor || colorStyle.bg,
        border: `1px solid ${note.customColor ? `${note.customColor}44` : colorStyle.border}`,
        backgroundImage: decryptedBg
          ? `linear-gradient(rgba(12, 12, 20, 0.5), rgba(12, 12, 20, 0.65)), url(${decryptedBg})`
          : (bgPattern.pattern || undefined),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect?.(note.id);
      }}
    >
      {/* Mood gradient overlay */}
      {moodStyle && (
        <div
          className="absolute inset-0 pointer-events-none rounded-2xl"
          style={{ backgroundImage: moodStyle.gradient }}
        />
      )}

      {/* Selection checkmark */}
      {selectionMode && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
            isSelected
              ? 'bg-[var(--gold)] text-black'
              : 'bg-white/10 border border-white/20'
          }`}
        >
          {isSelected && (
            <span className="material-symbols-outlined text-sm" style={{ fontSize: '16px' }}>check</span>
          )}
        </motion.div>
      )}

      <div className={`relative z-[1] p-4 ${viewMode === 'list' ? 'flex gap-4 items-start' : ''}`}>
        {/* Content */}
        <div className={`flex-1 min-w-0 ${viewMode === 'list' ? '' : ''}`}>
          {/* Mood badge */}
          {moodStyle && (
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-sm">{moodStyle.emoji}</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/40">{moodStyle.label}</span>
            </div>
          )}

          {/* Title */}
          {note.title && (
            <h3 className="font-medium text-[var(--text-primary)] leading-snug mb-1.5 text-sm">
              {note.title}
            </h3>
          )}

          {/* Content preview */}
          {note.content && !note.isChecklist && (
            <p className={`text-[var(--text-secondary)] text-xs leading-relaxed whitespace-pre-wrap ${
              viewMode === 'grid' ? 'line-clamp-[12]' : 'line-clamp-2'
            }`}>
              {getPlainText(note.content)}
            </p>
          )}

          {/* Checklist preview */}
          {note.isChecklist && note.checklist.length > 0 && (
            <div className={`flex flex-col gap-1 ${viewMode === 'grid' ? '' : ''}`}>
              {note.checklist.slice(0, viewMode === 'grid' ? 10 : 3).map(item => (
                <div key={item.id} className="flex items-center gap-2">
                  <span className={`material-symbols-outlined text-sm ${
                    item.checked ? 'text-[var(--gold)]/60' : 'text-white/25'
                  }`} style={{ fontSize: '14px', display: 'block', lineHeight: '1' }}>
                    {item.checked ? 'check_box' : 'check_box_outline_blank'}
                  </span>
                  <span className={`text-xs leading-none ${
                    item.checked
                      ? 'line-through text-[var(--text-secondary)]/50'
                      : 'text-[var(--text-secondary)]'
                  }`}>
                    {item.text || 'Empty item'}
                  </span>
                </div>
              ))}
              {note.checklist.length > (viewMode === 'grid' ? 10 : 3) && (
                <span className="text-[10px] text-white/30 ml-6">
                  +{note.checklist.length - (viewMode === 'grid' ? 10 : 3)} more
                </span>
              )}
              {totalChecklist > 0 && (
                <div className="flex items-center gap-1.5 mt-1.5 ml-0.5">
                  <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden max-w-[80px]">
                    <div
                      className="h-full rounded-full bg-[var(--gold)]/40 transition-all duration-300"
                      style={{ width: `${(checkedCount / totalChecklist) * 100}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-white/30 font-medium">{checkedCount}/{totalChecklist}</span>
                </div>
              )}
            </div>
          )}

          {/* Empty note indicator */}
          {isEmpty && (
            <p className="text-xs text-white/20 italic">Empty note</p>
          )}

          {/* Labels */}
          {note.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {note.labels.slice(0, 3).map(label => (
                <span
                  key={label}
                  className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-white/5 text-white/40 border border-white/5"
                >
                  {label}
                </span>
              ))}
              {note.labels.length > 3 && (
                <span className="text-[9px] text-white/25 self-center">+{note.labels.length - 3}</span>
              )}
            </div>
          )}
        </div>

        {/* Pin indicator */}
        {note.isPinned && (
          <span
            className="absolute top-2 right-2 material-symbols-outlined text-[var(--gold)]/50"
            style={{ fontSize: '14px', fontVariationSettings: "'FILL' 1" }}
          >
            push_pin
          </span>
        )}
      </div>

      {/* Hover actions (desktop) */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between px-2 py-1.5 bg-black/30 backdrop-blur-sm transition-all duration-200 ${
          showActions && !selectionMode ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
        }`}
      >
        {note.isTrashed ? (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onRestore?.(note.id); }}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors shrink-0"
              title="Restore"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>restore_from_trash</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDeletePermanently?.(note.id); }}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors shrink-0"
              title="Delete permanently"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete_forever</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onPin(note.id); }}
              className={`flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/10 transition-colors shrink-0 ${
                note.isPinned ? 'text-[var(--gold)]' : 'text-white/40 hover:text-white/70'
              }`}
              title={note.isPinned ? 'Unpin' : 'Pin'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px', fontVariationSettings: note.isPinned ? "'FILL' 1" : '' }}>push_pin</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onArchive(note.id); }}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors shrink-0"
              title={note.isArchived ? 'Unarchive' : 'Archive'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                {note.isArchived ? 'unarchive' : 'archive'}
              </span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onTrash(note.id); }}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/10 text-white/40 hover:text-red-400/70 transition-colors shrink-0"
              title="Delete"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

export default memo(NoteCard);
