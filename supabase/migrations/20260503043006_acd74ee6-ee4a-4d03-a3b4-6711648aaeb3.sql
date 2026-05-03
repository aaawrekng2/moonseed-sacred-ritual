
ALTER TABLE public.readings
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_readings_archived_at
  ON public.readings (user_id, archived_at)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_readings_user_active
  ON public.readings (user_id, created_at DESC)
  WHERE archived_at IS NULL;

-- Daily purge of readings archived >30 days, with pattern reading_ids cleanup.
CREATE OR REPLACE FUNCTION public.purge_archived_readings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _purged integer := 0;
  _r record;
BEGIN
  FOR _r IN
    SELECT id, user_id FROM public.readings
    WHERE archived_at IS NOT NULL
      AND archived_at < (now() - interval '30 days')
  LOOP
    -- Strip this reading from any pattern's reading_ids.
    UPDATE public.patterns
    SET reading_ids = array_remove(reading_ids, _r.id),
        lifecycle_state = CASE
          WHEN array_length(array_remove(reading_ids, _r.id), 1) IS NULL
            THEN 'dormant'
          ELSE lifecycle_state
        END,
        updated_at = now()
    WHERE user_id = _r.user_id
      AND _r.id = ANY(reading_ids);

    DELETE FROM public.readings WHERE id = _r.id;
    _purged := _purged + 1;
  END LOOP;
  RETURN _purged;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('purge-archived-readings');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'purge-archived-readings',
  '0 4 * * *',
  $$ SELECT public.purge_archived_readings(); $$
);
