ALTER TABLE public.readings
  ADD COLUMN IF NOT EXISTS journal_prompt_used boolean NOT NULL DEFAULT false;