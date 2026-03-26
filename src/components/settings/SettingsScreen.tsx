import ProfileSection from './ProfileSection';
import BackgroundPicker from './BackgroundPicker';
import SecuritySection from './SecuritySection';
import StorageSection from './StorageSection';

/**
 * SettingsScreen - Refactored for AURA Phase 7
 * Follows "The Digital Sanctuary" design philosophy from Stitch.
 * Uses modular components for Identity, Ambience, Privacy, and Storage.
 */
export default function SettingsScreen() {
  return (
    <div className="h-full w-full bg-[#0d0d15] overflow-y-auto font-sans pb-32 lg:pb-12 custom-scrollbar">
      {/* 1. Identity & Hero */}
      <ProfileSection />

      {/* 2. Settings Grid */}
      <div className="px-8 py-16 lg:py-24 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
        {/* Chat Customization */}
        <BackgroundPicker />

        {/* Security & Notifications */}
        <SecuritySection />

        {/* Storage, Versioning & Logout */}
        <StorageSection />
      </div>
    </div>
  );
}
