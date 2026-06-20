# App Version
VersionName: 2.4.14
VersionCode: 35
Date: 2026-06-20
Changes:
- Set aspect ratio of the entire post card container on the Home Feed to 9:16 (`aspect-[9/16]`) so that the media adjusts dynamically inside the card without hardcropping the media component itself.

## Previous Versions
### Version 2.4.13 (Code 34)
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
