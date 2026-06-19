# App Version
VersionName: 2.1.3
VersionCode: 15
Date: 2026-06-20
Changes:
- Refactored Arcade (Game Zone) page headers to remove the redundant white header and unified back navigation.
- Refactored Notes page headers to remove the redundant white header and unified back navigation.
- Refactored Memories Gallery headers to remove the redundant white header and unified back navigation.
- Implemented global hiding of media and images that fail to decrypt across home, explore, profile, and memories screens.
- Fixed mobile scrolling issue on the home page by constraining flex container height.
- Converted home screen recaps to Memories-style Moments cards.
- Fixed uncaught ReferenceError: Cannot access 'debouncedSave' before initialization on opening note editor.
- Added beforeunload window listener to prevent accidental page closes/refreshes during web uploads.
- Increased JS/browser parallel video upload chunk limit from 4 to 5.
- Reduced default video upload chunk size from 5MB to 1MB to avoid native bridge payload limits.
- Rewrote BackgroundUploadPlugin to enqueue chunks one-by-one, avoiding 1MB Android IPC Binder crashes.
- Implemented real-time chunk upload progress status polling in the frontend.
