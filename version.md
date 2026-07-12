# App Version
VersionName: 2.26.0
VersionCode: 153
Date: 2026-07-12
Changes:
- **Infrastructure — Smart Dual Cloudinary Router:** Added a `cloudinaryRouter.ts` system that intelligently manages two Cloudinary accounts (A: del5o1vnd, B: tvxm21ys). Automatically switches to the backup account when the primary hits its credit/bandwidth limit, with auto-recovery retry every 24 hours. All upload paths (cloudinary.ts, useMedia.ts, backgroundUpload.ts) now route through this system. Account B is currently active as primary since Account A's credits are exhausted.

## Previous Version (2.25.9)
VersionCode: 152
Date: 2026-07-11
Changes:
- **Feature — Long Press to Reply:** Added a "Reply" option to the message long-press and right-click context menu, giving users a secondary way to reply to messages alongside the existing swipe gesture.
- **Refinement — Note Raw Mode:** Upgraded note raw mode to preserve layout structural elements (headings, newlines, and list layouts) while keeping inline formatting tags (like `**bold**`, `*italic*`) raw and literal, allowing raw notes to use the high-performance rich text editor canvas instead of basic plain text textareas.

## Previous Version (2.25.8)
VersionCode: 151
Date: 2026-07-11
Changes:
- **Feature — Long Press to Reply:** Added a "Reply" option to the message long-press and right-click context menu, giving users a secondary way to reply to messages alongside the existing swipe gesture.

## Previous Version (2.25.7)
VersionCode: 150
Date: 2026-07-08
Changes:
- **Refinement — Soft Muted Active Text Color:** Adjusted the active header filter button text from pure bright white to a premium, softer warm off-white cream color (`text-[#f0ede8]`), matching the app's overall typography palette.

## Previous Version (2.25.6)
VersionCode: 149
Date: 2026-07-08
Changes:
- **Refinement — Header Active Button White Text:** Changed text color of active header scrollable buttons ("All", "Favorites", etc.) from gold/contrast to a high-contrast premium solid white text (`text-white`).
- **Refinement — Filter Button Borders & Colors:** Muted the filter button borders to `border-white/5` (hovering at `border-white/10`) to remove visual harshness. Adjusted the text/icon coloring to apply the gold accent color ONLY on hover or when the dropdown is active (open).

## Previous Version (2.25.5)
VersionCode: 148
Date: 2026-07-08
Changes:
- **Refinement — Filter Button Borders & Colors:** Muted the filter button borders to `border-white/5` (hovering at `border-white/10`) to remove visual harshness. Adjusted the text/icon coloring to apply the gold accent color ONLY on hover or when the dropdown is active (open).

## Previous Version (2.25.4)
VersionCode: 147
Date: 2026-07-08
Changes:
- **Fix — Moments Carousel Play Icon Centering:** Removed the offset margin-left (`ml-1`) from the play icon inside the Moments Carousel cards, centering it perfectly within its circular background.

## Previous Version (2.25.3)
VersionCode: 146
Date: 2026-07-08
Changes:
- **Refinement — Active Filter Styling:** Updated active filter dropdown items to have a subtle `bg-white/5` background and a custom border matching the separator line color (`border-white/5`), preventing design clutter.
- **Refinement — Simplified Sorting Options:** Removed icons from the "Newest First" and "Oldest First" sorting options to ensure a cleaner and more user-friendly appearance.

## Previous Version (2.25.2)
VersionCode: 145
Date: 2026-07-08
Changes:
- **Refinement — Glassmorphic Filter Dropdown:** Redesigned the filter popup UI in the Memories Gallery with a premium glassmorphic frosted appearance (`backdrop-blur-3xl`, transparent dark overlay, fine border).
- **Refinement — Visual Symbols & Micro-interactions:** Added custom Material Symbol icons to each dropdown option (clocks, histories, and hearts) with smooth scale-up micro-interactions on hover for a highly polished, user-friendly feel.

