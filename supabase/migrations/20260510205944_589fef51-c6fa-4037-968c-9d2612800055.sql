
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS ai_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_blocked_reason text;

DROP POLICY IF EXISTS "ai_call_log_admins_select" ON public.ai_call_log;
CREATE POLICY "ai_call_log_admins_select" ON public.ai_call_log FOR SELECT TO authenticated USING (public.has_admin_role(auth.uid()));

DROP POLICY IF EXISTS "ai_credit_grants_admins_select" ON public.ai_credit_grants;
CREATE POLICY "ai_credit_grants_admins_select" ON public.ai_credit_grants FOR SELECT TO authenticated USING (public.has_admin_role(auth.uid()));

DROP POLICY IF EXISTS "ai_credit_grants_admins_insert" ON public.ai_credit_grants;
CREATE POLICY "ai_credit_grants_admins_insert" ON public.ai_credit_grants FOR INSERT TO authenticated WITH CHECK (public.has_admin_role(auth.uid()));

DROP POLICY IF EXISTS "admin_settings_admins_update" ON public.admin_settings;
CREATE POLICY "admin_settings_admins_update" ON public.admin_settings FOR UPDATE TO authenticated USING (public.has_admin_role(auth.uid())) WITH CHECK (public.has_admin_role(auth.uid()));

DROP MATERIALIZED VIEW IF EXISTS public.seeker_usage_monthly;
CREATE MATERIALIZED VIEW public.seeker_usage_monthly AS
SELECT
  up.user_id,
  au.email,
  up.display_name,
  CASE
    WHEN up.is_premium AND up.subscription_type = 'gifted' THEN 'premium_gifted'
    WHEN up.is_premium THEN 'premium'
    ELSE 'free'
  END AS plan,
  up.role,
  au.created_at AS member_since,
  COALESCE(up.ai_blocked, false) AS ai_blocked,
  COALESCE(ai_month.calls, 0) AS ai_calls_this_month,
  COALESCE(ai_month.credits, 0) AS ai_credits_used_this_month,
  COALESCE(ai_month.cost_usd, 0)::numeric AS ai_cost_usd_this_month,
  COALESCE(ai_all.calls, 0) AS ai_calls_lifetime,
  COALESCE(ai_all.cost_usd, 0)::numeric AS ai_cost_usd_lifetime,
  COALESCE(st.bytes, 0) AS storage_bytes_current,
  (COALESCE(st.bytes, 0) / 1073741824.0) * 0.021 AS storage_cost_usd_this_month,
  CASE WHEN up.is_premium AND up.subscription_type IS DISTINCT FROM 'gifted' THEN 9.99 ELSE 0 END AS revenue_this_month,
  ai_all.last_call_at,
  st.last_upload_at,
  COALESCE(ai_month.abuse_hits, 0) > 0 AS hit_abuse_cap_this_month,
  COALESCE(ai_month.quota_hits, 0) > 0 AS hit_quota_exceeded_this_month
FROM public.user_preferences up
JOIN auth.users au ON au.id = up.user_id
LEFT JOIN (
  SELECT user_id,
    COUNT(*) FILTER (WHERE status = 'success') AS calls,
    SUM(credits_consumed) FILTER (WHERE status = 'success') AS credits,
    SUM(cost_usd) FILTER (WHERE status = 'success') AS cost_usd,
    COUNT(*) FILTER (WHERE status = 'rate_limited') AS abuse_hits,
    COUNT(*) FILTER (WHERE status = 'quota_exceeded') AS quota_hits
  FROM public.ai_call_log
  WHERE created_at >= date_trunc('month', now())
  GROUP BY user_id
) ai_month ON ai_month.user_id = up.user_id
LEFT JOIN (
  SELECT user_id,
    COUNT(*) FILTER (WHERE status = 'success') AS calls,
    SUM(cost_usd) FILTER (WHERE status = 'success') AS cost_usd,
    MAX(created_at) AS last_call_at
  FROM public.ai_call_log
  GROUP BY user_id
) ai_all ON ai_all.user_id = up.user_id
LEFT JOIN (
  SELECT user_id,
    SUM(CASE WHEN event_type LIKE '%_delete' THEN -size_bytes ELSE size_bytes END) AS bytes,
    MAX(created_at) AS last_upload_at
  FROM public.storage_event_log
  GROUP BY user_id
) st ON st.user_id = up.user_id;

CREATE UNIQUE INDEX seeker_usage_monthly_user_id_idx ON public.seeker_usage_monthly (user_id);
CREATE INDEX seeker_usage_monthly_ai_cost_idx ON public.seeker_usage_monthly (ai_cost_usd_this_month DESC);
CREATE INDEX seeker_usage_monthly_storage_idx ON public.seeker_usage_monthly (storage_bytes_current DESC);

DO $$
DECLARE jid int;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'refresh-seeker-usage';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule('refresh-seeker-usage','*/5 * * * *',$$REFRESH MATERIALIZED VIEW CONCURRENTLY public.seeker_usage_monthly$$);

REFRESH MATERIALIZED VIEW public.seeker_usage_monthly;
