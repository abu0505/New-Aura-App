/**
 * fetchDiverseMediaPool — Multi-bucket pool fetcher
 *
 * Problem: A single `ORDER BY created_at DESC LIMIT 200` only returns the
 * most recent items. If June alone has 700+ items, media from April/May/2025
 * is NEVER seen by the algorithm.
 *
 * Solution: 3 parallel queries, one per time bucket, then merge:
 *   - Recent  (last 14 days)       → up to 40 items
 *   - Middle  (14 days – 3 months) → up to 80 items
 *   - Old     (3+ months)          → up to 80 items
 *
 * This guarantees old nostalgia content and early videos always enter
 * the weighted pool, giving the algorithm real variety to work with.
 */

import { supabase } from '../lib/supabase';

const FEED_COLUMNS =
  'id, type, created_at, is_reel_upload, media_url, media_key, media_nonce, sender_public_key, sender_id, receiver_id, thumbnail_url';

export async function fetchDiverseMediaPool(
  userId: string,
  partnerId: string,
  {
    recentLimit = 40,
    middleLimit = 80,
    oldLimit = 80,
  } = {},
  excludeIds: string[] = []
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc('get_diverse_reels_pool', {
      u_id: userId,
      p_id: partnerId,
      recent_cnt: recentLimit,
      middle_cnt: middleLimit,
      old_cnt: oldLimit,
      exclude_ids: excludeIds,
    });

    if (error) throw error;

    if (data) {
      return data;
    }
  } catch (e) {
    console.warn('[feedPool] RPC failed or returned empty. Falling back to client-side queries:', e);
  }

  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const userFilter = `and(sender_id.eq.${userId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${userId})`;

  const buildFallbackQuery = (gte?: string, lt?: string, limitValue = 80) => {
    let query = supabase
      .from('messages')
      .select(FEED_COLUMNS)
      .in('type', ['image', 'video'])
      .or(userFilter)
      .eq('is_deleted_for_everyone', false);

    if (gte) query = query.gte('created_at', gte);
    if (lt) query = query.lt('created_at', lt);
    if (excludeIds.length > 0) {
      query = query.not('id', 'in', `(${excludeIds.join(',')})`);
    }

    return query.order('created_at', { ascending: false }).limit(limitValue);
  };

  // Fire all 3 time-bucket queries in parallel
  const [recentResult, middleResult, oldResult] = await Promise.all([
    buildFallbackQuery(twoWeeksAgo, undefined, recentLimit),
    buildFallbackQuery(threeMonthsAgo, twoWeeksAgo, middleLimit),
    buildFallbackQuery(undefined, threeMonthsAgo, oldLimit),
  ]);



  if (recentResult.error) console.error('[feedPool] Recent bucket error:', recentResult.error);
  if (middleResult.error) console.error('[feedPool] Middle bucket error:', middleResult.error);
  if (oldResult.error) console.error('[feedPool] Old bucket error:', oldResult.error);

  const pool: any[] = [];
  if (recentResult.data) pool.push(...recentResult.data);
  if (middleResult.data) pool.push(...middleResult.data);
  if (oldResult.data) pool.push(...oldResult.data);

  // Deduplicate by id (safety net)
  const seen = new Set<string>();
  return pool.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
