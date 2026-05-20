-- =============================================
-- AURA: Fix Profile Trigger + Cleanup Test User
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. Function that creates a profile row when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, public_key)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      split_part(NEW.email, '@', 1)
    ),
    ''
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Attach the trigger to auth.users (fires after every new signup)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Delete the test garbage profile AND its auth.users entry
--    The profile has display_name = 'husband788512' and NULL public_key
--    Deleting from auth.users cascades down and removes the profile row too.
DELETE FROM auth.users
WHERE id = 'a5e11089-a69d-497d-848a-f13cc7364d69';
