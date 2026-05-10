
CREATE TABLE public.ai_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  call_type text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cached_input_tokens int NOT NULL DEFAULT 0,
  cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  credits_consumed int NOT NULL DEFAULT 1,
  plan_at_time text NOT NULL DEFAULT 'free',
  reading_id uuid REFERENCES public.readings(id) ON DELETE SET NULL,
  pattern_id uuid REFERENCES public.patterns(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'success',
  error_code text,
  duration_ms int,
  idempotency_key text UNIQUE
);
CREATE INDEX idx_ai_call_log_user_created ON public.ai_call_log (user_id, created_at DESC);
CREATE INDEX idx_ai_call_log_user_type_created ON public.ai_call_log (user_id, call_type, created_at DESC);
CREATE INDEX idx_ai_call_log_status_created ON public.ai_call_log (status, created_at DESC);
ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_call_log_select_own" ON public.ai_call_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.ai_credit_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  credits_amount int NOT NULL,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_ai_credit_grants_user ON public.ai_credit_grants (user_id, created_at DESC);
CREATE INDEX idx_ai_credit_grants_user_expires ON public.ai_credit_grants (user_id, expires_at);
ALTER TABLE public.ai_credit_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_credit_grants_select_own" ON public.ai_credit_grants
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.admin_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_settings_select_authed" ON public.admin_settings
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.admin_settings (key, value, description) VALUES
  ('ai_enabled_globally', 'true'::jsonb, 'Master kill switch'),
  ('ai_quota_free_monthly', '50'::jsonb, 'Credits per month for free seekers'),
  ('ai_quota_premium_monthly', '1000'::jsonb, 'Credits per month for premium seekers'),
  ('ai_quota_anonymous_session', '3'::jsonb, 'Calls per anonymous session'),
  ('ai_credit_cost_interpretation', '1'::jsonb, NULL),
  ('ai_credit_cost_tailored_prompt', '1'::jsonb, NULL),
  ('ai_credit_cost_deep_reading', '5'::jsonb, NULL),
  ('ai_credit_cost_story_prose', '3'::jsonb, NULL),
  ('ai_credit_cost_share_summary', '1'::jsonb, NULL),
  ('ai_credit_cost_card_evidence', '3'::jsonb, NULL),
  ('ai_credit_cost_story_orchestration', '5'::jsonb, NULL),
  ('ai_credit_cost_pattern_interpretation', '2'::jsonb, NULL),
  ('ai_credit_cost_memory', '1'::jsonb, NULL),
  ('ai_credit_cost_insights', '1'::jsonb, NULL),
  ('storage_quota_free_photos_bytes', '104857600'::jsonb, 'Free: 100MB photo storage'),
  ('storage_quota_premium_photos_bytes', '5368709120'::jsonb, 'Premium: 5GB photo storage'),
  ('storage_quota_free_custom_decks', '10'::jsonb, NULL),
  ('storage_quota_premium_custom_decks', '50'::jsonb, NULL),
  ('ai_warning_threshold_pct', '75'::jsonb, NULL),
  ('ai_abuse_cap_per_hour', '20'::jsonb, NULL),
  ('ai_credit_pack_small_credits', '50'::jsonb, NULL),
  ('ai_credit_pack_small_price_usd', '4.99'::jsonb, NULL),
  ('ai_credit_pack_medium_credits', '200'::jsonb, NULL),
  ('ai_credit_pack_medium_price_usd', '14.99'::jsonb, NULL),
  ('ai_credit_pack_large_credits', '500'::jsonb, NULL),
  ('ai_credit_pack_large_price_usd', '29.99'::jsonb, NULL);

CREATE TABLE public.storage_event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  bucket text NOT NULL,
  path text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  reading_id uuid REFERENCES public.readings(id) ON DELETE SET NULL,
  deck_id uuid
);
CREATE INDEX idx_storage_event_user ON public.storage_event_log (user_id, created_at DESC);
ALTER TABLE public.storage_event_log ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ai_credit_grants (user_id, source, credits_amount, expires_at)
SELECT
  u.id,
  CASE WHEN COALESCE(up.is_premium, false) THEN 'monthly_premium' ELSE 'monthly_free' END,
  CASE WHEN COALESCE(up.is_premium, false) THEN 1000 ELSE 50 END,
  CASE
    WHEN EXTRACT(DAY FROM CURRENT_DATE) >= EXTRACT(DAY FROM u.created_at)
    THEN date_trunc('month', CURRENT_DATE) + interval '1 month' + (EXTRACT(DAY FROM u.created_at)::int - 1) * interval '1 day'
    ELSE date_trunc('month', CURRENT_DATE) + (EXTRACT(DAY FROM u.created_at)::int - 1) * interval '1 day'
  END
FROM auth.users u
LEFT JOIN public.user_preferences up ON up.user_id = u.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_credit_grants g WHERE g.user_id = u.id
);

CREATE OR REPLACE FUNCTION public.grant_monthly_credits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_free_quota int;
  v_premium_quota int;
BEGIN
  SELECT (value::text)::int INTO v_free_quota FROM admin_settings WHERE key = 'ai_quota_free_monthly';
  SELECT (value::text)::int INTO v_premium_quota FROM admin_settings WHERE key = 'ai_quota_premium_monthly';

  INSERT INTO public.ai_credit_grants (user_id, source, credits_amount, expires_at)
  SELECT
    u.id,
    CASE WHEN COALESCE(up.is_premium, false) THEN 'monthly_premium' ELSE 'monthly_free' END,
    CASE WHEN COALESCE(up.is_premium, false) THEN v_premium_quota ELSE v_free_quota END,
    now() + interval '1 month'
  FROM auth.users u
  LEFT JOIN public.user_preferences up ON up.user_id = u.id
  WHERE EXTRACT(DAY FROM u.created_at) = EXTRACT(DAY FROM CURRENT_DATE)
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_credit_grants g
      WHERE g.user_id = u.id
        AND g.source IN ('monthly_free', 'monthly_premium')
        AND g.created_at::date = CURRENT_DATE
    );
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'grant-monthly-credits') THEN
    PERFORM cron.schedule(
      'grant-monthly-credits',
      '0 0 * * *',
      $cron$SELECT public.grant_monthly_credits()$cron$
    );
  END IF;
END $$;
