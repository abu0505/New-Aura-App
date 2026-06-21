/**
 * ─── AURA Reel Algorithm ──────────────────────────────────────────────────────
 *
 * Strategy: Weighted Reservoir Sampling
 *
 * Each media item receives a numeric "weight" score.
 * Items are then selected randomly but with probability proportional to their
 * weight, so heavier items appear more often WITHOUT completely dominating.
 *
 * Weight breakdown (higher = appears more often):
 *
 * Source tier:
 *   - Dedicated reel upload (video)   → +10  (highest — intentional featured content)
 *   - Dedicated reel upload (photo)   → +8
 *   - On-This-Day bonus (same date last year ±3 days) → +9  (nostalgia gold)
 *   - New reel upload (0–3 days old)  → +6   (temporary new-content boost, then drops)
 *
 * Age tier (your "old > middle > latest" rule):
 *   - Old (6+ months ago)     → +7 video / +5 photo   (highest — nostalgia-first)
 *   - Middle (1–6 months)     → +5 video / +3 photo   (medium)
 *   - Recent (<1 month)       → +3 video / +2 photo   (lowest — avoid flooding with today's stuff)
 *
 * Minimum weight is always 1 so every item has at least some chance.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface WeightedMediaItem {
  id: string;
  type: 'image' | 'video' | string;
  created_at: string;
  is_reel_upload?: boolean;
  media_url?: string | null;
  media_key?: string | null;
  media_nonce?: string | null;
}

/**
 * Filters a pool of media items, removing any item that cannot be displayed.
 *
 * Regular media (images + non-chunked videos):
 *   - Must have media_url, media_key, and media_nonce to be decryptable.
 *
 * Chunked videos (type='video', media_url=NULL):
 *   - These store data in the video_chunks table, NOT in media_url.
 *   - They ARE displayable if they have media_key + media_nonce.
 *   - They are identified by: type === 'video' && !media_url && media_key && media_nonce
 */
export function filterDecryptableItems<T extends WeightedMediaItem>(pool: T[]): T[] {
  return pool.filter(item => {
    // Chunked video: type=video, no media_url, but has encryption keys
    if (item.type === 'video' && !item.media_url && !!item.media_key && !!item.media_nonce) {
      return true;
    }
    // Regular media: must have all three fields
    return !!item.media_url && !!item.media_key && !!item.media_nonce;
  });
}

/** How many days difference to count as "On This Day" (±3 days from today) */
const ON_THIS_DAY_TOLERANCE_DAYS = 3;

/**
 * Returns true if the media was created on approximately the same day in
 * a previous year (within ±3 days), enabling the "On This Day" nostalgia bonus.
 * Also considers same-day-of-month anniversary for media older than 6 months in younger libraries.
 */
function isOnThisDay(createdAt: string): boolean {
  const now = new Date();
  const created = new Date(createdAt);
  const ageDays = ageInDays(createdAt);

  // 1. Standard "On This Day" (same month and day, ±3 days, in a previous year)
  if (created.getFullYear() < now.getFullYear()) {
    const nowDayOfYear = getDayOfYear(now);
    const createdDayOfYear = getDayOfYear(created);

    const diff = Math.abs(nowDayOfYear - createdDayOfYear);
    // Account for year-wrap (e.g., Dec 30 vs Jan 2)
    const wrappedDiff = Math.min(diff, 365 - diff);

    if (wrappedDiff <= ON_THIS_DAY_TOLERANCE_DAYS) {
      return true;
    }
  }

  // 2. Same day-of-month monthly throwback for media older than 6 months (180 days)
  if (ageDays >= 180) {
    const nowDay = now.getDate();
    const createdDay = created.getDate();

    const diff = Math.abs(nowDay - createdDay);
    const wrappedDiff = Math.min(diff, 30 - diff); // Approximate month wrap

    if (wrappedDiff <= ON_THIS_DAY_TOLERANCE_DAYS) {
      return true;
    }
  }

  return false;
}

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = (date as any) - (start as any);
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/** Age of the item in full days from now */
function ageInDays(createdAt: string): number {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  return Math.floor((now - created) / (1000 * 60 * 60 * 24));
}

/**
 * Calculates a weight score for a single media item.
 * Higher score = more likely to appear in the reel feed.
 */
