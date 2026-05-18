ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS credits_balance integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS credits_next_refill_at timestamptz,
  ADD COLUMN IF NOT EXISTS credits_subscription_type text;