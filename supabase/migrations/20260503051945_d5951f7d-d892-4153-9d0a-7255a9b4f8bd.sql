ALTER TABLE public.custom_decks ADD COLUMN IF NOT EXISTS card_back_path text;
ALTER TABLE public.custom_decks ADD COLUMN IF NOT EXISTS card_back_thumb_path text;