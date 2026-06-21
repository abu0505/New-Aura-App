# App Version
VersionName: 2.9.0
VersionCode: 63
Date: 2026-06-21
Changes:
- Implemented smart automated aspect-ratio detection on mobile: if an image or video's original height-to-width ratio is less than 1.5 (meaning it is shorter in height than 2:3, e.g., 4:5, 1:1, or 16:9), it is automatically displayed in its original ratio by default instead of cropping to 2:3.

## Previous Versions
### Version 2.8.9 (Code 62)
- Added aspect ratio toggle button (Maximize2/Minimize2) after the Share button in the post feed to let users view media in its original aspect ratio (aspect-auto/h-auto/object-contain) or crop to fit (2:3 aspect ratio).
### Version 2.8.8 (Code 61)
- Refined mobile post layout: changed the edge-to-edge media aspect ratio from 4:5 to 2:3 on mobile devices to present a slightly taller, more balanced media representation.
### Version 2.8.7 (Code 60)
- Overhauled mobile post layout to Instagram-style: removed post card container background, borders, shadows, and rounded corners on mobile, making it flat. Adjusted mobile media aspect ratio to standard Instagram portrait 4:5 and stretched the media edge-to-edge (-mx-4) for a premium, native-looking scroll experience.
### Version 2.8.6 (Code 59)
- Refined mobile post layout: adjusted the post media container aspect ratio on mobile devices to 9:15, reducing the height slightly by ~6.25% to prevent the post from stretching too long while keeping the media and card height aligned.
### Version 2.8.5 (Code 58)
- Refined mobile post layout: adjusted the post media container aspect ratio on mobile devices to 9:16 (keeping the desktop layout as flex-grow/auto within the 2/3 aspect ratio card) so that the media is displayed perfectly without scaling or cropping issues, allowing the overall card to take necessary height.
### Version 2.8.4 (Code 57)
- Refined mobile post layout: adjusted the post card aspect ratio on mobile devices to 9:16, while maintaining the 2/3 aspect ratio on desktop viewports for an optimal experience across different screen sizes.
### Version 2.8.3 (Code 56)
- Reorganized the chat header calling options: combined Voice and Video calling options into a single call button dropdown menu, utilizing the custom Video Call icon.
### Version 2.8.2 (Code 55)
- Replaced the Reels tab navigation icon with a custom Instagram-style Reels clapperboard icon (featuring a play triangle and slanted top lines).
- Added a custom Video Call icon (video camera with an embedded play button) to the direct call controls in the chat headers.
- Implemented curvy chevrons with smooth, rounded tips for all media, carousel, and collage viewers.
- Replaced the Explore tab labels with "Search" to match the Search icon in bottom and sidebar navigation.
- Refined desktop post height and layout: adjusted post card aspect ratio from 9:16 to 2:3 on both mobile and desktop to present a slightly wider, more balanced post view.
- Consolidated desktop right sidebar: merged the partner status and chat widget into a single, elegant card container, removing call shortcuts, streak badges, and vault headers to focus purely on the conversation.
- Polished direct chat UI in sidebar: styled chat bubbles to match the original chat interface, including NaCl-box style bubble cards, time formatting, and dynamic double-tick status indicators.
- Fixed desktop post height: restricted home feed posts to a maximum height of 85% of the viewport height minus the header, automatically scaling the width to maintain a perfect 9:16 aspect ratio.
- Fixed desktop sidebar height cut-off: set a fixed viewport-relative height and max-height for the right sidebar aside element so it fits the viewport without getting cut off.
- Added a bubble-style direct chat interface to the desktop right sidebar for messaging the partner in real-time, including E2EE secure indicators, streak status integration, and quick audio/video calling shortcuts.
### Version 2.7.1 (Code 52)
- Extended the premium icon overhaul to the Stories system (Home Feed stories list, story circles, viewer overlay, and upload modal) and the dedicated Upload Reel Screen, converting all remaining high-frequency Material Symbols to Lucide React icons.
- Overhauled and improved the application's visual aesthetics by replacing the most frequently used icons with modern, clean, and premium Lucide React vector icons.
- Replaced icons in the Bottom Navigation Bar, Sidebar, Home Feed posts action bar, Reels screen action controls, Chat Screen headers, and Message Input fields.
- Implemented global premium CSS styling overrides for Google Material Symbols, setting a thin stroke weight (wght 250) and sleek optical sizes for all other icons across the entire app.

