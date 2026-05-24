-- Finding: feedback_posts.admin_note exposed to non-admin owners
-- Remove the authenticated role's ability to read admin_note via the client.
-- Admin server functions read admin_note through the service-role client
-- (supabaseAdmin), which is unaffected by these column-level grants.
REVOKE SELECT (admin_note) ON public.feedback_posts FROM authenticated;
REVOKE SELECT (admin_note) ON public.feedback_posts FROM anon;

-- Finding: user_preferences UPDATE allows privilege escalation at RLS layer.
-- Enforce privilege/billing field protection via column-level GRANTs in
-- addition to the existing prevent_user_preferences_privilege_escalation
-- trigger. Column-level UPDATE permissions are evaluated independently of
-- RLS policies and triggers, so even if the trigger is dropped or bypassed,
-- a direct UPDATE on these columns from the authenticated role is denied
-- at the SQL privilege layer.
REVOKE UPDATE (
  role,
  is_premium,
  subscription_type,
  premium_expires_at,
  premium_since,
  premium_tier,
  premium_months_used,
  premium_warning_sent_at,
  gifted_by,
  admin_note,
  archive_deepening_unlocked,
  stripe_customer_id
) ON public.user_preferences FROM authenticated;
REVOKE UPDATE (
  role,
  is_premium,
  subscription_type,
  premium_expires_at,
  premium_since,
  premium_tier,
  premium_months_used,
  premium_warning_sent_at,
  gifted_by,
  admin_note,
  archive_deepening_unlocked,
  stripe_customer_id
) ON public.user_preferences FROM anon;