## Previous Version (2.25.1)
VersionCode: 144
Date: 2026-07-08
Changes:
- **Feature — Memories Gallery Filter Dropdown:** Added a custom filter/sorting dropdown in the Memories Gallery next to the "Search by date" button.
- **Feature — Oldest vs Newest Sorting:** Allows sorting gallery images/videos in chronological order (Oldest First) or reverse chronological order (Newest First) with full paginated database synchronization.
- **Feature — Uploader Filter:** Added quick filters to view memories shared by "Both of Us", "Only Me", or "Only [Partner]".

## Previous Version (2.25.0)
VersionCode: 143
Date: 2026-07-08
Changes:
- **Feature — Reels PFP Updater:** Added an "Add to PFP" option to the Reels "More" options menu. Users can now set any photo memory or a captured frame from any video reel as their profile photo directly from the Reels screen.
- **Feature — Integrated Profile Cropper:** Selecting "Add to PFP" opens the standard circular image cropping modal, allowing users to zoom and adjust the crop of their new avatar before uploading.

## Previous Version (2.24.2)
VersionCode: 142
Date: 2026-07-08
Changes:
- **Feature — Synchronized Realtime Emoji Clicks:** Clicking/tapping an emoji-only message bubble triggers a broadcast event via Supabase Realtime, immediately replaying the animation on both users' screens simultaneously.
- **Feature — Limited Animation Loops:** Animated emojis now animate exactly 2 times initially and stop (rendering the static Apple emoji). Replayed animations on click play exactly 1 time.
- **Fix — Smiling Face with Hearts (🥰) Bug:** Forced both `🥰` and `😍` to use the Google Noto animated fallback to prevent `🥰` from incorrectly displaying the `😍` (heart-eyes) WebP animation from the Telegram CDN.

## Previous Version (2.23.3)
VersionCode: 139
Date: 2026-07-08
Changes:
- **Feature — Telegram Animated Emojis:** Upgraded the animated emoji system from Google Noto to Telegram's native animated emojis. Utilizes a CDN mapping system using `unicode-emoji-json` to dynamically fetch high-quality animated WebP emojis based on their English names.
- **Fix — Animated Emoji Fallbacks:** Restored proper multi-stage fallback logic where the app tries Telegram animated emojis first, falls back to Google Noto animations on error, and finally falls back to static Apple-style emojis.

## Previous Version (2.22.5)
VersionCode: 136
Date: 2026-07-07
Changes:
- **Feature — LRFU Cache Eviction:** Upgraded the media cache eviction policy from basic LRU to a hybrid LRFU (Least Recently & Frequently Used) model. Added a time-decay popularity score with a 48-hour half-life to prevent scrolling from evicting frequently viewed photos and videos.
- **Feature — Persistent Media Cache:** Implemented a persistent L2 media cache using IndexedDB (`idb-keyval`) to drastically reduce Cloudinary bandwidth consumption. Decrypted images, videos, avatars, and note backgrounds now survive page reloads and tab switches without re-fetching from the network.
- **Optimization — Bandwidth Leak Fixes:** Added in-flight request deduplication to `EncryptedImage` (so avatars and UI elements share the same fetch) and reduced the Reels background pre-load window from 4 to 2 to minimize wasteful downloads.
- **Feature — Storage Dashboard:** Added real-time Media Cache statistics (size and item count) to the Settings > Storage section, with a one-click "Manage App Storage" button to safely clear both RAM and persistent cache.