### Version 2.6.7 (Code 50)
- Implemented swipable full-screen vertical Reels swiper for profile posts, liked items, and saved items, supporting liking, saving, E2EE decryption, and chunked video rendering.
- Changed Liked and Saved tabs sorting to list most recently liked/saved media first (based on index in profiles arrays) rather than their original message creation dates.
### Version 2.6.6 (Code 49)
- Changed Liked and Saved tabs sorting to list most recently liked/saved media first (based on index in profiles arrays) rather than their original message creation dates.
### Version 2.6.5 (Code 48)
- Center-aligned and distributed Profile screen tabs equally across the tab bar using flex justify-around within a constrained container.
### Version 2.6.4 (Code 47)
- Increased average video probability in Home/Reels feeds from 35% to 40% (range of 3 to 5 videos per 10 items).
- Fixed critical mobile bottom navigation bar visibility bug: nav bar is now properly restored when exiting subviews (Notes, Gallery, Games) back to Explore grid.
### Version 2.6.3 (Code 46)
- Added a "Saved" posts & reels feature with profile tab view, interactive home feed bookmark button, and reels action save button.
### Version 2.6.2 (Code 45)
- Changed the video probability in home feed / reels queues to an average of 35% (range of 2 to 5 videos per 10 items).
### Version 2.6.1 (Code 44)
- Made partner's avatar and name clickable everywhere (Chat header, Chat message bubbles, Reels, Home Feed posts, and Desktop status sidebar) to open partner's profile.
- Removed the Profile Owner switcher toggle tab from the top of the Profile screen.
- Reduced the post/liked grids gap on desktop Profile screen from 3 to 1 (`gap-1`) to match mobile layout density.
### Version 2.6.0 (Code 43)
- Added a Profile owner toggle to switch between "My Profile" and "Wife's Profile" to view the partner's posts, notes, and liked items.
- Fixed video rendering in Profile and Explore grid thumbnails by implementing decryption for encrypted chunked videos.
- Dynamic tab labels and stats tracking on Profile page depending on selected owner.
### Version 2.5.6 (Code 42)
- Implemented a "Liked" tab on the Profile screen next to the existing posts grid, displaying all posts and reels liked by the user.
- Persisted likes from the Reels screen to the Supabase database (`profiles.favorited_message_ids`) and local storage.
- Synchronized double-tap and heart icon interactions on Reels to update the persisted likes state.
### Version 2.5.5 (Code 41)
- Cleaned up verbose test-phase console logs across key components (HomeScreen, ReelsScreen, ExploreScreen, ProfileScreen, RecapCard) to improve runtime performance.
- Muted database query logging ([SUPABASE FETCH START/SUCCESS]) to protect sensitive Authorization and E2EE headers from logging in plaintext.
- Muted debug traces in Media decryption (useMedia cache hits, key-unwrap steps, ciphertext sizes) and video chunking hooks (useVideoChunks).
### Version 2.5.4 (Code 40)
- Resized chat screen header call button/dropdown icon from 24px to 20px (`text-[20px]`) in both MobileChatScreen and DesktopChatScreen to match sibling icons.
- Resized chat header more_vert icon from 24px to 20px (`text-[20px]`) for design and size consistency.

