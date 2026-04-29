REVOKE EXECUTE ON FUNCTION public.handle_new_user_default_tags() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_default_user_tags(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_admin_action(text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_admin_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_role(uuid) TO authenticated;