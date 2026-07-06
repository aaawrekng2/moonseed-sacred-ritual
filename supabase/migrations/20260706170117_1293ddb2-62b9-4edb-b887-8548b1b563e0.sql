
CREATE TABLE public.lunation_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  note text,
  view_state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lunation_bookmarks TO authenticated;
GRANT ALL ON public.lunation_bookmarks TO service_role;

ALTER TABLE public.lunation_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own lunation bookmarks"
  ON public.lunation_bookmarks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own lunation bookmarks"
  ON public.lunation_bookmarks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lunation bookmarks"
  ON public.lunation_bookmarks FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own lunation bookmarks"
  ON public.lunation_bookmarks FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX lunation_bookmarks_user_id_idx ON public.lunation_bookmarks(user_id);

CREATE OR REPLACE FUNCTION public.touch_lunation_bookmarks_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER lunation_bookmarks_set_updated_at
  BEFORE UPDATE ON public.lunation_bookmarks
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_lunation_bookmarks_updated_at();
