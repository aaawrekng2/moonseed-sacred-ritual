ALTER TABLE public.custom_decks ADD COLUMN IF NOT EXISTS aspect_config jsonb;
ALTER TABLE public.custom_decks ADD COLUMN IF NOT EXISTS ai_voice_guide text;
ALTER TABLE public.custom_deck_cards ADD COLUMN IF NOT EXISTS prompt_status text[];