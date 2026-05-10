ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS spread_entry_modes jsonb NOT NULL DEFAULT '{}'::jsonb;