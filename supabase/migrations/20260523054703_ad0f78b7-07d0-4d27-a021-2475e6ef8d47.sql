ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS card_popover_sections jsonb DEFAULT '{}'::jsonb;