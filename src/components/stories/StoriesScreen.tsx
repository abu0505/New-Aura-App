import { useState, useEffect } from 'react';
import MobileStories from './MobileStories';
import DesktopStories from './DesktopStories';
import StoryViewer from './StoryViewer';
import StoryUploadModal from './StoryUploadModal';
import { useStories } from '../../hooks/useStories';
import type { Story } from '../../hooks/useStories';
import type { PartnerProfile } from '../../hooks/usePartner';

interface StoriesScreenProps {
  partner: PartnerProfile | null;
}

export default function StoriesScreen({ partner }: StoriesScreenProps) {
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const { stories, addStory, markAsSeen } = useStories();

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleStoryClick = (storyId: string) => {
    const story = stories.find(s => s.id === storyId);
    if (story) {
      setActiveStory(story);
      markAsSeen(storyId);
    }
  };

  const handleAddStory = () => {
    setIsAddModalOpen(true);
  };

  const handleCloseViewer = () => {
    setActiveStory(null);
  };

  return (
    <div className="w-full h-full bg-[#0d0d15] overflow-hidden">
      {isDesktop ? (
        <DesktopStories stories={stories} onStoryClick={handleStoryClick} onAddStory={handleAddStory} />
      ) : (
        <MobileStories stories={stories} onStoryClick={handleStoryClick} onAddStory={handleAddStory} />
      )}

      {/* Story Viewer Overlay */}
      <StoryViewer 
        isOpen={!!activeStory}
        onClose={handleCloseViewer}
        stories={stories}
        initialStoryId={activeStory?.id || null}
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
