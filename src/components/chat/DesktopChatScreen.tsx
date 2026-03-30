import { useRef, useEffect } from 'react';
import { useChat } from '../../hooks/useChat';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useChatSettings } from '../../hooks/useChatSettings';
import type { PartnerProfile } from '../../hooks/usePartner';
import MessageInput from './MessageInput';
import ChatBubble from './ChatBubble';
import PinnedMessagesBanner from './PinnedMessagesBanner';
import TypingIndicator from './TypingIndicator';
import EncryptedImage from '../common/EncryptedImage';

export default function DesktopChatScreen({ partner }: { partner: PartnerProfile }) {
  const { partnerIsTyping, sendTypingEvent } = useTypingIndicator(partner.id);
  const { messages, pinnedMessages, loading, loadingMore, hasMore, sendMessage, loadMore, reactToMessage, editMessage, deleteMessage, pinMessage, firstUnreadId, isOnline } = useChat(partner.id, partner.public_key, partner.key_history?.map(h => h.public_key));
  const { settings } = useChatSettings();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const previousMessageCountRef = useRef<number>(0);
  const isInitialMount = useRef(true);

  useEffect(() => {
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
    if (hasNewMessage && (sentByMe || isNearBottom)) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }

    previousMessageCountRef.current = messages.length;
  }, [messages, loading]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container || loadingMore || !hasMore) return;

    // Trigger load more when user stays near the top (e.g., < 100px)
    if (container.scrollTop < 100) {
      previousScrollHeightRef.current = container.scrollHeight;
      loadMore();
    }
  };

  const handleSend = (text: string, media?: any) => {
    sendMessage(text, media);
  };

  const getBackgroundStyle = () => {
    if (settings?.background_url === 'silk') return { background: '#1a1a24' };
    if (settings?.background_url === 'stars') return { background: 'linear-gradient(45deg, #0d0d15 0%, #1b1b23 100%)' };
    if (settings?.background_url === 'gold') return { background: 'linear-gradient(135deg, #13131b 0%, #2a2212 100%)' };
    
    return { background: '#0d0d15' };
  };

  return (
    <>
      <style>{`
        .glass-header { background: rgba(13, 13, 21, 0.8); backdrop-filter: blur(20px); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(230, 196, 135, 0.1); border-radius: 10px; }
      `}</style>

      <div className="absolute inset-0 grid grid-rows-[auto_auto_1fr_auto] text-[#e4e1ed] font-sans overflow-hidden transition-all duration-700">
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
        {/* TOP APP BAR - Explicit Grid Row 1 */}
        <header className="h-24 z-50 w-full glass-header flex items-center justify-between px-10 border-b border-white/5 relative shrink-0">
          <div className="flex items-center gap-5">
            <div className="relative">
              <div className="w-12 h-12 rounded-full border-2 border-[#e6c487]/30 p-0.5 overflow-hidden">
                <EncryptedImage
                  url={partner.avatar_url}
                  encryptionKey={partner.avatar_key}
                  nonce={partner.avatar_nonce}
                  alt="Partner Avatar"
                  className="w-full h-full object-cover rounded-full"
                  placeholder={`https://ui-avatars.com/api/?name=${partner.display_name || 'Partner'}&background=c9a96e&color=13131b`}
                />
              </div>
              {partner.is_online && (
                <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 border-[#0d0d15] rounded-full shadow-lg"></div>
              )}
            </div>
            <div>
              <h2 className="text-xl font-serif italic text-[#e6c487] leading-tight">{partner.display_name || 'Your Partner'}</h2>
              <p className="text-[10px] font-label tracking-[0.2em] text-[#998f81] uppercase mt-0.5">
                {partner.is_online ? (partner.status_message || 'Online') : 'Offline'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-8 text-[#998f81]">
            {!isOnline && (
              <div className="flex items-center gap-2 bg-red-500/10 px-4 py-2 rounded-full border border-red-500/20">
                <span className="text-[10px] uppercase tracking-[0.2em] text-red-200 font-bold">Offline Sanctuary</span>
              </div>
            )}
            <span className="material-symbols-outlined text-2xl hover:text-[#e6c487] cursor-pointer transition-colors">call</span>
            <span className="material-symbols-outlined text-2xl hover:text-[#e6c487] cursor-pointer transition-colors">videocam</span>
            <span className="material-symbols-outlined text-2xl hover:text-[#e6c487] cursor-pointer transition-colors">more_vert</span>
          </div>
        </header>

        {/* PINNED MESSAGES - Grid Row 2 */}
        <div className="w-full relative z-30">
          <PinnedMessagesBanner
            pinnedMessages={pinnedMessages}
            messages={messages}
            onUnpin={pinMessage}
            onJumpToMessage={(id) => {
              const el = document.getElementById(`msg-${id}`);
              const container = scrollContainerRef.current;
              if (el && container) {
                const containerRect = container.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                const offset = elRect.top - containerRect.top + container.scrollTop - 100;
                container.scrollTo({ top: offset, behavior: 'smooth' });
              }
            }}
          />
        </div>

        {/* SCROLLABLE CONTENT - Grid Row 3 (1fr) */}
        <div 
          ref={scrollContainerRef} 
          onScroll={handleScroll}
          className="min-h-0 w-full overflow-y-auto custom-scrollbar relative z-10"
        >
          <div className="max-w-[800px] mx-auto px-6 md:px-10 py-10 flex flex-col gap-1 min-h-full">
            {!partner.public_key && (
              <div className="text-center p-8 bg-[#e6c487]/5 border border-[#e6c487]/20 text-[#e6c487] rounded-[3rem] text-xs font-label uppercase tracking-widest leading-loose">
                Awaiting partner synchronization...
              </div>
            )}

            {hasMore && !loading && (
              <div className="flex justify-center py-4">
                {loadingMore ? (
                  <div className="w-6 h-6 border-2 border-[#e6c487]/30 border-t-[#e6c487] rounded-full animate-spin"></div>
                ) : (
                  <div className="text-[10px] text-[#998f81] uppercase tracking-[0.2em]">Scroll up to load more memories</div>
                )}
              </div>
            )}

            {loading ? (
              <div className="flex justify-center p-20">
                <div className="w-8 h-8 border-2 border-[#e6c487] rounded-full border-t-transparent animate-spin"></div>
              </div>
            ) : messages.map((msg, index) => {
              const isFirstInGroup = index === 0 || messages[index - 1].sender_id !== msg.sender_id;
              const isLastInGroup = index === messages.length - 1 || messages[index + 1].sender_id !== msg.sender_id;
              
              return (
                <div key={msg.id} id={`msg-${msg.id}`} className="flex flex-col gap-1 w-full">
                  {firstUnreadId === msg.id && (
                    <div className="flex items-center gap-6 py-10">
                      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#e6c487]/20 to-transparent" />
                      <span className="text-[10px] uppercase tracking-[0.3em] text-[#e6c487]/60 font-bold whitespace-nowrap">New Sanctuary Messages</span>
                      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#e6c487]/20 to-transparent" />
                    </div>
                  )}
                  <ChatBubble
                    message={msg}
                    partnerPublicKey={partner.public_key}
                    onReact={reactToMessage}
                    onEdit={editMessage}
                    onDelete={deleteMessage}
                    onPin={pinMessage}
                    isFirst={isFirstInGroup}
                    isLast={isLastInGroup}
                  />
                </div>
              );
            })}
            {partnerIsTyping && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* INPUT AREA - Grid Row 4 */}
        <div className="w-full bg-[#0d0d15] relative z-20">
          <MessageInput onSend={handleSend} onTyping={sendTypingEvent} disabled={!partner.public_key} />
        </div>

        {/* Background Layer */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 bg-[#0d0d15]" />
      </div>
    </>
  );
}