export function calculateReelWeight(item: WeightedMediaItem): number {
  const isVideo = item.type === 'video';
  const isReelUpload = !!item.is_reel_upload;
  const age = ageInDays(item.created_at);
  const onThisDay = isOnThisDay(item.created_at);

  let weight = 0;

  // ── "On This Day" bonus — added first as it stacks on top of age tier ─────
  if (onThisDay) {
    weight += 9;
  }

  // ── Dedicated Reel Upload tier ─────────────────────────────────────────────
  if (isReelUpload) {
    // Brand new reel upload (0–3 days): temporary boost so you actually see it
    if (age <= 3) {
      weight += isVideo ? 10 : 8;
      weight += 6; // new-upload bonus on top
    } else {
      // After 3 days, reel uploads settle into normal upload-source weight
      weight += isVideo ? 10 : 8;
    }
  } else {
    // ── Regular chat media: nostalgia-first age tiers ─────────────────────
    if (age >= 180) {
      // OLD (6+ months): highest nostalgia value
      weight += isVideo ? 7 : 5;
    } else if (age >= 30) {
      // MIDDLE (1–6 months): medium weight
      weight += isVideo ? 5 : 3;
    } else {
      // RECENT (<1 month): lowest weight — fresh chat media shouldn't dominate
      weight += isVideo ? 3 : 2;
    }
  }

  // Minimum safety net — every item has at least a tiny chance
  return Math.max(weight, 1);
}

/**
 * Weighted Reservoir Sampling (Algorithm A-Res)
 *
 * Selects `n` items from `pool` randomly but with probability proportional
 * to each item's weight. This guarantees:
 *   - Every item CAN appear (no hard exclusions)
 *   - High-weight items appear proportionally MORE often
 *   - The result is always a random permutation, not sorted by weight
 *
 * Reference: Efraimidis & Spirakis, 2006 — "Weighted random sampling with a reservoir"
 */
export function weightedReservoirSample<T extends WeightedMediaItem>(
  pool: T[],
  n: number,
  weightFn: (item: T) => number = calculateReelWeight
): T[] {
  if (pool.length === 0) return [];
  if (n >= pool.length) {
    // Not enough items to sample — return all, weighted-shuffled
    return weightedShuffle(pool, weightFn);
  }

  // Assign each item a key: key = random^(1/weight)
  // Higher weight → key closer to 1 → selected more often
  const scored = pool.map(item => ({
    item,
    key: Math.pow(Math.random(), 1 / Math.max(weightFn(item), 0.001)),
  }));

  // Sort descending by key and take top n
  scored.sort((a, b) => b.key - a.key);
  return scored.slice(0, n).map(s => s.item);
}

/**
 * Weighted shuffle — returns entire pool ordered by weighted random keys.
 * Used when n >= pool.length (shuffle instead of sample).
 */
function weightedShuffle<T extends WeightedMediaItem>(
  pool: T[],
  weightFn: (item: T) => number
): T[] {
  return [...pool]
    .map(item => ({
      item,
      key: Math.pow(Math.random(), 1 / Math.max(weightFn(item), 0.001)),
    }))
    .sort((a, b) => b.key - a.key)
    .map(s => s.item);
}

/**
 * Main entry point: given a raw pool of media items, returns a weighted
 * ordered list ready for the reel feed.
 *
 * @param pool   - All available media items
 * @param limit  - How many to return (default 50)
 */
export function buildReelQueue<T extends WeightedMediaItem>(
  pool: T[],
  limit = 50
): T[] {
  const videos = pool.filter(item => item.type === 'video');
  const images = pool.filter(item => item.type !== 'video');

  // Calculate video target using a randomized 30% to 50% target (3 to 5 videos per 10 items)
  let videoTarget = 0;
  let remaining = limit;
  while (remaining > 0) {
    const chunkSize = Math.min(remaining, 10);
    if (chunkSize === 10) {
      // Out of 10 items, randomly show 3, 4, or 5 videos (average 4.0 i.e. 40%)
      const v = Math.floor(Math.random() * 3) + 3;
      videoTarget += v;
    } else {
      // Scale proportionally for remaining items
      const minV = Math.ceil(0.3 * chunkSize);
      const maxV = Math.floor(0.5 * chunkSize);
      const v = Math.floor(Math.random() * (maxV - minV + 1)) + minV;
      videoTarget += v;
    }
    remaining -= chunkSize;
  }
  let imageTarget = limit - videoTarget;

  // Adjust targets if we don't have enough of one type in the fetched pool
  if (videos.length < videoTarget) {
    const deficit = videoTarget - videos.length;
    videoTarget = videos.length;
    imageTarget = Math.min(images.length, imageTarget + deficit);
  } else if (images.length < imageTarget) {
    const deficit = imageTarget - images.length;
    imageTarget = images.length;
    videoTarget = Math.min(videos.length, videoTarget + deficit);
  }

  const sampledVideos = weightedReservoirSample(videos, videoTarget);
  const sampledImages = weightedReservoirSample(images, imageTarget);

  const merged = [...sampledVideos, ...sampledImages];
  
  // Interleave/shuffle the merged list randomly so they don't appear in blocks
  return merged.sort(() => Math.random() - 0.5);
}
