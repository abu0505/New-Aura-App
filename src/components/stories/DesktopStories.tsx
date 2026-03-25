import { usePartner } from '../../hooks/usePartner';
import type { Story } from '../../hooks/useStories';

interface DesktopStoriesProps {
  stories: Story[];
  onStoryClick: (storyId: string) => void;
  onAddStory: () => void;
}

export default function DesktopStories({ stories, onStoryClick, onAddStory }: DesktopStoriesProps) {
  const { partner } = usePartner();

  return (
    <div className="h-screen overflow-y-auto bg-[#0d0d15] text-[#e4e1ed] font-sans selection:bg-[#e6c487]/30">
      {/* Top Navigation / Search */}
      <header className="flex justify-between items-center px-12 h-24 sticky top-0 bg-[#0d0d15]/80 backdrop-blur-xl z-40 border-b border-white/5">
        <div className="relative w-96">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#998f81]/50 text-xl">search</span>
          <input 
            type="text" 
            placeholder="Search memories..." 
            className="w-full bg-[#1b1b23] border border-white/5 rounded-full py-3 pl-12 pr-6 text-sm focus:ring-1 focus:ring-[#e6c487] focus:bg-[#292932] outline-none transition-all duration-300 placeholder:text-[#998f81]/40 text-white" 
          />
        </div>
        <div className="flex items-center gap-8">
          <button className="text-[#998f81] hover:text-[#e6c487] transition-colors duration-300">
            <span className="material-symbols-outlined">notifications</span>
          </button>
          <button className="text-[#998f81] hover:text-[#e6c487] transition-colors duration-300">
            <span className="material-symbols-outlined">favorite</span>
          </button>
        </div>
      </header>

      {/* Content Canvas */}
      <div className="px-12 pb-20 max-w-7xl mx-auto">
        {/* Header Section */}
        <section className="mb-12 mt-12">
          <h1 className="text-5xl font-serif italic font-bold text-[#e6c487] mb-2 tracking-tight">Stories</h1>
          <p className="text-[#998f81] font-light italic text-lg capitalize">Shared Moments from your private circle</p>
        </section>

        {/* Story Circles */}
        <section className="flex gap-8 mb-16 overflow-x-auto pb-4 scrollbar-hide">
          {/* Add Story */}
          <div onClick={onAddStory} className="flex flex-col items-center gap-4 flex-shrink-0 cursor-pointer group">
            <div className="w-24 h-24 rounded-full border-2 border-dashed border-[#998f81]/30 flex items-center justify-center group-hover:border-[#e6c487] group-active:scale-95 transition-all duration-300 bg-[#1b1b23]">
              <span className="material-symbols-outlined text-[#998f81] group-hover:text-[#e6c487] text-3xl transition-colors duration-300">add</span>
            </div>
            <span className="font-label text-[10px] font-bold uppercase tracking-widest text-[#998f81]">Add Story</span>
          </div>

          {/* Partner Story */}
          {stories.filter(s => !s.is_mine).length > 0 && (
            <div 
              onClick={() => {
                const firstPartnerStory = stories.filter(s => !s.is_mine)[0];
                if (firstPartnerStory) onStoryClick(firstPartnerStory.id);
              }} 
              className="flex flex-col items-center gap-4 flex-shrink-0 cursor-pointer group"
            >
              <div className="w-24 h-24 rounded-full p-[3px] bg-gradient-to-br from-[#e6c487] to-[#c9a96e] group-hover:scale-105 active:scale-95 transition-transform duration-300 shadow-2xl">
                <div className="w-full h-full rounded-full border-2 border-[#0d0d15] overflow-hidden bg-[#1b1b23]">
                  <img 
                    src={partner?.avatar_url || 'https://ui-avatars.com/api/?name=' + (partner?.display_name || 'P') + '&background=c9a96e&color=13131b'} 
                    alt="Partner's Avatar" 
                    className="w-full h-full object-cover" 
                  />
                </div>
              </div>
              <span className="font-label text-[10px] font-bold uppercase tracking-widest text-[#e6c487]">{partner?.display_name || 'Partner'}</span>
            </div>
          )}
        </section>

        {/* Stories Editorial Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
          {stories.map(story => (
            <div 
              key={story.id}
              onClick={() => onStoryClick(story.id)} 
              className="relative group aspect-[3/4] rounded-[2.5rem] overflow-hidden bg-[#1b1b23] cursor-pointer transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_40px_80px_-15px_rgba(0,0,0,0.6)] border border-white/5 flex items-center justify-center flex-col"
            >
              {!story.media_url ? (
                <>
                  <div className="absolute inset-0 bg-gradient-to-br from-[#1b1b23] to-[#0d0d15]"></div>
                  <div className="absolute inset-0 bg-[#e6c487]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                  <div className="p-12 h-full flex flex-col justify-center items-center text-center relative z-10 text-[#e4e1ed]">
                     <span className="material-symbols-outlined text-[#e6c487]/10 text-8xl mb-8">title</span>
                     <h2 className="text-2xl font-serif italic leading-relaxed px-4 text-[#e6c487] line-clamp-4">
                        {story.decrypted_content || 'Text Story'}
                     </h2>
                  </div>
                </>
              ) : (
                <>
                  <div className="absolute inset-0 flex items-center justify-center flex-col gap-4 bg-[#1b1b23]">
                    <span className="material-symbols-outlined text-6xl text-[#e6c487]/30 group-hover:scale-110 transition-transform duration-500">lock</span>
                    <span className="font-label text-xs uppercase tracking-widest text-[#998f81]/50">Encrypted Memory</span>
                  </div>
                </>
              )}
              
              <div className="absolute inset-0 bg-gradient-to-t from-[#0d0d15] via-transparent to-transparent pointer-events-none"></div>
              
              <div className="absolute top-8 right-8">
                <div className="bg-black/40 backdrop-blur-md p-3 rounded-full border border-white/10 text-[#e6c487]">
                   <span className="material-symbols-outlined text-xl">{story.media_url ? 'photo_camera' : 'title'}</span>
                </div>
              </div>
              
              <div className="absolute bottom-0 inset-x-0 p-6 z-10">
                <div className="bg-black/40 backdrop-blur-xl rounded-3xl p-5 flex items-center justify-between border border-white/10">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#e6c487]/30 shadow-xl flex items-center justify-center bg-[#1b1b23]">
                      {story.is_mine ? (
                         <span className="text-[10px] font-black text-[#e6c487] tracking-widest uppercase">YOU</span>
                      ) : (
                         <img 
                            src={partner?.avatar_url || 'https://ui-avatars.com/api/?name=' + (partner?.display_name || 'P') + '&background=c9a96e&color=13131b'} 
                            alt="Avatar" 
                            className="w-full h-full object-cover" 
                         />
                      )}
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-white tracking-wide">{story.is_mine ? 'You' : (partner?.display_name || 'Partner')}</p>
                      <p className="text-[10px] text-[#998f81] uppercase tracking-widest mt-0.5">
                        {new Date(story.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  {story.is_mine && story.viewed_at && (
                    <div className="flex items-center gap-2 bg-[#e6c487]/10 px-3 py-2 rounded-full border border-[#e6c487]/20 shadow-xl">
                      <span className="material-symbols-outlined text-xs text-[#e6c487]">done_all</span>
                      <span className="text-[9px] text-[#e6c487] uppercase font-bold tracking-widest">Seen</span>
                    </div>
                  )}
                  {!story.is_mine && !story.viewed_at && (
                    <div className="w-3 h-3 bg-[#e6c487] rounded-full shadow-[0_0_10px_rgba(230,196,135,0.5)] mr-2"></div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {stories.length === 0 && (
            <div className="col-span-full text-center py-20 text-[#998f81]/50 font-label text-sm uppercase tracking-widest border border-white/5 rounded-3xl bg-[#1b1b23]/30 backdrop-blur-xl">
               No memories shared in the last 24 hours.
            </div>
          )}
        </section>

        {/* Create Story Section */}
        <section className="bg-[#1b1b23]/30 backdrop-blur-md border border-white/5 rounded-[4rem] p-16 mb-20 relative overflow-hidden group shadow-3xl">
          <div className="absolute -right-20 -top-20 w-80 h-80 bg-[#e6c487]/5 rounded-full blur-[80px] group-hover:bg-[#e6c487]/10 transition-colors duration-700"></div>
          
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-end mb-16 gap-6">
            <div>
              <h2 className="text-5xl font-serif italic font-bold text-[#e6c487] mb-3">Create a Moment</h2>
              <p className="text-[#998f81] text-xl font-light italic">Capture a fragment of your day for only them to see.</p>
            </div>
            <button className="px-8 py-4 border border-[#998f81]/20 rounded-full text-[#998f81] hover:text-[#e6c487] hover:border-[#e6c487] transition-all text-[11px] font-bold tracking-widest uppercase active:scale-95 duration-300">
              View Archive
            </button>
          </div>

          <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-8">
            <div onClick={onAddStory} className="bg-[#0d0d15]/50 hover:bg-[#1b1b23] border border-white/5 p-10 rounded-[2.5rem] transition-all duration-500 cursor-pointer group/btn text-center flex flex-col items-center">
              <div className="w-20 h-20 rounded-3xl bg-[#e6c487]/5 flex items-center justify-center text-[#e6c487] mb-8 group-hover/btn:scale-110 group-hover/btn:bg-[#e6c487] group-hover/btn:text-[#412d00] transition-all duration-500">
                <span className="material-symbols-outlined text-4xl">photo_camera</span>
              </div>
              <h3 className="font-serif italic text-2xl mb-2 text-white">Take Photo</h3>
              <p className="text-sm text-[#998f81]/70 px-4 leading-relaxed font-light italic">Open the camera and capture the now.</p>
            </div>

            <div onClick={onAddStory} className="bg-[#0d0d15]/50 hover:bg-[#1b1b23] border border-white/5 p-10 rounded-[2.5rem] transition-all duration-500 cursor-pointer group/btn text-center flex flex-col items-center">
              <div className="w-20 h-20 rounded-3xl bg-[#e6c487]/5 flex items-center justify-center text-[#e6c487] mb-8 group-hover/btn:scale-110 group-hover/btn:bg-[#e6c487] group-hover/btn:text-[#412d00] transition-all duration-500">
                <span className="material-symbols-outlined text-4xl">image</span>
              </div>
              <h3 className="font-serif italic text-2xl mb-2 text-white">From Gallery</h3>
              <p className="text-sm text-[#998f81]/70 px-4 leading-relaxed font-light italic">Upload a memory from your library.</p>
            </div>

            <div onClick={onAddStory} className="bg-[#0d0d15]/50 hover:bg-[#1b1b23] border border-white/5 p-10 rounded-[2.5rem] transition-all duration-500 cursor-pointer group/btn text-center flex flex-col items-center">
              <div className="w-20 h-20 rounded-3xl bg-[#e6c487]/5 flex items-center justify-center text-[#e6c487] mb-8 group-hover/btn:scale-110 group-hover/btn:bg-[#e6c487] group-hover/btn:text-[#412d00] transition-all duration-500">
                <span className="material-symbols-outlined text-4xl">title</span>
              </div>
              <h3 className="font-serif italic text-2xl mb-2 text-white">Text Story</h3>
              <p className="text-sm text-[#998f81]/70 px-4 leading-relaxed font-light italic">Write a private note or status update.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
