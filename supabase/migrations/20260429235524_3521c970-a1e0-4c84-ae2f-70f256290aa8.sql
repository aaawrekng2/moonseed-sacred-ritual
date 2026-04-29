ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS allow_reversed_cards BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.readings ADD COLUMN IF NOT EXISTS card_orientations BOOLEAN[] NOT NULL DEFAULT '{}';