## Previous Version (2.22.2)
VersionCode: 133
Date: 2026-07-07
Changes:
- **Fix — Reels Button Highlights:** Removed the black background hover/active styles and the browser-level dark tap highlight overlays for the Reels action buttons, replacing them with a premium transparent/white-subtle glow.
- **Fix — Reels Folder Picker UI:** Repositioned the folder picker popup to display at the exact left side of the Folder button at the same height. Aligned the layout and colors to match the premium MediaViewer folder picker style.
- **Feature — Reels Folder Saving:** Replaced the Note button on the Reels page with a direct "Add to Folder" folder action. Users can now choose or create a collection/folder and organize high-quality reels immediately.
- **Feature — Reels Garbage Bin:** Added a 3-dot actions menu to the right side of the Reel Card. Users can stage poor/boring reels into the Garbage bin immediately, which are then filtered out of their feed.
- **Walkthrough — Reels Onboarding:** Introduced a guided walkthrough banner on the Reels tab, which is triggered when clicking "Get Started" on the What's New modal.

## Previous Version (2.22.0)
VersionCode: 131
Date: 2026-07-07
Changes:
- **Feature — Raw Note Mode:** Added a toggle button in the note editor to view/edit notes in their raw text format, bypassing rich text/markdown automatic preview styling. The raw setting persists in the database so that every user sees the note exactly as raw text, without affecting other notes.
- **Walkthrough — Raw Note Tutorial:** Introduced an interactive walkthrough banner on the notes page to guide the user on how to use the raw note toggle.
- **What's New Modal Update:** Updated the What's New modal to present the new Raw Note feature.

## Previous Version (2.21.0)
- **Feature — Pull-to-Refresh & Chat Reload:** Implemented a physics-based, glassmorphic swipe-to-refresh component wrapper for mobile (touch drag) and desktop (mouse drag) scrolling containers. Added a header-sync refresh button for instant manual re-fetching and rebuilding of Realtime database subscriptions to recover from 503/500 connection drops.
- **Fix — Supabase 500/503 Connection Dropouts:** Handled database schema caching timeouts and sleep-mode disconnects by allowing a full-scope clean re-query without resetting the application state.
- **Walkthrough — Reload & Refresh Tutorial:** Added contextual onboarding tutorials and walkthrough banners to both desktop and mobile chat screens.
- **Feature — YouTube-Style Video Streaming:** Restored progressive video playback via MediaSource Extensions (MSE) allowing receivers to play chunked videos instantly as soon as first few blocks land.
- **Fix — NaCl Decryption MAC Failures:** Resolved decryption failures on video resume/reload by adding `downloadingIndices` track queue to prevent race conditions between Realtime and loadExistingChunks fetches, and ensuring already-decrypted blocks are preserved.
- **Fix — Supabase 400 & 406 Errors:** Filtered out undefined/null/empty ID inputs to `.in('id', ...)` Supabase filters, and gracefully handle PGRST116 (missing profile row) on profile stats load to prevent screen crashes.
- **Walkthrough — Video Streaming Onboarding:** Added contextual tutorial walkthrough banner for the streaming video feature.
- **Feature — Retry Failed Messages:** Added a context menu option "Retry Resend" (3-dots/right-click for desktop, long-press for mobile) for failed outgoing messages (both text and media), allowing users to resend them instantly without retyping.
- **Walkthrough — Retry Message Tutorial:** Integrated an interactive walkthrough banner on Chat Screens (desktop & mobile) with a "Try Demo Now" button to simulate a failed message and guide the user.
- **What's New Modal Update:** Updated the "What's New" modal to feature the resend capability with guided onboarding.
- **Fix — Streaming Video Playback & Loop:** Kept strong JS references to decrypted Blob objects to prevent garbage collection and resolve ERR_FILE_NOT_FOUND error on loop or seek. Properly clear store states on playback error retry.
- **UX Fix — Folders List Styling:** Increased padding of folder items in chat menu and hid the scrollbar for a premium presentation.

## Previous Version (2.18.0)
- **Feature — Save Chat Media to Folders:** Added a new menu item to the chat media context menu (3-dots) to save all images/videos inside single or multi-media message bubbles to a folder at once.
- **Walkthrough — Save to Folder Tutorial:** Introduced a dismissible contextual walkthrough banner at the top of the chat view when clicking "Get Started" from the What's New modal.

