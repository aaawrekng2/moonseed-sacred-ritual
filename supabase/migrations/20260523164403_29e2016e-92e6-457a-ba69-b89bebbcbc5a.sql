
-- 1) Prevent privilege escalation via user_preferences UPDATE
CREATE OR REPLACE FUNCTION public.prevent_user_preferences_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow admins to change anything
  IF public.has_admin_role(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Non-admins cannot modify privilege/billing-controlled columns
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Not authorized to change role';
  END IF;
  IF NEW.is_premium IS DISTINCT FROM OLD.is_premium THEN
    RAISE EXCEPTION 'Not authorized to change is_premium';
  END IF;
  IF NEW.subscription_type IS DISTINCT FROM OLD.subscription_type THEN
    RAISE EXCEPTION 'Not authorized to change subscription_type';
  END IF;
  IF NEW.premium_expires_at IS DISTINCT FROM OLD.premium_expires_at THEN
    RAISE EXCEPTION 'Not authorized to change premium_expires_at';
  END IF;
  IF NEW.gifted_by IS DISTINCT FROM OLD.gifted_by THEN
    RAISE EXCEPTION 'Not authorized to change gifted_by';
  END IF;
  IF NEW.ai_blocked IS DISTINCT FROM OLD.ai_blocked THEN
    RAISE EXCEPTION 'Not authorized to change ai_blocked';
  END IF;
  IF NEW.ai_blocked_reason IS DISTINCT FROM OLD.ai_blocked_reason THEN
    RAISE EXCEPTION 'Not authorized to change ai_blocked_reason';
  END IF;
  IF NEW.admin_note IS DISTINCT FROM OLD.admin_note THEN
    RAISE EXCEPTION 'Not authorized to change admin_note';
  END IF;
  IF NEW.archive_deepening_unlocked IS DISTINCT FROM OLD.archive_deepening_unlocked THEN
    RAISE EXCEPTION 'Not authorized to change archive_deepening_unlocked';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_privilege_escalation_on_user_preferences ON public.user_preferences;
CREATE TRIGGER prevent_privilege_escalation_on_user_preferences
BEFORE UPDATE ON public.user_preferences
FOR EACH ROW
EXECUTE FUNCTION public.prevent_user_preferences_privilege_escalation();

-- 2) Lock down admin_settings reads to admins only
DROP POLICY IF EXISTS admin_settings_select_authed ON public.admin_settings;
CREATE POLICY admin_settings_admins_select
ON public.admin_settings
FOR SELECT
TO authenticated
USING (public.has_admin_role(auth.uid()));
