DROP POLICY IF EXISTS "users select all votes" ON public.feedback_votes;
CREATE POLICY "users select own votes" ON public.feedback_votes FOR SELECT TO authenticated USING (auth.uid() = user_id);