## Previous Version (2.17.3)
- **Feature — Frequent & Recent Folders:** Automatically sort collections/folders by the time media was last added to them. Whichever folder media was recently added to will rise to the top of the list.
- **Walkthrough — Contextual Tutorial:** Implemented a new walkthrough banner in the Memories screen and a walkthrough tooltip inside the Media Viewer directing users on how to use the folder sorting.
- **UX Update — WhatsNew Modal Glassmorphism:** Restyled the What's New modal to have a premium glassmorphic frosted glass design matching Image 2's aesthetic.
- **Fix — Modal Display timing:** Relocated the What's New modal trigger so it only displays after the user enters their correct security PIN, instead of showing on the Cart / PIN-lock screen.

## Previous Version (2.17.0)
- **Feature — Collection Folder Renaming:** Users can now rename their media folders (collections) directly from the collection list panel or within the collection details view.
- **Fix — Point & Line Lab Coordinate Accuracy (content-group CTM):** The real root cause: function-plot's d3 scales (`xScale`/`yScale`) operate in a nested `<g>` element's local coordinate system (offset from the SVG root by `translate(marginLeft, marginTop)`). Previous code was using `getScreenCTM()` on the SVG root, passing SVG-root coords to scales that expected group-local coords — causing every coordinate to be shifted by the margin. Now uses `getScreenCTM()` on the actual content group element, so the matrix inverse automatically accounts for the translate offset. Manual fallback also reads the actual margin values from the SVG's `translate` transform instead of hardcoded guesses.
- **Hotfix — processBlock null-guard:** Added early bail-out when `chunk_key`, `chunk_nonce`, `chunk_url`, or `chunk_index` are missing/undefined in a Realtime event payload. Previously caused `TypeError: Cannot read properties of undefined (reading 'split')` crash in `unwrapSymmetricKey` for Reels rows that don't carry a `chunk_key` field.
- **Faster decryption retry:** Reduced retry backoff from 1s/2s to 200ms/400ms. For permanently-corrupted old chunks (NaCl MAC check failed), all 3 attempts now finish in ~600ms instead of ~9 seconds, unblocking the UI significantly faster.


## Previous Version (2.16.0)
- **Adaptive Chunk Sizing (Solution B):** Web uploads now use 8MB chunks on fast connections (3-8MB adaptive via Network Information API), down to 3MB on slow connections. Native Android uses 2MB chunks (safe for Capacitor bridge Base64 limits). Previous 1MB fixed size caused excessive API calls.
- **Memory-Efficient Native Encryption (Solution A):** Rewrote Android native upload path to encrypt+enqueue one chunk at a time (3 in parallel) instead of holding all encrypted blocks in memory simultaneously. Eliminates OOM risk on large videos. Sequential bridge calls → 3-concurrent rolling bridge calls.
- **Web Parallel Limit Tuned (Solution C):** Reduced web parallel upload limit from 5 to 3 to prevent bandwidth saturation with the new larger 8MB chunks. Net result: fewer, larger requests with cleaner pipeline.
- **MSE Streaming Re-enabled with Race Condition Fix (Solution D):** Receiver-side video now starts playing after first chunk arrives (YouTube-style) via MediaSource Extensions. Fixed the previous ERR_FILE_NOT_FOUND race condition: MSE blobUrl is now kept stable for the life of MediaSource; reusableBlobUrl (plain Blob) is assembled in background after all chunks arrive for fullscreen/second-mount use. Non-fragmented videos auto-fall-back to blob-assembly.



## Previous Version (2.15.3)
- Cleaned up unused imports (Calendar) and unused local declarations (day) to ensure clean compiler builds.

## Previous Version (2.15.2)
- Added video cover/thumbnail frame selector feature to the manual reel creator.
- Users can now pause/seek the video to any preferred frame and capture it instantly using a new "Use Current Frame" action.
- Automatically generates and displays a first-frame fallback cover on video selection.

