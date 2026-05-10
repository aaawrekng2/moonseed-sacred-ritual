-- Q30 Stage 2 — move story orchestration columns to the patterns table
-- so the Stories page (which is per-pattern) can read them directly.

ALTER TABLE public.patterns
  ADD COLUMN IF NOT EXISTS story_name text,
  ADD COLUMN IF NOT EXISTS story_description text,
  ADD COLUMN IF NOT EXISTS per_reading_roles jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS remarkable_moments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS narrative_arc text,
  ADD COLUMN IF NOT EXISTS ai_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_version text,
  ADD COLUMN IF NOT EXISTS ai_reading_count_at_gen integer;