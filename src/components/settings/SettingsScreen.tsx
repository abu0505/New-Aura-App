import ProfileSection from './ProfileSection';
import AppearanceSettings from './AppearanceSettings';
import BackgroundPicker from './BackgroundPicker';
import SecuritySection from './SecuritySection';
import NotificationSettings from './NotificationSettings';
import StorageSection from './StorageSection';
import AutocompleteSettings from './AutocompleteSettings';

/**
 * SettingsScreen - Refactored for AURA Phase 7 & 8
 * Follows "The Digital Sanctuary" design philosophy from Stitch.
 * Uses modular components for Identity, Ambience, Privacy, Notifications, and Storage.
 */
export default function SettingsScreen() {
  return (
    <div className="h-full w-full bg-[var(--background)] overflow-y-auto font-sans pb-32 lg:pb-12 custom-scrollbar">
      {/* 1. Identity & Hero */}
      <ProfileSection />

      {/* 2. Settings Grid */}
      <div className="px-4 lg:px-8 py-10 lg:py-24 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
        {/* Appearance & Themes */}
        <AppearanceSettings />

        {/* Chat Customization */}
        <BackgroundPicker />
        
        {/* Auto Complete Customization */}
        <AutocompleteSettings />

        {/* Notifications Management */}
        <NotificationSettings />

        {/* Security & Privacy */}
        <SecuritySection />

        {/* Storage, Versioning & Logout */}
        <StorageSection />
      </div>
    </div>
  );
}
