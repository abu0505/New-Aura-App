import { useAuth } from '../../contexts/AuthContext';
import DesktopChatScreen from './DesktopChatScreen';
import MobileChatScreen from './MobileChatScreen';
import type { PartnerProfile } from '../../hooks/usePartner';

interface ChatScreenProps {
  partner: PartnerProfile | null;
  isActive?: boolean;
}

export default function ChatScreen({ partner, isActive }: ChatScreenProps) {
  const { signOut } = useAuth();

  if (!partner) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-[#0d0d15] text-[#e4e1ed] p-8 text-center space-y-6">
        <span className="material-symbols-outlined text-6xl text-[#e6c487] opacity-50">diversity_2</span>
        <h2 className="font-serif italic text-2xl text-[#e6c487]">Awaiting Your Partner</h2>
        <p className="text-sm text-[#998f81]/60 max-w-sm">
          AURA is designed for two. Have your partner sign up on this instance to establish the connection and generate the end-to-end encryption keys.
        </p>
        <button 
          onClick={signOut}
          className="mt-8 px-6 py-2 border border-[#998f81]/20 rounded-full text-[10px] font-bold uppercase tracking-widest hover:text-[#e6c487] hover:border-[#e6c487] transition-all"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <div className="hidden lg:block h-full w-full">
        <DesktopChatScreen partner={partner} isActive={isActive} />
      </div>
      <div className="lg:hidden h-full w-full">
        <MobileChatScreen partner={partner} isActive={isActive} />
      </div>
    </div>
  );
}
