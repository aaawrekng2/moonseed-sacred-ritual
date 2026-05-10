
REVOKE ALL ON public.seeker_usage_monthly FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seeker_usage_monthly TO service_role;
