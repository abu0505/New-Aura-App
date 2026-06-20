-- =============================================
-- AURA — Create Diverse Reels Pool Function (60/50 split + exclude_ids support)
-- Run in Supabase SQL Editor or apply via migrations
-- =============================================

CREATE OR REPLACE FUNCTION public.get_diverse_reels_pool(
  u_id UUID,
  p_id UUID,
  recent_cnt INT DEFAULT 40,
  middle_cnt INT DEFAULT 80,
  old_cnt INT DEFAULT 80,
  exclude_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS SETOF public.messages
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recent_limit INT;
  i_recent_limit INT;
  v_recent_chrono INT;
  i_recent_chrono INT;
  
  v_middle_limit INT;
  i_middle_limit INT;
  
  v_old_limit INT;
  i_old_limit INT;
BEGIN
  -- Calculate 60% video and 50% image targets for each bucket (ensuring plenty of both)
  v_recent_limit := ROUND(recent_cnt * 0.6)::INT;
  i_recent_limit := ROUND(recent_cnt * 0.5)::INT;
  
  v_recent_chrono := GREATEST(1, ROUND(v_recent_limit * 0.25)::INT);
  i_recent_chrono := GREATEST(1, ROUND(i_recent_limit * 0.25)::INT);

  v_middle_limit := ROUND(middle_cnt * 0.6)::INT;
  i_middle_limit := ROUND(middle_cnt * 0.5)::INT;

  v_old_limit := ROUND(old_cnt * 0.6)::INT;
  i_old_limit := ROUND(old_cnt * 0.5)::INT;

  RETURN QUERY
  (
    -- 1. RECENT VIDEOS (Chrono + Random)
    (
      SELECT * FROM public.messages
      WHERE type::text = 'video'
        AND (
          (sender_id = u_id AND receiver_id = p_id) OR 
          (sender_id = p_id AND receiver_id = u_id)
        )
        AND is_deleted_for_everyone = false
        AND created_at >= NOW() - INTERVAL '14 days'
        AND NOT (id = ANY(exclude_ids))
      ORDER BY created_at DESC
      LIMIT v_recent_chrono
    )
    UNION ALL
    (
      SELECT * FROM public.messages
      WHERE type::text = 'video'
        AND (
          (sender_id = u_id AND receiver_id = p_id) OR 
          (sender_id = p_id AND receiver_id = u_id)
        )
        AND is_deleted_for_everyone = false
        AND created_at >= NOW() - INTERVAL '14 days'
        AND NOT (id = ANY(exclude_ids))
        AND id NOT IN (
          SELECT id FROM public.messages
          WHERE type::text = 'video'
            AND (
              (sender_id = u_id AND receiver_id = p_id) OR 
              (sender_id = p_id AND receiver_id = u_id)
            )
            AND is_deleted_for_everyone = false
            AND created_at >= NOW() - INTERVAL '14 days'
            AND NOT (id = ANY(exclude_ids))
          ORDER BY created_at DESC
          LIMIT v_recent_chrono
        )
      ORDER BY random()
      LIMIT (v_recent_limit - v_recent_chrono)
    )
  )
  UNION ALL
  (
    -- 2. RECENT IMAGES (Chrono + Random)
    (
      SELECT * FROM public.messages
      WHERE type::text = 'image'
        AND (
          (sender_id = u_id AND receiver_id = p_id) OR 
          (sender_id = p_id AND receiver_id = u_id)
        )
        AND is_deleted_for_everyone = false
        AND created_at >= NOW() - INTERVAL '14 days'
        AND NOT (id = ANY(exclude_ids))
      ORDER BY created_at DESC
      LIMIT i_recent_chrono
    )
    UNION ALL
    (
      SELECT * FROM public.messages
      WHERE type::text = 'image'
        AND (
          (sender_id = u_id AND receiver_id = p_id) OR 
          (sender_id = p_id AND receiver_id = u_id)
        )
        AND is_deleted_for_everyone = false
        AND created_at >= NOW() - INTERVAL '14 days'
        AND NOT (id = ANY(exclude_ids))
        AND id NOT IN (
          SELECT id FROM public.messages
          WHERE type::text = 'image'
            AND (
              (sender_id = u_id AND receiver_id = p_id) OR 
              (sender_id = p_id AND receiver_id = u_id)
            )
            AND is_deleted_for_everyone = false
            AND created_at >= NOW() - INTERVAL '14 days'
            AND NOT (id = ANY(exclude_ids))
          ORDER BY created_at DESC
          LIMIT i_recent_chrono
        )
      ORDER BY random()
      LIMIT (i_recent_limit - i_recent_chrono)
    )
  )
  UNION ALL
  -- 3. MIDDLE VIDEOS (Random)
  (
    SELECT * FROM public.messages
    WHERE type::text = 'video'
      AND (
        (sender_id = u_id AND receiver_id = p_id) OR 
        (sender_id = p_id AND receiver_id = u_id)
      )
      AND is_deleted_for_everyone = false
      AND created_at < NOW() - INTERVAL '14 days'
      AND created_at >= NOW() - INTERVAL '90 days'
      AND NOT (id = ANY(exclude_ids))
    ORDER BY random()
    LIMIT v_middle_limit
  )
  UNION ALL
  -- 4. MIDDLE IMAGES (Random)
  (
    SELECT * FROM public.messages
    WHERE type::text = 'image'
      AND (
        (sender_id = u_id AND receiver_id = p_id) OR 
        (sender_id = p_id AND receiver_id = u_id)
      )
      AND is_deleted_for_everyone = false
      AND created_at < NOW() - INTERVAL '14 days'
      AND created_at >= NOW() - INTERVAL '90 days'
      AND NOT (id = ANY(exclude_ids))
    ORDER BY random()
    LIMIT i_middle_limit
  )
  UNION ALL
  -- 5. OLD VIDEOS (Random)
  (
    SELECT * FROM public.messages
    WHERE type::text = 'video'
      AND (
        (sender_id = u_id AND receiver_id = p_id) OR 
        (sender_id = p_id AND receiver_id = u_id)
      )
      AND is_deleted_for_everyone = false
      AND created_at < NOW() - INTERVAL '90 days'
      AND NOT (id = ANY(exclude_ids))
    ORDER BY random()
    LIMIT v_old_limit
  )
  UNION ALL
  -- 6. OLD IMAGES (Random)
  (
    SELECT * FROM public.messages
    WHERE type::text = 'image'
      AND (
        (sender_id = u_id AND receiver_id = p_id) OR 
        (sender_id = p_id AND receiver_id = u_id)
      )
      AND is_deleted_for_everyone = false
      AND created_at < NOW() - INTERVAL '90 days'
      AND NOT (id = ANY(exclude_ids))
    ORDER BY random()
    LIMIT i_old_limit
  );
END;
$$;
