# AURA — Private Couples Messenger
## Full Product Requirements Document (PRD)
### Version 1.1 | For Lovable / v0 One-Shot Build

---

> ⚠️ **CRITICAL INSTRUCTION TO AI BUILDER (LOVABLE / V0):**
> This PRD must be implemented **completely and entirely in one single generation pass**. Do not skip any section, do not leave placeholders, do not defer any feature to "future phases." Every feature described in this document must be fully functional, wired up, and working when the app is first generated. This is a complete product spec — build all of it.

---

## 1. Product Overview

**App Name:** AURA

**What it is:** A private, ultra-premium, end-to-end encrypted messaging app built exclusively for two users — a couple. It is inspired by the core communication features of Telegram and Snapchat, but without any public social features (no feeds, no public posts, no explore, no reels). It is purely a private, intimate communication channel between two people.

**Who uses it:** Exactly 2 users. No registration flow for new users. No user discovery. No public profiles. Just two hardcoded accounts that talk to each other.

**Core Philosophy:** Every pixel should feel like it was designed by a 10+ year UI/UX expert. Premium, warm, intimate, and fast. Think luxury Swiss watch meets modern messaging — refined, intentional, and beautiful. No generic AI aesthetics. No purple gradients. No Inter font. This should look like it cost $200,000 to design.

---

## 2. Tech Stack (Do Not Deviate)

| Layer | Technology |
|---|---|
| **Frontend** | React + TypeScript + Vite |
| **Styling** | Tailwind CSS + custom CSS variables |
| **Database & Auth** | Supabase (Postgres + Realtime + Auth) |
| **Media Storage** | Cloudinary |
| **E2E Encryption** | libsodium.js (TweetNaCl) |
| **Push Notifications** | Web Push API + Supabase Edge Functions |
| **Live Location** | Browser Geolocation API + Supabase Realtime |
| **Animations** | Framer Motion |
| **Icons** | Lucide React |
| **Fonts** | Google Fonts — use something distinctive and premium (suggestions: "Fraunces" for display, "DM Sans" for body — but choose what feels best for luxury intimacy) |
| **Image Optimization** | `browser-image-compression` (npm) — industry-standard, Canvas-based, perceptually lossless |
| **Video Optimization** | `@ffmpeg/ffmpeg` + `@ffmpeg/util` (ffmpeg.wasm) — runs FFmpeg natively in-browser via WebAssembly, CRF-based H.264 encoding |

---

## 3. Design System & UI Philosophy

