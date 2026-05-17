ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS font_pairing TEXT DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS text_scale REAL DEFAULT 1.0;