## Previous Version (2.15.1)
- Replaced native date inputs with a custom, premium calendar picker on the upload reel screen that adapts to the app theme.
- Added quick anniversary shortcuts (e.g., 1 Year Ago, 5 Years Ago) to easily target past events.
- Features custom Month/Year quick selectors and Chevron navigation for easy backdating.

## Previous Version (2.15.0)
- Raised reel video upload limit from 200 MB to **1 GB** by routing all video uploads through `processAndUploadChunked` instead of the single-blob `processAndUpload` path.
- Videos are now split into 1 MB encrypted blocks, uploaded in parallel (up to 5 at a time), and streamed progressively.
- Pre-inserts the `messages` row (with `is_reel_upload: true`) before chunking starts, so the recipient sees the thumbnail instantly.
- Live per-chunk progress bar (20–95%) in the upload UI with readable status strings.
- Updated `FILE_SIZE_LIMITS.video` in `useMedia.ts` to 1 GB to keep all validation consistent.

### Version 2.14.0
- Added image and video cropping features when uploading reels manually.
- Integrated `react-easy-crop` inside manual reel creator with 6 preset aspect ratios (9:16, 2:3, 4:5, 1:1, 16:9, 21:9).
- Image crops are processed via client-side canvas drawing before encryption and upload.
- Video aspect ratio choices are stored in metadata and rendered dynamically with proper containment/clipping in the feed.

## Previous Versions
### Version 2.13.7 (Code 109)
- Fixed coordinate scaling mismatch under responsive layout resize by normalizing client-screen pointer pixels back to function-plot's internal coordinate dimensions before inverting via D3 scales.

### Version 2.13.6 (Code 108)

- Replaced manual coordinate mapping math in mousemove and click handlers with function-plot D3 linear scale inverters (xScale.invert/yScale.invert), achieving 100% pixel-perfect point-plotting and hover coordinate accuracy.

### Version 2.13.5 (Code 107)
- Fixed a bug where plotted lines/shapes temporarily turned grayish after less than a second by copying presentation stroke attributes directly to inline style overrides.

### Version 2.13.4 (Code 106)
- Added point label indicators rendered directly above plotted points on the graph canvas.
- Added support for direct point connection on the graph (click an existing point to set as start, select solid/dotted style, and click a second point to connect).
- Fixed a bug where custom grid lines disappeared on zoom-out by generating grid lines using robust polyline paths instead of implicit/built-in function samplers.
- Fixed layout clipping inside the Point Lab by setting overflow-visible on the sub-tab container, resolving dropdown menu cutoffs.

### Version 2.13.3 (Code 105)
- Wired the custom shape rendering prop in the Math Lab screen to the Canvas, enabling rendering of multi-point lines, polygons, triangles, rectangles, and squares.
- Implemented dynamic auto spacing grid lines that scale and display reference grid lines automatically on zoom and pan.
- Removed the "Spacing" text label from the grid spacing selector in the toolbar for a cleaner look.

### Version 2.13.2 (Code 104)
- Redesigned and positioned Point & Line Lab and Intersection Solver select menus downward with custom dark-themed menus, fully fixing the layout alignment, and implemented a click-outside listener to automatically close open popovers.
- Added a "Snap to Grid" toggle, allowing clicked points on the graph to snap to perfect integer/grid coordinates.
- Added an adjustable "Grid Spacing" control, enabling fine-grained, dynamic reference grid lines spaced at Auto, 1, 2, or 5 units.

