CREATE POLICY "storage_event_log_select_own"
ON public.storage_event_log
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "storage_event_log_insert_own"
ON public.storage_event_log
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "storage_event_log_admins_select"
ON public.storage_event_log
FOR SELECT
TO authenticated
USING (public.has_admin_role(auth.uid()));

CREATE INDEX IF NOT EXISTS storage_event_log_user_event_idx
ON public.storage_event_log (user_id, event_type);