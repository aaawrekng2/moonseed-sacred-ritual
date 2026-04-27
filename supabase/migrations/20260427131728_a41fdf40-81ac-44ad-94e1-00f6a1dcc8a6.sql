ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS remembered_question TEXT;