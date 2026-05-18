ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS card_scale_grid integer NOT NULL DEFAULT 100,
ADD COLUMN IF NOT EXISTS card_scale_bar integer NOT NULL DEFAULT 100,
ADD COLUMN IF NOT EXISTS card_scale_deck integer NOT NULL DEFAULT 100,
ADD COLUMN IF NOT EXISTS card_scale_pairs integer NOT NULL DEFAULT 100;