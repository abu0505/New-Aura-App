import { useAuth } from '../../contexts/AuthContext';
import DesktopChatScreen from './DesktopChatScreen';
import MobileChatScreen from './MobileChatScreen';
import type { PartnerProfile } from '../../hooks/usePartner';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';

interface ChatScreenProps {
  partner: PartnerProfile | null;
  isActive?: boolean;
}

export default function ChatScreen({ partner, isActive }: ChatScreenProps) {
  const { signOut } = useAuth();
  
  // We call useTypingIndicator here so it is only instantiated once. 
  // Calling it twice in both mobile/desktop screens leads to duplicated channel 
  // subscriptions and clobbers the 'typing' Realtime broadcast connection.
  const { partnerIsTyping, sendTypingEvent } = useTypingIndicator(partner?.id);

  if (!partner) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-[var(--bg-primary)] text-[#e4e1ed] p-8 text-center space-y-6">
        <span className="material-symbols-outlined text-6xl text-[var(--gold)] opacity-50">diversity_2</span>
        <h2 className="font-serif italic text-2xl text-[var(--gold)]">Awaiting Your Partner</h2>
        <p className="text-sm text-[#998f81]/60 max-w-sm">
          AURA is designed for two. Have your partner sign up on this instance to establish the connection and generate the end-to-end encryption keys.
        </p>
        <button 
          onClick={signOut}
          className="mt-8 px-6 py-2 border border-[#998f81]/20 rounded-full text-[10px] font-bold uppercase tracking-widest hover:text-[var(--gold)] hover:border-[var(--gold)] transition-all"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <div className="hidden lg:block h-full w-full">
        <DesktopChatScreen partner={partner} isActive={isActive} partnerIsTyping={partnerIsTyping} sendTypingEvent={sendTypingEvent} />
      </div>
      <div className="lg:hidden h-full w-full">
        <MobileChatScreen partner={partner} isActive={isActive} partnerIsTyping={partnerIsTyping} sendTypingEvent={sendTypingEvent} />
      </div>
    </div>
  );
}
