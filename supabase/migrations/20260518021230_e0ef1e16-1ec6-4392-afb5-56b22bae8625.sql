-- Daily purge of stale anonymous auth users.
-- Removes anonymous accounts older than 7 days that never created a reading.
-- These are almost always bot/crawler visits.

CREATE OR REPLACE FUNCTION public.purge_stale_anonymous_users()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  _purged integer := 0;
BEGIN
  WITH deleted AS (
    DELETE FROM auth.users u
    WHERE u.is_anonymous = true
      AND u.created_at < now() - interval '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.readings r WHERE r.user_id = u.id
      )
    RETURNING 1
  )
  SELECT count(*) INTO _purged FROM deleted;
  RETURN _purged;
END;
$$;

-- Remove any prior schedule with the same name (idempotent re-runs).
SELECT cron.unschedule('purge-stale-anonymous-users')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-stale-anonymous-users');

-- Schedule daily at 03:00 UTC.
SELECT cron.schedule(
  'purge-stale-anonymous-users',
  '0 3 * * *',
  $$ SELECT public.purge_stale_anonymous_users(); $$
);