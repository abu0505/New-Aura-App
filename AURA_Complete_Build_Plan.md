# AURA — Complete Build Plan (All Phases)
## Private Couples Messenger — Full Implementation Guide

> **Purpose**: This document captures every detail needed to build AURA from its current state through completion. Use it in any AI coding IDE (Cursor, Windsurf, Bolt, etc.) to continue development.

---

## Current State Summary (What's Already Built)

### Database (Supabase) ✅
All tables are created and live with RLS policies:
- `profiles` — display_name, avatar_url, public_key, is_online, last_seen
- `messages` — encrypted_content, nonce, type (enum: text/image/video/audio/document/location/sticker), media fields, reaction, reply_to, read/delivered receipts, edit/delete flags
- `stories` — encrypted ephemeral content with 24h expiry
- `pinned_messages` — message_id + pinned_by
- `live_locations` — encrypted_lat/lng with is_sharing flag
- `chat_settings` — background_url, notification_enabled per user
- `push_subscriptions` — endpoint, p256dh, auth for Web Push
- `streaks` — current_streak, longest_streak, last_message_date per user

**Supabase Realtime** enabled on: messages, profiles, stories, live_locations

**Triggers**: Auto-create profile on signup, auto-update `updated_at` timestamps

### Supabase Project Details
- **URL**: `https://ugfxjjakpsngfdrjlsdr.supabase.co`
- **Anon Key**: stored in `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
- **Cloudinary**: cloud name `del5o1vnd`, upload preset `hamara-encrypted-media`

### Frontend Code ✅ (with build errors to fix)
- **Auth**: `AuthContext.tsx` — email/password login, session persistence, auto keypair generation
- **Encryption**: `src/lib/encryption.ts` — TweetNaCl box/secretbox for messages and media
- **Chat hook**: `src/hooks/useChat.ts` — fetch, realtime subscribe, send, edit, delete, react, pin
- **Partner hook**: `src/hooks/usePartner.ts` — finds the other user in profiles table
- **Typing**: `src/hooks/useTypingIndicator.ts` — Supabase Realtime Broadcast
- **Online status**: `src/hooks/useOnlineStatus.ts` — visibilitychange event
- **Chat UI**: ChatBubble, ChatInput, MessageList, MessageContextMenu, ReactionPicker, PinnedMessagesBanner, TypingIndicator, AttachmentSheet, MediaViewer
- **Layout**: AppShell (flex column with BottomNav), Header, BottomNav (Chat/Stories/Location/Settings tabs)
- **Login page**: Animated gradient background, AURA wordmark, gold "Unlock AURA" button
- **Design system**: Dark theme with gold accents, Playfair Display + DM Sans fonts

### Known Build Error ⚠️
```
Rollup failed to resolve import "@supabase/supabase-js"
```
**Fix**: Run `npm install @supabase/supabase-js` (or `bun add @supabase/supabase-js`). The dependency is imported but may be missing from package.json.

Also check these dependencies are installed:
- `tweetnacl`, `tweetnacl-util` (encryption)
- `framer-motion` (animations)
- `date-fns` (date formatting)
- `sonner` (toast notifications)
- `lucide-react` (icons)
- `@tanstack/react-query` (data fetching)
- `react-router-dom` (routing)

---

## PHASE 1: Fix Build & Polish Core Chat

### Priority: Fix build errors first

**Step 1.1 — Install missing dependencies**
```bash
npm install @supabase/supabase-js tweetnacl tweetnacl-util framer-motion date-fns
```

**Step 1.2 — Verify Supabase types match schema**

File: `src/integrations/supabase/types.ts`

This file needs to be regenerated or manually updated to match the actual database schema. The types should include all tables (profiles, messages, stories, pinned_messages, live_locations, chat_settings, push_subscriptions, streaks) with their exact column types. Use `npx supabase gen types typescript` or manually define the `Database` type.

**Step 1.3 — Remove `(supabase as any)` casts**

Throughout `useChat.ts`, `usePartner.ts`, `useOnlineStatus.ts`, `AuthContext.tsx`, the Supabase client is cast as `any` to bypass type checking. Once the types file is correct, replace all `(supabase as any)` with just `supabase` for proper type safety.

**Step 1.4 — Message Forwarding**
Forwarding should re-send a message with a "Forwarded" label (PRD 8.8).

**Step 1.5 — Test core chat flow**
1. Create 2 users in Supabase Auth dashboard (email + password)
2. Log in as User A in one browser, User B in another
3. Verify: messages send, encrypt, decrypt, appear in realtime
4. Verify: reactions, edit, delete, pin, reply all work
5. Verify: typing indicator shows, online status updates

---

## PHASE 2: Media Attachments (Full Implementation)

### 2.1 — Image Attachment

**Files to create/edit:**
- `src/hooks/useMediaUpload.ts` — orchestrates: pick file → optimize → encrypt → upload → send message
- `src/components/chat/QualityChoiceModal.tsx` — "Original vs Optimized" cards with size estimates
- Edit `ChatBubble.tsx` — image type: show thumbnail with blur while decrypting, tap for fullscreen

**Flow:**
1. User taps attachment → selects Photo/Video from `AttachmentSheet`
2. Browser file picker opens (`accept="image/*"`)
3. `QualityChoiceModal` appears showing:
   - **Original**: actual file size, "Full quality"
   - **Optimized**: estimated compressed size (~2MB), "Saves data"
4. If optimized: use `browser-image-compression` library:
   ```ts
   import imageCompression from 'browser-image-compression';
   const compressed = await imageCompression(file, {
     maxSizeMB: 2,
     maxWidthOrHeight: 1920,
     fileType: 'image/webp',
     useWebWorker: true
   });
   ```
5. Encrypt the image bytes with `nacl.secretbox()` (random key)
6. Encrypt the symmetric key with recipient's public key via `nacl.box()`
7. Upload encrypted blob to Cloudinary as `raw` resource type
8. Insert message with type='image', media_url, media_key (encrypted symmetric key), media_nonce
9. Generate thumbnail: resize to 200px width, upload separately as thumbnail_url
10. **Selection Memory**: Store the user's last choice (Original vs Optimized) in `localStorage` and pre-select it next time (PRD 24.3).

**Decryption on receive:**
1. Fetch media_url
2. Decrypt symmetric key using sender's public key
3. Decrypt image bytes with symmetric key
4. Create object URL and display

**Dependencies:** `npm install browser-image-compression`

### 2.2 — Video Attachment

**Same flow as image, with video optimization:**
- Use `@ffmpeg/ffmpeg` (WASM) for client-side compression
- Show progress bar during transcoding
- Target: CRF 23, H.264, 720p max
- Generate video thumbnail at 1s mark

```ts
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();
await ffmpeg.load();
await ffmpeg.writeFile('input', await fetchFile(file));
await ffmpeg.exec(['-i', 'input', '-c:v', 'libx264', '-crf', '23', '-vf', 'scale=-2:720', '-preset', 'fast', 'output.mp4']);
const data = await ffmpeg.readFile('output.mp4');
```

**Dependencies:** `npm install @ffmpeg/ffmpeg @ffmpeg/util`

### 2.3 — Audio Recording & Attachment

**Components:**
- `src/components/chat/AudioRecorder.tsx` — hold-to-record mic button

**Implementation:**
- Use `MediaRecorder` API with `audio/webm` or `audio/ogg`
- Show waveform during recording (use `AnalyserNode` from Web Audio API)
- Slide-left-to-cancel gesture
- On release: encrypt audio → upload to Cloudinary → send message with type='audio', duration field

**Playback in ChatBubble:**
- Custom audio player with waveform visualization
- Play/pause button, scrubber, duration display
- Speed toggle: 1x / 1.5x / 2x (`audioElement.playbackRate`)

### 2.4 — Document Attachment

- File picker: `accept="*"` with common MIME types
- No optimization, just encrypt and upload as `raw` to Cloudinary
- Show file icon + name + size in bubble
- Tap to download (decrypt → create blob → trigger download)

### 2.5 — Location Message

- Use `navigator.geolocation.getCurrentPosition()`
- Encrypt lat/lng as text
- Show static map thumbnail in bubble (use OpenStreetMap tile URL or a simple lat/lng display)
- Tap opens the Location tab

### 2.6 — Media Viewer (Fullscreen)

**File:** `src/components/chat/MediaViewer.tsx` (exists but needs full implementation)

- Fullscreen overlay with dark backdrop
- Pinch-to-zoom for images (use CSS `transform: scale()` with touch events, or `react-zoom-pan-pinch` library)
- Swipe to dismiss
- Video: fullscreen player with native controls
- Share/download button

---

## PHASE 3: Stories

### 3.1 — Database (Already exists)
Table `stories` with encrypted_content, media_url/key/nonce, 24h expiry, viewed_at

### 3.2 — Story Creation

**Files:**
- `src/pages/Stories.tsx` — main stories screen
- `src/components/stories/StoryCreator.tsx` — capture/upload UI
- `src/hooks/useStories.ts` — CRUD + realtime

**Flow:**
1. Stories tab shows: your story circle + partner's story circle
2. Tap "+" on your circle → camera or gallery picker
3. Options: Image, Video (max 30s), Text (colored background with text overlay)
4. Add optional text overlay on images/videos:
   - **Font Options**: 3 styles (Bold, Handwritten, Minimal)
   - **Color Picker**: Choose text color (PRD 10.4).
5. Encrypt media same as chat attachments
6. Insert into `stories` table, expires_at = now + 24h

### 3.3 — Story Viewer

**File:** `src/components/stories/StoryViewer.tsx`

- Full-screen viewer with progress bar at top (like Instagram Stories)
- Auto-advance after 5s for images, video duration for videos
- Tap left/right to navigate between stories
- Swipe down to close
- When partner views your story: update `viewed_at` timestamp
- Show "Seen" indicator on your own stories

### 3.4 — Story Expiry

**Supabase cron job** (pg_cron extension):
```sql
-- Enable pg_cron in Supabase dashboard first
SELECT cron.schedule(
  'delete-expired-stories',
  '0 * * * *', -- every hour
  $$DELETE FROM public.stories WHERE expires_at < now()$$
);
```

Or handle client-side: filter stories where `expires_at > now()` in queries.

### 3.5 — Stories UI Design

- Story circles: gradient gold border (unseen) / grey border (seen)
- Progress bars: thin gold bars at top of viewer
- Background: text stories have gradient backgrounds (array of preset gradients to choose from)

---

## PHASE 4: Streaks

### 4.1 — Database (Already exists)
Table `streaks` with current_streak, longest_streak, last_message_date per user

### 4.2 — Streak Calculation Logic

**Supabase Database Function:**
```sql
CREATE OR REPLACE FUNCTION public.update_streak()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  streak_row streaks%ROWTYPE;
  partner_last_date DATE;
  today DATE := CURRENT_DATE;
