# AURA Phase 1: Manual Testing Guide (Updated)

This guide outlines the steps to manually verify the Core Chat features and recent refinements.

## 1. Authentication & Encryption Setup
- **Action**: Register or Log in as User A and User B (use two different browsers or Incognito).
- **Verify**:
    - [ ] Navigating to `/chat` shows the partner's profile.
    - [ ] Check Supabase `profiles` table: `public_key` should be populated for both.
    - [ ] Check Browser DevTools -> Application -> Local Storage: `aura_keypair` should exist.

## 2. Core Messaging (E2E Encrypted)
- **Action**: Send a text message from User A to User B.
- **Verify**:
    - [ ] User B receives the message in real-time.
    - [ ] Check Supabase `messages` table: `encrypted_content` should be ciphertext (garbled text), NOT the original message.
    - [ ] Both users see the message decrypted and readable.

## 3. Media Sharing
- **Action**: Click "+" -> Photo/Video. Select a file.
- **Verify**:
    - [ ] Progress indicator shows "Securing media...".
    - [ ] Recipient sees the media rendered correctly inside a bubble.
    - [ ] Tapping media opens the fullscreen viewer.

## 4. Unread Message Separator (NEW)
- **Action**: 
    1. User A stays offline or has the chat closed.
    2. User B sends 3-4 messages.
    3. User A opens the chat.
- **Verify**:
    - [ ] A "New Messages" divider appears above the first unread message from User B.
    - [ ] The divider disappears once the messages are read and the session is refreshed.

## 5. Offline Message Queueing (NEW)
- **Action**:
    1. Open DevTools -> Network -> Select "Offline".
    2. Send a message "Test Offline".
    3. User A sees an "Offline Sanctuary" banner in the header.
    4. Change Network back to "Online".
- **Verify**:
    - [ ] While offline, the message appears with a "clock" (pending) icon.
    - [ ] Once online, the message automatically syncs and the "clock" changes to a single/double checkmark.

## 6. Premium Stickers (NEW)
- **Action**: Click "+" -> Stickers. Select any sticker.
- **Verify**:
    - [ ] Sticker is sent and rendered as a large emoji.
    - [ ] Sticker does NOT have a background bubble (native feel).
    - [ ] Reaction badge works correctly on stickers.

## 7. Decryption Failure Handling (NEW)
- **Action**: 
    1. Send a message.
    2. Go to Supabase dashboard -> `messages` table.
    3. Edit the `nonce` or `encrypted_content` of that message manually to "corrupt" it.
    4. Refresh the chat app.
- **Verify**:
    - [ ] Instead of a crash or ciphertext, a "Decryption Failed" ghost bubble (red dashed border) appeared with "⚠️ Could not decrypt this message".

## 8. Real-time Status & Sync
- **Action**: Change User A's status or start typing.
- **Verify**:
    - [ ] User B sees the Typing indicator ("...") and the Online/Offline status changes in the header.
