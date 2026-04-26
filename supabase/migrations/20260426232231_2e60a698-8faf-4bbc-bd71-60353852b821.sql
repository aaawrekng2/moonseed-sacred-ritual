-- Revoke base-table privileges from the `anon` role on all private tables.
-- These GRANTs are defaults inherited from `public`/Supabase setup and are
-- what triggers the "Anonymous Access Policies" linter warning, even though
-- RLS already blocks access. Removing the GRANT itself is the recommended
-- defense-in-depth fix.

REVOKE ALL ON public.readings FROM anon;
REVOKE ALL ON public.reading_photos FROM anon;
REVOKE ALL ON public.user_tags FROM anon;
REVOKE ALL ON public.custom_guides FROM anon;
REVOKE ALL ON public.user_preferences FROM anon;
REVOKE ALL ON public.user_streaks FROM anon;