BEGIN
  -- Find or create streak row
  SELECT * INTO streak_row FROM streaks
  WHERE (user1_id = NEW.sender_id AND user2_id = NEW.receiver_id)
     OR (user1_id = NEW.receiver_id AND user2_id = NEW.sender_id)
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO streaks (user1_id, user2_id, current_streak, longest_streak)
    VALUES (NEW.sender_id, NEW.receiver_id, 0, 0)
    RETURNING * INTO streak_row;
  END IF;

  -- Update sender's last message date
  IF streak_row.user1_id = NEW.sender_id THEN
    streak_row.last_message_date_user1 := today;
    partner_last_date := streak_row.last_message_date_user2;
  ELSE
    streak_row.last_message_date_user2 := today;
    partner_last_date := streak_row.last_message_date_user1;
  END IF;

  -- Check if both messaged today or consecutive days
  IF partner_last_date IS NOT NULL AND (today - partner_last_date) <= 1 THEN
    IF streak_row.current_streak = 0 OR (today - GREATEST(streak_row.last_message_date_user1, streak_row.last_message_date_user2)) <= 1 THEN
      streak_row.current_streak := streak_row.current_streak + 1;
    END IF;
  END IF;

  -- Update longest
  IF streak_row.current_streak > streak_row.longest_streak THEN
    streak_row.longest_streak := streak_row.current_streak;
  END IF;

  -- Save
  UPDATE streaks SET
    current_streak = streak_row.current_streak,
    longest_streak = streak_row.longest_streak,
    last_message_date_user1 = streak_row.last_message_date_user1,
    last_message_date_user2 = streak_row.last_message_date_user2
  WHERE id = streak_row.id;

  RETURN NEW;
