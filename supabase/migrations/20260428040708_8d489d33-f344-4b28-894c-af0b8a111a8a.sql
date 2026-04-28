
ALTER TABLE public.readings
  ADD COLUMN IF NOT EXISTS is_deep_reading boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deep_reading_lenses jsonb,
  ADD COLUMN IF NOT EXISTS mirror_saved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dawn_cycle_date date;

CREATE INDEX IF NOT EXISTS readings_user_dawn_cycle_idx
  ON public.readings (user_id, dawn_cycle_date)
  WHERE is_deep_reading = true;

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS archive_deepening_unlocked boolean NOT NULL DEFAULT false;
