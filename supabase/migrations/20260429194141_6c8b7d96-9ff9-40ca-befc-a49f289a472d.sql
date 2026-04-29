ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS default_share_color TEXT NOT NULL DEFAULT 'gold',
  ADD COLUMN IF NOT EXISTS last_share_level TEXT;