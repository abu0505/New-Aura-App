import { useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react'; 
import { useChat } from '../../hooks/useChat';
import type { ChatMessage } from '../../hooks/useChat';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useChatSettings } from '../../hooks/useChatSettings';
import { useAuth } from '../../contexts/AuthContext';
import type { PartnerProfile } from '../../hooks/usePartner';
import MessageInput from './MessageInput';
import ChatBubble from './ChatBubble';
// PinnedMessagesBanner imported later if needed, but removed here
import TypingIndicator from './TypingIndicator';
import EncryptedImage from '../common/EncryptedImage';

export default function MobileChatScreen({ partner }: { partner: PartnerProfile }) {
  const { user } = useAuth();
  const [pinFilter, setPinFilter] = useState<'all' | 'me' | 'partner'>('all');
  const [viewMode, setViewMode] = useState<'chat' | 'pinned'>('chat');
  const [showPinDropdown, setShowPinDropdown] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

  const { partnerIsTyping, sendTypingEvent } = useTypingIndicator(partner.id);
  const { messages, pinnedMessages, pinnedMessageDetails, loading, loadingMore, hasMore, sendMessage, loadMore, reactToMessage, editMessage, deleteMessage, pinMessage, firstUnreadId, isOnline } = useChat(partner.id, partner.public_key, partner.key_history?.map(h => h.public_key));
  const { settings } = useChatSettings();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const previousMessageCountRef = useRef<number>(0);
  const isInitialMount = useRef(true);
  
  const [isJumpingToPinned, setIsJumpingToPinned] = useState<string | null>(null);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (isInitialMount.current) {
      if (!loading && messages.length > 0) {
        container.scrollTop = container.scrollHeight;
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
    if (hasNewMessage && (sentByMe || isNearBottom)) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }

    previousMessageCountRef.current = messages.length;
  }, [messages, loading]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container || loadingMore || !hasMore) return;

    if (container.scrollTop < 100) {
      previousScrollHeightRef.current = container.scrollHeight;
      loadMore();
    }
  };

  const handleSend = (text: string, media?: any, replyToId?: string) => {
    sendMessage(text, media, replyToId);
  };

  const handleJumpToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setIsJumpingToPinned(null);
    } else {
      if (hasMore && !loadingMore) {
        setIsJumpingToPinned(id);
        const container = scrollContainerRef.current;
        if (container) {
          previousScrollHeightRef.current = container.scrollHeight;
        }
        loadMore();
      }
    }
  };

  useEffect(() => {
    if (isJumpingToPinned && !loadingMore) {
      const el = document.getElementById(`msg-${isJumpingToPinned}`);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
        setIsJumpingToPinned(null);
      } else if (hasMore) {
        const container = scrollContainerRef.current;
        if (container) {
          previousScrollHeightRef.current = container.scrollHeight;
        }
        loadMore();
      } else {
        setIsJumpingToPinned(null);
      }
    }
  }, [messages.length, loadingMore, isJumpingToPinned, hasMore, loadMore]);

  const getBackgroundStyle = () => {
    if (settings?.background_url === 'silk') return { background: '#1a1a24' };
    if (settings?.background_url === 'stars') return { background: 'linear-gradient(45deg, #0d0d15 0%, #1b1b23 100%)' };
    if (settings?.background_url === 'gold') return { background: 'linear-gradient(135deg, #13131b 0%, #2a2212 100%)' };
    
    return { background: '#0d0d15' };
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

  return (
    <>
      <style>{`
        .glass-header { background: rgba(13, 13, 21, 0.8); backdrop-filter: blur(20px); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(230, 196, 135, 0.2); border-radius: 10px; }
      `}</style>
      
      <div 
        className="flex flex-col h-screen w-full relative overflow-hidden text-[#e4e1ed] font-sans transition-all duration-700"
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
              <div className="absolute inset-0 bg-[#0d0d15]/60 backdrop-blur-[2px]" />
            </div>
          )}
        </div>
        {/* TopAppBar */}
        <header className="shrink-0 sticky top-0 z-50 w-full glass-header flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => document.dispatchEvent(new CustomEvent('toggle-nav'))} 
              className="text-[#998f81] hover:text-[#e6c487] transition-colors active:scale-90 mr-1 flex items-center justify-center p-2 rounded-full"
            >
              <span className="material-symbols-outlined text-xl">arrow_back</span>
            </button>
            <div className="relative">
              <div className="w-10 h-10 rounded-full border-2 border-[#e6c487]/30 overflow-hidden bg-[#1b1b23]">
                <EncryptedImage
                  url={partner.avatar_url}
                  encryptionKey={partner.avatar_key}
                  nonce={partner.avatar_nonce}
                  alt="Partner Avatar"
                  className="w-full h-full object-cover"
                  placeholder={`https://ui-avatars.com/api/?name=${partner.display_name || 'Partner'}&background=c9a96e&color=13131b`}
                />
              </div>
              {partner.is_online && (
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#0d0d15]"></div>
              )}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-serif italic text-lg text-[#e6c487] leading-tight truncate">{partner.display_name || 'Your Partner'}</span>
              <span className="text-[10px] font-label uppercase tracking-widest text-[#998f81] truncate">
                {partner.is_online ? (partner.status_message || 'Online') : 'Offline'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[#998f81]">
            {!isOnline && (
              <div className="flex items-center gap-1.5 bg-red-500/10 px-3 py-1.5 rounded-full border border-red-500/20 mr-2">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                <span className="text-[9px] uppercase tracking-widest text-red-200 font-bold">Offline</span>
              </div>
            )}
            <button className="hover:text-[#e6c487] transition-colors active:scale-90">
              <span className="material-symbols-outlined">call</span>
            </button>
            <button className="hover:text-[#e6c487] transition-colors active:scale-90">
              <span className="material-symbols-outlined">videocam</span>
            </button>
            
            <div className="relative">
              <button 
                onClick={() => setShowPinDropdown(!showPinDropdown)}
                className="hover:text-[#e6c487] transition-colors active:scale-90 flex items-center justify-center p-1 -m-1"
              >
                <span className="material-symbols-outlined">more_vert</span>
              </button>
              
              {showPinDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowPinDropdown(false)} />
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-[#292932] border border-white/5 shadow-xl glass-panel z-50 overflow-hidden py-1">
                    {viewMode === 'pinned' && (
                      <button 
                        onClick={() => { setViewMode('chat'); setShowPinDropdown(false); }}
                        className="w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 text-[#e6c487] bg-white/5 font-bold mb-1"
                      >
                        <span className="material-symbols-outlined text-[18px]">forum</span>
                        Back to Normal Chat
                      </button>
                    )}
                    <button 
                      onClick={() => { setViewMode('pinned'); setPinFilter('me'); setShowPinDropdown(false); }}
                      className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 ${pinFilter === 'me' && viewMode === 'pinned' ? 'text-[#e6c487] bg-white/5' : 'text-[#e4e1ed] hover:bg-white/5'}`}
                    >
                      <span className="material-symbols-outlined text-[18px]">push_pin</span>
                      My Pinned Messages
                    </button>
                    <button 
                      onClick={() => { setViewMode('pinned'); setPinFilter('partner'); setShowPinDropdown(false); }}
                      className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 border-t border-white/5 ${pinFilter === 'partner' && viewMode === 'pinned' ? 'text-[#e6c487] bg-white/5' : 'text-[#e4e1ed] hover:bg-white/5'}`}
                    >
                      <span className="material-symbols-outlined text-[18px]">person</span>
                      Partner's Pinned Messages
                    </button>
                    <button 
                      onClick={() => { setViewMode('pinned'); setPinFilter('all'); setShowPinDropdown(false); }}
                      className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 border-t border-white/5 ${pinFilter === 'all' && viewMode === 'pinned' ? 'text-[#e6c487] bg-white/5' : 'text-[#e4e1ed] hover:bg-white/5'}`}
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
            <div className="bg-[#e6c487]/10 backdrop-blur-md border-b border-[#e6c487]/20 px-4 py-3 flex items-center justify-between shadow-lg z-30 relative shrink-0">
               <div className="flex flex-col">
                  <span className="text-[#e6c487] text-xs font-label uppercase tracking-widest font-bold flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">push_pin</span>
                    Pinned Messages
                  </span>
                  <span className="text-[#998f81] text-[10px] uppercase tracking-widest mt-0.5">
                     {pinFilter === 'all' ? 'Combined View' : pinFilter === 'me' ? 'My Pins' : 'Partner\'s Pins'}
                  </span>
               </div>
               <button 
                 onClick={() => setViewMode('chat')}
                 className="bg-[#292932] px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest text-[#e6c487] border border-[#e6c487]/30 hover:bg-[#e6c487]/20 transition-colors"
               >
                 Close
               </button>
            </div>
          )}
          
          {/* Jumping loading indicator */}
          {isJumpingToPinned && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-[#292932]/90 text-[#e6c487] text-xs px-4 py-2 rounded-full border border-[#e6c487]/30 shadow-xl backdrop-blur-md flex items-center gap-2 z-40">
              <span className="w-3 h-3 border-2 border-[#e6c487]/30 border-t-[#e6c487] rounded-full animate-spin"></span>
              Loading history...
            </div>
          )}

          {/* Message List */}
          <div 
            ref={scrollContainerRef} 
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6 flex flex-col gap-1 custom-scrollbar pb-12 anchor-auto"
          >
            {hasMore && !loading && viewMode === 'chat' && (
              <div className="flex justify-center py-4 anchor-none">
                {loadingMore ? (
                  <div className="w-5 h-5 border-2 border-[#e6c487]/30 border-t-[#e6c487] rounded-full animate-spin"></div>
                ) : (
                  <div className="text-[9px] text-[#998f81] uppercase tracking-[0.2em] opacity-60 font-bold">Scroll up for older memories</div>
                )}
              </div>
            )}

            {!partner.public_key && (
              <div className="text-center p-6 bg-[#e6c487]/5 border border-[#e6c487]/20 text-[#e6c487] rounded-[2rem] text-[10px] font-label uppercase tracking-widest leading-loose shadow-xl">
                Establishing Sanctuary Connection...<br/>Generating Encryption Keys.
              </div>
            )}

            {loading ? (
              <div className="flex justify-center p-12">
                 <div className="w-6 h-6 border-2 border-[#e6c487] rounded-full border-t-transparent animate-spin"></div>
              </div>
            ) : (() => {
              const listToRender = viewMode === 'chat' ? messages : pinnedMessagesData;
              
              if (viewMode === 'pinned' && listToRender.length === 0) {
                return (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 opacity-60">
                    <span className="material-symbols-outlined text-4xl text-[#e6c487] mb-2">push_pin</span>
                    <span className="text-sm text-[#e4e1ed] font-label uppercase tracking-widest text-center">No Pinned Messages Found</span>
                  </div>
                );
              }

              return listToRender.map((msg, index) => {
                const currentDateStr = new Date(msg.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
                const previousMsg = index > 0 ? listToRender[index - 1] : null;
                const previousDateStr = previousMsg ? new Date(previousMsg.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
                
                const showDateSeparator = currentDateStr !== previousDateStr;
                const isFirstInGroup = index === 0 || previousMsg?.sender_id !== msg.sender_id || showDateSeparator;
                
                // For last in group, we also check if the next message has a different date
                const nextMsg = index < listToRender.length - 1 ? listToRender[index + 1] : null;
                const nextDateStr = nextMsg ? new Date(nextMsg.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
                const isLastInGroup = index === listToRender.length - 1 || nextMsg?.sender_id !== msg.sender_id || nextDateStr !== currentDateStr;

                return (
                  <div key={msg.id} id={viewMode === 'chat' ? `msg-${msg.id}` : `pinned-${msg.id}`} className="flex flex-col gap-1 w-full">
                    {showDateSeparator && (
                      <div className="flex justify-center my-6">
                        <span className="bg-[#292932]/80 backdrop-blur-md px-3 py-1 rounded-full text-[10px] text-[#998f81] uppercase tracking-[0.2em] font-bold border border-white/5 shadow-md">
                          {currentDateStr}
                        </span>
                      </div>
                    )}
                    {viewMode === 'chat' && firstUnreadId === msg.id && (
                      <div className="flex items-center gap-4 py-6">
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#e6c487]/20 to-transparent" />
                        <span className="text-[10px] uppercase tracking-[0.2em] text-[#e6c487]/60 font-bold">New Messages</span>
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#e6c487]/20 to-transparent" />
                      </div>
                    )}
                    <div className={`flex w-full ${msg.sender_id === user?.id || viewMode === 'pinned' ? 'justify-end' : 'justify-start'}`}>
                      <ChatBubble 
                        message={msg} 
                        partnerPublicKey={msg.sender_id === user?.id ? partner.public_key : null}
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
                        onReply={viewMode === 'chat' ? (id: string) => setReplyingTo(messages.find(m => m.id === id) || null) : undefined}
                        repliedMessage={msg.reply_to ? messages.find(m => m.id === msg.reply_to) : undefined}
                        onJumpToMessage={handleJumpToMessage}
                      />
                    </div>
                  </div>
                );
              });
            })()}
            {partnerIsTyping && viewMode === 'chat' && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input Bar */}
          {viewMode === 'chat' && (
            <div className="shrink-0 w-full relative z-20">
              <MessageInput 
                onSend={handleSend} 
                onTyping={sendTypingEvent} 
                disabled={!partner.public_key} 
                replyingTo={replyingTo}
                onCancelReply={() => setReplyingTo(null)}
              />
            </div>
          )}
        </main>
      </div>
    </>
  );
}
