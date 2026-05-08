-- Background queue tracking columns
ALTER TABLE public.custom_deck_cards
  ADD COLUMN IF NOT EXISTS variant_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.custom_deck_cards
  ADD COLUMN IF NOT EXISTS variant_last_attempt_at timestamptz NULL;

-- Queue picker index (partial — only rows that may need work)
CREATE INDEX IF NOT EXISTS custom_deck_cards_variant_queue_idx
  ON public.custom_deck_cards (processing_status, variant_last_attempt_at)
  WHERE processing_status IN ('pending', 'failed') AND variant_attempts < 3;

-- Schedule background queue runner every 30 seconds via pg_cron + pg_net.
-- Uses verify_jwt=false on the edge function (set in supabase/config.toml)
-- so no Authorization header is required.
DO $$
BEGIN
  -- Remove any prior schedule so this migration is idempotent.
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'process-variant-queue';
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

SELECT cron.schedule(
  'process-variant-queue',
  '30 seconds',
  $$
    SELECT net.http_post(
      url := 'https://zsbejabwxiarclgqeiqv.supabase.co/functions/v1/process-variant-queue',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 25000
    );
  $$
);