### Version 2.5.3 (Code 39)
- Adjusted Reels card layout: enlarged bottom-left avatar container size to 56px (w-14 h-14) for enhanced visibility.
- Pushed right-side action controls container up to `bottom-[240px]` (mobile) and `lg:bottom-[170px]` (desktop) to prevent overlap with the full-width profile details container.
### Version 2.5.2 (Code 38)
- Refined ReelsScreen layout: shifted Mute button to absolute top-left of the card to prevent overlap.
- Expanded bottom-left profile details area to span the full width (using right-4 instead of right-16) for cleaner caption presentation.
- Pushed right-side action buttons up (using bottom-[200px]/lg:bottom-[120px]) so they sit above the profile info.
- Enlarged bottom-left avatar container size to 48px (w-12 h-12) for a more premium look.
### Version 2.5.1 (Code 37)
- Integrated a new "Share to chat" functionality for both feed posts and video reels. When users click the share button, the post or reel is duplicated and inserted securely into the direct vault chat using the original wrapped E2EE keys.
- Supported duplication and forwarding of both standard single-file media assets and fragmented chunked video blocks.
### Version 2.5.0 (Code 36)
- Restructured Home feed header: centered "AURA" brand title and added a "+" upload icon that programmatically switches to the dedicated upload reel view.
- Created a dedicated, full-screen `UploadReelScreen` optimized for both mobile and desktop viewports, with integrated file selection, aspect-ratio preview, captions, E2EE encryption processing, and progress feedback.
- Removed the local floating upload FAB and UploadReelModal from the ReelsScreen to centralize creation entry from the main Home feed.
### Version 2.4.14 (Code 35)
- Set aspect ratio of the entire post card container on the Home Feed to 9:16 (`aspect-[9/16]`) so that the media adjusts dynamically inside the card without hardcropping the media component itself.
- Changed Home Feed video/image post media container aspect ratio from 1:1 (`aspect-square`) to 9:16 (`aspect-[9/16]`) to fit vertical reels-style content.
### Version 2.4.12 (Code 33)
- Implemented Reels-like video playback for Home Feed posts: removed default controls overlay, enabled looping, and integrated `IntersectionObserver` to automatically play videos when visible in the viewport and pause them when scrolled away. Clicking/tapping a post video toggles play/pause with a premium animated indicator.
- Integrated Synchronized Global Mute Toggle: added volume/mute controls to both Home Feed post videos and Reel Cards. Toggling mute on any video synchronizes instantly across all players in the app via custom events and is persisted in `localStorage`.
### Version 2.4.11 (Code 32)
- Fixed Chat Screen Reel Leak: added `.eq('is_reel_upload', false)` to Main and Missed message queries in `useChat.ts`, and ignored incoming messages with `is_reel_upload: true` in the realtime insertion channel to keep dedicated uploads out of the chat log.
- Fixed Eager Seen Tracking Bug: replaced the immediate batch-based seen tagging with progressive, scroll-based seen tagging on both Reels and Home screens. Items are now only marked as seen as the user actually views them on their screens.
### Version 2.4.10 (Code 31)
- Fixed background video reel playback bug: passed the active tab state (`isActive`) to `ReelsScreen` and propagated it to `ReelCard` so that audio and video playback pause immediately when switching away from the Reels tab.
### Version 2.4.9 (Code 30)
- Fixed Upload Reel modal bottom-sheet on mobile devices: added a bottom padding offset to prevent overlapping by the global bottom navigation bar, limited the maximum card height, and made the body scrollable.
### Version 2.4.8 (Code 29)
- Replaced 70% video and 30% image ratio targets with a randomized 60% video and 40% image mix. Each block of 10 items is randomized to target between 4 and 7 videos, ensuring dynamic pool distribution without dominance.
- Overhauled frontend pagination tracking: separated seen files into `seenVideoIds` and `seenImageIds` refs on both Reels Screen and Home Page Feed.
- Implemented a self-healing seen recycling system: when either videos or images are scarce, the algorithm automatically recycles seen files, keeping only a dynamically scaled fraction (up to the last 30 videos and 50 images) in the excluded set. This ensures the reels and posts can scroll infinitely without hitting a dead end.
### Version 2.4.7 (Code 28)
- Fixed a critical database function compilation/signature issue: replaced CREATE OR REPLACE FUNCTION with an explicit DROP FUNCTION cascade to allow Postgres to register the new `exclude_ids` array parameter. This successfully activates the Seen ID exclusion logic in the production database, restoring rich date variety across all available months and dates.
- Verified that database RPC returns correct date distributions from April, May, and June without date clustering.
### Version 2.4.6 (Code 27)
- Implemented fully infinite, scroll-based pagination for both Reels Screen and Home Page Feed.
- Added session-based seen ID tracking (`exclude_ids`) to eliminate repeat posts/reels during scrolling. Redefined the database RPC function `get_diverse_reels_pool` to accept `exclude_ids UUID[]` and filter out duplicates.
- Refactored feedPool.ts utility to propagate `excludeIds` to both the primary RPC function and the client-side query fallback handler.
- Configured dynamic threshold triggers (5 slots before end of list) to fetch the next batch seamlessly in the background.
### Version 2.4.5 (Code 26)
- Implemented a targeted 70% video and 30% image composition ratio for the reels and home feed. Updated both the PostgreSQL RPC function `get_diverse_reels_pool` and the frontend `buildReelQueue` utility to dynamically sample videos and images separately to enforce this ratio.
- Added dynamic allocation logic to safely fall back if either images or videos are scarce, maximizing pool size while targeting the 70/30 distribution.
- Documented database profile analysis showing there was no media content in the DB prior to April 2026, clarifying date distribution behavior.
### Version 2.4.4 (Code 25)
- Overhauled feed pooling logic by replacing client-side chronological queries with a database RPC function `get_diverse_reels_pool` implementing stratified random sampling. This resolves the clustered dates bug (e.g. only seeing June 20, 6, 5, 4 and March 20) for high-frequency posters, allowing images/videos to be served evenly from any month/year across the entire chat history.
- Added a robust client-side fallback path in feedPool.ts to prevent any crashes if the RPC database function fails or is un-migrated.
- Created and executed a new database schema migration to define the `get_diverse_reels_pool` PL/pgSQL function.
### Version 2.4.3 (Code 24)
- Resolved severe PostgREST query parameters conflict: replaced chained .or() media-type filters with standard .in() and .eq() methods across feedPool, HomeScreen, ExploreScreen, and MemoriesScreen. This restores full historical image/video coverage for all feeds (e.g. May/April content) which was previously blocked by text messages.
- Disabled the Ken Burns image zooming effect completely on Reels Screen to prevent visual distortion.
- Implemented video reel play/pause toggle on single click/tap with premium animated visual status indicators.
- Added long-press to pause video reels on touch/mouse hold, resuming automatically on release (matches Instagram/TikTok reels behavior).
- Fixed grayish overlay container in Reels Screen, restoring original video/image colors by replacing full-screen dark gradient with targeted top and bottom gradient overlays.
- Overhauled feed algorithm with multi-bucket diverse pool fetching (recent/middle/old) — old media (3+ months) now always enters the weighted pool regardless of how many recent items exist.
- Fixed chunked videos (198 out of 240 videos) being completely filtered from Reels and Home feed — updated filterDecryptableItems to recognize chunked videos (media_url=NULL, data in video_chunks table).
- Added full chunked video playback support in ReelCard — fetches video_chunks from DB, decrypts blocks, and assembles for seamless playback in both Reels and Home feed.
- Applied same diverse pool strategy to PIN-entry prefetch (AppLockContext) for consistent feed content across all entry points.
- Created shared feedPool.ts utility for consistent multi-bucket pool fetching across HomeScreen, ReelsScreen, and AppLockContext.
### Version 2.3.1 (Code 19)
- Fixed TypeScript type mismatch and assignability issues in ReelsScreen and HomeScreen when calling the reel weighting utility.
### Version 2.3.0 (Code 18)
- Added dedicated Upload Reel feature: gold FAB button on ReelsScreen opens a bottom-sheet upload modal with video/photo picker, caption input, upload progress, and encryption pipeline.
- Implemented Weighted Reservoir Sampling reel algorithm (Algorithm A-Res) with nostalgia-first scoring: old media (6+ months) > middle (1–6 months) > recent (<1 month), videos weighted higher than photos throughout.
- Added "On This Day" bonus weight (+9) for media from the same calendar date in a previous year — surfaces nostalgic memories automatically.
- Dedicated reel uploads receive highest priority weight (video=+10, photo=+8) plus a temporary new-upload boost for 0–3 days after upload.
- Applied same weighted algorithm to Home Feed (fetches 150-item pool, selects 30 via weighted sampling) so reel uploads and old/video memories surface in both Reels and Home pages.
- Added "Featured Reel" gold badge on reel cards that were uploaded via dedicated upload flow.
- Added is_reel_upload boolean column to messages table with DB index for fast queries.
- Updated TypeScript types for messages table to include is_reel_upload field.

- Completely redesigned the Desktop Login Screen: removed the "Aura Store" branding/shopping bag references and replaced it with a centered glassmorphism card, gold gradients, lock icon, and animated background particles.
- Redesigned the Home Screen (Feed) for desktop: implemented a responsive 2-column layout containing a Main Feed (left) and a Partner Profile Status Sidebar (right) with calling options and active streak tracking.
- Redesigned the Explore Screen for desktop: limited container width for readability and implemented a responsive 4-column discovery gallery grid.
- Redesigned the Profile Screen for desktop: implemented an Instagram-style layout with user statistics, bio, edit actions, and a 4-column responsive posts grid.
- Redesigned the Reels Screen for desktop: confined vertical cards inside a centered smartphone aspect-ratio container with hover adjustments to match desktop standards and prevent video/photo pixelation.
- Made sure all mobile layout viewports remain completely untouched and identical to their original design.
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
