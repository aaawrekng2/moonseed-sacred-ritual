-- Alerts raised by the detect-weaves evaluator.
CREATE TABLE IF NOT EXISTS public.detect_weaves_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  kind         text NOT NULL CHECK (kind IN ('failure', 'partial', 'zero_streak')),
  severity     text NOT NULL DEFAULT 'warn' CHECK (severity IN ('info', 'warn', 'error')),
  message      text NOT NULL,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_id       uuid,
  notified_at  timestamptz,
  resolved_at  timestamptz,
  resolved_by  uuid
);

CREATE INDEX IF NOT EXISTS detect_weaves_alerts_open_idx
  ON public.detect_weaves_alerts (created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.detect_weaves_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read alerts"
  ON public.detect_weaves_alerts FOR SELECT
  TO authenticated
  USING (public.has_admin_role(auth.uid()));

CREATE POLICY "Admins update alerts"
  ON public.detect_weaves_alerts FOR UPDATE
  TO authenticated
  USING (public.has_admin_role(auth.uid()))
  WITH CHECK (public.has_admin_role(auth.uid()));

-- Inserts happen via supabaseAdmin (service role, bypasses RLS) so we
-- intentionally do NOT add an INSERT policy.

-- Mark each detect-weaves run after the evaluator has scored it so the
-- evaluator never alerts on the same run twice.
ALTER TABLE public.detect_weaves_runs
  ADD COLUMN IF NOT EXISTS alerted boolean NOT NULL DEFAULT false;