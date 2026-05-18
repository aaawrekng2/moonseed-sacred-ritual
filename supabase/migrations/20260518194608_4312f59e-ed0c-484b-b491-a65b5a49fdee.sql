-- Q102 — Credits schema foundation: ledger-truth + Stripe scaffolding.

-- 1. Drop broken cache columns on user_preferences (they conflicted with the ledger).
ALTER TABLE public.user_preferences
  DROP COLUMN IF EXISTS credits_balance,
  DROP COLUMN IF EXISTS credits_next_refill_at,
  DROP COLUMN IF EXISTS credits_subscription_type;

-- 2. Add Stripe customer id to user_preferences.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- 3. Tag Stripe-sourced grants on the existing ledger.
ALTER TABLE public.ai_credit_grants
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS pack_sku text;

CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_grants_stripe_session_uniq
  ON public.ai_credit_grants(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

-- 4. Webhook audit + idempotency table.
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stripe_events_admins_select ON public.stripe_events;
CREATE POLICY stripe_events_admins_select
  ON public.stripe_events FOR SELECT TO authenticated
  USING (has_admin_role(auth.uid()));

-- 5. Daily reconciliation table.
CREATE TABLE IF NOT EXISTS public.daily_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date date NOT NULL UNIQUE,
  total_users integer NOT NULL DEFAULT 0,
  total_granted integer NOT NULL DEFAULT 0,
  total_consumed integer NOT NULL DEFAULT 0,
  total_outstanding integer NOT NULL DEFAULT 0,
  stripe_paid_cents bigint NOT NULL DEFAULT 0,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_reconciliation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_reconciliation_admins_select ON public.daily_reconciliation;
CREATE POLICY daily_reconciliation_admins_select
  ON public.daily_reconciliation FOR SELECT TO authenticated
  USING (has_admin_role(auth.uid()));