END;
$$;

-- Trigger on new messages
CREATE TRIGGER on_message_update_streak
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_streak();
```

### 4.3 — Streak Reset (Cron)
```sql
SELECT cron.schedule(
  'reset-broken-streaks',
  '0 0 * * *', -- midnight daily
  $$
  UPDATE public.streaks
  SET current_streak = 0
  WHERE GREATEST(last_message_date_user1, last_message_date_user2) < CURRENT_DATE - 1
    AND current_streak > 0
  $$
);
```

### 4.4 — Streak UI

**File:** `src/hooks/useStreak.ts`
```ts
// Subscribe to streaks table via realtime
// Return current_streak, longest_streak
```

**Header integration:** Already has Flame icon + count in Header.tsx. Wire up `useStreak` hook.

**Milestone celebrations** (optional polish):
- 7 days: 🔥 "One week strong!"
- 30 days: 💛 "One month of love!"
- 100 days: ✨ "100 days together!"
- 365 days: 🏆 "One year!"

Show as animated toast/modal with confetti (use `canvas-confetti` library).

**Streak Detail Card**:
Implement a bottom sheet showing current streak, best ever, and today's status for both users (PRD 23.4).

---

## PHASE 5: Live Location Sharing

### 5.1 — Location Screen

**Files:**
- `src/pages/Location.tsx` — map view with both users' locations
- `src/hooks/useLiveLocation.ts` — watch position + encrypt + update Supabase

**Map:** Use Leaflet.js with OpenStreetMap tiles (free, no API key needed)

```bash
npm install leaflet react-leaflet @types/leaflet
```

### 5.2 — Sharing Flow

1. User taps "Share Live Location" button
2. Permission prompt → `navigator.geolocation.watchPosition()`
3. Every 10 seconds: encrypt lat/lng → update `live_locations` table
4. Set `is_sharing = true`
5. Partner sees location on map via Supabase Realtime subscription
6. Auto-stop after 1 hour, or manual stop button

### 5.3 — Map UI

- Full-screen Leaflet map with dark tile theme (CartoDB dark_matter tiles)
- Two animated markers: you (gold) and partner (accent color)
- Accuracy circle around each marker
- "Share" / "Stop Sharing" button at bottom
- Distance between users displayed

**Tile URL (dark theme):**
```
https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png
```

### 5.4 — Location in Chat

When someone sends a location message:
- Static map thumbnail in bubble (Leaflet static image or simple text)
- Tap → navigates to Location tab and centers on that coordinate

---

## PHASE 6: Push Notifications

### 6.1 — Service Worker

**File:** `public/sw.js`
```js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'AURA', {
      body: data.body || 'New message',
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      tag: 'aura-message',
      renotify: true,
      data: { url: '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

### 6.2 — Client-Side Subscription

**File:** `src/lib/pushNotifications.ts`
```ts
const VAPID_PUBLIC_KEY = 'your-vapid-public-key-here'; // from environment

export async function subscribeToPush(userId: string) {
  const registration = await navigator.serviceWorker.register('/sw.js');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  });

  const { endpoint, keys } = subscription.toJSON();

  await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth
  });
}
```

### 6.3 — Supabase Edge Function (Send Push)

**File:** `supabase/functions/send-push/index.ts`
```ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import webpush from 'npm:web-push';

serve(async (req) => {
  const { receiver_id, title, body } = await req.json();

  const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;

  webpush.setVapidDetails('mailto:your@email.com', VAPID_PUBLIC, VAPID_PRIVATE);

  // Fetch receiver's push subscriptions
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', receiver_id);

  for (const sub of subs || []) {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title, body })
    );
  }

  return new Response(JSON.stringify({ success: true }));
});
```

### 6.4 — Database Webhook Trigger

Set up a Supabase Database Webhook on `messages` INSERT that calls the Edge Function. This way every new message automatically triggers a push to the receiver.

**Story Notifications**:
Enhance Edge Function to send "[Name] added to their story ✨" when a new story is inserted (PRD 13.3).

Alternatively, use a Postgres trigger + `pg_net` extension:
```sql
CREATE OR REPLACE FUNCTION notify_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://ugfxjjakpsngfdrjlsdr.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
    body := jsonb_build_object('receiver_id', NEW.receiver_id, 'title', 'AURA', 'body', 'New message')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_message_send_push
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION notify_push();
```

---

## PHASE 7: Settings Screen

### 7.1 — Settings Page

**File:** `src/pages/Settings.tsx`

**Sections:**

1. **Profile**
   - Avatar (tap to change, upload to Cloudinary)
   - Display name (editable inline)
   - Email (read-only, from auth)

2. **Chat Background**
   - Grid of preset dark backgrounds/patterns
   - Option to upload custom background
   - **Apply to Both**: Option to sync background setting to partner's view via Supabase (PRD 12.2).
   - Stored in `chat_settings.background_url`
   - Applied as CSS background on chat screen with brightness(0.3) blur(0px).

3. **Notifications**
   - Toggle: Enable/disable push notifications
   - Stored in `chat_settings.notification_enabled`

4. **Encryption Status**
   - Show: "End-to-end encryption active ✓"
   - Your public key fingerprint (first 8 chars of public key hash)
   - Partner's public key fingerprint
   - **Verify with partner**: Show a comparison view or QR code for manual trust verification (PRD 14.3).
   - "Verify with partner" — show QR code or comparison view

5. **Storage**
   - Show estimated storage used
   - "Clear cached media" button

6. **Account**
   - "Sign out" button (gold outline)
   - App version

### 7.2 — Chat Background Implementation

**File:** `src/hooks/useChatSettings.ts`
```ts
// Fetch and subscribe to chat_settings for current user
// Provide updateBackground(url) and toggleNotifications() functions
```

In `MessageList.tsx`, apply the background:
```tsx
<div style={{ backgroundImage: `url(${settings.background_url})` }} className="...">
```

Provide 6-8 preset backgrounds:
- Subtle dark gradient patterns
- Starfield
- Geometric gold lines on dark
- Soft bokeh
- etc.

Store presets in `src/lib/chatBackgrounds.ts` as an array of URLs or CSS gradients.

---

## PHASE 8: Polish & PWA

### 8.1 — PWA Manifest

**File:** `public/manifest.json`
```json
{
  "name": "AURA",
  "short_name": "AURA",
  "description": "Your private world",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0D0D12",
  "theme_color": "#D4AF61",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Add to `index.html`:
```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#D4AF61" />
<meta name="apple-mobile-web-app-capable" content="yes" />
```

### 8.2 — Performance Optimizations

- Lazy load routes: `React.lazy(() => import('./pages/Stories'))`
- **Read Receipts**: Use `IntersectionObserver` in `MessageList.tsx` to mark messages as read only when they actually scroll into view (PRD 15.3).
- Virtual scroll for message list if >500 messages (use `@tanstack/react-virtual`)
- Image lazy loading with `loading="lazy"`
- Debounce typing indicator (300ms)
- Cache decrypted messages in memory (already done via state)

### 8.3 — Animations & Micro-interactions

Already partially implemented. Additional polish:
- **Message send**: spring scale 0.85 → 1 (done in ChatBubble)
- **Tab switch**: fade + slide transition using `framer-motion AnimatePresence`
- **Context menu**: scale-up spring animation
- **Reaction add**: pop animation
- **Story progress**: smooth linear animation
- **Pull to refresh**: elastic overscroll indicator

### 8.4 — Error Handling

- Network offline indicator (banner at top)
- Message send retry on failure (queue failed messages, retry on reconnect)
- Graceful decryption failure ("Message couldn't be decrypted" bubble)
- Session expired auto-redirect to login

### 8.5 — Accessibility

- All interactive elements focusable
- ARIA labels on icon buttons
- Color contrast ratios ≥ 4.5:1
- Keyboard navigation for context menu

### 8.6 Missing PRD Features (Leftovers)

- **Media Quality Choice Modal** (PRD 9.2 & 24.3): Add a bottom sheet modal when sending images/videos with "Original" vs "Optimized" choice, and remember the choice in `localStorage`. ✅ *(Implemented)*
- **Verify Key Fingerprint** (PRD 14): In Settings, show the user's public key fingerprint and a way to verify with partner (QR code or comparison view). ✅ *(Drafted)*
- **Sticker Pack** (PRD 8.10): Small built-in premium sticker pack (~20 minimal stickers). ✅ *(Drafted)*
- **Chat Background Sync** (PRD 12): Implement the "Apply to both" feature for background changes. ✅ *(Implemented)*
- **Advanced Error Recovery** (PRD 16): Handle `ffmpeg.wasm` load failures gracefully by falling back to Original quality. Add "⚠️ Could not decrypt this message" inline error display. ✅ *(Drafted)*

### 8.7 Fine-Grained PRD Polish (The Final Gaps)

- **🔥 Streak Logic & UI (PRD 23):**
  - Shared Row Logic: Exactly *one* shared row in the `streaks` table for the couple.
  - Streak At Risk UI: Amber pulsing flame and orange text notification (PRD 954).
  - Detail Card Polish: Giant Lottie/CSS fire effect, "Best Ever" and "Snapped Today" checklist (PRD 958).
  - Break Notification: "💔 Your streak broke" push alert (PRD 935).
- **💬 Messaging Polish (PRD 8):**
  - Reply Navigation: Tap reply bubble to scroll-to and highlight original message (PRD 394).
  - Pinned Banner: Automatically cycle through multiple pinned messages (PRD 420).
  - Forwarded Label: Re-sent messages via forwarding are missing the explicit "Forwarded" label (PRD 414).
  - Audio Speed: 1.5x / 2x speed toggle on voice notes (PRD 165).
- **✨ Stories (PRD 10):**
  - Story Reaction: Heart reaction button on partner's stories (PRD 655).
  - Caption Styling: 3 font styles (Bold, Handwritten, Minimal) and color picker for story captions (PRD 666).
- **📍 Location & System (PRD 11 / 15):**
  - Distance Display: "2.4 km apart" live distance display on the map (PRD 689).
  - Offline Banner: "Connecting..." top-level banner when the network is lost (PRD 823).
  - Video Call Placeholder: UI-only video call icon in the header (PRD 340).

---

## File Structure (Target Final State)

```
src/
├── App.tsx
├── App.css
├── index.css
├── main.tsx
├── vite-env.d.ts
├── types/
│   └── chat.ts
├── contexts/
│   └── AuthContext.tsx
├── hooks/
│   ├── useChat.ts
│   ├── useChatSettings.ts
│   ├── useLiveLocation.ts
│   ├── useMediaUpload.ts
│   ├── use-mobile.tsx
│   ├── useOnlineStatus.ts
│   ├── usePartner.ts
│   ├── useStories.ts
│   ├── useStreak.ts
│   ├── use-toast.ts
│   └── useTypingIndicator.ts
├── lib/
│   ├── cloudinary.ts
│   ├── encryption.ts
│   ├── pushNotifications.ts
│   ├── chatBackgrounds.ts
│   └── utils.ts
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx
│   │   ├── BottomNav.tsx
│   │   └── Header.tsx
│   ├── chat/
│   │   ├── AttachmentSheet.tsx
│   │   ├── AudioRecorder.tsx
│   │   ├── ChatBubble.tsx
│   │   ├── ChatInput.tsx
│   │   ├── MediaViewer.tsx
│   │   ├── MessageContextMenu.tsx
│   │   ├── MessageList.tsx
│   │   ├── PinnedMessagesBanner.tsx
│   │   ├── QualityChoiceModal.tsx
│   │   ├── ReactionPicker.tsx
│   │   └── TypingIndicator.tsx
│   ├── stories/
│   │   ├── StoryCreator.tsx
│   │   ├── StoryViewer.tsx
│   │   └── StoryCircle.tsx
│   ├── settings/
│   │   ├── ProfileSection.tsx
│   │   ├── BackgroundPicker.tsx
│   │   ├── EncryptionStatus.tsx
│   │   └── NotificationToggle.tsx
│   └── ui/ (shadcn components)
├── pages/
│   ├── Chat.tsx (exists — renamed from Index)
│   ├── Login.tsx
│   ├── Stories.tsx
│   ├── Location.tsx
│   ├── Settings.tsx
│   └── NotFound.tsx
└── integrations/
    └── supabase/
        ├── client.ts
        └── types.ts

supabase/
├── config.toml
├── migrations/
│   └── (existing migration)
└── functions/
    └── send-push/
        └── index.ts

public/
├── sw.js
├── manifest.json
├── icon-192.png
├── icon-512.png
├── placeholder.svg
└── robots.txt
```

---

## Routing (Target)

```tsx
<Routes>
  <Route path="/login" element={<Login />} />
  <Route path="/" element={<AppShell><Chat /></AppShell>} />
  <Route path="/stories" element={<AppShell><Stories /></AppShell>} />
  <Route path="/location" element={<AppShell><Location /></AppShell>} />
  <Route path="/settings" element={<AppShell><Settings /></AppShell>} />
</Routes>
```

All routes except `/login` are wrapped in `<ProtectedRoute>`.

---

## Dependencies (Complete List)

### Already in project:
- react, react-dom, react-router-dom
- @tanstack/react-query
- tailwindcss, tailwindcss-animate, postcss, autoprefixer
- @radix-ui/* (shadcn primitives)
- lucide-react
- sonner
- framer-motion
- date-fns
- clsx, tailwind-merge, class-variance-authority

### Need to install:
```bash
npm install @supabase/supabase-js tweetnacl tweetnacl-util
npm install browser-image-compression          # Phase 2: image optimization
npm install @ffmpeg/ffmpeg @ffmpeg/util         # Phase 2: video optimization
npm install leaflet react-leaflet @types/leaflet  # Phase 5: maps
npm install canvas-confetti                      # Phase 4: streak celebrations (optional)
npm install @tanstack/react-virtual              # Phase 8: virtual scroll (optional)
npm install react-zoom-pan-pinch                 # Phase 2: image viewer (optional)
```

---

## Design Tokens Reference

```css
/* Colors (HSL values in CSS variables) */
--background: 240 24% 4%;        /* #0D0D12 */
--card: 240 21% 9%;              /* #13131D */
--primary: 41 60% 61%;           /* #D4AF61 (warm gold) */
--accent: 35 66% 76%;            /* #E8C99A (light gold) */
--foreground: 40 20% 93%;        /* warm off-white */
--muted-foreground: 230 10% 55%; /* lavender-grey */
--surface: 240 20% 12%;          /* #1A1A28 */
--destructive: 0 84% 60%;        /* red for delete actions */

/* Fonts */
font-display: 'Playfair Display', serif;  /* headings, branding */
font-sans: 'DM Sans', sans-serif;         /* body text */

/* Loaded in index.html via Google Fonts */
```

---

## Testing Checklist

### Phase 1 (Core Chat)
- [ ] Login works for both users
- [ ] Messages encrypt/decrypt correctly
- [ ] Realtime: messages appear instantly for partner
- [ ] Reactions toggle on/off
- [ ] Edit message shows "(edited)"
- [ ] Delete for me hides from sender only
- [ ] Delete for everyone shows "This message was deleted"
- [ ] Pin/unpin messages, banner cycles
- [ ] Typing indicator shows/hides
- [ ] Online status updates on tab focus/blur
- [ ] Read receipts: single check → double check → gold double check

### Phase 2 (Media)
- [ ] Image: pick → optimize → encrypt → upload → display → fullscreen viewer
- [ ] Video: pick → compress → encrypt → upload → inline player
- [ ] Audio: record → encrypt → upload → waveform player
- [ ] Document: pick → encrypt → upload → download on tap

### Phase 3 (Stories)
- [ ] Create image/video/text story
- [ ] Story appears for partner
- [ ] Progress bar advances correctly
- [ ] Story expires after 24h
- [ ] "Seen" indicator works

### Phase 4 (Streaks)
- [ ] Streak increments when both message daily
- [ ] Streak resets after missed day
- [ ] Longest streak tracks correctly
- [ ] Milestone celebrations fire

### Phase 5 (Live Location)
- [ ] Permission prompt works
- [ ] Map shows both users
- [ ] Location updates in realtime
- [ ] Share/stop sharing works

### Phase 6 (Push Notifications)
- [ ] Service worker registers
- [ ] Subscription saved to DB
- [ ] Notification shows when app is in background
- [ ] Click notification opens app

### Phase 7 (Settings)
- [ ] Avatar upload works
- [ ] Display name updates
- [ ] Chat background changes
- [ ] Notification toggle works
- [ ] Sign out works

---

## Environment Variables

```env
VITE_SUPABASE_URL=https://ugfxjjakpsngfdrjlsdr.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-key>
VITE_VAPID_PUBLIC_KEY=<your-vapid-public-key>
```

**Supabase Secrets** (set via Supabase Dashboard > Edge Functions > Secrets):
```
VAPID_PUBLIC_KEY=<your-vapid-public-key>
VAPID_PRIVATE_KEY=<your-vapid-private-key>
```

---

## Implementation Order (Recommended)

1. **Fix build errors** (install deps, fix types) — 10 min
2. **Test core chat** (create users, verify encryption) — 15 min
3. **Image attachments** — 2-3 hours
4. **Audio recording** — 2 hours
5. **Video attachments** — 2-3 hours
6. **Document attachments** — 30 min
7. **Stories** — 3-4 hours
8. **Streaks** — 1-2 hours
9. **Live Location** — 2-3 hours
10. **Settings screen** — 2 hours
11. **Push notifications** — 2-3 hours
12. **PWA + polish** — 2 hours

**Total estimated: ~22-30 hours of AI-assisted development**

---

*Generated from AURA PRD + codebase analysis on 2026-03-24*
