# Cloudinary Multi-Account + Garbage Can Strategy

> **Context:** Personal couple's app (2 users only), lifetime free on Vercel, no production/domain plans. This document outlines the complete media management strategy.

---

## Overview

Since the app is personal (2 users: me + wife) with very low traffic and no commercial intent, the plan is to:
1. Use multiple Cloudinary free accounts **sequentially** — one active upload account at a time.
2. Keep old full accounts alive as **read-only (bandwidth-only)** storage.
3. Implement a **Garbage Can** feature to reclaim storage on demand.

---

## Credit Allocation Strategy (Per Account)

Each Cloudinary free account gives **25 credits/month** on a rolling 30-day window.

### Planned Allocation

| Usage Type | Credits Used | Actual Limit |
|---|---|---|
| **Storage** | 15–20 credits | 15–20 GB of media |
| **Bandwidth** | 5–10 credits | 5–10 GB delivery |
| **Transformations** | 0 credits | Not used at all |

### Why This Ratio Works
- **2 users only** means bandwidth consumption is extremely low.
- Example: 100MB of media viewed = 0.1 GB bandwidth = 0.1 credits.
- At this scale, 5 credits of bandwidth = ~50 GB of actual viewing, which is more than enough.

---

## Multi-Account Rotation Plan

```
Account A  →  fills up 15-20GB  →  becomes READ-ONLY (bandwidth only)
Account B  →  new active upload account
Account B  →  fills up 15-20GB  →  becomes READ-ONLY
Account C  →  new active upload account
... and so on
```

### Database Schema Requirement
Every media record in Supabase **must store the `cloud_name`** of the account it was uploaded to:

```sql
-- Example column addition to messages/media table
ALTER TABLE messages ADD COLUMN cloudinary_cloud_name TEXT NOT NULL DEFAULT 'your_default_cloud_name';
```

### How Media URLs Work Across Accounts
A Cloudinary URL looks like:
```
https://res.cloudinary.com/{cloud_name}/image/upload/{public_id}
```

Since each account has a different `cloud_name`, the URL itself already tells the browser which account to fetch from. **No extra logic needed for reads** — the URL is self-contained.

### Active Upload Account Config (in .env)
Only the **current active upload account** needs API keys in your env:
```env
VITE_CLOUDINARY_CLOUD_NAME_ACTIVE=account_b_cloud_name
VITE_CLOUDINARY_API_KEY=xxxx
VITE_CLOUDINARY_API_SECRET=xxxx
```

Old read-only accounts (A, C...) need **no API keys** since their public URLs work without auth.

---

## Garbage Can Feature Plan

### Concept
Instead of immediately deleting "unwanted" media, move its `public_id` to a "garbage" state. The actual Cloudinary deletion only happens when you manually trigger it.

### Database Schema

```sql
-- Add a 'is_garbage' flag to your media tracking table
ALTER TABLE messages ADD COLUMN is_garbage BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN garbage_added_at TIMESTAMPTZ;

-- Or a separate dedicated garbage table
CREATE TABLE garbage_bin (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  cloudinary_public_id TEXT NOT NULL,
  cloud_name TEXT NOT NULL,          -- which account this belongs to
  media_type TEXT NOT NULL,          -- 'image' or 'video'
  added_by UUID REFERENCES profiles(id),
  added_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Garbage Can Flow

```
User sees media they don't need
        ↓
Taps "Move to Garbage" (long press or swipe)
        ↓
message.is_garbage = TRUE (media still exists on Cloudinary, still viewable)
        ↓
        ...later...
        ↓
User goes to Settings → "Garbage Can"
        ↓
Sees list of all garbage media with previews
        ↓
Taps "Empty Garbage" button
        ↓
App calls Cloudinary Delete API for each public_id
        ↓
Rows deleted from DB, storage freed on Cloudinary
```

### Cloudinary Delete API Call (Unsigned delete via server/edge function)

```typescript
// lib/cloudinary.ts
export async function deleteFromCloudinary(publicId: string, cloudName: string) {
  // This should be called from a Supabase Edge Function (never expose secret on client)
  const timestamp = Math.round(Date.now() / 1000);
  const signature = await generateSignature({ public_id: publicId, timestamp });

  const formData = new FormData();
  formData.append('public_id', publicId);
  formData.append('timestamp', timestamp.toString());
  formData.append('api_key', process.env.CLOUDINARY_API_KEY!);
  formData.append('signature', signature);

  await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
    { method: 'POST', body: formData }
  );
}
```

---

## Will Cloudinary Detect & Ban?

### Honest Risk Assessment

| Factor | Your Situation | Risk Level |
|---|---|---|
| Number of accounts | 3–5 over lifetime | 🟡 Low-Medium |
| Traffic per account | Extremely low (2 users) | 🟢 Very Low |
| Upload pattern | Slow, natural, human-like | 🟢 Very Low |
| Same IP uploads | Possible (home Wi-Fi) | 🟡 Minor flag |
| Bot-like behavior | None | 🟢 Very Low |
| Commercial use | No | 🟢 Very Low |

### What Cloudinary Actually Monitors
- **Bot/automated bulk uploads** → You're uploading naturally.
- **Same IP creating 50+ accounts** → You're making 3–5 over years.
- **Abuse of their CDN (DDoS, scraping)** → Not applicable.
- **Content policy violations** → Not applicable.

### Realistic Verdict
> **Very low chance of detection or ban** for your specific use case.
>
> You are 2 users, uploading media slowly over months. The accounts will be on different email addresses and will be used sequentially (not simultaneously for uploads). Cloudinary's enforcement is aimed at SaaS companies trying to abuse free tiers at scale — not a personal app with 2 users.

### Things to Avoid (Risk Minimization)
- ❌ Don't use the same email for multiple accounts (use different gmail aliases like `abc+cloud1@gmail.com`)
- ❌ Don't write a script that auto-uploads 500 files in 1 hour
- ✅ Upload naturally as you use the app
- ✅ Keep only 1 account active for uploads at a time
- ✅ Old accounts are just CDN read — that's 100% normal

---

## Implementation Checklist

### Phase 1: Multi-Account Support in DB
- [ ] Add `cloudinary_cloud_name` column to `messages` table
- [ ] Add `cloudinary_public_id` column (if not already there)
- [ ] Update upload function to always tag the `cloud_name` on insert
- [ ] Store active upload `cloud_name` in Supabase settings table or env

### Phase 2: Garbage Can Feature
- [ ] Create `garbage_bin` table in Supabase
- [ ] Add "Move to Garbage" UI (long press on media bubble)
- [ ] Build "Garbage Can" screen in Settings
- [ ] Add "Empty Garbage" button → calls bulk delete Supabase Edge Function
- [ ] Show estimated storage that will be freed

### Phase 3: Account Rotation (Manual)
- [ ] When Account A storage hits ~15GB → create Account B
- [ ] Update `.env` with new active account credentials (redeploy Vercel)
- [ ] Old Account A URLs continue working as-is (no code change needed)

---

## Summary

This is a smart, practical strategy for a personal lifetime-free app. The garbage can feature adds intelligent storage management, and the multi-account rotation ensures you never run out of space. Given it's just 2 users with natural usage patterns, the ban risk from Cloudinary is negligible.
