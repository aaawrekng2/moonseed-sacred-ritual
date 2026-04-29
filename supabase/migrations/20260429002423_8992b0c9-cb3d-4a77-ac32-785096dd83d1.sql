ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS tz_mode text NOT NULL DEFAULT 'auto';

ALTER TABLE public.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_tz_mode_check;
ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_tz_mode_check
  CHECK (tz_mode IN ('auto','fixed'));