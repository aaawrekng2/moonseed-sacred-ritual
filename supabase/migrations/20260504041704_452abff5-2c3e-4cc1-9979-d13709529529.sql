
-- AI tone preference
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS ai_tone text NOT NULL DEFAULT 'reflective';

-- Use trigger-based validation (not CHECK) per project rules
CREATE OR REPLACE FUNCTION public.validate_ai_tone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ai_tone NOT IN ('oracular','reflective','direct','poetic') THEN
    RAISE EXCEPTION 'invalid ai_tone: %', NEW.ai_tone;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_ai_tone_trigger ON public.user_preferences;
CREATE TRIGGER validate_ai_tone_trigger
  BEFORE INSERT OR UPDATE OF ai_tone ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.validate_ai_tone();

-- Reflections cache (short text)
CREATE TABLE IF NOT EXISTS public.insight_reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  reflection text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, cache_key)
);

ALTER TABLE public.insight_reflections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own reflections select" ON public.insight_reflections
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own reflections insert" ON public.insight_reflections
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own reflections update" ON public.insight_reflections
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own reflections delete" ON public.insight_reflections
  FOR DELETE USING (auth.uid() = user_id);

-- Themes cache (JSON)
CREATE TABLE IF NOT EXISTS public.insight_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  themes jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, cache_key)
);

ALTER TABLE public.insight_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own themes select" ON public.insight_themes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own themes insert" ON public.insight_themes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own themes update" ON public.insight_themes
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own themes delete" ON public.insight_themes
  FOR DELETE USING (auth.uid() = user_id);
