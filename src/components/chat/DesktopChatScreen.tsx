import { useRef, useEffect, useState, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useChat } from '../../hooks/useChat';
import type { ChatMessage } from '../../hooks/useChat';
import { useChatSettings } from '../../hooks/useChatSettings';
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
import DesktopCameraStudio from './DesktopCameraStudio';
import { LastSeenStatus } from './LastSeenStatus';
import { useTabNotification } from '../../hooks/useTabNotification';



interface DesktopChatScreenProps {
  partner: PartnerProfile;
  isActive?: boolean;
  partnerIsTyping: boolean;
  sendTypingEvent: (isTyping: boolean) => void;
}

export default function DesktopChatScreen({ partner, isActive, partnerIsTyping, sendTypingEvent }: DesktopChatScreenProps) {
  const { user } = useAuth();
  const [pinFilter, setPinFilter] = useState<'all' | 'me' | 'partner'>('all');
  const [viewMode, setViewMode] = useState<'chat' | 'pinned'>('chat');
  const [showPinDropdown, setShowPinDropdown] = useState(false);
  const pinDropdownRef = useRef<HTMLDivElement>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [isDesktopCameraOpen, setIsDesktopCameraOpen] = useState(false);

  const messageInputRef = useRef<MessageInputHandle>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

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

  // ── Browser Tab Notification Badge (Desktop only) ──
  // Shows "(3) AURA" / "(9+) AURA" in the tab when there are unread messages.
  // Resets to "AURA" as soon as messages are read via the IntersectionObserver below.
  useTabNotification(messages);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const isBottomLocked = useRef(true);

  const [isJumpingToPinned, setIsJumpingToPinned] = useState<string | null>(null);
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


  const handleSend = (text: string, media?: any, replyToId?: string) => {
    sendMessage(text, media, replyToId);
  };

  const handleJumpToMessage = async (id: string) => {
    const index = groupedList.findIndex(item => {
      if (isMessageGroup(item)) return item.some(m => m.id === id);
      return item.id === id;
    });

    if (index !== -1 && virtuosoRef.current) {
      isBottomLocked.current = false;
      virtuosoRef.current.scrollToIndex({ index, align: 'center', behavior: 'smooth' });
      setIsJumpingToPinned(null);
    } else {
      setIsJumpingToPinned(id);
      await jumpToMessageWindow(id);
      
      setTimeout(() => {
        const newIndex = groupMessages(viewMode === 'chat' ? messages : pinnedMessagesData).findIndex(item => {
          if (isMessageGroup(item)) return item.some(m => m.id === id);
          return item.id === id;
        });
        if (newIndex !== -1 && virtuosoRef.current) {
          isBottomLocked.current = false;
          virtuosoRef.current.scrollToIndex({ index: newIndex, align: 'center', behavior: 'auto' });
        }
        setIsJumpingToPinned(null);
      }, 150);
    }
  };

  handleJumpToMessageRef.current = handleJumpToMessage;

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
  useEffect(() => {
    if (viewMode !== 'chat') return;

    const unreadMessages = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushReads = () => {
      if (unreadMessages.size > 0) {
        markAsRead(Array.from(unreadMessages));
        unreadMessages.clear();
      }
    };

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
      root: null,
      threshold: 0.1,
    });

    // Observe all existing message elements
    document.querySelectorAll('[data-message-id]').forEach(el => {
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

    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      if (flushTimer) clearTimeout(flushTimer);
      flushReads();
    };
  }, [viewMode, markAsRead]);

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

  const groupedList = useMemo(() => groupMessages(listToRender), [listToRender]);

  const lastReadMyMsg = useMemo(() =>
    viewMode === 'chat'
      ? [...listToRender].reverse().find(m => m.is_mine && m.is_read && !!m.read_at) ?? null
      : null
  , [listToRender, viewMode]);

  const renderItem = (index: number) => {
    const item = groupedList[index];
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
      <div key={isGroup ? `group-${firstMsg.id}` : firstMsg.id} id={viewMode === 'chat' ? `msg-${firstMsg.id}` : `pinned-${firstMsg.id}`} className="flex flex-col gap-1 w-full message-row max-w-[800px] mx-auto">
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
            <span className="text-[10px] uppercase tracking-[0.3em] text-primary/60 font-bold whitespace-nowrap">New Sanctuary Messages</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
          </div>
        )}
        <div className={`flex w-full ${firstMsg.sender_id === user?.id || viewMode === 'pinned' ? 'justify-end' : 'justify-start'}`}>
          <ChatBubbleErrorBoundary messageId={firstMsg.id}>
            {isGroup ? (
              <MediaGridBubble
                messages={item}
                partnerPublicKey={partner.public_key}
                isMine={firstMsg.sender_id === user?.id}
                isFirst={isFirstInGroup}
                isLast={isLastInGroup}
                onReply={viewMode === 'chat' ? (id: string) => {
                  setReplyingTo(messages.find(m => m.id === id) || null);
                  messageInputRef.current?.focusInput();
                } : undefined}
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
                onRedirect={viewMode === 'pinned' ? (id) => {
                  setViewMode('chat');
                  handleJumpToMessage(id);
                } : undefined}
                onReply={viewMode === 'chat' ? (id: string) => {
                  setReplyingTo(messages.find(m => m.id === id) || null);
                  messageInputRef.current?.focusInput();
                } : undefined}
                repliedMessage={item.reply_to ? (messages.find(m => m.id === item.reply_to) ?? replyMessageCache[item.reply_to]) : undefined}
                onJumpToMessage={handleJumpToMessage}
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
  };

  const getBackgroundStyle = () => {
    if (settings?.background_url === 'silk') return { background: 'var(--background-silk, #1a1a24)' };
    if (settings?.background_url === 'stars') return { background: 'var(--background-stars, linear-gradient(45deg, #0d0d15 0%, #1b1b23 100%))' };
    if (settings?.background_url === 'gold') return { background: 'var(--background-gold, linear-gradient(135deg, #13131b 0%, #2a2212 100%))' };

    return {}; // Let tailwind class handle default
  };



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

        <AnimatePresence>
          {isDesktopCameraOpen && (
            <DesktopCameraStudio
              onClose={() => setIsDesktopCameraOpen(false)}
              onSend={(file, _caption) => {
                // Manually trigger the high-quality upload workflow via MessageInput's handleDroppedFiles
                // since they share the same media process. Alternatively, just call the media handler.
                // handleDroppedFiles natively handles video/image by opening the Quality choice modal,
                // but since DesktopStudio ALREADY showed a preview and caption, we might want to bypass QualityChoice
                // or just trigger handleDroppedFiles and let it show Quality choice. 
                // We'll let handleDroppedFiles trigger the Quality choice for consistency.
                if (messageInputRef.current) {
                  // Hack: attach caption to file if possible or just rely on the modal
                  // The QualityChoiceModal handles captions. So we just pass the file.
                  messageInputRef.current.handleDroppedFiles([file]);
                }
              }}
              onGallerySelect={(files, _caption) => {
                if (messageInputRef.current) {
                  messageInputRef.current.handleDroppedFiles(files);
                }
              }}
            />
          )}
        </AnimatePresence>

        <div
          className="flex-1 grid grid-rows-[auto_auto_1fr_auto] overflow-hidden transition-all duration-700 relative z-10"
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
          {/* TOP APP BAR - Explicit Grid Row 1 */}
          <header className="h-24 z-50 w-full glass-header flex items-center justify-between px-10 border-b border-white/5 relative shrink-0">
            <div className="flex items-center gap-5">
              <div className="relative">
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
              <div>
                <h2 className="text-xl font-serif text-primary leading-tight">{partner.display_name || 'Your Partner'}</h2>
                <p className="text-[10px] font-label tracking-[0.2em] text-aura-text-secondary uppercase mt-0.5">
                  <LastSeenStatus isOnline={partner.is_online} lastSeen={partner.last_seen} />
                </p>
              </div>
            </div>
            <div className="flex items-center gap-8 text-aura-text-secondary">
              {!isOnline && (
                <div className="flex items-center gap-2 bg-red-500/10 px-4 py-2 rounded-full border border-red-500/20">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-red-200 font-bold">Offline Sanctuary</span>
                </div>
              )}
              <span className="material-symbols-outlined text-2xl hover:text-primary cursor-pointer transition-colors">call</span>
              <span className="material-symbols-outlined text-2xl hover:text-primary cursor-pointer transition-colors">videocam</span>
              <div className="relative" ref={pinDropdownRef}>
                <span
                  className="material-symbols-outlined text-2xl hover:text-primary cursor-pointer transition-colors"
                  onClick={() => setShowPinDropdown(!showPinDropdown)}
                >
                  more_vert
                </span>
                {showPinDropdown && (
                  <>
                    <div className="absolute right-0 top-full mt-4 w-56 rounded-xl bg-aura-bg-elevated border border-white/5 shadow-2xl glass-panel z-50 overflow-hidden py-1">
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

          {/* SCROLLABLE CONTENT - Virtualized */}
          <div
            className="min-h-0 w-full relative z-10"
            style={{
              maskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 60px), transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 60px), transparent 100%)',
            }}
          >
            {!partner.public_key && (
              <div className="absolute inset-0 flex items-center justify-center z-10 px-6">
                <div className="text-center p-8 bg-primary/5 border border-primary/20 text-primary rounded-[3rem] text-xs font-label uppercase tracking-widest leading-loose shadow-xl">
                  Awaiting partner synchronization...
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex justify-center p-20">
                <div className="w-8 h-8 border-2 border-primary rounded-full border-t-transparent animate-spin"></div>
              </div>
            ) : viewMode === 'pinned' && groupedList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-12 opacity-60">
                <span className="material-symbols-outlined text-5xl text-primary mb-4">push_pin</span>
                <span className="text-lg text-aura-text-primary font-label uppercase tracking-widest text-center">No Pinned Messages Found</span>
              </div>
            ) : (
              <Virtuoso
                ref={virtuosoRef}
                style={{ height: '100%' }}
                className="custom-scrollbar"
                data={groupedList}
                initialTopMostItemIndex={groupedList.length > 0 ? groupedList.length - 1 : 0}
                followOutput={(isAtBottom) => {
                  const lastMsg = messages[messages.length - 1];
                  if (lastMsg?.is_mine) return 'smooth';
                  return isAtBottom ? 'smooth' : false;
                }}
                atTopStateChange={(atTop) => {
                  if (atTop && hasMore && !loadingMore && viewMode === 'chat') {
                    loadMore();
                  }
                }}
                atBottomStateChange={(atBottom) => {
                  if (atBottom && hasMoreNewer && viewMode === 'chat') {
                    loadMoreNewer();
                  }
                }}
                components={{
                  Header: () => hasMore && viewMode === 'chat' ? (
                    <div className="flex justify-center py-6">
                      {loadingMore
                        ? <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        : <div className="text-[10px] text-aura-text-secondary uppercase tracking-[0.2em] opacity-60 font-bold">Scroll up for older memories</div>
                      }
                    </div>
                  ) : <div className="pt-10" />,
                  Footer: () => (
                    <div className="pb-32 px-6 md:px-10">
                      {partnerIsTyping && viewMode === 'chat' && <TypingIndicator />}
                    </div>
                  ),
                }}
                increaseViewportBy={{ top: 800, bottom: 800 }}
                itemContent={(index) => (
                  <div className="px-6 md:px-10 py-1">
                    {renderItem(index)}
                  </div>
                )}
              />
            )}
          </div>

          {/* Jump to Latest Floating Button */}
          {hasMoreNewer && viewMode === 'chat' && (
            <div className="absolute bottom-32 right-10 z-[100]">
              <button 
                onClick={jumpToLatest} 
                className="bg-primary text-background px-4 py-2 rounded-full shadow-lg font-bold text-sm flex items-center gap-2 hover:scale-105 transition-transform"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                Jump to Latest
              </button>
            </div>
          )}

          {/* INPUT AREA - Grid Row 4 */}
          {viewMode === 'chat' && (
            <div className="w-full bg-background relative z-20">
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
    </>
  );
}
