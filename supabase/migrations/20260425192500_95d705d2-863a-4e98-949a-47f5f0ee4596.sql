ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS oracle_mode boolean NOT NULL DEFAULT false;