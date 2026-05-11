ALTER TABLE public.insight_themes ADD COLUMN IF NOT EXISTS generated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.insight_reflections ADD COLUMN IF NOT EXISTS generated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS reduce_premium_prompts boolean NOT NULL DEFAULT false;