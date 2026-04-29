-- Extend symbolic_threads with new Phase 9 fields
ALTER TABLE public.symbolic_threads
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS recurrence_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pattern_id UUID,
  ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT false;

-- Backfill title from summary where missing
UPDATE public.symbolic_threads SET title = summary WHERE title IS NULL;

-- Patterns
CREATE TABLE IF NOT EXISTS public.patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  lifecycle_state TEXT NOT NULL DEFAULT 'emerging',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  thread_ids UUID[] NOT NULL DEFAULT '{}',
  reading_ids UUID[] NOT NULL DEFAULT '{}',
  is_premium BOOLEAN NOT NULL DEFAULT false,
  is_user_named BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE public.patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own patterns" ON public.patterns
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own patterns" ON public.patterns
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own patterns" ON public.patterns
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own patterns" ON public.patterns
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER touch_patterns_updated_at
  BEFORE UPDATE ON public.patterns
  FOR EACH ROW EXECUTE FUNCTION public.touch_symbolic_threads_updated_at();

-- Weaves
CREATE TABLE IF NOT EXISTS public.weaves (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  weave_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  pattern_ids UUID[] NOT NULL DEFAULT '{}',
  reading_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_premium BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE public.weaves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own weaves" ON public.weaves
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own weaves" ON public.weaves
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own weaves" ON public.weaves
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own weaves" ON public.weaves
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Readings.pattern_id
ALTER TABLE public.readings
  ADD COLUMN IF NOT EXISTS pattern_id UUID;

CREATE INDEX IF NOT EXISTS idx_readings_pattern_id ON public.readings(pattern_id);
CREATE INDEX IF NOT EXISTS idx_patterns_user_id ON public.patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_weaves_user_id ON public.weaves(user_id);
CREATE INDEX IF NOT EXISTS idx_symbolic_threads_pattern_id ON public.symbolic_threads(pattern_id);