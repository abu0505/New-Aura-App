import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { getStoredKeyPair } from '../../lib/encryption';
import { encodeBase64 } from 'tweetnacl-util';
import {
  searchLocalCache,
  cacheDecryptedMessages,
  getCachedIds,
  makeConversationKey,
  type CachedMessage,
} from '../../lib/searchCache';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  created_at: string;
  decrypted_content: string;
  is_mine: boolean;
  sender_id: string;
}

/** Internal pool entry — stores full text for subset filtering */
interface PoolEntry {
  id: string;
  created_at: string;
  content: string;        // original casing
  content_lower: string;  // pre-lowered for fast search
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

const PAGE_SIZE = 500;

const MSG_COLS =
  'id,sender_id,receiver_id,encrypted_content,nonce,created_at,is_deleted_for_everyone,sender_public_key' as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatResultDate(isoString: string): string {
  const d = new Date(isoString);
  const now = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');

  if (d.getFullYear() === now.getFullYear()) {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${day} ${monthNames[d.getMonth()]}`;
  }
  return `${day}/${month}/${String(d.getFullYear()).slice(-2)}`;
}

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

// ─── Worker Manager ──────────────────────────────────────────────────────────

let workerInstance: Worker | null = null;

function getDecryptWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL('../../workers/searchDecrypt.worker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return workerInstance;
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
  const [displayResults, setDisplayResults] = useState<SearchResult[]>([]);
  const [isWarming, setIsWarming] = useState(false);
  const [warmingDone, setWarmingDone] = useState(false);
  const [statusWordIndex, setStatusWordIndex] = useState(0);
  const [wordVisible, setWordVisible] = useState(true);
  const [isCommitted, setIsCommitted] = useState(false); // true after Enter
  const isCommittedRef = useRef(false);

  useEffect(() => {
    isCommittedRef.current = isCommitted;
  }, [isCommitted]);

  const [showWalkthrough, setShowWalkthrough] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const show = localStorage.getItem('show_chat_search_walkthrough') === 'true';
      if (show) {
        setShowWalkthrough(true);
      }
    }
  }, [isOpen]);

  const closeWalkthrough = () => {
    localStorage.removeItem('show_chat_search_walkthrough');
    setShowWalkthrough(false);
  };

  const abortRef = useRef<AbortController | null>(null);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The hidden pool — ALL decrypted messages found during background warming.
   * Keyed by the INITIAL query that triggered the warm-up.
   * As user types more characters, we re-filter THIS pool locally (0ms).
   */
  const poolRef = useRef<PoolEntry[]>([]);
  const poolQueryRef = useRef(''); // the query the pool was warmed for
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setDisplayResults([]);
      setIsWarming(false);
      setWarmingDone(false);
      setIsCommitted(false);
      stopStatusCycle();
      poolRef.current = [];
      poolQueryRef.current = '';
      seenIdsRef.current = new Set();
      setShowWalkthrough(false);
    }
  }, [isOpen]);

  // ── Status word cycling ──
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

  // ── Cache in-memory messages to IndexedDB ──
  useEffect(() => {
    if (!userId || !partnerId || cachedMessages.length === 0) return;
    const convKey = makeConversationKey(userId, partnerId);
    const toCache: CachedMessage[] = [];

    for (const m of cachedMessages) {
      if (!m.decrypted_content) continue;
      toCache.push({
        id: m.id,
        conversation_key: convKey,
        content: m.decrypted_content.toLowerCase(),
        content_original: m.decrypted_content,
        sender_id: m.sender_id,
        created_at: m.created_at,
        is_deleted: !!m.is_deleted_for_everyone,
      });
    }

    if (toCache.length > 0) {
      cacheDecryptedMessages(toCache).catch(() => {});
    }
  }, [cachedMessages, userId, partnerId]);

  // ═══════════════════════════════════════════════════════════════════════════
  // BACKGROUND WARMING ENGINE
  // Silently fetches + decrypts ALL matching messages into the hidden pool.
  // User sees nothing until they press Enter.
  // ═══════════════════════════════════════════════════════════════════════════

  const runBackgroundWarm = useCallback(async (q: string) => {
    if (!q.trim() || !userId || !partnerId) return;

    // If new query is a SUPERSET of current pool query (user typed more chars),
    // no need to re-warm — we can just subset-filter locally
    const normalQ = q.toLowerCase();
    if (
      poolRef.current.length > 0 &&
      poolQueryRef.current &&
      normalQ.startsWith(poolQueryRef.current.toLowerCase()) &&
      normalQ !== poolQueryRef.current.toLowerCase()
    ) {
      // Pool is already warm and still valid — just update committed results if shown
      if (isCommittedRef.current) {
        const filtered = filterPool(normalQ);
        setDisplayResults(filtered);
      }
      return;
    }

    // New base query — need full warm-up
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    poolRef.current = [];
    poolQueryRef.current = normalQ;
    seenIdsRef.current = new Set();
    setIsWarming(true);
    setWarmingDone(false);
    startStatusCycle();

    const myKeyPair = getStoredKeyPair();
    const convKey = makeConversationKey(userId, partnerId);

    // ── PHASE 1: In-memory messages → pool ──
    const reversed = [...cachedMessages].reverse();
    for (const m of reversed) {
      if (controller.signal.aborted) return;
      if (m.is_deleted_for_everyone || !m.decrypted_content) continue;
      if (seenIdsRef.current.has(m.id)) continue;

      const lower = m.decrypted_content.toLowerCase();
      if (lower.includes(normalQ)) {
        seenIdsRef.current.add(m.id);
        poolRef.current.push({
          id: m.id,
          created_at: m.created_at,
          content: m.decrypted_content,
          content_lower: lower,
          is_mine: m.is_mine,
          sender_id: m.sender_id,
        });
      }
    }

    // If user already pressed Enter while we were scanning, show immediate results
    if (isCommittedRef.current && !controller.signal.aborted) {
      setDisplayResults(filterPool(normalQ));
    }

    if (controller.signal.aborted) return;

    // ── PHASE 2: IndexedDB cache → pool ──
    try {
      const cachedResults = await searchLocalCache(q, userId, partnerId);
      if (controller.signal.aborted) return;

      for (const cm of cachedResults) {
        if (seenIdsRef.current.has(cm.id)) continue;
        seenIdsRef.current.add(cm.id);
        poolRef.current.push({
          id: cm.id,
          created_at: cm.created_at,
          content: cm.content_original,
          content_lower: cm.content.toLowerCase(),
          is_mine: cm.sender_id === userId,
          sender_id: cm.sender_id,
        });
      }

      if (isCommittedRef.current && !controller.signal.aborted) {
        setDisplayResults(filterPool(normalQ));
      }
    } catch { /* IndexedDB unavailable */ }

    if (controller.signal.aborted) return;

    // ── PHASE 3: DB scan + Worker decryption → pool ──
    if (!myKeyPair || !partnerPublicKey) {
      setIsWarming(false);
      setWarmingDone(true);
      stopStatusCycle();
      return;
    }

    let localCachedIds: Set<string>;
    try {
      localCachedIds = await getCachedIds(userId, partnerId);
    } catch {
      localCachedIds = new Set();
    }
    for (const id of localCachedIds) seenIdsRef.current.add(id);

    const secretKeyB64 = encodeBase64(myKeyPair.secretKey);
    const fallbackKeysB64 = partnerKeyHistory || [];
    const worker = getDecryptWorker();
    let pagesDone = 0;
    const MAX_PAGES = 100;

    try {
      while (!controller.signal.aborted && pagesDone < MAX_PAGES) {
        const fetchPage = async (pageIdx: number) => {
          const { data, error } = await supabase
            .from('messages')
            .select(MSG_COLS)
            .or(`and(sender_id.eq.${userId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${userId})`)
            .order('created_at', { ascending: false })
            .range(pageIdx * PAGE_SIZE, (pageIdx + 1) * PAGE_SIZE - 1);
          return { data, error };
        };

        // Fetch 2 pages in parallel
        const [res1, res2] = await Promise.all([
          fetchPage(pagesDone),
          fetchPage(pagesDone + 1)
        ]);

        if (controller.signal.aborted) return;
        const combinedData = [...(res1.data || []), ...(res2.data || [])];
        if (combinedData.length === 0) break;

        const uncached = combinedData.filter(row => !seenIdsRef.current.has(row.id));

        if (uncached.length > 0) {
          const reqId = crypto.randomUUID();
          const workerResult = await new Promise<{
            matches: Array<{ id: string; content: string; sender_id: string; created_at: string; is_mine: boolean }>;
            allDecrypted: Array<{ id: string; content: string; sender_id: string; created_at: string; is_deleted: boolean }>;
          }>((resolve) => {
            const handler = (e: MessageEvent) => {
              if (e.data.type === 'BATCH_RESULT' && e.data.requestId === reqId) {
                worker.removeEventListener('message', handler);
                resolve(e.data);
              }
            };
            worker.addEventListener('message', handler);
            worker.postMessage({
              type: 'DECRYPT_BATCH',
              batch: uncached,
              userId,
              secretKeyB64,
              partnerPublicKeyB64: partnerPublicKey,
              fallbackKeysB64,
              query: q,
              requestId: reqId,
            });
          });

          if (controller.signal.aborted) return;

          // Cache ALL decrypted messages for future searches
          const toCache: CachedMessage[] = workerResult.allDecrypted.map(d => ({
            id: d.id,
            conversation_key: convKey,
            content: d.content.toLowerCase(),
            content_original: d.content,
            sender_id: d.sender_id,
            created_at: d.created_at,
            is_deleted: d.is_deleted,
          }));
          cacheDecryptedMessages(toCache).catch(() => {});

          // Add matches to pool
          for (const d of workerResult.allDecrypted) {
            seenIdsRef.current.add(d.id);
          }
          for (const m of workerResult.matches) {
            poolRef.current.push({
              id: m.id,
              created_at: m.created_at,
              content: m.content,
              content_lower: m.content.toLowerCase(),
              is_mine: m.is_mine,
              sender_id: m.sender_id,
            });
          }

          // Live-update display if user already pressed Enter
          if (isCommittedRef.current && !controller.signal.aborted) {
            setDisplayResults(filterPool(normalQ));
          }
        }

        if (res1.data && res1.data.length < PAGE_SIZE) break;
        if (res2.data && res2.data.length < PAGE_SIZE) break;
        pagesDone += 2;
      }
    } catch { /* network error */ }

    if (!controller.signal.aborted) {
      setIsWarming(false);
      setWarmingDone(true);
      stopStatusCycle();

      // Final update if committed
      if (isCommittedRef.current) {
        setDisplayResults(filterPool(normalQ));
      }
    }
  }, [userId, partnerId, partnerPublicKey, partnerKeyHistory, cachedMessages, startStatusCycle, stopStatusCycle]);

  // ── Filter pool locally by current query (subset filtering — ~0.1ms) ──
  function filterPool(normalQuery: string): SearchResult[] {
    const results: SearchResult[] = [];
    for (const entry of poolRef.current) {
      if (entry.content_lower.includes(normalQuery)) {
        results.push({
          id: entry.id,
          created_at: entry.created_at,
          decrypted_content: entry.content,
          is_mine: entry.is_mine,
          sender_id: entry.sender_id,
        });
      }
    }
    // Sort newest first
    results.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return results;
  }

  // ── Typing handler: debounced background warm ──
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);

    if (!value.trim()) {
      // Cleared — reset everything
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      setDisplayResults([]);
      setIsWarming(false);
      setWarmingDone(false);
      setIsCommitted(false);
      stopStatusCycle();
      poolRef.current = [];
      poolQueryRef.current = '';
      seenIdsRef.current = new Set();
      return;
    }

    const normalQ = value.toLowerCase();

    // If user already committed and pool is warm, live-filter immediately
    if (isCommitted && poolRef.current.length > 0) {
      // Check if new query is superset of pool query (can subset-filter)
      if (normalQ.startsWith(poolQueryRef.current.toLowerCase())) {
        setDisplayResults(filterPool(normalQ));
        return; // No need to re-warm
      }
    }

    // Debounce background warming (300ms)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runBackgroundWarm(value);
    }, 300);
  }, [runBackgroundWarm, stopStatusCycle, isCommitted]);

  // ── Enter = commit: show results from pool instantly ──
  const commitSearch = useCallback(() => {
    if (!query.trim()) return;
    const normalQ = query.toLowerCase();
    setIsCommitted(true);

    // If pool has data, show filtered results INSTANTLY
    if (poolRef.current.length > 0) {
      setDisplayResults(filterPool(normalQ));
    } else {
      // Pool is empty or still warming — show what we have (may be empty initially)
      setDisplayResults([]);
    }

    // If warming hasn't started yet (user typed fast and hit Enter before debounce),
    // start it immediately
    if (!isWarming && !warmingDone) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      runBackgroundWarm(query);
    }
  }, [query, isWarming, warmingDone, runBackgroundWarm]);

  // When warming updates pool and user is committed, auto-update display
  useEffect(() => {
    if (isCommitted && query.trim() && (isWarming || warmingDone)) {
      const normalQ = query.toLowerCase();
      setDisplayResults(filterPool(normalQ));
    }
  }, [isCommitted, isWarming, warmingDone, query]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopStatusCycle();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [stopStatusCycle]);

  const handleResultClick = (result: SearchResult) => {
    onJumpToMessage(result.id);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      commitSearch();
    }
  };

  if (!isOpen) return null;

  // ── UX state ──
  const isShowingResults = isCommitted && query.trim();
  const isActivelySearching = isWarming && isCommitted;
  const showNoResults = isCommitted && !isWarming && warmingDone && query.trim() && displayResults.length === 0;

  // Warming indicator (subtle, while typing before Enter)
  const showWarmingHint = isWarming && !isCommitted && query.trim();

  const phaseLabel = isActivelySearching
    ? SEARCH_STATUS_WORDS[statusWordIndex]
    : showWarmingHint
    ? 'Preparing results...'
    : '';

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

            <div className="relative flex-1 overflow-hidden">
              {/* Animated status word with static searched text */}
              {isActivelySearching && query.trim() && (
                <div
                  className="absolute inset-x-0 inset-y-0 pointer-events-none flex items-center gap-1.5"
                  style={{ zIndex: 1 }}
                >
                  <span
                    className="text-primary shrink-0"
                    style={{
                      opacity: wordVisible ? 1 : 0,
                      transform: wordVisible ? 'translateY(0)' : 'translateY(-12px)',
                      transition: 'opacity 0.28s ease, transform 0.28s ease',
                      fontSize: '0.8rem',
                      fontStyle: 'italic',
                      whiteSpace: 'nowrap',
                      display: 'inline-block',
                      width: '7.5rem', // stable width so dot and query don't shift
                    }}
                  >
                    {phaseLabel}
                  </span>
                  <span className="text-white/40 text-[10px] shrink-0">•</span>
                  <span
                    className="text-sm truncate"
                    style={{
                      color: 'var(--color-text-primary, #f0e6d3)',
                    }}
                  >
                    {query}
                  </span>
                </div>
              )}
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => handleQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search messages..."
                className="w-full bg-transparent outline-none focus:ring-0 border-none text-sm placeholder-aura-text-secondary"
                style={{
                  color: isActivelySearching && query.trim() ? 'transparent' : 'var(--color-text-primary, #f0e6d3)',
                  caretColor: isActivelySearching && query.trim() ? 'transparent' : 'var(--color-primary, #e6c487)',
                  transition: 'color 0.2s',
                }}
              />
            </div>

            {/* Clear / Close */}
            {query ? (
              <button
                onClick={() => { handleQueryChange(''); abortRef.current?.abort(); }}
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

          {/* Walkthrough Tooltip */}
          {showWalkthrough && (
            <div className="mx-4 my-2 p-3 bg-gradient-to-br from-[var(--bg-elevated)] to-[#191926]/95 border border-[var(--gold)]/30 rounded-2xl shadow-xl relative z-[202] flex gap-2.5">
              <div className="p-1.5 rounded-lg bg-[rgba(var(--primary-rgb),_0.1)] border border-[rgba(var(--primary-rgb),_0.2)] text-[var(--gold)] h-fit shrink-0">
                <span className="material-symbols-outlined text-[16px] block">help</span>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-serif italic text-xs text-[var(--gold)] mb-0.5">Chat Search</h4>
                <p className="text-[10px] text-white/60 leading-relaxed mb-2">
                  Type your query. The field won't change while typing. Press <span className="text-[var(--gold)] font-bold">Enter</span> to commit your search. Once searching begins, you'll see animated progress alongside your query.
                </p>
                <div className="flex justify-end">
                  <button
                    onClick={closeWalkthrough}
                    className="px-2.5 py-1 rounded-md bg-[var(--gold)] text-[var(--on-accent)] font-bold text-[9px] uppercase tracking-wider hover:bg-[var(--gold-deep)] transition-colors"
                  >
                    Got it!
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Results Area */}
          <div className="overflow-y-auto scrollbar-hide" style={{ maxHeight: 'calc(60dvh - 60px)' }}>
            {/* Empty state — no query */}
            {!query.trim() && (
              <div className="flex flex-col items-center justify-center py-12 opacity-50">
                <span className="material-symbols-outlined text-4xl text-primary mb-2">manage_search</span>
                <span className="text-xs text-aura-text-secondary uppercase tracking-widest">
                  Type to search all messages
                </span>
              </div>
            )}

            {/* Typing but not yet committed — hint to press Enter */}
            {query.trim() && !isCommitted && (
              <div className="flex flex-col items-center justify-center py-12 opacity-50">
                <span className="material-symbols-outlined text-4xl text-primary mb-2">keyboard_return</span>
                <span className="text-xs text-aura-text-secondary uppercase tracking-widest">
                  Press Enter to search
                </span>
                {showWarmingHint && (
                  <span className="text-[10px] text-primary/50 uppercase tracking-widest mt-2 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 border border-primary/30 border-t-primary rounded-full animate-spin" />
                    Warming up results...
                  </span>
                )}
              </div>
            )}

            {/* No results (search committed and done) */}
            {showNoResults && (
              <div className="flex flex-col items-center justify-center py-12 opacity-50">
                <span className="material-symbols-outlined text-4xl text-primary mb-2">search_off</span>
                <span className="text-xs text-aura-text-secondary uppercase tracking-widest">
                  No messages found
                </span>
              </div>
            )}

            {/* Committed + searching + no results yet */}
            {isCommitted && isWarming && query.trim() && displayResults.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 opacity-60">
                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-3" />
                <span className="text-xs text-aura-text-secondary uppercase tracking-widest">
                  Scanning your conversations...
                </span>
              </div>
            )}

            {/* Result list */}
            {isShowingResults && displayResults.length > 0 && (
              <div className="divide-y divide-white/5">
                {displayResults.map(result => (
                  <button
                    key={result.id}
                    onClick={() => handleResultClick(result)}
                    className="w-full text-left px-4 py-3 hover:bg-white/5 active:bg-white/10 transition-colors flex items-start gap-3 group"
                  >
                    <div
                      className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{
                        background: result.is_mine
                          ? 'var(--color-primary, #e6c487)'
                          : 'rgba(255,255,255,0.3)',
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm leading-snug line-clamp-2"
                        style={{ color: 'var(--color-text-primary, #f0e6d3)' }}
                      >
                        {highlightMatch(result.decrypted_content, query)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
                        {formatResultDate(result.created_at)}
                      </span>
                      <span className="material-symbols-outlined text-[14px] opacity-0 group-hover:opacity-60 transition-opacity text-primary">
                        arrow_forward
                      </span>
                    </div>
                  </button>
                ))}

                {/* Still searching footer */}
                {isWarming && (
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
