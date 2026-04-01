import { motion } from 'framer-motion';
import { usePartner } from '../../hooks/usePartner';

import type { Story } from '../../hooks/useStories';

interface MobileStoriesProps {
  stories: Story[];
  onStoryClick: (storyId: string) => void;
  onAddStory: () => void;
}

export default function MobileStories({ stories, onStoryClick, onAddStory }: MobileStoriesProps) {
  const { partner } = usePartner();

  return (
    <div className="min-h-[100dvh] pb-32 font-sans bg-[#0d0d15] text-[#e4e1ed] selection:bg-[#e6c487]/30">
      {/* Top App Bar */}
      <header className="bg-[#0f172a]/60 backdrop-blur-xl sticky top-0 z-40 border-b border-white/5 flex items-center justify-between px-6 py-4 w-full">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#1b1b23] border border-[#e6c487]/20 flex items-center justify-center overflow-hidden">
            <img 
              src={partner?.avatar_url || 'https://ui-avatars.com/api/?name=' + (partner?.display_name || 'A') + '&background=c9a96e&color=13131b'} 
              alt="Partner Profile" 
              className="w-full h-full object-cover rounded-full" 
            />
          </div>
          <h1 className="font-serif italic text-xl tracking-wide text-[#E6C487]/90">{partner?.display_name || 'AURA'}</h1>
        </div>
        <button className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/5 transition-colors duration-300 text-[#998f81]">
          <span className="material-symbols-outlined">more_vert</span>
        </button>
      </header>

      <main className="px-6 pt-8 space-y-10 max-w-2xl mx-auto">
        <section>
          <h2 className="font-serif italic text-4xl font-bold text-[#e6c487] tracking-tight">Stories</h2>
        </section>

        {/* Story Circles Row */}
        <section className="overflow-x-auto scrollbar-hide -mx-6 px-6">
          <div className="flex gap-6 items-start">
            {/* User Story (Add) */}
            <div className="flex flex-col items-center gap-3 shrink-0" onClick={onAddStory}>
              <div className="relative w-20 h-20 p-[3px] rounded-full bg-gradient-to-br from-[#e6c487] to-[#c9a96e] cursor-pointer active:scale-95 transition-transform">
                <div className="w-full h-full rounded-full bg-[#0d0d15] flex items-center justify-center overflow-hidden relative">
                  <div className="absolute inset-0 bg-white/5"></div>
                  <span className="material-symbols-outlined text-4xl text-[#e6c487]">add</span>
                </div>
              </div>
              <span className="font-label text-[10px] font-bold uppercase tracking-widest text-[#998f81]">Your Story</span>
            </div>

            {/* Active Story (Partner) */}
            {stories.filter(s => !s.is_mine).length > 0 && (
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="flex flex-col items-center gap-3 shrink-0"
                onClick={() => {
                  const firstPartnerStory = stories.filter(s => !s.is_mine)[0];
                  if (firstPartnerStory) onStoryClick(firstPartnerStory.id);
                }}
              >
                <div className="w-20 h-20 p-[3px] rounded-full bg-gradient-to-br from-[#e6c487] to-[#c9a96e] cursor-pointer active:scale-95 transition-transform">
                  <div className="w-full h-full rounded-full bg-[#0d0d15] border-[2px] border-[#0d0d15] overflow-hidden">
                    <img 
                      src={partner?.avatar_url || 'https://ui-avatars.com/api/?name=' + (partner?.display_name || 'P') + '&background=c9a96e&color=13131b'} 
                      alt="Partner's Story" 
                      className="w-full h-full object-cover" 
                    />
                  </div>
                </div>
                <span className="font-label text-[10px] font-bold uppercase tracking-widest text-[#e6c487]">{partner?.display_name || 'Partner'}</span>
              </motion.div>
            )}
          </div>
        </section>

        {/* Recent Memories Section */}
        <section className="space-y-6">
          <div className="flex justify-between items-end">
            <h3 className="font-serif italic text-xl text-[#e4e1ed]">Recent Memories</h3>
            <span className="font-label text-[10px] font-bold uppercase tracking-widest text-[#e6c487]/70 cursor-pointer hover:text-[#e6c487]">View all</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {stories.map(story => (
              <div 
                key={story.id}
                onClick={() => onStoryClick(story.id)}
                className="col-span-1 relative aspect-square rounded-3xl overflow-hidden bg-[#1b1b23] cursor-pointer group border border-white/5 flex flex-col items-center justify-center p-4 hover:bg-[#292932] transition-colors"
              >
                {!story.media_url ? (
                   <span className="font-serif italic text-sm text-[#e6c487] text-center line-clamp-3 px-2">
                     {story.decrypted_content || 'Text Story'}
                   </span>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-3xl text-[#e6c487]/40 mb-2 group-hover:scale-110 transition-transform">lock</span>
                    <span className="font-label text-[9px] uppercase tracking-widest text-[#998f81]/60">Encrypted</span>
                  </>
                )}
                
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none"></div>
                <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/5">
                  <span className="text-[9px] text-[#e4e1ed] font-bold tracking-widest uppercase">
                    {new Date(story.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {story.is_mine && story.viewed_at && (
                  <div className="absolute top-3 right-3 shadow-2xl flex items-center gap-1.5 bg-[#e6c487]/20 backdrop-blur-md px-3 py-1.5 rounded-full border border-[#e6c487]/40">
                    <span className="material-symbols-outlined text-[10px] text-[#e6c487]">done_all</span>
                    <span className="text-[9px] text-[#e6c487] font-bold tracking-widest uppercase">Seen</span>
                  </div>
                )}
                {!story.is_mine && !story.viewed_at && (
                  <div className="absolute top-3 right-3 w-3 h-3 bg-[#e6c487] rounded-full shadow-[0_0_10px_rgba(230,196,135,0.5)]"></div>
                )}
              </div>
            ))}
            {stories.length === 0 && (
              <div className="col-span-2 text-center py-10 text-[#998f81]/50 font-label text-xs uppercase tracking-widest">
                 No memories shared in the last 24 hours.
              </div>
            )}
          </div>
        </section>

        {/* Create a Moment */}
        <section className="mt-4">
          <div className="p-8 rounded-[2rem] bg-[#1b1b23] relative overflow-hidden group border border-white/5 shadow-2xl">
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-[#e6c487]/5 rounded-full blur-[60px] group-hover:bg-[#e6c487]/10 transition-all duration-700"></div>
            
            <div className="relative z-10 flex flex-col items-center space-y-8">
              <div className="text-center space-y-2">
                <h4 className="font-serif italic text-2xl text-[#e6c487] font-semibold">Capture the now</h4>
                <p className="font-sans text-xs text-[#998f81]/70 max-w-[200px] mx-auto italic leading-relaxed">
                  Keep your private thread alive with a new memory.
                </p>
              </div>

              <div className="flex items-center justify-between w-full max-w-[240px]">
                <button onClick={onAddStory} className="flex flex-col items-center gap-3 group/btn">
                  <div className="w-14 h-14 rounded-full bg-[#0d0d15] border border-white/5 flex items-center justify-center text-[#e6c487] group-hover/btn:scale-110 group-hover/btn:bg-[#e6c487] group-hover/btn:text-[#412d00] transition-all duration-300">
                    <span className="material-symbols-outlined">image</span>
                  </div>
                  <span className="font-label text-[9px] font-bold uppercase tracking-widest text-[#998f81] group-hover/btn:text-[#e6c487]">Gallery</span>
                </button>
                
                <button onClick={onAddStory} className="flex flex-col items-center gap-3 group/btn">
                  <div className="w-14 h-14 rounded-full bg-[#0d0d15] border border-white/5 flex items-center justify-center text-[#e6c487] group-hover/btn:scale-110 group-hover/btn:bg-[#e6c487] group-hover/btn:text-[#412d00] transition-all duration-300">
                    <span className="material-symbols-outlined">videocam</span>
                  </div>
                  <span className="font-label text-[9px] font-bold uppercase tracking-widest text-[#998f81] group-hover/btn:text-[#e6c487]">Video</span>
                </button>

                <button onClick={onAddStory} className="flex flex-col items-center gap-3 group/btn">
                  <div className="w-14 h-14 rounded-full bg-[#0d0d15] border border-white/5 flex items-center justify-center text-[#e6c487] group-hover/btn:scale-110 group-hover/btn:bg-[#e6c487] group-hover/btn:text-[#412d00] transition-all duration-300">
                    <span className="material-symbols-outlined">title</span>
                  </div>
                  <span className="font-label text-[9px] font-bold uppercase tracking-widest text-[#998f81] group-hover/btn:text-[#e6c487]">Text</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
