import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { getStoredKeyPair } from '../../lib/encryption';
import { decryptMessageWithFallback, decodeBase64 } from '../../lib/encryption';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  created_at: string;
  decrypted_content: string;
  is_mine: boolean;
  sender_id: string;
}

interface ChatSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
  userId: string | undefined;
  partnerId: string | undefined;
  partnerPublicKey: string | null | undefined;
  partnerKeyHistory?: string[];
  /** Already-loaded in-memory messages (searched first, zero egress) */
  cachedMessages: Array<{
    id: string;
    created_at: string;
    decrypted_content?: string;
    is_mine: boolean;
    sender_id: string;
    encrypted_content?: string | null;
    nonce?: string | null;
    sender_public_key?: string | null;
    is_deleted_for_everyone?: boolean;
  }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SEARCH_STATUS_WORDS = [
  'Searching...',
  'Deep Diving...',
  'Finding results...',
  'Scanning history...',
  'Almost there...',
];

const PAGE_SEARCH_SIZE = 50; // messages fetched per DB page during background scan

const MSG_SEARCH_COLS =
  'id,sender_id,encrypted_content,nonce,created_at,is_deleted_for_everyone,sender_public_key' as const;

// ─── Date Formatting ─────────────────────────────────────────────────────────

function formatResultDate(isoString: string): string {
  const d = new Date(isoString);
  const now = new Date();
  const currentYear = now.getFullYear();
  const msgYear = d.getFullYear();

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');

  if (msgYear === currentYear) {
    // Same year → "DD/MM"
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${day} ${monthNames[d.getMonth()]}`;
  }
  // Past year → "DD/MM/YY"
  const yy = String(msgYear).slice(-2);
  return `${day}/${month}/${yy}`;
}

// ─── Highlight helper ─────────────────────────────────────────────────────────

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-primary/40 text-primary rounded px-0.5">{part}</mark>
      : part
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatSearch({
  isOpen,
  onClose,
  onJumpToMessage,
  userId,
  partnerId,
  partnerPublicKey,
  partnerKeyHistory,
  cachedMessages,
}: ChatSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [statusWordIndex, setStatusWordIndex] = useState(0);
  const [wordVisible, setWordVisible] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      // Reset state on close
      setQuery('');
      setResults([]);
      setIsSearching(false);
      stopStatusCycle();
    }
  }, [isOpen]);

  // ── Status word cycling animation ──
  const stopStatusCycle = useCallback(() => {
    if (statusIntervalRef.current) {
      clearInterval(statusIntervalRef.current);
      statusIntervalRef.current = null;
    }
  }, []);

  const startStatusCycle = useCallback(() => {
    stopStatusCycle();
    setStatusWordIndex(0);
    setWordVisible(true);

    // Every 1.8s: fade out → change word → fade in
    let idx = 0;
    statusIntervalRef.current = setInterval(() => {
      setWordVisible(false);
      setTimeout(() => {
        idx = (idx + 1) % SEARCH_STATUS_WORDS.length;
        setStatusWordIndex(idx);
        setWordVisible(true);
      }, 300);
    }, 1800);
  }, [stopStatusCycle]);

  // ── Decrypt a single DB row inline (no worker needed for search) ──
  const tryDecrypt = useCallback((
    row: { encrypted_content: string | null; nonce: string | null; sender_id: string; sender_public_key?: string | null; is_deleted_for_everyone?: boolean },
    myKeyPair: { secretKey: Uint8Array; publicKey: Uint8Array },
  ): string => {
    if (row.is_deleted_for_everyone) return '';
    if (!row.encrypted_content || !row.nonce) return '';
    if (!partnerPublicKey) return '';

    try {
      const isMine = row.sender_id === userId;
      const decryptionKey = isMine
        ? partnerPublicKey
        : (row.sender_public_key || partnerPublicKey);

      const fallbackKeys = (partnerKeyHistory || [])
        .filter(k => k !== decryptionKey)
        .map(k => decodeBase64(k));

      return decryptMessageWithFallback(
        row.encrypted_content,
        row.nonce,
        decodeBase64(decryptionKey),
        myKeyPair.secretKey,
        fallbackKeys,
      );
    } catch {
      return '';
    }
  }, [userId, partnerPublicKey, partnerKeyHistory]);

  // ── Main search logic ──
  const runSearch = useCallback(async (q: string) => {
    if (!q.trim() || !userId || !partnerId) {
      setResults([]);
      setIsSearching(false);
      stopStatusCycle();
      return;
    }

    // Abort any previous search
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setResults([]);
    setIsSearching(true);
    seenIdsRef.current = new Set();
    startStatusCycle();

    const normalQ = q.toLowerCase();
    const myKeyPair = getStoredKeyPair();

    // ── PHASE 1: Search cached (in-memory) messages, newest first ──
    const reversed = [...cachedMessages].reverse();
    const phaseOneResults: SearchResult[] = [];

    for (const m of reversed) {
      if (controller.signal.aborted) return;

      const text = (m.decrypted_content || '').toLowerCase();
      if (text.includes(normalQ) && !m.is_deleted_for_everyone) {
        if (!seenIdsRef.current.has(m.id)) {
          seenIdsRef.current.add(m.id);
          phaseOneResults.push({
            id: m.id,
            created_at: m.created_at,
            decrypted_content: m.decrypted_content || '',
            is_mine: m.is_mine,
            sender_id: m.sender_id,
          });
        }
      }
    }

    if (phaseOneResults.length > 0) {
      setResults(phaseOneResults);
    }

    if (controller.signal.aborted) return;

    // ── PHASE 2: Progressive DB scan, newest first ──
    // We scan page by page from newest → oldest, appending matches in real time
    let cursor: string | null = null; // "created_at < cursor" for pagination

    // We still need to scan from the very latest backwards — we'll skip IDs we've
    // already matched in Phase 1 via seenIdsRef.
    try {
      let pagesDone = 0;
      const MAX_PAGES = 200; // safety ceiling — 200 × 50 = 10,000 messages

      while (!controller.signal.aborted && pagesDone < MAX_PAGES) {
        let q2 = supabase
          .from('messages')
          .select(MSG_SEARCH_COLS)
          .or(`and(sender_id.eq.${userId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${userId})`)
          .order('created_at', { ascending: false })
          .limit(PAGE_SEARCH_SIZE);

        if (cursor) q2 = q2.lt('created_at', cursor);

        const { data, error } = await q2;

        if (controller.signal.aborted) return;
        if (error || !data || data.length === 0) break;

        cursor = data[data.length - 1].created_at;

        // Decrypt and check each row
        const pageResults: SearchResult[] = [];
        for (const row of data) {
          if (controller.signal.aborted) return;
          if (seenIdsRef.current.has(row.id)) continue;
          if (row.is_deleted_for_everyone) continue;

          const text = myKeyPair
            ? tryDecrypt(row as any, myKeyPair)
            : '';

          if (text.toLowerCase().includes(normalQ)) {
            seenIdsRef.current.add(row.id);
            pageResults.push({
              id: row.id,
              created_at: row.created_at,
              decrypted_content: text,
              is_mine: row.sender_id === userId,
              sender_id: row.sender_id,
            });
          }
        }

        if (pageResults.length > 0 && !controller.signal.aborted) {
          // Merge: insert at the right chronological position (results are sorted newest first)
          setResults(prev => {
            const merged = [...prev];
            for (const r of pageResults) {
              // Find position to insert (keep newest-first order by created_at)
              const insertAt = merged.findIndex(
                x => new Date(x.created_at) < new Date(r.created_at)
              );
              if (insertAt === -1) merged.push(r);
              else merged.splice(insertAt, 0, r);
            }
            return merged;
          });
        }

        if (data.length < PAGE_SEARCH_SIZE) break; // No more pages
        pagesDone++;
      }
    } catch {
      // Silently ignore network errors during scan
    }

    if (!controller.signal.aborted) {
      setIsSearching(false);
      stopStatusCycle();
    }
  }, [userId, partnerId, cachedMessages, tryDecrypt, startStatusCycle, stopStatusCycle]);

  // Removed real-time debounced trigger in favor of manual "Enter" search

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopStatusCycle();
    };
  }, [stopStatusCycle]);

  const handleResultClick = (result: SearchResult) => {
    onJumpToMessage(result.id);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter') runSearch(query);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[200] bg-black/60"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed inset-x-0 top-0 z-[201] max-w-lg mx-auto"
        style={{ maxHeight: '60dvh' }}
      >
        <div
          className="flex flex-col rounded-b-3xl shadow-2xl overflow-hidden"
          style={{
            background: 'var(--bg-elevated, #1a1a28)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderTop: 'none',
            maxHeight: '60dvh',
          }}
        >
          {/* Search Input Row */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
            <span className="material-symbols-outlined text-xl text-primary shrink-0">
              search
            </span>

            {/* Input + animated status word */}
            <div className="relative flex-1 overflow-hidden">
              {/* Animated status word (shown while searching, above the input) */}
              {isSearching && query.trim() && (
                <div
                  className="absolute inset-0 pointer-events-none flex items-center"
                  style={{ zIndex: 1 }}
                >
                  <span
                    className="text-primary"
                    style={{
                      opacity: wordVisible ? 1 : 0,
                      transform: wordVisible ? 'translateY(0)' : 'translateY(-12px)',
                      transition: 'opacity 0.28s ease, transform 0.28s ease',
                      fontSize: '0.8rem',
                      fontStyle: 'italic',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {SEARCH_STATUS_WORDS[statusWordIndex]}
                  </span>
                </div>
              )}
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search messages..."
                className="w-full bg-transparent outline-none focus:ring-0 border-none text-sm placeholder-aura-text-secondary"
                style={{
                  color: isSearching && query.trim() ? 'transparent' : 'var(--color-text-primary, #f0e6d3)',
                  caretColor: isSearching && query.trim() ? 'transparent' : 'var(--color-primary, #e6c487)',
                  transition: 'color 0.2s',
                }}
              />
            </div>

            {/* Clear / Close */}
            {query ? (
              <button
                onClick={() => { setQuery(''); setResults([]); abortRef.current?.abort(); setIsSearching(false); stopStatusCycle(); }}
                className="text-aura-text-secondary hover:text-primary transition-colors shrink-0"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            ) : (
              <button
                onClick={onClose}
                className="text-aura-text-secondary hover:text-primary transition-colors shrink-0"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            )}
          </div>

          {/* Results Area */}
          <div className="overflow-y-auto scrollbar-hide" style={{ maxHeight: 'calc(60dvh - 60px)' }}>
            {/* Empty state */}
            {!query.trim() && (
              <div className="flex flex-col items-center justify-center py-12 opacity-50">
                <span className="material-symbols-outlined text-4xl text-primary mb-2">manage_search</span>
                <span className="text-xs text-aura-text-secondary uppercase tracking-widest">
                  Type to search all messages
                </span>
              </div>
            )}

            {/* No results (search done, query non-empty) */}
            {!isSearching && query.trim() && results.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 opacity-50">
                <span className="material-symbols-outlined text-4xl text-primary mb-2">search_off</span>
                <span className="text-xs text-aura-text-secondary uppercase tracking-widest">
                  No messages found
                </span>
              </div>
            )}

            {/* Searching, no results yet */}
            {isSearching && query.trim() && results.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 opacity-60">
                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-3" />
                <span className="text-xs text-aura-text-secondary uppercase tracking-widest">
                  Scanning your conversations...
                </span>
              </div>
            )}

            {/* Result list */}
            {results.length > 0 && (
              <div className="divide-y divide-white/5">
                {results.map(result => (
                  <button
                    key={result.id}
                    onClick={() => handleResultClick(result)}
                    className="w-full text-left px-4 py-3 hover:bg-white/5 active:bg-white/10 transition-colors flex items-start gap-3 group"
                  >
                    {/* Side indicator */}
                    <div
                      className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{
                        background: result.is_mine
                          ? 'var(--color-primary, #e6c487)'
                          : 'rgba(255,255,255,0.3)',
                      }}
                    />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm leading-snug line-clamp-2"
                        style={{ color: 'var(--color-text-primary, #f0e6d3)' }}
                      >
                        {highlightMatch(result.decrypted_content, query)}
                      </p>
                    </div>

                    {/* Date + arrow */}
                    <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest text-primary"
                      >
                        {formatResultDate(result.created_at)}
                      </span>
                      <span
                        className="material-symbols-outlined text-[14px] opacity-0 group-hover:opacity-60 transition-opacity text-primary"
                      >
                        arrow_forward
                      </span>
                    </div>
                  </button>
                ))}

                {/* "Still searching..." footer */}
                {isSearching && (
                  <div className="flex items-center justify-center gap-2 py-3 opacity-50">
                    <div className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    <span className="text-[10px] text-aura-text-secondary uppercase tracking-widest">
                      Still scanning older messages...
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