### Version 2.13.1 (Code 103)
- Fixed default CommonJS import issue with `function-plot` in ES modules/Vite by wrapping the invocation in a fallback resolver.
- Redesigned the Math Lab sidebar layout to use pure Tailwind responsive visibility and height classes, fixing the collapsed/hidden layout rendering bug.
- Implemented the interactive **Point & Line Lab** section, allowing manual point plotting (by entering X/Y coordinates) and interactive click-to-plot directly on the graph canvas.
- Added a Point Joiner tool to construct straight lines (including horizontal/vertical boundary lines) between any two plotted points and render their equations (e.g., $y = mx + c$).
- Developed a numerical intersection solver to calculate and highlight intersection points (rendered as green dots) between any functions or lines.
- Prominently styled X and Y zero-axis lines to draw through the origin and remain visible at all times, dividing the view clearly into four quadrants.
- Centered zoom controls symmetrically around $(0, 0)$ to keep the origin centered in the canvas viewport.

## Previous Versions
### Version 2.13.0 (Code 102)
- Added "Math Lab" feature, providing a dedicated graph plotting and mathematical analysis tool customized for IIT Madras BS Degree Qualifier Exam preparation.
- Supports plotting up to 5 simultaneous functions in real-time, custom math-symbol keyboard, preset categories grouped by weekly syllabus topics, derivative curve overlays, zoom controls, coordinate tracking on hover, custom coordinate domains, and full responsive dark-mode styling.

### Version 2.12.2 (Code 101)
- Overlaid post header over tall aspect ratio media (> 2:3 ratio) on mobile viewports to mimic native Instagram style, showing such media in its original height.

### Version 2.12.1 (Code 100)
- Fixed TypeScript compiler errors in `HomeScreen.tsx` caused by references to the renamed `setDecryptedUrl` state.

### Version 2.12.0 (Code 99)
- Major performance overhaul: Posts (Home Feed) now use a Memories-style central priority decryption queue with 8 parallel workers, 1500px look-ahead, and visibility-based prioritization. Media for upcoming posts is decrypted before the user even scrolls to them, making the feed feel instant.
- Reels media loading optimized: increased parallel decryption semaphore from 3 to 8 slots and extended look-ahead pre-loading from 2 to 4 adjacent reels, so the next reels are fully decrypted and ready before swiping.

### Version 2.11.1 (Code 98)
- Fixed a critical "Maximum update depth exceeded" infinite loop bug in Memories Gallery screen by properly optimizing the useEffect dependency array for the decryption priority queue.
- Fixed a bug where media grid items in the Explore screen appeared broken after returning from the Memories Gallery screen, by centralizing object URL cache management and cleanup inside the parent ExploreScreen component and preventing premature URL revocation on child unmount.
- Fixed a DOMException "Node cannot be found in the current page" crash when toggling laser mode/drawing mode in the NoteEditor by wrapping the EditorContent inside a stable container div to avoid DOM reconciliation conflicts.

## Previous Versions
### Version 2.11.0 (Code 97)
- Overhauled the mobile Notes editor: replaced the modal dialog with a fully-immersive, full-screen page including a premium slide-in transition from the right, removing backdrops, borders, and margins on mobile while keeping centered cards on larger screens.
- Fixed the Drawing Canvas laser mode: resolved pointer move latency by utilizing synchronous ref event tracking instead of async React state updates, and added a glowing core laser dot at the pointer tip for enhanced visibility.

### Version 2.10.19 (Code 96)
- Removed margin top and bottom from the moments carousel element on the home page.
- Removed margin top from where the post feed starts on the home page.

