import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { partner } = usePartner();

  return (
    <div className="h-full w-full bg-[#0d0d15] overflow-y-auto font-sans pb-32 lg:pb-12">
      {/* Hero Section */}
      <section className="relative px-8 pt-20 pb-16 lg:pt-32 lg:pb-24 border-b border-white/5 bg-gradient-to-b from-[#1b1b23]/50 to-transparent">
        <div className="max-w-4xl mx-auto flex flex-col lg:flex-row items-center gap-12">
          <div className="relative group">
            <div className="w-32 h-32 lg:w-48 lg:h-48 rounded-[3rem] border-2 border-[#e6c487] p-1.5 shadow-3xl overflow-hidden transition-transform duration-700 group-hover:scale-105">
               <img 
                src={user?.user_metadata?.avatar_url || "https://ui-avatars.com/api/?name=You&background=c9a96e&color=13131b"} 
                alt="Your Avatar" 
                className="w-full h-full object-cover rounded-[2.5rem]" 
              />
            </div>
            <button className="absolute -bottom-2 -right-2 w-10 h-10 bg-[#e6c487] text-[#412d00] rounded-2xl flex items-center justify-center shadow-xl group-hover:rotate-12 transition-transform">
              <span className="material-symbols-outlined text-sm">edit</span>
            </button>
          </div>

          <div className="text-center lg:text-left flex-1">
            <h1 className="font-serif italic text-4xl lg:text-6xl text-[#e6c487] mb-4">
              {user?.user_metadata?.display_name || 'Sanctuary Keeper'}
            </h1>
            <p className="font-label text-xs uppercase tracking-[0.4em] text-white/40 mb-8">Synchronized with {partner?.display_name || 'Partner'}</p>
            
            <div className="flex flex-wrap justify-center lg:justify-start gap-4">
              <div className="bg-white/5 border border-white/10 rounded-2xl px-6 py-3 flex items-center gap-3">
                <span className="material-symbols-outlined text-[#e6c487] text-sm">verified_user</span>
                <span className="font-label text-[10px] tracking-widest text-white/60">E2E SECURED</span>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl px-6 py-3 flex items-center gap-3">
                <span className="material-symbols-outlined text-[#e6c487] text-sm">cloud_done</span>
                <span className="font-label text-[10px] tracking-widest text-white/60">MEMENTO SYNC ACTIVE</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Settings Grid */}
      <section className="px-8 py-16 lg:py-24 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Profile Group */}
        <div className="bg-[#1b1b23]/40 border border-white/5 rounded-[2.5rem] p-10 shadow-2xl hover:border-[#e6c487]/20 transition-all duration-500 group">
          <div className="flex items-center gap-4 mb-10">
            <span className="material-symbols-outlined text-[#e6c487] group-hover:rotate-12 transition-transform">person</span>
            <h3 className="font-serif italic text-xl text-white">Identity</h3>
          </div>
          <div className="space-y-8">
            <div className="flex justify-between items-center opacity-70">
              <span className="text-xs uppercase tracking-widest text-white/60 font-label">Display Name</span>
              <span className="text-white text-sm">{user?.user_metadata?.display_name}</span>
            </div>
            <div className="flex justify-between items-center opacity-70">
              <span className="text-xs uppercase tracking-widest text-white/60 font-label">Sanctuary Key</span>
              <span className="text-white text-sm">AURA-XXXX</span>
            </div>
          </div>
        </div>

        {/* Security Group */}
        <div className="bg-[#1b1b23]/40 border border-white/5 rounded-[2.5rem] p-10 shadow-2xl hover:border-[#e6c487]/20 transition-all duration-500 group">
          <div className="flex items-center gap-4 mb-10">
            <span className="material-symbols-outlined text-[#e6c487] group-hover:rotate-12 transition-transform">lock</span>
            <h3 className="font-serif italic text-xl text-white">Privacy Protocol</h3>
          </div>
          <div className="space-y-8">
            <div className="flex justify-between items-center">
              <span className="text-xs uppercase tracking-widest text-white/60 font-label">Lock Mementos</span>
              <div className="w-10 h-5 bg-[#e6c487] rounded-full relative">
                <div className="absolute right-1 top-1 w-3 h-3 bg-[#412d00] rounded-full" />
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs uppercase tracking-widest text-white/60 font-label">Hidden From Map</span>
              <div className="w-10 h-5 bg-white/10 rounded-full relative">
                 <div className="absolute left-1 top-1 w-3 h-3 bg-white/40 rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Logout Button */}
        <div className="md:col-span-2 mt-8">
          <button 
            onClick={signOut}
            className="w-full bg-red-500/10 border border-red-500/20 text-red-400 py-6 rounded-full font-label font-bold tracking-[0.4em] uppercase text-[10px] hover:bg-red-500/20 hover:text-red-300 transition-all active:scale-[0.98] duration-300 shadow-2xl shadow-red-500/5 group"
          >
            <span className="flex items-center justify-center gap-3">
              <span className="material-symbols-outlined text-sm group-hover:-translate-x-1 transition-transform">logout</span>
              Dissolve Connection
            </span>
          </button>
        </div>
      </section>

      {/* Footer Branding */}
      <footer className="px-8 pb-20 text-center opacity-30">
        <h2 className="font-serif italic text-xl text-[#e6c487] mb-2 tracking-widest">AURA</h2>
        <p className="font-label text-[8px] uppercase tracking-[0.5em] text-white">Version 1.0.4 • Digital Sanctuary Protocol</p>
      </footer>
    </div>
  );
}
