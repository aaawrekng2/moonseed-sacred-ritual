
-- Q69 — Add credits-only admin settings and simplify monthly grant function.

INSERT INTO public.admin_settings (key, value, description)
VALUES
  ('ai_starter_credits', '50'::jsonb, 'Credits granted to new users on first sign-in.'),
  ('ai_monthly_credits', '50'::jsonb, 'Credits granted to all users each month.'),
  ('max_custom_decks', '10'::jsonb, 'Maximum number of custom decks per user.')
ON CONFLICT (key) DO NOTHING;

-- Replace the monthly grant function to use a single quota for all users.
CREATE OR REPLACE FUNCTION public.grant_monthly_credits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_quota int;
BEGIN
  SELECT (value::text)::int INTO v_quota
  FROM admin_settings WHERE key = 'ai_monthly_credits';
  IF v_quota IS NULL THEN v_quota := 50; END IF;

  INSERT INTO public.ai_credit_grants (user_id, source, credits_amount, expires_at)
  SELECT
    u.id,
    'monthly',
    v_quota,
    now() + interval '1 month'
  FROM auth.users u
  WHERE EXTRACT(DAY FROM u.created_at) = EXTRACT(DAY FROM CURRENT_DATE)
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_credit_grants g
      WHERE g.user_id = u.id
        AND g.source IN ('monthly', 'monthly_free', 'monthly_premium')
        AND g.created_at::date = CURRENT_DATE
    );
END;
$function$;
