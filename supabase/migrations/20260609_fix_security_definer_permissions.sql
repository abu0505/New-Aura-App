-- Revoke execution from public, anon, and authenticated roles on security definer functions to prevent anonymous execution via PostgREST API
REVOKE EXECUTE ON FUNCTION public.get_random_shuffle_recap(uuid, uuid, integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_chat_settings(text, text, text, boolean) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_shared_app_pin(text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_notifications() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_streak_at_midnight() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_streaks_at_risk() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_last_month_recap(uuid, uuid, integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_last_week_recap(uuid, uuid, integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_last_year_month_recap(uuid, uuid, integer, integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_throwbacks(uuid, uuid, integer, integer, integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_streak_camera() FROM public, anon, authenticated;

-- Explicitly grant execution to authenticated role for functions called by the frontend app
GRANT EXECUTE ON FUNCTION public.get_random_shuffle_recap(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_chat_settings(text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_shared_app_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_last_month_recap(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_last_week_recap(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_throwbacks(uuid, uuid, integer, integer, integer) TO authenticated;