### 3.1 Aesthetic Direction
- **Theme:** Dark-first design. Deep, warm dark backgrounds (not pure #000000 — use rich dark tones like #0D0D0F, #111118, #13131A). Warm amber/gold accents. Feels like a candlelit private room.
- **Mood:** Intimate, premium, whisper-quiet. Like a luxury hotel's private lounge.
- **NOT:** Flat corporate blue. Generic chat app white. Telegram's cold grey. WhatsApp green. None of that.

### 3.2 Color Palette
```
Background Primary:    #0F0F14
Background Secondary:  #16161F
Background Elevated:   #1E1E2A
Accent Primary:        #C9A96E  (warm gold)
Accent Secondary:      #E8C99A  (lighter gold)
Accent Glow:           rgba(201, 169, 110, 0.15)
Text Primary:          #F0EDE8
Text Secondary:        #8A8799
Text Muted:            #4A4857
Sender Bubble:         linear-gradient(135deg, #C9A96E, #A8845A)
Receiver Bubble:       #1E1E2A
Border Subtle:         rgba(201, 169, 110, 0.12)
Success:               #6ECB8A
Danger:                #E87676
```

### 3.3 Typography
- Use a premium pairing. Suggested: **Playfair Display** (headings/logo) + **DM Sans** (body/messages). Or choose something equally distinctive and intimate.
- Message text: 15px, comfortable line-height 1.6
- Timestamps: 11px, muted, elegant
- App name "AURA" in the header: custom styled, feels like a brand

### 3.4 Spacing & Layout
- Generous padding. Messages don't feel cramped.
- Chat bubbles have soft border-radius (18px sender, 18px receiver, with the classic tail shape)
- Subtle glassmorphism on overlays and modals (backdrop-filter: blur)
- Smooth 60fps animations on everything — message sends, transitions, reactions

### 3.5 Micro-interactions
- Message send: bubble scales in from 0.85 → 1 with a spring animation
- Reaction picker: emerges from bottom with a soft bounce
- Media viewer: full-screen with a cinematic fade-in
- Story viewer: smooth swipe/progress animation
- Typing indicator: three animated dots with staggered wave animation
- New message notification: subtle golden pulse on the unread badge

---

## 4. Authentication

### 4.1 Setup
- Supabase Auth with email + password
- **Exactly 2 user accounts exist.** These are created manually in the Supabase dashboard — no sign-up UI needed.
- Login page is the only public page. Everything else requires authentication.
- Sessions persist. Users stay logged in indefinitely (refresh tokens enabled).

### 4.2 Login Screen Design
- Full-screen dark background with a subtle animated gradient or particle effect
- Centered card with the AURA logo prominently displayed
- Email + password fields with premium styling
- No "Forgot password", no "Sign up", no social auth buttons
- A single "Enter" or "Unlock AURA" button
- Subtle tagline below the logo: *"Your private world."*

### 4.3 User Profiles (Hardcoded 2 Users)
Each user has:
- Display name
- Avatar (uploaded photo, stored encrypted on Cloudinary)
- Online/last seen status

---

## 5. End-to-End Encryption (E2E) — libsodium.js

### 5.1 This Is Non-Negotiable
Every single piece of data that leaves the user's device must be encrypted. Supabase and Cloudinary must only ever store ciphertext — never plaintext text, never readable media files.

### 5.2 How to Implement

**Key Generation (on first login):**
```javascript
import { box, randomBytes } from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

// Each user generates a keypair on first login
const keyPair = box.keyPair();
// Public key → stored in Supabase (profiles table, public)
// Secret key → stored ONLY in localStorage/IndexedDB on-device, NEVER sent to server
```

**Encrypting a message before sending:**
```javascript
import { box, randomBytes } from 'tweetnacl';

function encryptMessage(message, recipientPublicKey, senderSecretKey) {
  const nonce = randomBytes(box.nonceLength);
  const messageUint8 = new TextEncoder().encode(message);
  const encrypted = box(messageUint8, nonce, recipientPublicKey, senderSecretKey);
  return {
    ciphertext: encodeBase64(encrypted),
    nonce: encodeBase64(nonce)
  };
}
```

**Decrypting on receive:**
```javascript
function decryptMessage(ciphertext, nonce, senderPublicKey, recipientSecretKey) {
  const decrypted = box.open(
    decodeBase64(ciphertext),
    decodeBase64(nonce),
    senderPublicKey,
    recipientSecretKey
  );
  return new TextDecoder().decode(decrypted);
}
```

**For media files (images, video, audio, documents):**
```javascript
import { secretbox, randomBytes } from 'tweetnacl';

// Generate a random symmetric key for each file
const fileKey = randomBytes(secretbox.keyLength);
const nonce = randomBytes(secretbox.nonceLength);

// Encrypt the file as Uint8Array BEFORE uploading to Cloudinary
const fileBuffer = await file.arrayBuffer();
const fileUint8 = new Uint8Array(fileBuffer);
const encryptedFile = secretbox(fileUint8, nonce, fileKey);

// Upload encryptedFile blob to Cloudinary (it looks like garbage to Cloudinary)
// Store the fileKey encrypted with the recipient's public key in Supabase message metadata
```

### 5.3 Key Rules
- Secret keys NEVER leave the device
- Public keys are the only keys stored in Supabase
- Media file symmetric keys are encrypted with libsodium box before storing in Supabase
- Chat background images are also encrypted before upload
- Story media is also encrypted before upload
- If keys are lost, messages cannot be recovered — this is by design

### 5.4 Compress Before Encrypting
For images: compress to max 1200px width, quality 0.85 using Canvas API before encrypting.
For videos: if browser supports it, compress. Otherwise encrypt as-is with a size warning UI.

---

## 6. Database Schema (Supabase)

### 6.1 Tables

```sql
-- Users/Profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  display_name TEXT NOT NULL,
  avatar_url TEXT, -- Cloudinary URL (encrypted avatar blob)
  public_key TEXT NOT NULL, -- libsodium public key, base64
  is_online BOOLEAN DEFAULT false,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES profiles(id),
  receiver_id UUID REFERENCES profiles(id),
  ciphertext TEXT NOT NULL, -- encrypted message content
  nonce TEXT NOT NULL, -- libsodium nonce
  message_type TEXT DEFAULT 'text', -- text | image | video | audio | document | location | sticker
  media_url TEXT, -- Cloudinary URL for encrypted media blob
  media_key TEXT, -- encrypted symmetric key for media file
  media_nonce TEXT, -- nonce for media decryption
  media_metadata TEXT, -- encrypted: {filename, size, mimeType, duration, thumbnail}
  reply_to_id UUID REFERENCES messages(id), -- for reply threading
  is_edited BOOLEAN DEFAULT false,
  edited_at TIMESTAMPTZ,
  is_deleted_for_sender BOOLEAN DEFAULT false,
  is_deleted_for_everyone BOOLEAN DEFAULT false,
  reactions JSONB DEFAULT '{}', -- {"❤️": ["user_id"], "😂": ["user_id"]}
  is_pinned BOOLEAN DEFAULT false,
  is_forwarded BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ, -- when receiver read it
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stories
CREATE TABLE stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  ciphertext TEXT, -- encrypted caption (if any)
  nonce TEXT,
  media_url TEXT NOT NULL, -- Cloudinary URL for encrypted story media
  media_key TEXT NOT NULL, -- encrypted symmetric key
  media_nonce TEXT NOT NULL,
  media_type TEXT NOT NULL, -- image | video
  media_metadata TEXT, -- encrypted: {duration, width, height}
  viewed_by JSONB DEFAULT '[]', -- array of user_ids who viewed
  expires_at TIMESTAMPTZ NOT NULL, -- 24 hours from created_at
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pinned Messages (reference table for quick access)
CREATE TABLE pinned_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id),
  pinned_by UUID REFERENCES profiles(id),
  pinned_at TIMESTAMPTZ DEFAULT NOW()
);

-- Live Location Sharing
CREATE TABLE live_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  encrypted_lat TEXT NOT NULL,
  encrypted_lng TEXT NOT NULL,
  nonce TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sharing_started_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Settings (per user)
CREATE TABLE chat_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) UNIQUE,
  background_url TEXT, -- Cloudinary URL of encrypted background image
  background_key TEXT, -- encrypted symmetric key
  background_nonce TEXT,
  notification_sound BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Push Notification Subscriptions
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  subscription JSONB NOT NULL, -- Web Push subscription object
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Streaks
CREATE TABLE streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- There is always exactly ONE row in this table (the shared streak between the 2 users)
  current_streak INT DEFAULT 0,          -- number of consecutive days both users have exchanged media
  longest_streak INT DEFAULT 0,          -- all-time record
  last_snap_date DATE,                   -- the calendar date (UTC) when the last qualifying snap was sent
  user_a_snapped_today BOOLEAN DEFAULT false,  -- did user A send a snap today?
  user_b_snapped_today BOOLEAN DEFAULT false,  -- did user B send a snap today?
  streak_at_risk BOOLEAN DEFAULT false,  -- true if it's been 20+ hours since last snap (warning state)
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.2 Row Level Security (RLS)
Enable RLS on ALL tables. Only the 2 known user IDs can read/write. Example:
```sql
-- Only authenticated users can see messages where they are sender or receiver
CREATE POLICY "Users can only see their own messages"
ON messages FOR ALL
USING (
  auth.uid() = sender_id OR auth.uid() = receiver_id
);
```
Apply equivalent policies to all other tables.

### 6.3 Supabase Realtime
Enable Realtime on: `messages`, `stories`, `live_locations`, `profiles` (for online status).

---

## 7. App Structure & Navigation

### 7.1 Layout
The app is a single-screen chat app with a bottom navigation bar (mobile-first, but also works on desktop):

```
┌─────────────────────────────┐
│          HEADER             │  ← App name "AURA" + partner status
├─────────────────────────────┤
│                             │
│        MAIN CONTENT         │  ← Changes based on active tab
│         AREA                │
│                             │
├─────────────────────────────┤
│   💬    📖    📍    ⚙️      │  ← Bottom Nav: Chat | Stories | Location | Settings
└─────────────────────────────┘
```

### 7.2 Header
- Left: AURA logo (styled wordmark)
- Center: Partner's name + online status indicator (green dot if online, "last seen X ago" if not)
- Right: Pinned messages icon + video call placeholder (UI only, not functional) 

### 7.3 Bottom Navigation
- **Chat** (💬) — Main chat screen
- **Stories** (✨) — Story viewer/creator
- **Location** (📍) — Live location sharing
- **Settings** (⚙️) — App settings, profile, background, notifications

---

## 8. Chat Screen (Core Feature)

### 8.1 Message List
- Messages grouped by date with a floating date divider (e.g., "Today", "Yesterday", "March 20")
- Auto-scroll to bottom on new message
- Smooth scroll behavior
- Pull-to-load older messages (pagination, 30 messages at a time)
- Unread message separator line if user has unread messages from before

### 8.2 Chat Bubbles

**Sender (right-aligned):**
- Gradient bubble: `linear-gradient(135deg, #C9A96E, #A8845A)`
- White text
- Tail on bottom-right
- Timestamp inside bubble (bottom right, lighter)
- Read receipt checkmarks: single grey ✓ = sent, double grey ✓ = delivered, double gold ✓✓ = read

**Receiver (left-aligned):**
- Background: `#1E1E2A`
- Light text
- Tail on bottom-left
- Timestamp inside bubble (bottom right, muted)
- Partner's small avatar circle above first bubble in a sequence

**Bubble Layout Rules:**
- Text messages: max-width 75% of screen
- Consecutive messages from same person within 60 seconds: no avatar repeat, reduced gap
- Long press on any bubble → context menu (Reply, React, Copy, Forward, Pin, Edit (own only), Delete)

### 8.3 Message Input Bar
- Fixed at bottom, above keyboard
- Left side: Attachment icon (opens media picker modal)
- Center: Expandable text input (grows up to 5 lines, then scrolls)
  - Placeholder: *"Say something beautiful..."*
  - Supports emoji natively
- Right side: 
  - When text is empty: Microphone icon (hold to record audio)
  - When text has content: Send button (gold arrow icon, animated on press)

### 8.4 Reply to Message
- Tap Reply in context menu → a reply preview bar appears above the input
- Shows original sender name + truncated message preview
- Send button sends the reply, which is threaded to the original
- Tapping a reply bubble in chat scrolls to and highlights the original message

### 8.5 Message Reactions
- Long press → reaction picker appears above the bubble
- 8 reactions available: ❤️ 😂 😮 😢 🔥 👀 🎉 💯
- Reactions displayed below the bubble as small emoji + count
- Tapping an existing reaction toggles it for the current user
- Both users can react to the same message

### 8.6 Edit Messages (own messages only)
- Long press → Edit → inline text editor opens in the input bar with the message pre-filled
- After editing and sending: message updates in-place with an "(edited)" indicator
- Supabase real-time updates the message for the other user instantly

### 8.7 Delete Messages
- **Delete for me:** removes from your view, still visible to partner
- **Delete for everyone:** removes from both views, replaced with *"This message was deleted"* ghost bubble

### 8.8 Forward Messages
- Long press → Forward → selects the message → shows forward button
- In this 2-person app, forwarding just re-sends the message as a new message with a "Forwarded" label

### 8.9 Pinned Messages
- Long press → Pin → message is pinned
- A pinned messages banner appears at the top of the chat (dismissible, re-openable via header icon)
- Tapping the banner scrolls to the pinned message
- Multiple messages can be pinned; banner cycles through them

### 8.10 Message Types Display

**Image:**
- Thumbnail shown inline in bubble (blurred/loading state while decrypting)
- Tap → full-screen viewer with pinch-to-zoom
- Grid layout if multiple images sent together

**Video:**
- Inline player with play button overlay
- Shows duration badge
- Tap play → expands to full-screen player

**Audio Message:**
- Waveform visualization (static wave shape, animates while playing)
- Play/pause button, scrubber, duration
- Speed toggle: 1x → 1.5x → 2x

**Document:**
- Icon based on file type (PDF icon, DOC icon, etc.)
- Filename + file size shown
- Tap → download and open

**Location (Live):**
- Map thumbnail (static map image) inside bubble
- "📍 Live Location — tap to view" label
- Tap → navigates to Location tab with full map

**Stickers:**
- Larger display, no bubble background
- (Include a small built-in sticker pack of ~20 premium minimal stickers)

---

## 9. Media Attachment Flow

### 9.1 Attachment Modal (opens on + icon tap)
A bottom sheet slides up with options:
- 📷 Camera (open camera)
- 🖼️ Photo & Video (open gallery picker)
- 🎵 Audio File (pick audio from device)
- 📄 Document (pick any file)
- 📍 Location (share current/live location)
- 🎨 Sticker (open sticker picker)

### 9.2 Media Quality Choice Modal (REQUIRED for images and videos only)

After the user picks an image or video from the gallery or camera, and **before** any processing begins, display a full-screen bottom sheet modal asking:

**Title:** *"How would you like to send this?"*

Two large tappable cards side-by-side:

**Card 1 — Original Quality**
- Icon: 💎
- Label: **"Original"**
- Sub-label: shows actual file size, e.g. *"40.2 MB — sent as-is"*
- Description: *"Full quality, larger file size, longer upload time"*
- Border: subtle gold border when selected

**Card 2 — Optimized**
- Icon: ⚡
- Label: **"Optimized"**
- Sub-label: shows estimated output size, e.g. *"~3.1 MB — visually identical"*
- Description: *"Smart compression, no visible quality loss, faster to send"*
- Border: subtle gold border when selected
- A small green **"Recommended"** pill badge in top-right corner of this card

Below the two cards:
- A **"Send"** button (gold, full-width)
- Small text: *"Optimized files are compressed on your device before encrypting. We never see your media."*

**Default selection:** Optimized is pre-selected by default.

For audio files and documents: skip this modal entirely — they are sent as-is.

---

### 9.3 Image Optimization (using `browser-image-compression`)

**Library:** `browser-image-compression` — the most popular browser-native image compression library (500k+ weekly npm downloads). Uses Canvas API with perceptual quality targeting. Does NOT use lossy artifacts or block compression at moderate settings.

**Algorithm:** JPEG/WebP progressive encoding with perceptual quality targeting. Unlike naive Canvas quality reduction, `browser-image-compression` iterates to hit a target file size while preserving visual fidelity (maxSizeMB target, not a fixed quality number).

```javascript
import imageCompression from 'browser-image-compression';

async function optimizeImage(file: File): Promise<File> {
  const options = {
    maxSizeMB: 2,               // Target max 2MB output
    maxWidthOrHeight: 2560,     // Preserve resolution up to 2560px (retina quality)
    useWebWorker: true,         // Non-blocking — runs in background thread
    fileType: 'image/webp',     // WebP: 30-50% smaller than JPEG at same quality
    initialQuality: 0.92,       // Start at 92% quality — visually indistinguishable from 100%
    alwaysKeepResolution: true, // Do NOT downscale resolution — only reduce file encoding size
    onProgress: (progress) => updateProgressBar(progress)
  };
  return await imageCompression(file, options);
}
```

**What this achieves in practice:**
- A 40MB RAW/HEIC photo → ~1.8–3MB WebP with zero visible quality difference at normal viewing
- A 8MB JPEG → ~0.9–1.5MB WebP
- Resolution is NEVER downscaled — only encoding efficiency improves
- Runs in a Web Worker so the UI never freezes during compression

---

### 9.4 Video Optimization (using `@ffmpeg/ffmpeg` — ffmpeg.wasm)

**Library:** `@ffmpeg/ffmpeg` + `@ffmpeg/util` — FFmpeg compiled to WebAssembly. This is the exact same FFmpeg used by Hollywood studios and YouTube, running entirely in-browser. Zero quality compromise approach.

**Algorithm:** H.264 with CRF (Constant Rate Factor) encoding. CRF does NOT target a fixed bitrate — it targets a **constant perceptual quality level**. The output looks identical to the source at a fraction of the file size.

```javascript
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();

async function optimizeVideo(file: File, onProgress: (p: number) => void): Promise<File> {
  // Load FFmpeg WASM core (loads once, cached after first use)
  if (!ffmpeg.loaded) {
    await ffmpeg.load({
      coreURL: await toBlobURL('/ffmpeg-core.js', 'text/javascript'),
      wasmURL: await toBlobURL('/ffmpeg-core.wasm', 'application/wasm'),
    });
  }

  ffmpeg.on('progress', ({ progress }) => onProgress(Math.round(progress * 100)));

  await ffmpeg.writeFile('input.mp4', await fetchFile(file));

  await ffmpeg.exec([
    '-i', 'input.mp4',
    '-c:v', 'libx264',         // H.264 codec — universally supported
    '-crf', '23',              // CRF 23: the sweet spot — visually lossless to human eye
                               // (0 = lossless, 51 = worst; 18-28 is the quality range)
    '-preset', 'fast',         // 'fast' preset: good speed/quality tradeoff on mobile
    '-c:a', 'aac',             // AAC audio — standard, efficient
    '-b:a', '128k',            // 128kbps audio — CD quality, no audible difference
    '-movflags', '+faststart', // Enables streaming start (moov atom at beginning)
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', // Ensure even dimensions (H.264 requirement)
    'output.mp4'
  ]);

  const data = await ffmpeg.readFile('output.mp4');
  return new File([data], file.name.replace(/\.[^.]+$/, '.mp4'), { type: 'video/mp4' });
}
```

**What CRF 23 achieves in practice:**
- A 40MB phone video → ~4–8MB MP4 with visually identical quality on any screen
- A 200MB 4K video → ~20–40MB with no perceptible difference at full-screen playback
- Audio quality is preserved at 128kbps AAC — no audible difference from original
- The output is fully streamable (faststart flag)

**FFmpeg WASM Loading UX:**
- First-ever video optimization: show a one-time loading state *"Preparing video engine... (first time only)"* with a progress indicator (~3–5 seconds to load WASM)
- After loaded: WASM is cached in browser memory for the session — subsequent optimizations start instantly
- Show a per-video progress bar: *"Optimizing video... 47%"*

---

### 9.5 Full Upload Flow (after quality choice)

```
User picks image/video
        ↓
Quality Choice Modal appears
        ↓
    ┌───────────────────────────────┐
    │  Original selected?           │  → Skip to step 4
    │  Optimized selected?          │  → Step 2 & 3 first
    └───────────────────────────────┘
        ↓
Step 2: On-device optimization
  • Image → browser-image-compression (Web Worker, non-blocking)
  • Video → ffmpeg.wasm (CRF 23 H.264, with progress bar)
        ↓
Step 3: Show size comparison in bubble preview area:
  "Original: 40.2 MB  →  Optimized: 3.4 MB  ✓ Ready to send"
        ↓
Step 4: Encrypt optimized/original file with libsodium secretbox
        ↓
Step 5: Upload encrypted blob to Cloudinary (raw, no transformations)
        ↓
Step 6: Store Cloudinary URL + encrypted file key + nonce in Supabase
        ↓
Step 7: Bubble shows media thumbnail + upload progress bar
        ↓
Receiver: downloads blob → decrypts → displays
```

**Important:** Optimization always happens BEFORE encryption. The order must never be reversed.

---

### 9.6 Audio Recording
- Hold microphone button → records audio
- Release → shows preview with waveform + send/cancel options
- Audio messages are NOT subject to the quality choice modal — sent as-is (they are already compressed by the MediaRecorder API using Opus codec)
- Encrypt recording before sending (same libsodium secretbox flow as all media)
- Sliding left while holding cancels recording

---

## 10. Stories Feature

### 10.1 Story Overview
Stories are 24-hour ephemeral posts visible only to the other user. They disappear automatically after 24 hours. This is purely private — only the two users can see each other's stories.

### 10.2 Stories Tab UI

**Stories Screen Layout:**
- Top section: "Your Story" card + "Add to Story" button
- Below: Partner's story card (if they have an active story)
- Cards show: avatar, name, gradient ring if unviewed, story preview thumbnail (decrypted)
- Clean, immersive design with large story cards

**Story Card States:**
- **No story:** dashed border, "+" icon
- **Has unviewed story:** animated gradient ring (gold/warm tones)
- **All viewed:** muted ring

### 10.3 Viewing a Story
- Tap story card → full-screen story viewer
- Top: progress bars (one per story item), auto-advance
- Image stories: display for 5 seconds
- Video stories: play for full duration
- Tap left half: go to previous story item
- Tap right half / swipe left: go to next story item
- Swipe down: dismiss
- Bottom: "👁 Seen" indicator (your own story) or a heart reaction button (partner's story)
- When all stories from a person are viewed: auto-dismiss
- Story is marked as viewed in Supabase

### 10.4 Creating a Story
- Tap "+" on Your Story card → Story Creator opens
- **Media options:**
  - Pick from gallery (image or video)
  - Take photo/video with camera
- **Caption (optional):**
  - Text overlay on the story (positioned, styled)
  - Font options: 3 styles (bold, handwritten-style, minimal)
  - Color picker for caption text
- **After selecting media:** preview screen shows the story
- Post button → compress → encrypt → upload to Cloudinary → create story record in Supabase
- Story expires in 24 hours (set `expires_at = NOW() + INTERVAL '24 hours'`)

### 10.5 Story Encryption
- Story media is encrypted with libsodium secretbox (same as chat media)
- Caption is encrypted with libsodium box (same as chat messages)
- Cloudinary only sees encrypted blobs

### 10.6 Story Expiry
- Supabase cron job (pg_cron) or Edge Function scheduled to delete expired stories
- On client, filter out stories where `expires_at < NOW()` before displaying

---

## 11. Live Location Sharing

### 11.1 Location Tab UI
- Full-screen map (use Leaflet.js with OpenStreetMap tiles — free, no API key needed)
- Your pin and partner's pin shown on map
- If partner is sharing live location: their pin animates/pulses
- Distance between the two users shown at the top: *"2.4 km apart"*

### 11.2 Starting Live Location Share
- Tap "Share My Location" button → asks for browser geolocation permission
- Choose duration: 15 min | 1 hour | Until I stop
- Location updates sent to Supabase Realtime every 10 seconds (encrypted)
- Encryption: lat/lng encrypted with libsodium before storing
- Other user sees the live pin moving on the map in real-time
- A location sharing message is sent in the chat too (with map thumbnail)

### 11.3 Stopping
- "Stop Sharing" button
- Auto-stops when duration expires
- Sets `is_active = false` in `live_locations` table

---

## 12. Chat Background Customization

### 12.1 Where to Access
Settings tab → "Chat Background"

### 12.2 Options
- **Default:** Current dark theme (no background image)
- **Choose from Gallery:** opens gallery picker → user selects an image
- **Apply to:** just me | both of us (if "both": the background setting is synced to partner's view too via Supabase)

### 12.3 How It Works Technically
1. User picks image from gallery
2. Compress to appropriate resolution for background
3. Encrypt with libsodium secretbox
4. Upload encrypted blob to Cloudinary
5. Store URL + key + nonce in `chat_settings` table
6. On chat screen: download → decrypt → set as CSS background-image on the chat area
7. Apply a dark overlay/blur so bubbles remain readable

### 12.4 UI of the Background
- Background image shown with: `brightness(0.3) blur(0px)` — subtle, not distracting
- Bubbles remain fully legible
- A "Remove Background" option to reset to default

---

## 13. Push Notifications

### 13.1 Web Push Setup
- On first login, request notification permission from the browser
- If granted, generate a Web Push subscription and store in `push_subscriptions` table
- Use VAPID keys (generate with `web-push` npm package)

### 13.2 Trigger
- When User A sends a message → Supabase Edge Function fires → sends Web Push to User B's subscription
- Notification shows: sender name + *"Sent you a message"* (do NOT show message content in notification for privacy)
- Tapping notification → opens app → navigates to chat

### 13.3 Story Notifications
- When partner posts a new story → push notification: *"[Name] added to their story ✨"*

### 13.4 Notification Settings
- Settings → Notifications → toggle on/off
- Notification sound toggle

---

## 14. Settings Screen

Clean settings screen with sections:

### Profile
- Change display name
- Change avatar (pick from gallery → encrypt → upload)
- View your own public key (for trust verification)

### Chat
- Chat Background (as described in Section 12)
- Notification Sound (on/off)

### Privacy & Security
- View E2E encryption status (show a green shield ✅ with text: *"All messages are end-to-end encrypted"*)
- View your key fingerprint (so both users can verify keys match — security feature)

### Notifications
- Push notifications toggle
- Sound toggle

### About
- App version
- *"AURA — Built for two."*
- Encryption badge: *"Secured with libsodium E2E encryption"*

---

## 15. Online Status & Typing Indicators

### 15.1 Online Status
- When user opens app → update `is_online = true` + `last_seen = NOW()` in profiles
- When user closes app / goes to background (use `visibilitychange` event) → update `is_online = false`
- Supabase Realtime subscription on partner's profile row → header updates in real-time

### 15.2 Typing Indicator
- When user starts typing in input → send a typing event via Supabase Realtime Broadcast (not stored in DB)
- Partner sees animated typing indicator (three bouncing dots, styled with the gold accent)
- If no keystroke for 3 seconds → stop broadcasting typing

### 15.3 Read Receipts
- When receiver opens a message (it scrolls into view using Intersection Observer) → update `read_at = NOW()`
- Sender sees their ✓✓ turn gold

---

## 16. File Size Limits & Error Handling

| Media Type | Max Size (Original) | Max Size (Optimized output) | Behavior if Exceeded |
|---|---|---|---|
| Image | 50 MB | ~1.5–3 MB (WebP, browser-image-compression) | Show size warning, still allow |
| Video | 500 MB | ~4–40 MB depending on length (ffmpeg.wasm CRF 23) | Show warning + strong recommendation to optimize |
| Audio | 25 MB | Sent as-is (no optimization) | Allow, show file size |
| Document | 50 MB | Sent as-is (no optimization) | Allow, show file size |

- All upload errors shown as toast notifications (non-intrusive, bottom of screen)
- Network offline: queue messages locally, send when reconnected
- Decryption failure: show "⚠️ Could not decrypt this message" in place of content
- ffmpeg.wasm load failure: gracefully fall back to sending Original, show toast: *"Video engine unavailable — sending original"*

---

## 17. Performance & UX Requirements

- **App load time:** Under 2 seconds on a modern device
- **Message send:** Feels instant (optimistic UI — show bubble immediately, sync in background)
- **60fps animations** on all transitions
- **Smooth scroll** in chat — no jank
- **Lazy load** older messages (virtual scroll for long chats)
- **Image loading:** Show blurred placeholder while decrypting, then fade in
- **Offline support:** Show "Connecting..." banner when offline, re-subscribe to Realtime on reconnect
- **Mobile-first responsive:** Works beautifully on mobile browsers (iOS Safari + Android Chrome) and desktop

---

## 18. Specific UX Flows (Step-by-Step)

### Sending a Text Message
1. User types in input
2. Typing indicator broadcasts to partner
3. User taps send (or Enter on desktop)
4. Bubble appears immediately (optimistic, slightly muted while sending)
5. Encrypt message with libsodium
6. Insert to Supabase
7. Bubble becomes fully visible + ✓ appears
8. Partner receives via Realtime subscription → decrypts → bubble appears in their chat
9. When partner reads → ✓✓ turns gold for sender

### Sending a Photo
1. Tap attachment → Photo & Video
2. Select photo from gallery
3. **Quality Choice Modal appears** — user sees original size vs estimated optimized size
4. User selects "Optimized" (default) or "Original" → taps Send
5. If Optimized: `browser-image-compression` runs in Web Worker (non-blocking) with progress shown
6. Size comparison shown in bubble preview: *"40.2 MB → 3.1 MB ✓"*
7. Encrypt (libsodium secretbox) → Upload to Cloudinary → Store URL+key in Supabase
8. Bubble shows image thumbnail with upload progress bar
9. Partner receives → downloads blob → decrypts → shows image

### Sending a Video
1. Tap attachment → Photo & Video
2. Select video from gallery
3. **Quality Choice Modal appears** — user sees original file size vs estimated optimized size
4. User selects "Optimized" (default) or "Original" → taps Send
5. If Optimized: ffmpeg.wasm loads (if first time, shows *"Preparing video engine..."*), then CRF 23 H.264 encoding runs with a live % progress bar in the bubble area
6. Size comparison shown: *"Original: 40.2 MB → Optimized: 5.8 MB ✓"*
7. Encrypt → Upload to Cloudinary → Store in Supabase
8. Bubble shows video thumbnail + play button + duration badge
9. Partner receives → downloads → decrypts → inline player with full-screen tap

### Posting a Story
1. Tap Stories tab → tap "+" on Your Story
2. Story creator opens (full-screen camera/gallery picker)
3. Pick media → optional caption overlay
4. Preview screen
5. Tap "Share" → Encrypt → Upload → Create story record
6. Story ring appears around user's avatar
7. Partner sees new story ring on their Stories tab
8. Partner receives push notification: *"[Name] added to their story ✨"*

---

## 23. Streak Feature (Snapchat-Style)

### 23.1 What a Streak Is
A streak is a count of consecutive calendar days on which **both** users have sent at least one qualifying "snap" (any image or video message) to each other. If either user fails to send a snap within a 24-hour calendar day (midnight to midnight UTC), the streak resets to 0. The streak is a shared number — it belongs to the couple, not to one person.

**Qualifying snap types:** Image messages, video messages. (Text, audio, documents, stickers, and location shares do NOT count toward the streak.)

---

### 23.2 Database

The `streaks` table (defined in Section 6.1) has exactly one row, shared between both users:

```sql
-- Supabase function to evaluate streak after every qualifying snap is sent
CREATE OR REPLACE FUNCTION update_streak(sender_uuid UUID)
RETURNS void AS $$
DECLARE
  rec streaks%ROWTYPE;
  today DATE := CURRENT_DATE;
BEGIN
  SELECT * INTO rec FROM streaks LIMIT 1;

  -- Mark which user snapped today
  IF sender_uuid = '<USER_A_ID>' THEN
    UPDATE streaks SET user_a_snapped_today = true, updated_at = NOW() WHERE id = rec.id;
  ELSE
    UPDATE streaks SET user_b_snapped_today = true, updated_at = NOW() WHERE id = rec.id;
  END IF;

  -- Refresh rec
  SELECT * INTO rec FROM streaks LIMIT 1;

  -- If BOTH have snapped today and today is a new day
  IF rec.user_a_snapped_today AND rec.user_b_snapped_today AND rec.last_snap_date < today THEN
    UPDATE streaks SET
      current_streak = CASE
        WHEN rec.last_snap_date = today - INTERVAL '1 day' THEN rec.current_streak + 1
        ELSE 1  -- gap detected, restart from 1
      END,
      longest_streak = GREATEST(rec.longest_streak,
        CASE
          WHEN rec.last_snap_date = today - INTERVAL '1 day' THEN rec.current_streak + 1
          ELSE 1
        END
      ),
      last_snap_date = today,
      user_a_snapped_today = false,
      user_b_snapped_today = false,
      streak_at_risk = false,
      updated_at = NOW()
    WHERE id = rec.id;
  END IF;
END;
$$ LANGUAGE plpgsql;
```

A **Supabase pg_cron job runs at 20:00 UTC every day** to check if `last_snap_date < CURRENT_DATE - 1` (missed yesterday). If so, it:
- Resets `current_streak = 0`
- Sets `streak_at_risk = false`
- Sends a push notification to both users: *"🔥 Your streak broke. Start a new one today!"*

A **second pg_cron at 20:00 UTC** checks if `last_snap_date = CURRENT_DATE - 1` and current hour >= 20 (streak hasn't been continued yet today) — sets `streak_at_risk = true` and sends a push notification.

---

### 23.3 Streak UI — Header Display

The streak count is shown **in the main chat header**, between the partner's name and the status indicator:

```
┌────────────────────────────────────┐
│  AURA    Priya ● online   🔥 47   │
└────────────────────────────────────┘
```

- **🔥 [number]** — flame emoji + streak count, styled in gold
- Tapping this opens the Streak Detail Card (see below)
- If streak is 0: show a grey unlit flame 🩶 with "0" — inviting them to start
- If `streak_at_risk = true`: the flame pulses with an amber warning glow animation + the number turns orange

---

### 23.4 Streak Detail Card (modal on tap)

A beautiful bottom sheet that slides up showing:

**Top:**
- Giant animated flame 🔥 (Lottie animation or CSS keyframe fire effect)
- Current streak number in large display font: **"47 Days"**
- Subtitle: *"You've been inseparable for 47 days 💛"*

**Stats row:**
- 🔥 Current: **47**
- 🏆 Best Ever: **63**

**Progress section:**
- *"[Your name] snapped today ✅"*
- *"[Partner name] snapped today ✅"* (or ⏳ if not yet)

**If streak at risk:**
- Amber warning banner: *"⚠️ Send a snap before midnight to keep the streak alive!"*
- A quick-send camera button right inside the modal

**Bottom:**
- Dismiss handle
- Small text: *"Streaks count when both of you send a photo or video in the same day."*

---

### 23.5 Streak Milestone Celebrations

When the streak reaches certain numbers, show a full-screen confetti animation + celebration card:

| Milestone | Message |
|---|---|
| 7 days | *"One week of love 🌸"* |
| 30 days | *"A whole month together 🌙"* |
| 100 days | *"100 days of us 💛"* |
| 365 days | *"A full year. You're everything. 🔥"* |

The celebration card shows:
- Full-screen Framer Motion confetti in gold/warm tones
- The milestone message centered with large typography
- Automatically dismisses after 4 seconds or on tap

---

### 23.6 Streak Push Notifications

| Trigger | Notification |
|---|---|
| Partner sends their daily snap | *"[Name] sent a snap 🔥 Keep the streak alive!"* |
| 20:00 UTC, neither has snapped | *"⚠️ Your streak is at risk! Send a snap before midnight."* |
| Streak breaks | *"💔 Your streak ended at [N] days. Start again today?"* |
| Milestone reached | *"🎉 [N]-day streak! You two are unstoppable."* |

---

## 24. Media Optimization — Architecture Summary

This section summarizes all optimization decisions in one place for the AI builder to reference.

### 24.1 Why Two Different Libraries

| | Images | Videos |
|---|---|---|
| **Library** | `browser-image-compression` | `@ffmpeg/ffmpeg` (ffmpeg.wasm) |
| **Algorithm** | WebP progressive encoding via Canvas API | H.264 CRF 23 via FFmpeg WebAssembly |
| **Why this choice** | Specifically built for browser image compression; handles HEIC/HEIF/JPEG/PNG/WebP natively; Web Worker support built-in; most popular image compression library on npm | FFmpeg is the industry gold standard for video encoding used by YouTube, Netflix, and VLC; CRF encoding is quality-first (not bitrate-first) so visual quality is preserved at all times |
| **Quality approach** | Perceptual quality targeting — iterates to hit size target while preserving visual fidelity | CRF 23 = visually lossless to human eye; encoder adds bits where needed, saves where not |
| **Speed** | ~1–3 seconds for typical phone photo | ~5–30 seconds depending on video length and device CPU |
| **Runs in** | Web Worker (non-blocking) | Main thread with progress events (show % progress bar) |

### 24.2 Optimization Is Always On-Device

- No server-side processing
- No sending raw files to any third-party service for compression
- The optimized file is produced entirely on the user's device
- Only the final (already optimized or original, then encrypted) blob is ever uploaded

### 24.3 The Quality Choice Must Be Remembered Per Session

- Store the user's last choice (Original vs Optimized) in `localStorage`
- Pre-select it on next media send
- User can always change it on a per-send basis

### 24.4 Compression.ts Library

Update `src/lib/compression.ts` to contain:

```typescript
// Image optimization using browser-image-compression
export async function optimizeImage(
  file: File,
  onProgress?: (p: number) => void
): Promise<{ optimizedFile: File; originalSize: number; optimizedSize: number }> { ... }

// Video optimization using ffmpeg.wasm
export async function optimizeVideo(
  file: File,
  onProgress?: (p: number) => void
): Promise<{ optimizedFile: File; originalSize: number; optimizedSize: number }> { ... }

// Helper: format bytes to human readable
export function formatBytes(bytes: number): string { ... }

// Helper: estimate output size before processing (for UI preview)
export function estimateOptimizedSize(file: File): string { ... }
```

---

## 19. What to NOT Build

This is explicitly out of scope. Do not add any of these:

- ❌ User registration / sign-up flow (only login for 2 existing users)
- ❌ User search or discovery
- ❌ Group chats
- ❌ Public profiles
- ❌ Feed / timeline / explore
- ❌ Posts / Reels / Public content of any kind
- ❌ Disappearing messages timer (Snapchat-style)
- ❌ Screenshot detection
- ❌ Video calling (UI placeholder is fine, but no actual WebRTC)
- ❌ Sticker marketplace / store
- ❌ Ads or analytics of any kind

---

## 20. Folder Structure

```
src/
├── components/
│   ├── auth/
│   │   └── LoginScreen.tsx
│   ├── chat/
│   │   ├── ChatScreen.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── MessageInput.tsx
│   │   ├── AttachmentModal.tsx
│   │   ├── MediaQualityModal.tsx       ← NEW: Original vs Optimized choice
│   │   ├── ReactionPicker.tsx
│   │   ├── ReplyPreview.tsx
│   │   ├── PinnedMessagesBanner.tsx
│   │   ├── TypingIndicator.tsx
│   │   ├── MediaViewer.tsx
│   │   ├── AudioPlayer.tsx
│   │   └── DateDivider.tsx
│   ├── streak/
│   │   ├── StreakBadge.tsx             ← NEW: 🔥 47 badge shown in header
│   │   ├── StreakDetailCard.tsx        ← NEW: bottom sheet with stats
│   │   └── StreakCelebration.tsx       ← NEW: confetti milestone modal
│   ├── stories/
│   │   ├── StoriesTab.tsx
│   │   ├── StoryCard.tsx
│   │   ├── StoryViewer.tsx
│   │   └── StoryCreator.tsx
│   ├── location/
│   │   ├── LocationTab.tsx
│   │   └── LocationMap.tsx
│   ├── settings/
│   │   ├── SettingsTab.tsx
│   │   ├── ProfileSettings.tsx
│   │   ├── BackgroundPicker.tsx
│   │   └── NotificationSettings.tsx
│   ├── shared/
│   │   ├── BottomNav.tsx
│   │   ├── Header.tsx
│   │   ├── Toast.tsx
│   │   ├── LoadingSpinner.tsx
│   │   └── EncryptionBadge.tsx
├── hooks/
│   ├── useEncryption.ts
│   ├── useMessages.ts
│   ├── useRealtime.ts
│   ├── useMediaUpload.ts
│   ├── useMediaOptimization.ts        ← NEW: wraps compression.ts with UI state
│   ├── useStreak.ts                   ← NEW: reads/updates streak, handles milestones
│   ├── useStories.ts
│   ├── useLiveLocation.ts
│   └── usePushNotifications.ts
├── lib/
│   ├── supabase.ts
│   ├── cloudinary.ts
│   ├── encryption.ts                  ← All libsodium logic
│   ├── compression.ts                 ← browser-image-compression + ffmpeg.wasm
│   └── notifications.ts
├── types/
│   └── index.ts
├── App.tsx
└── main.tsx
```

---

## 21. Environment Variables Needed

```env
VITE_SUPABASE_URL=https://ugfxjjakpsngfdrjlsdr.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZnhqamFrcHNuZ2Zkcmpsc2RyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDY3NzQsImV4cCI6MjA4OTkyMjc3NH0.KiA-8YqdsgO1Is2Fumh4mqmfQY8i1O_K8RnQtBcjuGo
VITE_CLOUDINARY_CLOUD_NAME=del5o1vnd
VITE_CLOUDINARY_UPLOAD_PRESET=hamara-encrypted-media
VITE_VAPID_PUBLIC_KEY=BJO561DHULQLDvzsCQhdb3uO2AoiOQEy2EOfdnzEX62-xasIgF6IrE0RCWaAfczEYSXeFncYUT25qEE996doRyc
```

---

## 22. Final Instruction to AI Builder

Build this application **completely in one generation**. Every section of this PRD must be implemented. The UI must be premium, intimate, and feel like it was designed by a 10-year senior designer — warm dark tones, gold accents, smooth animations, beautiful typography. No placeholders. No "coming soon." No TODO comments. Full working code. The encryption must be real — using libsodium/TweetNaCl, not fake or simulated. The streak system must be fully wired to Supabase with real pg_cron jobs and real push notifications. The media optimization must use `browser-image-compression` for images and `@ffmpeg/ffmpeg` (ffmpeg.wasm) for videos — not Canvas API quality hacks. The app must feel like a digital sanctuary — private, beautiful, and exclusively for two people in love.

---

*AURA — Your private world. Built for two.*
