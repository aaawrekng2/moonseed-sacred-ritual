
-- Admin/subscription tracking on user_preferences
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS subscription_type text NOT NULL DEFAULT 'none';
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS gifted_by uuid REFERENCES auth.users(id);
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS admin_note text;

-- Optional CHECK-style validation via simple constraints
DO $$ BEGIN
  ALTER TABLE public.user_preferences
    ADD CONSTRAINT user_preferences_role_check
    CHECK (role IN ('user','admin','super_admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.user_preferences
    ADD CONSTRAINT user_preferences_subscription_type_check
    CHECK (subscription_type IN ('none','trial','stripe','gifted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Promote mark@spiekerstudios.com to super_admin
UPDATE public.user_preferences
SET role = 'super_admin'
WHERE user_id IN (
  SELECT id FROM auth.users WHERE lower(email) = 'mark@spiekerstudios.com'
);

-- Helper function so admin queries can be written without joins (and so RLS can be extended later)
CREATE OR REPLACE FUNCTION public.has_admin_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_preferences
    WHERE user_id = _user_id AND role IN ('admin','super_admin')
  );
$$;

-- Allow admins to read all user_preferences rows (for admin panel listing)
CREATE POLICY "Admins can read all preferences"
ON public.user_preferences
FOR SELECT
TO authenticated
USING (public.has_admin_role(auth.uid()));

-- Allow admins to update all user_preferences rows (gift premium / set role)
CREATE POLICY "Admins can update all preferences"
ON public.user_preferences
FOR UPDATE
TO authenticated
USING (public.has_admin_role(auth.uid()))
WITH CHECK (public.has_admin_role(auth.uid()));

-- Allow admins to read all readings (counts + last reading date)
CREATE POLICY "Admins can read all readings"
ON public.readings
FOR SELECT
TO authenticated
USING (public.has_admin_role(auth.uid()));