### Version 2.10.18 (Code 96)
- Fixed "Extract & Send Frame" feature sending a black/blank image. Root causes: (1) `chunked_video` type was not finding the correct video element (videoRef is only for standard videos), (2) `document.querySelector('video')` could grab the wrong element, (3) frame was captured while the video was still playing (decoder hadn't settled on the current frame). Fix: search for the best ready video inside the viewer overlay, pause the video, seek to the current time to trigger a decoder flush via the `seeked` event, capture the frame after the decoder settles, resume playback, and add a blank-frame sanity check with an automatic retry.

### Version 2.10.16 (Code 94)
- Fixed video frame capture black screen issues in fullscreen mode by implementing a parent-container-level fullscreen mode for MediaViewer.
- Added a custom fullscreen toggle button in the MediaViewer toolbar and hid native browser video player fullscreen controls.
- Integrated parent fullscreen triggers with ChunkedVideoPlayer.

### Version 2.10.15 (Code 93)
- Batched the Memories Gallery fullscreen media viewer dynamically by day so swiping only scrolls through media shared on that same date.
- Fixed TypeScript compiler errors in ExploreScreen by typing partner's public key safely and removing unused motion imports.
### Version 2.10.14 (Code 92)
- Added ArrowUp and ArrowDown keyboard arrow keys navigation to dedicated and profile Reels screen viewports on desktop.
- Prevented double/triple reel snapping skipping (momentum snapping) on both desktop and mobile devices by adding `scrollSnapStop: 'always'` to all Reels container items and placeholders.
### Version 2.10.13 (Code 91)
- Overhauled the profile full-screen reels swiper viewer: replaced the initial scrolling/sliding animation with an instant positioning jump using `useLayoutEffect` and removing `scroll-smooth`, allowing the clicked item to open immediately with normal swiping behavior (just like Instagram).

### Version 2.10.12 (Code 90)
- Added left and right keyboard arrow navigation (with input-focus safety) to the full-screen MediaViewer and StoryViewer on desktop viewports.
- Replaced the "Jump to Latest" button in both desktop and mobile chat screens with a simple circular down-arrow button.

### Version 2.10.11 (Code 89)
- Replaced the "Jump to Latest" button in both desktop and mobile chat screens with a simple circular down-arrow button.

### Version 2.10.10 (Code 88)
- Replaced the `react-zoom-pan-pinch` wrapper (`TransformWrapper`) with a plain containerized image in the full-screen MediaViewer. This completely solves the issue on mobile where swiping multiple images caused them to get grabbed and panned around, allowing the touch events to bubble up cleanly and behave exactly like standard moments swiping.

### Version 2.10.9 (Code 87)
- Cleaned up unused `direction` state and its references from `MediaViewer.tsx` to fix TypeScript/ESLint warnings about declared but unread variables.

### Version 2.10.8 (Code 86)
- Refactored the full-screen chat MediaViewer swipe gesture to use a state-independent useRef tracking mechanism, matching the high-performance implementation in MomentViewer. This eliminates intermediate re-renders during drag starts, resulting in an exceptionally smooth and responsive swipe transition. Also aligned the slide animation to use the clean fade-and-scale effect.

### Version 2.10.7 (Code 85)
- Curated moments loading optimization: if the first item in any moment card is a video (either standard or chunked), it is automatically pre-loaded and pre-decrypted in the background upon mounting. This makes it instantly available for playback without loading delay when opened.

### Version 2.10.6 (Code 84)
- Implemented hover-to-play video playback for feed posts on desktop viewports. When hovering over a video post card, it will automatically play, and when the mouse leaves, it will automatically pause. Auto-playback via viewport entry is disabled for desktop viewports.

### Version 2.10.5 (Code 83)
- Removed sticky positioning from the homepage header on both mobile and desktop viewports, allowing it to stay in normal layout flow and scroll away with the page content.

### Version 2.10.4 (Code 82)
- Cleaned up profile screen tab labels: changed the tab label from displaying the partner's name ("Wife's Posts") to a simpler "Posts" label when viewing the partner's profile page.

### Version 2.9.18 (Code 81)
- Added double-tap/double-click to like feature for feed posts on the HomeScreen, featuring a premium animated heart burst overlay effect and custom click delay to separate media play/pause from like triggers.

### Version 2.9.17 (Code 80)
- Fixed desktop Home Feed post layout to render as a clean Pinterest-style masonry grid. Removed the viewport constraint in aspect ratio detection to allow media to scale to its native aspect ratio on desktop, and eliminated vertical container stretching (removed flex-1 constraint when original ratio is active) to completely resolve top/bottom black bars and empty spacing inside cards.

### Version 2.9.16 (Code 79)
- Refactored the HomeScreen 2-column post layout on desktop viewports to use a dynamic masonry grid layout. This allows columns to stack post cards of uneven heights without leaving empty vertical gaps, while preserving correct chronological order.

### Version 2.9.15 (Code 78)
- Suppressed new message in-app toast notifications from appearing while the app is locked or on the PIN entry screen, resolving visual privacy leaks before app access is granted.

### Version 2.9.14 (Code 77)
- Overhauled the HomeScreen post feed layout from a single vertical column to a 2-column grid on desktop and larger viewports. Adjusted the FeedPost card to adapt fluidly to the column widths (w-full, h-auto, aspect-[2/3]) instead of restricting it to viewport height limits.

### Version 2.9.13 (Code 76)
- Fixed a rendering issue in the Shared Notepad on the Home Feed where Tiptap HTML tags (like `<p>`, `<h1>`, etc.) were displayed as raw text inside note preview cards, by introducing a `getPlainText` HTML stripper.

### Version 2.9.12 (Code 75)
- Refined desktop sidebar spacing by reducing the gap between navigation tabs from 8 to 5 (`gap-5`).

### Version 2.9.11 (Code 74)
- Added dynamic scaling for active navigation sidebar buttons on desktop: active buttons now show with py-5 and px-6 padding.
- Shifted the GIF entry point from the main input action bar into the "+" (attachment options) menu for all viewports.

### Version 2.9.10 (Code 73)
- Fully cleaned up internal sonner wrapper container layout ([data-content]) by forcing width, background, borders, and margins to inherit transparency and fit content size.

### Version 2.9.9 (Code 72)
- Re-aligned the custom top-right toast to sit flush with the right viewport edge (with padding) and set space to sit on the left of the toast.

### Version 2.9.8 (Code 71)
- Implemented robust class-based CSS styling override for the custom toast container, completely eliminating wrapper background leakage on mobile viewports.

### Version 2.9.7 (Code 70)
- Fixed toast notification UI bug on mobile where the default sonner wrapper background extended beyond the rounded custom toast card.

### Version 2.9.6 (Code 69)
- Resolved unused import and unused state warnings (`Zap`, `Coffee`, `mySnappedToday`, `partnerSnappedToday`) on the HomeScreen by rendering the `Zap` and `Coffee` Lucide icons in the nudge buttons and implementing detailed descriptive text for the active streak card.
### Version 2.9.5 (Code 68)
- Replaced the redundant chat widget on the desktop Home feed sidebar with a beautiful, premium "Together Space" Partner Dashboard. The dashboard includes live call controls, interactive streak status, trophy milestones, total shared vault media counters, quick love emoji nudges, and a real-time synchronized couple notepad/checklist widget.

### Version 2.9.4 (Code 67)
- Fixed an auto-scroll bug on the HomeScreen where the side chat widget's scrollIntoView caused the entire home feed to scroll down when landing or receiving new messages.

### Version 2.9.3 (Code 66)
- Fixed duplicate import of `realtimeHub` in [App.tsx](file:///c:/D%20drive%20D/College%20Detailed%20Projects/ai%20projects/client/new-social-media-app/src/App.tsx) causing build problems.

### Version 2.9.2 (Code 65)
- Added in-app new message toast notification (top-right) that appears when the user is online but not on the chat page — shows a gold-accented card with "New Message" and "Tap to open chat →". Tapping the toast navigates directly to the chat tab.
- Added animated gold accent dot on the Chat icon in both the mobile bottom navigation bar and the desktop sidebar when unread messages arrive while the user is on another page. The dot pulses subtly and clears automatically when the user opens the chat tab.

### Version 2.9.0 (Code 63)
- Implemented smart automated aspect-ratio detection on mobile: if an image or video's original height-to-width ratio is less than 1.5 (meaning it is shorter in height than 2:3, e.g., 4:5, 1:1, or 16:9), it is automatically displayed in its original ratio by default instead of cropping to 2:3.
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
