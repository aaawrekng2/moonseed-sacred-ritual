ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS mfa_recovery_codes text[];