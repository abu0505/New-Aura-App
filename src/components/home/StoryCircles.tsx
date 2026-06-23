import { useState } from 'react';
import { useStories } from '../../hooks/useStories';
import { usePartner } from '../../hooks/usePartner';
import { useAuth } from '../../contexts/AuthContext';
import StoryViewer from '../stories/StoryViewer';
import StoryUploadModal from '../stories/StoryUploadModal';
import EncryptedImage from '../common/EncryptedImage';

export default function StoryCircles() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { stories, addStory, markAsSeen } = useStories();
  const [activeStoryId, setActiveStoryId] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Group stories
  const partnerStories = stories.filter(s => !s.is_mine);
  const myStories = stories.filter(s => s.is_mine);

  const hasPartnerStories = partnerStories.length > 0;
  const hasMyStories = myStories.length > 0;

  // Unseen partner stories check
  const hasUnseenPartnerStories = partnerStories.some(s => !s.viewed_at);
  const hasUnseenMyStories = myStories.some(s => !s.viewed_at);

  const handlePartnerClick = () => {
    if (hasPartnerStories) {
      const firstStory = partnerStories[0];
      setActiveStoryId(firstStory.id);
      markAsSeen(firstStory.id);
    }
  };

  const handleMyClick = () => {
    if (hasMyStories) {
      const firstStory = myStories[0];
      setActiveStoryId(firstStory.id);
      markAsSeen(firstStory.id);
    } else {
      setIsAddModalOpen(true);
    }
  };

  return (
    <div className="w-full py-4 5 bg-[var(--bg-primary)] px-4">
      <div className="flex gap-4 items-center overflow-x-auto scrollbar-hide py-1">
        
        {/* User Story Circle */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          <div 
            onClick={handleMyClick}
            className={`relative w-16 h-16 rounded-full cursor-pointer active:scale-95 transition-transform flex items-center justify-center p-[2px] ${
              hasMyStories 
                ? (hasUnseenMyStories ? 'bg-gradient-to-tr from-[var(--gold)] to-rose-400' : 'bg-white/10') 
                : 'border border-dashed border-white/20'
            }`}
          >
            <div className="w-full h-full rounded-full bg-[var(--bg-primary)] overflow-hidden relative p-[2px]">
              {user?.user_metadata?.avatar_url ? (
                <EncryptedImage 
                  url={user.user_metadata.avatar_url}
                  encryptionKey={user.user_metadata.avatar_key ? (typeof user.user_metadata.avatar_key === 'string' ? user.user_metadata.avatar_key : JSON.stringify(user.user_metadata.avatar_key)) : null}
                  nonce={user.user_metadata.avatar_nonce ? (typeof user.user_metadata.avatar_nonce === 'string' ? user.user_metadata.avatar_nonce : JSON.stringify(user.user_metadata.avatar_nonce)) : null}
                  alt="Your profile" 
                  className="w-full h-full object-cover rounded-full" 
                  placeholder={`https://ui-avatars.com/api/?name=${user?.user_metadata?.display_name || 'You'}&background=c9a96e&color=000000`}
                />
              ) : (
                <div className="w-full h-full rounded-full bg-[var(--bg-secondary)] flex items-center justify-center overflow-hidden">
                  <span className="material-symbols-outlined text-xl text-[var(--gold)]">person</span>
                </div>
              )}
              {/* Add Badge if no stories */}
              {!hasMyStories && (
                <div className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-[var(--gold)] flex items-center justify-center text-[var(--on-accent)] shadow-md">
                  <span className="material-symbols-outlined text-sm font-bold">add</span>
                </div>
              )}
            </div>
          </div>
          <span className="text-[10px] font-sans font-medium text-white/60 tracking-wider">Your Story</span>
        </div>

        {/* Partner Story Circle */}
        {hasPartnerStories && (
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div 
              onClick={handlePartnerClick}
              className={`relative w-16 h-16 rounded-full cursor-pointer active:scale-95 transition-transform flex items-center justify-center p-[2.5px] ${
                hasUnseenPartnerStories 
                  ? 'bg-gradient-to-tr from-[var(--gold)] via-rose-400 to-[#8a2be2] animate-pulse' 
                  : 'bg-white/10'
              }`}
            >
              <div className="w-full h-full rounded-full bg-[var(--bg-primary)] p-[2px] overflow-hidden">
                <EncryptedImage 
                  url={partner?.avatar_url || null}
                  encryptionKey={partner?.avatar_key ? (typeof partner.avatar_key === 'string' ? partner.avatar_key : JSON.stringify(partner.avatar_key)) : null}
                  nonce={partner?.avatar_nonce ? (typeof partner.avatar_nonce === 'string' ? partner.avatar_nonce : JSON.stringify(partner.avatar_nonce)) : null}
                  alt={partner?.display_name || 'Partner'} 
                  className="w-full h-full object-cover rounded-full" 
                  placeholder={`https://ui-avatars.com/api/?name=${partner?.display_name || 'Partner'}&background=c9a96e&color=13131b`}
                />
              </div>
            </div>
            <span className={`text-[10px] font-sans font-medium tracking-wider ${hasUnseenPartnerStories ? 'text-[var(--gold)] font-bold' : 'text-white/60'}`}>
              {partner?.display_name || 'Partner'}
            </span>
          </div>
        )}

      </div>

      {/* Story Viewer Overlay */}
      <StoryViewer 
        isOpen={!!activeStoryId}
        onClose={() => setActiveStoryId(null)}
        stories={stories}
        initialStoryId={activeStoryId}
        partnerPublicKey={partner?.public_key || null}
      />

      {/* Story Upload Modal */}
      <StoryUploadModal 
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onUploadComplete={addStory}
      />
    </div>
  );
}
