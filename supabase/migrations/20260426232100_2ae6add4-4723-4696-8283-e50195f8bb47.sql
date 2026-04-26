-- Tighten RLS policies: restrict to `authenticated` role only and require auth.uid() match.
-- The previous policies used the default `public` role, which allowed the anon role
-- to attempt access (RLS still blocked it via auth.uid() = user_id, but the linter
-- correctly flags this as a hardening opportunity).

-- ============================================================================
-- readings
-- ============================================================================
DROP POLICY IF EXISTS "Users can read own readings" ON public.readings;
DROP POLICY IF EXISTS "Users can insert own readings" ON public.readings;
DROP POLICY IF EXISTS "Users can update own readings" ON public.readings;
DROP POLICY IF EXISTS "Users can delete own readings" ON public.readings;

CREATE POLICY "Users can read own readings"
  ON public.readings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own readings"
  ON public.readings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own readings"
  ON public.readings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own readings"
  ON public.readings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- reading_photos
-- ============================================================================
DROP POLICY IF EXISTS "Users select own photos" ON public.reading_photos;
DROP POLICY IF EXISTS "Users insert own photos" ON public.reading_photos;
DROP POLICY IF EXISTS "Users update own photos" ON public.reading_photos;
DROP POLICY IF EXISTS "Users delete own photos" ON public.reading_photos;

CREATE POLICY "Users select own photos"
  ON public.reading_photos FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own photos"
  ON public.reading_photos FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own photos"
  ON public.reading_photos FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own photos"
  ON public.reading_photos FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- user_tags
-- ============================================================================
DROP POLICY IF EXISTS "Users select own tags" ON public.user_tags;
DROP POLICY IF EXISTS "Users insert own tags" ON public.user_tags;
DROP POLICY IF EXISTS "Users update own tags" ON public.user_tags;
DROP POLICY IF EXISTS "Users delete own tags" ON public.user_tags;

CREATE POLICY "Users select own tags"
  ON public.user_tags FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own tags"
  ON public.user_tags FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own tags"
  ON public.user_tags FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own tags"
  ON public.user_tags FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- custom_guides
-- ============================================================================
DROP POLICY IF EXISTS "Users can manage own guides" ON public.custom_guides;

CREATE POLICY "Users can manage own guides"
  ON public.custom_guides FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- user_preferences
-- ============================================================================
DROP POLICY IF EXISTS "Users can read own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can insert own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can update own preferences" ON public.user_preferences;

CREATE POLICY "Users can read own preferences"
  ON public.user_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences"
  ON public.user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
  ON public.user_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- user_streaks
-- ============================================================================
DROP POLICY IF EXISTS "Users can read own streak" ON public.user_streaks;
DROP POLICY IF EXISTS "Users can insert own streak" ON public.user_streaks;
DROP POLICY IF EXISTS "Users can update own streak" ON public.user_streaks;

CREATE POLICY "Users can read own streak"
  ON public.user_streaks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own streak"
  ON public.user_streaks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own streak"
  ON public.user_streaks FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- Storage: reading-photos bucket
-- Per-user folder isolation: storage path is `<user_id>/<reading_id>/<filename>`
-- ============================================================================
DROP POLICY IF EXISTS "Users select own reading photos" ON storage.objects;
DROP POLICY IF EXISTS "Users insert own reading photos" ON storage.objects;
DROP POLICY IF EXISTS "Users update own reading photos" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own reading photos" ON storage.objects;

CREATE POLICY "Users select own reading photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'reading-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users insert own reading photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'reading-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users update own reading photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'reading-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'reading-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users delete own reading photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'reading-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );