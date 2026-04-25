import { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback } from 'react'; 
import { useChat } from '../../hooks/useChat';
import type { ChatMessage } from '../../hooks/useChat';
import { useChatSettings } from '../../hooks/useChatSettings';
import { useAuth } from '../../contexts/AuthContext';
import type { PartnerProfile } from '../../hooks/usePartner';
import MessageInput from './MessageInput';
import ChatBubble from './ChatBubble';
import MediaGridBubble from './MediaGridBubble';
import { ChatBubbleErrorBoundary } from './ChatBubbleErrorBoundary';
import { groupMessages, isMessageGroup } from '../../utils/messageGrouping';
// PinnedMessagesBanner imported later if needed, but removed here
import TypingIndicator from './TypingIndicator';
import { SeenIndicator } from './SeenIndicator';
import { LastSeenStatus } from './LastSeenStatus';
import EncryptedImage from '../common/EncryptedImage';



interface MobileChatScreenProps {
  partner: PartnerProfile;
  isActive?: boolean;
  partnerIsTyping: boolean;
  sendTypingEvent: (isTyping: boolean) => void;
}

export default function MobileChatScreen({ partner, isActive, partnerIsTyping, sendTypingEvent }: MobileChatScreenProps) {
  const { user } = useAuth();
  const [pinFilter, setPinFilter] = useState<'all' | 'me' | 'partner'>('all');
  const [viewMode, setViewMode] = useState<'chat' | 'pinned'>('chat');
  const [showPinDropdown, setShowPinDropdown] = useState(false);
  const pinDropdownRef = useRef<HTMLDivElement>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const messageInputRef = useRef<any>(null); // Type imported from MessageInput if needed, using any for now to avoid circular deps if missing

  // Click outside listener for the pin dropdown
  useEffect(() => {
    const handleClickOutside = (e: Event) => {
      if (pinDropdownRef.current && !pinDropdownRef.current.contains(e.target as Node)) {
        setShowPinDropdown(false);
      }
    };

    if (showPinDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('pointerdown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [showPinDropdown]);

  const { 
    messages, pinnedMessages, pinnedMessageDetails, replyMessageCache, loading, loadingMore, 
    hasMore, hasMoreNewer, sendMessage, loadMore, loadMoreNewer, jumpToMessageWindow, jumpToLatest, reactToMessage, editMessage, 
    deleteMessage, pinMessage, firstUnreadId, isOnline, markAsRead,
    addOptimisticMediaMessage, commitOptimisticMediaMessage,
    addChunkedVideoMessage, updateChunkStatus, commitChunkedVideoMessage, finalizeChunkedVideoMessage
  } = useChat(partner.id, partner.public_key, partner.key_history?.map(h => h.public_key));
  const { settings } = useChatSettings();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const previousMessageCountRef = useRef<number>(0);
  const isInitialMount = useRef(true);
  const isBottomLocked = useRef(true);
  
  const [isJumpingToPinned, setIsJumpingToPinned] = useState<string | null>(null);
  const handleJumpToMessageRef = useRef<((id: string) => void) | null>(null);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (isInitialMount.current) {
      if (!loading && messages.length > 0) {
        // Immediate scroll
        container.scrollTop = container.scrollHeight;
        
        // Secondary scroll via requestAnimationFrame
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });

        // Tertiary scroll via timeout (catch images that decode quickly)
        setTimeout(() => {
          if (isBottomLocked.current) {
            container.scrollTop = container.scrollHeight;
          }
        }, 300);

        isInitialMount.current = false;
        previousMessageCountRef.current = messages.length;
      }
      return;
    }

    // Scroll anchoring
    if (previousScrollHeightRef.current) {
      const hDiff = container.scrollHeight - previousScrollHeightRef.current;
      if (hDiff > 0) {
        container.scrollTop += hDiff;
        previousScrollHeightRef.current = 0;
        previousMessageCountRef.current = messages.length;
        return;
      }
    }

    const { scrollHeight, scrollTop, clientHeight } = container;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 250;
    
    // Auto-scroll logic for new messages
    const hasNewMessage = messages.length > previousMessageCountRef.current;
    const lastMessage = messages[messages.length - 1];
    const sentByMe = lastMessage?.is_mine;

    // If I sent the message, always scroll to bottom. 
    // If it's from partner, only scroll if already near bottom.
    if (viewMode === 'chat' && hasNewMessage && (sentByMe || isNearBottom)) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }

    previousMessageCountRef.current = messages.length;
  }, [messages, loading, viewMode]);

  useEffect(() => {
    if (partnerIsTyping && viewMode === 'chat') {
       const container = scrollContainerRef.current;
       if (!container) return;
       const { scrollHeight, scrollTop, clientHeight } = container;
       const isNearBottom = scrollHeight - scrollTop - clientHeight < 250;
       if (isNearBottom) {
         messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
       }
    }
  }, [partnerIsTyping, viewMode]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container || loadingMore || viewMode === 'pinned') return;

    // Raise threshold to 300px — better UX for touch scrolling
    if (hasMore && container.scrollTop < 300) {
      previousScrollHeightRef.current = container.scrollHeight;
      loadMore();
    }

    if (hasMoreNewer && container.scrollHeight - container.scrollTop - container.clientHeight < 300) {
      loadMoreNewer();
    }
  };

  // Auto-load more if the initial batch is dominated by media messages
  // (no text visible = user can't scroll to find context above the images)
  useEffect(() => {
    if (loading || loadingMore || !hasMore || viewMode !== 'chat') return;
    if (messages.length === 0) return;
    const nonMediaCount = messages.filter(m => m.type === 'text' || m.type === 'sticker').length;
    // If 80%+ of loaded messages are media, auto-load more to surface text context
    if (nonMediaCount / messages.length < 0.2) {
      const container = scrollContainerRef.current;
      if (container) previousScrollHeightRef.current = container.scrollHeight;
      loadMore();
    }
  // Only run once after initial load completes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Initial landing "Bottom Lock": Keep anchored to bottom during first 3 seconds
  // while media and messages are settling/decrypting.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Detect if user scrolls up manually — if they do, unlock the bottom anchor
    const detectManualScroll = () => {
      if (!isBottomLocked.current) return;
      const { scrollHeight, scrollTop, clientHeight } = container;
      // Allow some slack (100px)
      if (scrollHeight - scrollTop - clientHeight > 100) {
        isBottomLocked.current = false;
      }
    };

    container.addEventListener('scroll', detectManualScroll, { passive: true });
    
    // ResizeObserver monitors height changes inside the container (e.g. images loading)
    const observer = new ResizeObserver(() => {
      if (isBottomLocked.current) {
        container.scrollTop = container.scrollHeight;
      }
    });

    // Observe the content wrapper (first child of scroll container)
    if (container.firstElementChild) {
      observer.observe(container.firstElementChild);
    }

    // Auto-release lock after 3 seconds anyway to be safe
    const timer = setTimeout(() => {
      isBottomLocked.current = false;
    }, 3000);

    return () => {
      container.removeEventListener('scroll', detectManualScroll);
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  const handleSend = (text: string, media?: any, replyToId?: string) => {
    sendMessage(text, media, replyToId);
  };

  const handleJumpToMessage = async (id: string) => {
    const el = document.querySelector(`[data-message-id="${id}"]`) || document.getElementById(`msg-${id}`);
    const container = scrollContainerRef.current;

    if (el && container) {
      isBottomLocked.current = false;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const offset = elRect.top - containerRect.top + container.scrollTop - (containerRect.height / 2) + (elRect.height / 2);
      container.scrollTo({ top: offset, behavior: 'smooth' });
      setIsJumpingToPinned(null);
    } else {
      setIsJumpingToPinned(id);
      await jumpToMessageWindow(id);
      
      setTimeout(() => {
        const newEl = document.querySelector(`[data-message-id="${id}"]`) || document.getElementById(`msg-${id}`);
        const newContainer = scrollContainerRef.current;
        if (newEl && newContainer) {
          isBottomLocked.current = false;
          const containerRect = newContainer.getBoundingClientRect();
          const elRect = newEl.getBoundingClientRect();
          const offset = elRect.top - containerRect.top + newContainer.scrollTop - (containerRect.height / 2) + (elRect.height / 2);
          newContainer.scrollTo({ top: offset, behavior: 'auto' });
        }
        setIsJumpingToPinned(null);
      }, 150);
    }
  };

  handleJumpToMessageRef.current = handleJumpToMessage;

  // ── Stable callback refs ──────────────────────────────────────────────────
  // messagesRef always holds the latest messages without causing handlers to
  // be recreated. This is the key fix for mobile: React.memo(ChatBubble) was
  // broken by inline arrow functions that were re-created every render, forcing
  // every bubble to re-render on a single emoji reaction or reply state change.
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Stable reply handler – same reference for the entire component lifetime.
  const handleReply = useCallback((id: string) => {
    setReplyingTo(messagesRef.current.find(m => m.id === id) || null);
    messageInputRef.current?.focusInput();
  }, []);

  // Stable jump handler – always delegates to latest implementation via ref.
  const stableHandleJumpToMessage = useCallback((id: string) => {
    handleJumpToMessageRef.current?.(id);
  }, []);

  // Stable redirect from pinned view back to chat at the right scroll position.
  const handlePinnedRedirect = useCallback((id: string) => {
    setViewMode('chat');
    handleJumpToMessageRef.current?.(id);
  }, []);

  useEffect(() => {
    const handleGlobalJump = (e: any) => {
      const msgId = e.detail?.messageId;
      if (msgId) {
        setViewMode('chat');
        handleJumpToMessageRef.current?.(msgId);
      }
    };
    document.addEventListener('jump-to-message', handleGlobalJump);
    return () => document.removeEventListener('jump-to-message', handleGlobalJump);
  }, []);


  
  // Real-time "Seen" logic using Intersection Observer
  // ══ FIXED: Observer is created ONCE and persists across message changes ══
  // Previously, this effect had `messages` in its deps, which meant:
  // 1. Every new message → effect re-runs → old observer destroyed → new one created
  // 2. The 1-second debounce timer (timerRef) was lost on each re-run
  // 3. markAsRead() never fired → ticks never updated (✓ stayed single)
  // 
  // Now we use a MutationObserver to auto-observe new [data-message-id] elements
  // as they appear in the DOM, without needing to recreate the IntersectionObserver.
  useEffect(() => {
    if (viewMode !== 'chat') return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const unreadMessages = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushReads = () => {
      if (unreadMessages.size > 0) {
        markAsRead(Array.from(unreadMessages));
        unreadMessages.clear();
      }
    };

    // Create IntersectionObserver ONCE
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          const msgId = el.getAttribute('data-message-id');
          const isMine = el.getAttribute('data-is-mine') === 'true';
          const isRead = el.getAttribute('data-is-read') === 'true';

          if (msgId && !isMine && !isRead) {
            unreadMessages.add(msgId);
            if (flushTimer) clearTimeout(flushTimer);
            flushTimer = setTimeout(flushReads, 1000);
          }
        }
      });
    }, {
      root: container,
      threshold: 0.1,
    });

    // Observe all existing message elements
    const observeAll = () => {
      container.querySelectorAll('[data-message-id]').forEach(el => {
        observer.observe(el);
      });
    };
    observeAll();

    // Use MutationObserver to auto-observe NEW message elements added to DOM
    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            // Check if the added node itself is a message element
            if (node.hasAttribute('data-message-id')) {
              observer.observe(node);
            }
            // Also check descendants
            node.querySelectorAll?.('[data-message-id]')?.forEach(el => {
              observer.observe(el);
            });
          }
        }
      }
    });

    mutationObserver.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      if (flushTimer) clearTimeout(flushTimer);
      // Flush any pending reads on cleanup
      flushReads();
    };
  }, [viewMode, markAsRead]);

  const getBackgroundStyle = () => {
    if (settings?.background_url === 'silk') return { background: 'var(--bg-primary)' };
    if (settings?.background_url === 'stars') return { background: 'linear-gradient(45deg, var(--bg-primary) 0%, var(--bg-elevated) 100%)' };
    if (settings?.background_url === 'gold') return { background: 'linear-gradient(135deg, var(--bg-primary) 0%, var(--gold-deep) 100%)' };
    
    return { background: 'var(--bg-primary)' };
  };

  const filteredPinnedMessages = pinnedMessages.filter(p => {
    if (pinFilter === 'me') return p.pinned_by === user?.id;
    if (pinFilter === 'partner') return p.pinned_by === partner.id;
    return true; // 'all'
  });

  const pinnedMessagesData = useMemo(() => {
    if (viewMode !== 'pinned') return [];
    return filteredPinnedMessages
      .map(p => messages.find(m => m.id === p.message_id) || pinnedMessageDetails[p.message_id])
      .filter(Boolean)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [filteredPinnedMessages, messages, pinnedMessageDetails, viewMode]);

  const listToRender = useMemo(() => {
    if (viewMode === 'chat') return messages;
    return pinnedMessagesData;
  }, [viewMode, messages, pinnedMessagesData]);

  return (
    <>
      <style>{`
        .glass-header { 
          background: var(--bg-elevated); 
          backdrop-filter: blur(12px); 
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { 
          background: var(--gold-light); 
          opacity: 0.2;
          border-radius: 10px; 
        }
      `}</style>
      
      <div 
        className="flex flex-col h-[100dvh] w-full relative overflow-hidden text-aura-text-primary font-sans transition-all duration-700"
      >
        {/* Background Layer */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden" style={getBackgroundStyle()}>
          {settings?.background_url?.startsWith('http') && (
            <div className="absolute inset-0">
               <EncryptedImage 
                url={settings.background_url}
                encryptionKey={settings.background_key}
                nonce={settings.background_nonce}
                alt="Chat Background"
                className="w-full h-full object-cover opacity-30"
              />
              <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px]" />
            </div>
          )}
        </div>
        {/* TopAppBar */}
        <header className="shrink-0 sticky top-0 z-50 w-full glass-header flex items-center justify-between px-2 py-4 border-b border-white/5 gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <button 
              onClick={() => document.dispatchEvent(new CustomEvent('toggle-nav'))} 
              className="text-aura-text-secondary hover:text-primary transition-colors active:scale-90 mr-1 flex items-center justify-center p-2 rounded-full"
            >
              <span className="material-symbols-outlined text-xl">arrow_back</span>
            </button>
            <div className="relative">
              <div className="w-10 h-10 rounded-full border-2 border-primary/30 overflow-hidden bg-aura-bg-elevated">
                <EncryptedImage
                  url={partner.avatar_url}
                  encryptionKey={partner.avatar_key}
                  nonce={partner.avatar_nonce}
                  alt="Partner Avatar"
                  className="w-full h-full object-cover"
                  placeholder={`https://ui-avatars.com/api/?name=${partner.display_name || 'Partner'}&background=c9a96e&color=000000`}
                />
              </div>
              {partner.is_online && (
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-aura-success rounded-full border-2 border-background"></div>
              )}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-serif text-lg text-primary leading-tight truncate">{partner.display_name || 'Your Partner'}</span>
              <span className="text-[9px] font-label uppercase tracking-widest text-aura-text-secondary truncate">
                <LastSeenStatus isOnline={partner.is_online} lastSeen={partner.last_seen} compact />
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-aura-text-secondary">
            {!isOnline && (
              <div className="flex items-center gap-1.5 bg-red-500/10 px-3 py-1.5 rounded-full border border-red-500/20 mr-2">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                <span className="text-[9px] uppercase tracking-widest text-red-200 font-bold">Offline</span>
              </div>
            )}
            <button className="hover:text-primary transition-colors active:scale-90">
              <span className="material-symbols-outlined">call</span>
            </button>
            <button className="hover:text-primary transition-colors active:scale-90">
              <span className="material-symbols-outlined">videocam</span>
            </button>
            
            <div className="relative" ref={pinDropdownRef}>
              <button 
                onClick={() => setShowPinDropdown(!showPinDropdown)}
                className="hover:text-primary transition-colors active:scale-90 flex items-center justify-center p-1 -m-1"
              >
                <span className="material-symbols-outlined">more_vert</span>
              </button>
              
              {showPinDropdown && (
                <>
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-aura-bg-elevated border border-white/5 shadow-xl glass-panel z-50 overflow-hidden py-1">
                    {viewMode === 'pinned' && (
                      <button 
                        onClick={() => { setViewMode('chat'); setShowPinDropdown(false); }}
                        className="w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 text-primary bg-white/5 font-bold mb-1"
                      >
                        <span className="material-symbols-outlined text-[18px]">forum</span>
                        Back to Normal Chat
                      </button>
                    )}
                    <button 
                      onClick={() => { setViewMode('pinned'); setPinFilter('me'); setShowPinDropdown(false); }}
                      className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 ${pinFilter === 'me' && viewMode === 'pinned' ? 'text-primary bg-white/5' : 'text-aura-text-primary hover:bg-white/5'}`}
                    >
                      <span className="material-symbols-outlined text-[18px]">push_pin</span>
                      My Pinned Messages
                    </button>
                    <button 
                      onClick={() => { setViewMode('pinned'); setPinFilter('partner'); setShowPinDropdown(false); }}
                      className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 border-t border-white/5 ${pinFilter === 'partner' && viewMode === 'pinned' ? 'text-primary bg-white/5' : 'text-aura-text-primary hover:bg-white/5'}`}
                    >
                      <span className="material-symbols-outlined text-[18px]">person</span>
                      Partner's Pinned Messages
                    </button>
                    <button 
                      onClick={() => { setViewMode('pinned'); setPinFilter('all'); setShowPinDropdown(false); }}
                      className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 border-t border-white/5 ${pinFilter === 'all' && viewMode === 'pinned' ? 'text-primary bg-white/5' : 'text-aura-text-primary hover:bg-white/5'}`}
                    >
                      <span className="material-symbols-outlined text-[18px]">library_add_check</span>
                      Combined Pinned Messages
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col relative overflow-hidden">
          
          {viewMode === 'pinned' && (
            <div className="bg-primary/10 backdrop-blur-md border-b border-primary/20 px-4 py-3 flex items-center justify-between shadow-lg z-30 relative shrink-0">
               <div className="flex flex-col">
                  <span className="text-primary text-xs font-label uppercase tracking-widest font-bold flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">push_pin</span>
                    Pinned Messages
                  </span>
                  <span className="text-aura-text-secondary text-[10px] uppercase tracking-widest mt-0.5">
                     {pinFilter === 'all' ? 'Combined View' : pinFilter === 'me' ? 'My Pins' : 'Partner\'s Pins'}
                  </span>
               </div>
               <button 
                 onClick={() => setViewMode('chat')}
                 className="bg-aura-bg-elevated px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
               >
                 Close
               </button>
            </div>
          )}
          
          {/* Jumping loading indicator */}
          {isJumpingToPinned && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-aura-bg-elevated/90 text-primary text-xs px-4 py-2 rounded-full border border-primary/30 shadow-xl backdrop-blur-md flex items-center gap-2 z-40">
              <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></span>
              Loading history...
            </div>
          )}

          {/* Message List */}
          <div 
            ref={scrollContainerRef} 
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto overflow-x-hidden px-2 pt-6 pb-24 flex flex-col gap-1 custom-scrollbar anchor-none"
            style={{
              maskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 80px), transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 80px), transparent 100%)',
            }}
          >
            {hasMore && !loading && viewMode === 'chat' && (
              <div className="flex justify-center py-4 anchor-none">
                {loadingMore ? (
                  <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                ) : (
                  <div className="text-[9px] text-aura-text-secondary uppercase tracking-[0.2em] opacity-60 font-bold">Scroll up for older memories</div>
                )}
              </div>
            )}

            {!partner.public_key && (
              <div className="text-center p-6 bg-primary/5 border border-primary/20 text-primary rounded-[2rem] text-[10px] font-label uppercase tracking-widest leading-loose shadow-xl">
                Establishing Sanctuary Connection...<br/>Generating Encryption Keys.
              </div>
            )}

            {loading ? (
              <div className="flex justify-center p-12">
                 <div className="w-6 h-6 border-2 border-primary rounded-full border-t-transparent animate-spin"></div>
              </div>
            ) : (() => {
              if (viewMode === 'pinned' && listToRender.length === 0) {
                return (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 opacity-60">
                    <span className="material-symbols-outlined text-4xl text-primary mb-2">push_pin</span>
                    <span className="text-sm text-aura-text-primary font-label uppercase tracking-widest text-center">No Pinned Messages Found</span>
                  </div>
                );
              }

              const lastReadMyMsg = viewMode === 'chat' 
                ? [...listToRender].reverse().find(m => m.is_mine && m.is_read && !!m.read_at)
                : null;
                


              const groupedList = groupMessages(listToRender);

              return groupedList.map((item, index) => {
                const isGroup = isMessageGroup(item);
                const firstMsg = isGroup ? item[0] : item;
                const lastMsg = isGroup ? item[item.length - 1] : item;
                
                const currentDateStr = new Date(firstMsg.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
                const prevItem = index > 0 ? groupedList[index - 1] : null;
                const prevMsg = prevItem ? (isMessageGroup(prevItem) ? prevItem[prevItem.length - 1] : prevItem) : null;
                const previousDateStr = prevMsg ? new Date(prevMsg.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
                
                const showDateSeparator = currentDateStr !== previousDateStr;
                const isFirstInGroup = index === 0 || prevMsg?.sender_id !== firstMsg.sender_id || showDateSeparator;
                
                const nextItem = index < groupedList.length - 1 ? groupedList[index + 1] : null;
                const nextMsg = nextItem ? (isMessageGroup(nextItem) ? nextItem[0] : nextItem) : null;
                const nextDateStr = nextMsg ? new Date(nextMsg.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
                const isLastInGroup = index === groupedList.length - 1 || nextMsg?.sender_id !== lastMsg.sender_id || nextDateStr !== currentDateStr;

                return (
                  <div key={isGroup ? `group-${firstMsg.id}` : firstMsg.id} id={viewMode === 'chat' ? `msg-${firstMsg.id}` : `pinned-${firstMsg.id}`} className="flex flex-col gap-1 w-full message-row">
                    {showDateSeparator && (
                      <div className="flex justify-center my-6">
                        <span className="bg-aura-bg-elevated/80 backdrop-blur-md px-3 py-1 rounded-full text-[10px] text-aura-text-secondary uppercase tracking-[0.2em] font-bold border border-white/5 shadow-md">
                          {currentDateStr}
                        </span>
                      </div>
                    )}
                    {viewMode === 'chat' && firstUnreadId === firstMsg.id && (
                      <div className="flex items-center gap-4 py-6">
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
                        <span className="text-[10px] uppercase tracking-[0.2em] text-primary/60 font-bold">New Messages</span>
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
                      </div>
                    )}
                    <div className={`flex w-full ${firstMsg.sender_id === user?.id || viewMode === 'pinned' ? 'justify-end' : 'justify-start'}`}>
                      <ChatBubbleErrorBoundary messageId={firstMsg.id}>
                        {isGroup ? (
                          <MediaGridBubble 
                            messages={item}
                            partnerPublicKey={partner.public_key}
                            onReact={viewMode === 'chat' ? reactToMessage : undefined}
                            isMine={firstMsg.sender_id === user?.id}
                            isFirst={isFirstInGroup}
                            isLast={isLastInGroup}
                            onReply={viewMode === 'chat' ? handleReply : undefined}
                            onDelete={viewMode === 'chat' ? deleteMessage : undefined}
                            onPin={pinMessage}
                            quickEmojis={settings?.quick_emojis}
                          />
                        ) : (
                          <ChatBubble 
                            message={item} 
                            partnerPublicKey={partner.public_key}
                            onReact={viewMode === 'chat' ? reactToMessage : undefined}
                            onEdit={viewMode === 'chat' ? editMessage : undefined}
                            onDelete={viewMode === 'chat' ? deleteMessage : undefined}
                            onPin={pinMessage}
                            isFirst={isFirstInGroup}
                            isLast={isLastInGroup}
                            isPinnedView={viewMode === 'pinned'}
                            onRedirect={viewMode === 'pinned' ? handlePinnedRedirect : undefined}
                            onReply={viewMode === 'chat' ? handleReply : undefined}
                            repliedMessage={item.reply_to ? (messages.find(m => m.id === item.reply_to) ?? replyMessageCache[item.reply_to]) : undefined}
                            onJumpToMessage={stableHandleJumpToMessage}
                            quickEmojis={settings?.quick_emojis}
                          />
                        )}
                      </ChatBubbleErrorBoundary>
                    </div>
                    {lastReadMyMsg && lastReadMyMsg.id === lastMsg.id && (
                      <SeenIndicator timestamp={lastReadMyMsg.read_at!} />
                    )}
                  </div>
                );
              });
            })()}
            {partnerIsTyping && viewMode === 'chat' && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Jump to Latest Floating Button */}
          {hasMoreNewer && viewMode === 'chat' && (
            <div className="absolute bottom-24 right-4 z-[100]">
              <button 
                onClick={jumpToLatest} 
                className="bg-primary text-background px-4 py-2 rounded-full shadow-lg font-bold text-xs flex items-center gap-1.5 active:scale-95 transition-transform"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                Jump to Latest
              </button>
            </div>
          )}

          {/* Chat Input Bar */}
          {viewMode === 'chat' && (
            <div className="shrink-0 w-full relative z-20">
              <MessageInput 
                ref={messageInputRef}
                onSend={handleSend} 
                onTyping={sendTypingEvent} 
                disabled={!partner.public_key} 
                replyingTo={replyingTo}
                onCancelReply={() => setReplyingTo(null)}
                isActive={isActive}
                partnerPublicKey={partner.public_key}
                onOptimisticMediaStart={addOptimisticMediaMessage}
                onOptimisticMediaComplete={commitOptimisticMediaMessage}
                partnerId={partner.id}
                onChunkedVideoStart={addChunkedVideoMessage}
                onChunkedVideoStatusUpdate={updateChunkStatus}
                onChunkedVideoCommit={commitChunkedVideoMessage}
                onChunkedVideoFinalize={finalizeChunkedVideoMessage}
              />
            </div>
          )}
        </main>
      </div>
    </>
  );
}
