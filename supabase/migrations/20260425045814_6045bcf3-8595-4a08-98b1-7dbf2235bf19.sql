-- Phase 4: AI interpretation via Claude
-- Stores each AI-generated reading and serves as the source of truth
-- for the 3-readings-per-day-per-user limit (enforced server-side).

CREATE TABLE public.readings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  spread_type TEXT NOT NULL,
  card_ids INTEGER[] NOT NULL,
  interpretation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index supports the daily-count query (filter by user_id + created_at).
CREATE INDEX readings_user_created_idx
  ON public.readings (user_id, created_at DESC);

ALTER TABLE public.readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own readings"
  ON public.readings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own readings"
  ON public.readings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
