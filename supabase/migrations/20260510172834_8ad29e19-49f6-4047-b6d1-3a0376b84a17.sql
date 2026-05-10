ALTER TABLE public.symbolic_threads
  ADD COLUMN IF NOT EXISTS story_name TEXT,
  ADD COLUMN IF NOT EXISTS story_description TEXT,
  ADD COLUMN IF NOT EXISTS per_reading_roles JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS remarkable_moments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS narrative_arc TEXT,
  ADD COLUMN IF NOT EXISTS ai_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_version TEXT,
  ADD COLUMN IF NOT EXISTS ai_reading_count_at_gen INT;

CREATE INDEX IF NOT EXISTS idx_symbolic_threads_ai_generated_at
  ON public.symbolic_threads (ai_generated_at);