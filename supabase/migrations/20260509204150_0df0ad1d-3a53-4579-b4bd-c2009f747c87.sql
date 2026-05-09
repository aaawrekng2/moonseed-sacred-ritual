ALTER TABLE public.custom_deck_cards
  ADD COLUMN IF NOT EXISTS journal_prompts text[] NULL;

ALTER TABLE public.readings
  ADD COLUMN IF NOT EXISTS tailored_prompt text NULL;