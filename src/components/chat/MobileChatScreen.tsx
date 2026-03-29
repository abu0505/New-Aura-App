import { useRef, useEffect } from 'react'; 
import { useChat } from '../../hooks/useChat';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useChatSettings } from '../../hooks/useChatSettings';
import type { PartnerProfile } from '../../hooks/usePartner';
import MessageInput from './MessageInput';
import ChatBubble from './ChatBubble';
import PinnedMessagesBanner from './PinnedMessagesBanner';
import TypingIndicator from './TypingIndicator';
import EncryptedImage from '../common/EncryptedImage';

export default function MobileChatScreen({ partner }: { partner: PartnerProfile }) {
  useOnlineStatus();
  const { partnerIsTyping, sendTypingEvent } = useTypingIndicator(partner.id);
  const { messages, pinnedMessages, loading, sendMessage, reactToMessage, editMessage, deleteMessage, pinMessage, firstUnreadId, isOnline } = useChat(partner.id, partner.public_key, partner.key_history?.map(h => h.public_key));
  const { settings } = useChatSettings();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (isInitialMount.current) {
      messagesEndRef.current?.scrollIntoView();
      if (messages.length > 0) isInitialMount.current = false;
      return;
    }

    const { scrollHeight, scrollTop, clientHeight } = container;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 250;

    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

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
            <div className="flex flex-col">
              <span className="font-serif italic text-lg text-[#e6c487] leading-tight">{partner.display_name || 'Your Partner'}</span>
              <span className="text-[10px] font-label uppercase tracking-widest text-[#998f81]">
                {partner.is_online ? 'Online' : 'Offline'}
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
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col relative overflow-hidden">
          
          <PinnedMessagesBanner 
            pinnedMessages={pinnedMessages} 
            messages={messages} 
            onUnpin={pinMessage} 
            onJumpToMessage={(id) => {
              const el = document.getElementById(`msg-${id}`);
              const container = scrollContainerRef.current;
              if (el && container) {
                // Direct scroll calculation relative to the message list container
                const containerRect = container.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                const offset = elRect.top - containerRect.top + container.scrollTop - 80;
                container.scrollTo({ top: offset, behavior: 'smooth' });
              }
            }}
          />

          {/* Message List */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-6 custom-scrollbar pb-12">
            {!partner.public_key && (
              <div className="text-center p-6 bg-[#e6c487]/5 border border-[#e6c487]/20 text-[#e6c487] rounded-[2rem] text-[10px] font-label uppercase tracking-widest leading-loose shadow-xl">
                Establishing Sanctuary Connection...<br/>Generating Encryption Keys.
              </div>
            )}

            {loading ? (
              <div className="flex justify-center p-12">
                 <div className="w-6 h-6 border-2 border-[#e6c487] rounded-full border-t-transparent animate-spin"></div>
              </div>
            ) : messages.map((msg) => (
              <div key={msg.id} id={`msg-${msg.id}`} className="flex flex-col gap-6">
                {firstUnreadId === msg.id && (
                  <div className="flex items-center gap-4 py-6">
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#e6c487]/20 to-transparent" />
                    <span className="text-[10px] uppercase tracking-[0.2em] text-[#e6c487]/60 font-bold">New Messages</span>
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
                />
              </div>
            ))}
            {partnerIsTyping && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input Bar */}
          <div className="shrink-0 w-full relative z-20">
            <MessageInput onSend={handleSend} onTyping={sendTypingEvent} disabled={!partner.public_key} />
          </div>
        </main>
      </div>
    </>
  );
}
