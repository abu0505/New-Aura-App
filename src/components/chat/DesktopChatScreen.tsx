import { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { useChat } from '../../hooks/useChat';
import type { ChatMessage } from '../../hooks/useChat';
import { useChatSettingsContext } from '../../contexts/ChatSettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import type { PartnerProfile } from '../../hooks/usePartner';
import MessageInput from './MessageInput';
import type { MessageInputHandle } from './MessageInput';
import ChatBubble from './ChatBubble';
import MediaGridBubble from './MediaGridBubble';
import { ChatBubbleErrorBoundary } from './ChatBubbleErrorBoundary';
import { groupMessages, isMessageGroup } from '../../utils/messageGrouping';
// PinnedMessagesBanner removed in favor of integrated view
import TypingIndicator from './TypingIndicator';
import { SeenIndicator } from './SeenIndicator';
import EncryptedImage from '../common/EncryptedImage';
import { AnimatePresence, motion } from 'framer-motion';
// ── PERF: Lazy-load DesktopCameraStudio (37KB) — only loaded when user clicks camera ──
const DesktopCameraStudio = lazy(() => import('./DesktopCameraStudio'));
import { LastSeenStatus } from './LastSeenStatus';
import { useCall } from '../../contexts/CallContext';
import { useNotifications } from '../../contexts/NotificationContext';
import ChatSearch from './ChatSearch';
import { getBackgroundData } from '../../utils/backgroundParser';
import StreakBadge from './StreakBadge';
import SnapCaptureOverlay from './SnapCaptureOverlay';
import SnapCaptureConsentModal from './SnapCaptureConsentModal';
import type { useSnapCapture } from '../../hooks/useSnapCapture';
import { toast } from 'sonner';
import { Phone, Camera, MoreVertical, Search, MessageSquare, Pin, User, CheckSquare, BookOpen, ChevronDown } from 'lucide-react';
import { VideoCallIcon } from '../common/CustomIcons';



interface DesktopChatScreenProps {
  partner: PartnerProfile;
  isActive?: boolean;
  partnerIsTyping: boolean;
  sendTypingEvent: (isTyping: boolean) => void;
  snapCapture: ReturnType<typeof useSnapCapture>;
}

export default function DesktopChatScreen({ partner, isActive, partnerIsTyping, sendTypingEvent, snapCapture }: DesktopChatScreenProps) {
  const { user } = useAuth();
  const { markReadBySenderId } = useNotifications();
  const [pinFilter, setPinFilter] = useState<'all' | 'me' | 'partner'>('all');
  const [viewMode, setViewMode] = useState<'chat' | 'pinned'>('chat');
  const [showPinDropdown, setShowPinDropdown] = useState(false);
  const pinDropdownRef = useRef<HTMLDivElement>(null);
  const [showCallDropdown, setShowCallDropdown] = useState(false);
  const callDropdownRef = useRef<HTMLDivElement>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [isDesktopCameraOpen, setIsDesktopCameraOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAfkActive, setIsAfkActive] = useState(() => {
    return localStorage.getItem('aura_afk_mode') === 'true';
  });

  useEffect(() => {
    const handleAfkChange = (e: any) => {
      setIsAfkActive(e.detail);
    };
    window.addEventListener('afk-mode-change', handleAfkChange);
    return () => window.removeEventListener('afk-mode-change', handleAfkChange);
  }, []);

  const toggleAfkMode = () => {
    const newVal = !isAfkActive;
    localStorage.setItem('aura_afk_mode', String(newVal));
    setIsAfkActive(newVal);
    window.dispatchEvent(new CustomEvent('afk-mode-change', { detail: newVal }));
    if (newVal) {
      toast.success('Study Mode (AFK) is active. You will stay online even in the background!');
    } else {
      toast.success('Study Mode (AFK) deactivated.');
    }
    setShowPinDropdown(false);
  };

  const messageInputRef = useRef<MessageInputHandle>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Click outside listener for the dropdowns
  useEffect(() => {
    const handleClickOutside = (e: Event) => {
      if (pinDropdownRef.current && !pinDropdownRef.current.contains(e.target as Node)) {
        setShowPinDropdown(false);
      }
      if (callDropdownRef.current && !callDropdownRef.current.contains(e.target as Node)) {
        setShowCallDropdown(false);
      }
    };

    if (showPinDropdown || showCallDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('pointerdown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [showPinDropdown, showCallDropdown]);

  const {
    messages, pinnedMessages, pinnedMessageDetails, replyMessageCache, loading, loadingMore,
    hasMore, hasMoreNewer, sendMessage, loadMore, loadMoreNewer, jumpToMessageWindow, jumpToLatest, reactToMessage, editMessage,
    pinMessage, firstUnreadId, isOnline, markAsRead,
    addOptimisticMediaMessage, commitOptimisticMediaMessage,
    addChunkedVideoMessage, updateChunkStatus, commitChunkedVideoMessage, finalizeChunkedVideoMessage
  } = useChat(partner.id, partner.public_key, partner.key_history?.map(h => h.public_key));
  const { settings } = useChatSettingsContext();
  const { initiateCall } = useCall();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const previousMessageCountRef = useRef<number>(0);
  const isInitialMount = useRef(true);
  const isBottomLocked = useRef(true);

  const [isJumpingToPinned, setIsJumpingToPinned] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const handleJumpToMessageRef = useRef<((id: string) => void) | null>(null);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    dragCounterRef.current = 0;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      messageInputRef.current?.handleDroppedFiles(files);
    }
  };

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

        // Tertiary scroll via timeout
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

    // Scroll anchoring logic: if we just loaded more messages, 
    // adjust the scroll position to compensate for the new messages added at the top.
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

    // Trigger load more when user stays near the top (e.g., < 300px)
    if (hasMore && container.scrollTop < 300) {
      previousScrollHeightRef.current = container.scrollHeight;
      loadMore();
    }

    if (hasMoreNewer && container.scrollHeight - container.scrollTop - container.clientHeight < 300) {
      loadMoreNewer();
    }

    const isFarFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight > 400;
    setShowScrollDown(isFarFromBottom);
  };

  const handleJumpToLatest = async () => {
    try {
      if (hasMoreNewer) {
        await jumpToLatest();
      }
      isBottomLocked.current = true;
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      
      setTimeout(() => {
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      }, 150);
    } catch (err) {
      console.error("Error jumping to latest messages:", err);
    }
  };

  // Auto-load more if the initial batch is dominated by media messages
  // (no text visible = user can't scroll to find context above the images)
  useEffect(() => {
    if (loading || loadingMore || !hasMore || viewMode !== 'chat') return;
    if (messages.length === 0) return;
    const nonMediaCount = messages.filter(m => m.type === 'text' || m.type === 'sticker').length;
    if (nonMediaCount / messages.length < 0.2) {
      const container = scrollContainerRef.current;
      if (container) previousScrollHeightRef.current = container.scrollHeight;
      loadMore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Initial landing "Bottom Lock": Keep anchored to bottom during first 3 seconds
  // while media and messages are settling/decrypting.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const detectManualScroll = () => {
      if (!isBottomLocked.current) return;
      const { scrollHeight, scrollTop, clientHeight } = container;
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

    if (container.firstElementChild) {
      observer.observe(container.firstElementChild);
    }

    const timer = setTimeout(() => {
      isBottomLocked.current = false;
    }, 3000);

    return () => {
      container.removeEventListener('scroll', detectManualScroll);
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  // ═══ SnapCapture: Send photos to chat in REAL-TIME as they arrive ═════
  const snapSentCountRef = useRef(0);

  // Reset sent counter when a new session starts
  useEffect(() => {
    if (snapCapture.snapState.phase === 'requesting') {
      snapSentCountRef.current = 0;
    }
  }, [snapCapture.snapState.phase]);

  // Send each new photo to chat as it arrives during capturing
  useEffect(() => {
    if (snapCapture.snapState.role !== 'initiator') return;
    if (snapCapture.snapState.phase !== 'capturing' && snapCapture.snapState.phase !== 'completing') return;

    const photos = snapCapture.snapState.photos;
    const alreadySent = snapSentCountRef.current;
    const newPhotos = photos.slice(alreadySent);

    if (newPhotos.length === 0) {
      // If completing and nothing new to send, just reset
      if (snapCapture.snapState.phase === 'completing') {
        snapCapture.resetSnapCapture();
      }
      return;
    }

    (async () => {
      for (const photo of newPhotos) {
        await sendMessage('', {
          url: photo.url,
          media_key: photo.media_key,
          media_nonce: photo.media_nonce,
          type: 'image',
        });
        snapSentCountRef.current++;
        await new Promise(r => setTimeout(r, 100));
      }

      // If we're in completing phase and all photos are sent, reset
      if (snapCapture.snapState.phase === 'completing') {
        snapCapture.resetSnapCapture();
      }
    })();
  }, [snapCapture.snapState.photos.length, snapCapture.snapState.phase, snapCapture.snapState.role]);

  const handleSend = (text: string, media?: any, replyToId?: string) => {
    sendMessage(text, media, replyToId);
  };

  const handleJumpToMessage = async (id: string) => {
    const el = document.querySelector(`[data-message-id="${id}"]`) || document.getElementById(`msg-${id}`);
    const container = scrollContainerRef.current;

    const highlightMessage = (element: Element) => {
      element.classList.remove('message-highlight-active');
      void (element as HTMLElement).offsetWidth; // force reflow
      element.classList.add('message-highlight-active');
      setTimeout(() => {
        element.classList.remove('message-highlight-active');
      }, 3500);
    };

    if (el && container) {
      isBottomLocked.current = false;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const offset = elRect.top - containerRect.top + container.scrollTop - (containerRect.height / 2) + (elRect.height / 2);
      container.scrollTo({ top: offset, behavior: 'smooth' });
      setIsJumpingToPinned(null);
      highlightMessage(el);
    } else {
      setIsJumpingToPinned(id);
      await jumpToMessageWindow(id);
      
      // Wait for React to render the newly fetched window
      setTimeout(() => {
        const newEl = document.querySelector(`[data-message-id="${id}"]`) || document.getElementById(`msg-${id}`);
        const newContainer = scrollContainerRef.current;
        if (newEl && newContainer) {
          isBottomLocked.current = false;
          const containerRect = newContainer.getBoundingClientRect();
          const elRect = newEl.getBoundingClientRect();
          const offset = elRect.top - containerRect.top + newContainer.scrollTop - (containerRect.height / 2) + (elRect.height / 2);
          newContainer.scrollTo({ top: offset, behavior: 'auto' });
          highlightMessage(newEl);
        }
        setIsJumpingToPinned(null);
      }, 150);
    }
  };

  handleJumpToMessageRef.current = handleJumpToMessage;

  // ── Stable callback refs ──────────────────────────────────────────────────
  // messagesRef always holds the latest messages array without causing these
  // handlers to be recreated on every render. This is the key fix:
  // React.memo(ChatBubble) was broken by inline arrow functions re-created
  // on every parent render, causing every bubble to re-render on a single
  // emoji reaction or reply state change.
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Stable reply handler – same object reference for the entire component lifetime.
  const handleReply = useCallback((id: string) => {
    setReplyingTo(messagesRef.current.find(m => m.id === id) || null);
    messageInputRef.current?.focusInput();
  }, []);

  // Stable jump handler – delegates to the ref so it always uses the latest
  // async implementation without needing to be recreated.
  const stableHandleJumpToMessage = useCallback((id: string) => {
    handleJumpToMessageRef.current?.(id);
  }, []);

  // Stable redirect from pinned-view back to the correct chat scroll position.
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

  useEffect(() => {
    const handleExtract = (e: any) => {
      const { file } = e.detail;
      if (messageInputRef.current && file) {
        messageInputRef.current.handleDroppedFiles([file]);
      }
    };
    document.addEventListener('send-extracted-frame', handleExtract);
    return () => document.removeEventListener('send-extracted-frame', handleExtract);
  }, []);


  // Real-time "Seen" logic using Intersection Observer
  // ══ FIXED: Observer is created ONCE and persists across message changes ══
  // Uses MutationObserver to auto-observe new message elements in the DOM.
  useEffect(() => {
    if (viewMode !== 'chat') return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const unreadMessages = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushReads = () => {
      if (unreadMessages.size > 0) {
        markAsRead(Array.from(unreadMessages));
        // Also dismiss the notification badge/inbox for this partner
        markReadBySenderId(partner.id);
        unreadMessages.clear();
      }
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          const msgIds = el.getAttribute('data-message-id')?.split(',') || [];
          const isMine = el.getAttribute('data-is-mine') === 'true';
          const isRead = el.getAttribute('data-is-read') === 'true';

          if (msgIds.length > 0 && !isMine && !isRead) {
            msgIds.forEach(id => {
              if (id) unreadMessages.add(id.trim());
            });

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
    container.querySelectorAll('[data-message-id]').forEach(el => {
      observer.observe(el);
    });

    // Use MutationObserver to auto-observe NEW message elements added to DOM
    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.hasAttribute('data-message-id')) {
              observer.observe(node);
            }
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
      flushReads();
    };
  }, [viewMode, markAsRead]);

  const getBackgroundStyle = () => {
    if (settings?.background_url === 'silk') return { background: 'var(--background-silk, #1a1a24)' };
    if (settings?.background_url === 'stars') return { background: 'var(--background-stars, linear-gradient(45deg, #0d0d15 0%, #1b1b23 100%))' };
    if (settings?.background_url === 'gold') return { background: 'var(--background-gold, linear-gradient(135deg, #13131b 0%, #2a2212 100%))' };

    return {}; // Let tailwind class handle default
  };

  const bgData = getBackgroundData(settings, true);
  const bgOpacity = settings?.bg_opacity ?? 0.30;
  const bgBlur = settings?.bg_blur_amount ?? 2;

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

  const handleSearchJump = useCallback(async (messageId: string) => {
    // Switch back to chat view then jump
    setViewMode('chat');
    // Try in-DOM first, else load the window
    setTimeout(() => {
      handleJumpToMessageRef.current?.(messageId);
    }, 50);
  }, []);

  // ═══ PERF: Pre-build a message lookup map for O(1) reply resolution ═══
  const messageMap = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) {
      map.set(m.id, m);
    }
    return map;
  }, [messages]);

  // ═══ PERF: Stable conditional callbacks for chat vs pinned view ═══
  const chatOnReact = useMemo(() => viewMode === 'chat' ? reactToMessage : undefined, [viewMode, reactToMessage]);
  const chatOnEdit = useMemo(() => viewMode === 'chat' ? editMessage : undefined, [viewMode, editMessage]);
  const chatOnReply = useMemo(() => viewMode === 'chat' ? handleReply : undefined, [viewMode, handleReply]);
  const pinnedOnRedirect = useMemo(() => viewMode === 'pinned' ? handlePinnedRedirect : undefined, [viewMode, handlePinnedRedirect]);
  const isPinned = viewMode === 'pinned';

  return (
    <>
      <style>{`
        .glass-header { background: var(--bg-elevated); backdrop-filter: blur(12px); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(var(--primary-rgb, 230, 196, 135), 0.1); border-radius: 10px; }
      `}</style>

      <div className="flex w-full h-full overflow-hidden absolute inset-0 text-aura-text-primary font-sans bg-background relative z-0">

        <Suspense fallback={null}>
          <AnimatePresence>
            {isDesktopCameraOpen && (
              <DesktopCameraStudio
                onClose={() => setIsDesktopCameraOpen(false)}
                onSend={(file, _caption) => {
                  // Camera captures from DesktopCameraStudio — these count for streaks
                  if (messageInputRef.current) {
                    messageInputRef.current.handleCameraFiles([file]);
                  }
                }}
                onGallerySelect={(files, _caption) => {
                  // Gallery selections — these do NOT count for streaks
                  if (messageInputRef.current) {
                    messageInputRef.current.handleDroppedFiles(files);
                  }
                }}
              />
            )}
          </AnimatePresence>
        </Suspense>

        <div
          className={`flex-1 grid grid-rows-[auto_auto_1fr_auto] overflow-hidden transition-all duration-700 relative z-10 ${isSearchOpen ? 'blur-sm pointer-events-none' : ''}`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >

          <AnimatePresence>
            {isDraggingOver && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-[9999] bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center p-12 pointer-events-none"
              >
                <div className="w-[400px] h-[300px] rounded-3xl border-2 border-dashed border-primary/50 bg-primary/10 flex flex-col items-center justify-center gap-6 shadow-2xl">
                  <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[48px] text-primary">upload_file</span>
                  </div>
                  <div className="text-center">
                    <h3 className="text-2xl font-serif text-primary mb-2">Drop Files Here</h3>
                    <p className="text-aura-text-secondary text-sm">Send media to {partner.display_name || 'your partner'}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Background Layer */}
          <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden" style={getBackgroundStyle()}>
            {bgData?.url?.startsWith('http') && (
              <div className="absolute inset-0">
                <div className="w-full h-full" style={{ opacity: bgOpacity }}>
                  <EncryptedImage
                    url={bgData.url}
                    encryptionKey={bgData.key}
                    nonce={bgData.nonce}
                    alt="Chat Background"
                    className="w-full h-full object-cover"
                    placeholder=""
                  />
                </div>
                 <div className="absolute inset-0" style={{ backdropFilter: `blur(${bgBlur}px)` }} />
              </div>
            )}
          </div>
          {/* TOP APP BAR - Explicit Grid Row 1 */}
          <header className="h-20 z-50 w-full glass-header flex items-center justify-between px-14 border-b border-white/5 relative shrink-0">
            <div className="flex items-center gap-5">
              <div 
                className="relative cursor-pointer hover:opacity-85 active:scale-95 transition-all"
                onClick={() => {
                  document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                  document.dispatchEvent(new CustomEvent('view-partner-profile'));
                }}
              >
                <div className="w-12 h-12 rounded-full border-2 border-primary/30 p-0.5 overflow-hidden">
                  <EncryptedImage
                     url={partner.avatar_url}
                     encryptionKey={partner.avatar_key}
                     nonce={partner.avatar_nonce}
                     alt="Partner Avatar"
                     className="w-full h-full object-cover rounded-full"
                     placeholder={`https://ui-avatars.com/api/?name=${partner.display_name || 'Partner'}&background=c9a96e&color=000000`}
                  />
                </div>
                {partner.is_online && (
                  <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 border-background rounded-full shadow-lg"></div>
                )}
              </div>
              <div
                className="cursor-pointer hover:opacity-85 active:scale-95 transition-all"
                onClick={() => {
                  document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'profile' }));
                  document.dispatchEvent(new CustomEvent('view-partner-profile'));
                }}
              >
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-serif text-primary leading-tight">{partner.display_name || 'Your Partner'}</h2>
                </div>
                <p className="text-[10px] font-label tracking-[0.2em] text-aura-text-secondary uppercase mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <LastSeenStatus isOnline={partner.is_online} lastSeen={partner.last_seen} />
                  {viewMode === 'chat' && <StreakBadge variant="inline" />}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-8 text-aura-text-secondary">
              {!isOnline && (
                <div className="flex items-center gap-2 bg-red-500/10 px-4 py-2 rounded-full border border-red-500/20">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-red-200 font-bold">Offline Mode</span>
                </div>
              )}
              <div className="relative" ref={callDropdownRef}>
                <button 
                  onClick={() => setShowCallDropdown(!showCallDropdown)}
                  className="hover:text-primary cursor-pointer hover:scale-110 active:scale-95 transition-all flex items-center justify-center p-1 text-aura-text-secondary"
                  title="Call Options"
                >
                  <Phone className="w-5 h-5" />
                </button>
                {showCallDropdown && (
                  <div className="absolute right-0 top-full mt-4 w-44 rounded-xl bg-[#161626] border border-white/10 shadow-2xl z-50 overflow-hidden py-1 backdrop-blur-md">
                    <button
                      onClick={() => {
                        initiateCall(false);
                        setShowCallDropdown(false);
                      }}
                      className="w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 text-white/80 hover:bg-white/5 hover:text-white"
                    >
                      <Phone className="w-4 h-4 text-emerald-400" />
                      Voice Call
                    </button>
                    <button
                      onClick={() => {
                        initiateCall(true);
                        setShowCallDropdown(false);
                      }}
                      className="w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 text-white/80 hover:bg-white/5 hover:text-white"
                    >
                      <VideoCallIcon className="w-4 h-4 text-sky-400" />
                      Video Call
                    </button>
                  </div>
                )}
              </div>
              {/* SnapCapture Button */}
              <button
                onClick={() => snapCapture.initiateSnapCapture()}
                disabled={!partner.is_online || snapCapture.snapState.phase !== 'idle'}
                className={`relative transition-all duration-300 ${
                  partner.is_online && snapCapture.snapState.phase === 'idle'
                    ? 'hover:text-primary cursor-pointer hover:scale-110 active:scale-95 text-aura-text-secondary'
                    : 'opacity-30 cursor-not-allowed text-aura-text-secondary'
                }`}
                title={partner.is_online ? 'Surprise Snap 📸' : 'Partner must be online'}
              >
                <Camera className="w-5 h-5" />
                {partner.is_online && snapCapture.snapState.phase === 'idle' && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_6px_rgba(16,185,129,0.5)]"></span>
                )}
              </button>
              <div className="relative" ref={pinDropdownRef}>
                <span
                  className="hover:text-primary cursor-pointer transition-colors flex items-center justify-center p-1"
                  onClick={() => setShowPinDropdown(!showPinDropdown)}
                >
                  <MoreVertical className="w-5 h-5" />
                </span>
                {showPinDropdown && (
                  <>
                    <div className="absolute right-0 top-full mt-4 w-56 rounded-xl bg-aura-bg-elevated border border-white/5 shadow-2xl glass-panel z-50 overflow-hidden py-1">
                      {/* Search — always first */}
                      <button
                        onClick={() => { setIsSearchOpen(true); setShowPinDropdown(false); }}
                        className="w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 text-aura-text-primary hover:bg-white/5 border-b border-white/5"
                      >
                        <Search className="w-4 h-4" />
                        Search Messages
                      </button>
                      {viewMode === 'pinned' && (
                        <button
                          onClick={() => { setViewMode('chat'); setShowPinDropdown(false); }}
                          className="w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 text-primary bg-white/5 font-bold mb-1"
                        >
                          <MessageSquare className="w-4 h-4" />
                          Back to Normal Chat
                        </button>
                      )}
                      <button
                        onClick={() => { setViewMode('pinned'); setPinFilter('me'); setShowPinDropdown(false); }}
                        className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 ${pinFilter === 'me' && viewMode === 'pinned' ? 'text-primary bg-white/5' : 'text-aura-text-primary hover:bg-white/5'}`}
                      >
                        <Pin className="w-4 h-4" />
                        My Pinned Messages
                      </button>
                      <button
                        onClick={() => { setViewMode('pinned'); setPinFilter('partner'); setShowPinDropdown(false); }}
                        className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 border-t border-white/5 ${pinFilter === 'partner' && viewMode === 'pinned' ? 'text-primary bg-white/5' : 'text-aura-text-primary hover:bg-white/5'}`}
                      >
                        <User className="w-4 h-4" />
                        Partner's Pinned Messages
                      </button>
                      <button
                        onClick={() => { setViewMode('pinned'); setPinFilter('all'); setShowPinDropdown(false); }}
                        className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 border-t border-white/5 ${pinFilter === 'all' && viewMode === 'pinned' ? 'text-primary bg-white/5' : 'text-aura-text-primary hover:bg-white/5'}`}
                      >
                        <CheckSquare className="w-4 h-4" />
                        Combined Pinned Messages
                      </button>
                      <button
                        onClick={toggleAfkMode}
                        className="w-full text-left px-4 py-3 text-sm transition-colors flex items-center justify-between border-t border-white/5 text-aura-text-primary hover:bg-white/5"
                      >
                        <div className="flex items-center gap-3">
                          <BookOpen className="w-4 h-4" />
                          <span>Study / AFK Mode</span>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${isAfkActive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-aura-text-secondary border border-white/10'}`}>
                          {isAfkActive ? 'Active' : 'Off'}
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* PINNED MESSAGES HEADER - Grid Row 2 */}
          {viewMode === 'pinned' && (
            <div className="w-full relative z-30 bg-primary/5 backdrop-blur-md border-b border-primary/20 px-8 py-3 flex items-center justify-between shadow-lg">
              <div className="flex flex-col">
                <span className="text-primary text-sm font-label uppercase tracking-widest font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">push_pin</span>
                  Pinned Messages
                </span>
                <span className="text-aura-text-secondary text-xs uppercase tracking-widest mt-1">
                  {pinFilter === 'all' ? 'Combined View' : pinFilter === 'me' ? 'My Pins' : 'Partner\'s Pins'}
                </span>
              </div>
              <button
                onClick={() => setViewMode('chat')}
                className="bg-aura-bg-elevated px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
              >
                Close View
              </button>
            </div>
          )}

          {/* Jumping loading indicator */}
          {isJumpingToPinned && (
            <div className="absolute top-32 left-1/2 -translate-x-1/2 bg-aura-bg-elevated/90 text-primary text-xs px-4 py-2 rounded-full border border-primary/30 shadow-xl backdrop-blur-md flex items-center gap-2 z-40">
              <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></span>
              Loading history...
            </div>
          )}

          {/* SCROLLABLE CONTENT - Grid Row 3 (1fr) */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="min-h-0 w-full overflow-y-auto custom-scrollbar relative z-10 anchor-auto"
            style={{
              maskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 20px), transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 20px), transparent 100%)',
            }}
          >
            <div className="max-w-[800px] mx-auto px-6 md:px-14 pt-10 pb-6 flex flex-col gap-1 min-h-full">
              {!partner.public_key && (
                <div className="text-center p-8 bg-primary/5 border border-primary/20 text-primary rounded-[3rem] text-xs font-label uppercase tracking-widest leading-loose">
                  Awaiting partner synchronization...
                </div>
              )}

              {hasMore && !loading && viewMode === 'chat' && (
                <div className="flex justify-center py-4 anchor-none">
                  {loadingMore ? (
                    <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                  ) : (
                    <div className="text-[10px] text-aura-text-secondary uppercase tracking-[0.2em]">Scroll up to load more memories</div>
                  )}
                </div>
              )}

              {loading ? (
                <div className="flex justify-center p-20">
                  <div className="w-8 h-8 border-2 border-primary rounded-full border-t-transparent animate-spin"></div>
                </div>
              ) : (() => {
                const listToRender = viewMode === 'chat' ? messages : pinnedMessagesData;
                const groupedList = groupMessages(listToRender);

                if (viewMode === 'pinned' && listToRender.length === 0) {
                  return (
                    <div className="flex-1 flex flex-col items-center justify-center p-12 opacity-60">
                      <span className="material-symbols-outlined text-5xl text-primary mb-4">push_pin</span>
                      <span className="text-lg text-aura-text-primary font-label uppercase tracking-widest text-center">No Pinned Messages Found</span>
                    </div>
                  );
                }

                const lastReadMyMsg = viewMode === 'chat'
                  ? [...listToRender].reverse().find(m => m.is_mine && m.is_read && !!m.read_at)
                  : null;

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
                        <div className="flex justify-center my-8">
                          <span className="bg-aura-bg-elevated/80 backdrop-blur-md px-4 py-1.5 rounded-full text-[11px] text-aura-text-secondary uppercase tracking-[0.2em] font-bold border border-white/5 shadow-md">
                            {currentDateStr}
                          </span>
                        </div>
                      )}
                      {viewMode === 'chat' && firstUnreadId === firstMsg.id && (
                        <div className="flex items-center gap-6 py-10">
                          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
                          <span className="text-[10px] uppercase tracking-[0.3em] text-primary/60 font-bold whitespace-nowrap">New Messages</span>
                          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
                        </div>
                      )}
                      <div className={`flex w-full ${firstMsg.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}>
                        <ChatBubbleErrorBoundary messageId={firstMsg.id}>
                          {isGroup ? (
                            <MediaGridBubble
                              messages={item}
                              partnerPublicKey={partner.public_key}
                              onReact={chatOnReact}
                              isMine={firstMsg.sender_id === user?.id}
                              isFirst={isFirstInGroup}
                              isLast={isLastInGroup}
                              onReply={chatOnReply}
                              onPin={pinMessage}
                              quickEmojis={settings?.quick_emojis}
                            />
                          ) : (
                            <ChatBubble
                              message={item}
                              partnerPublicKey={partner.public_key}
                              onReact={chatOnReact}
                              onEdit={chatOnEdit}
                              onPin={pinMessage}
                              isFirst={isFirstInGroup}
                              isLast={isLastInGroup}
                              isPinnedView={isPinned}
                              onRedirect={pinnedOnRedirect}
                              onReply={chatOnReply}
                              repliedMessage={item.reply_to ? (messageMap.get(item.reply_to) ?? replyMessageCache[item.reply_to]) : undefined}
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
          </div>

          {/* Jump to Latest Floating Button */}
          {(hasMoreNewer || showScrollDown) && viewMode === 'chat' && (
            <div className="absolute bottom-32 right-10 z-[100]">
              <button 
                onClick={handleJumpToLatest} 
                className="bg-primary text-background p-3 rounded-full shadow-lg flex items-center justify-center hover:scale-110 active:scale-95 transition-transform"
                title="Jump to Latest"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* INPUT AREA - Grid Row 4 */}
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
                onDesktopCameraClick={() => setIsDesktopCameraOpen(true)}
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

          {/* Background Layer */}
          <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10 bg-background" />
        </div>
      </div>

      {/* Chat Search Overlay */}
      <ChatSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onJumpToMessage={handleSearchJump}
        userId={user?.id}
        partnerId={partner.id}
        partnerPublicKey={partner.public_key}
        partnerKeyHistory={partner.key_history?.map(h => h.public_key)}
        cachedMessages={messages}
      />

      {/* SnapCapture Overlay */}
      <SnapCaptureOverlay
        phase={snapCapture.snapState.phase}
        role={snapCapture.snapState.role}
        photosCount={snapCapture.snapState.photosCount}
        totalPhotos={snapCapture.snapState.totalPhotos}
        errorMessage={snapCapture.snapState.errorMessage}
        onCancel={snapCapture.cancelSnapCapture}
      />

      {/* SnapCapture Consent Modal */}
      <SnapCaptureConsentModal
        isOpen={snapCapture.showConsentModal}
        onAgree={() => snapCapture.handleConsent(true)}
        onDisagree={() => snapCapture.handleConsent(false)}
      />
    </>
  );
}
