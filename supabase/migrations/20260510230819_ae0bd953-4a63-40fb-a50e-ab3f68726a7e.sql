
-- Q35a: Feedback system schema

CREATE TABLE public.feedback_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null check (char_length(title) <= 100 AND char_length(title) > 0),
  description text check (description IS NULL OR char_length(description) <= 500),
  category text not null check (category in ('bug','feature')),
  status text not null default 'pending' check (status in ('pending','under_review','planned','in_progress','done','dismissed')),
  admin_note text,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

ALTER TABLE public.feedback_posts ENABLE ROW LEVEL SECURITY;

-- Seekers can insert their own posts
CREATE POLICY "users insert own feedback" ON public.feedback_posts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Seekers can see approved (non-pending, non-dismissed) posts OR their own posts
CREATE POLICY "users select approved or own feedback" ON public.feedback_posts
  FOR SELECT TO authenticated
  USING (
    (status NOT IN ('pending','dismissed'))
    OR auth.uid() = user_id
  );

-- Admins can select all
CREATE POLICY "admins select all feedback" ON public.feedback_posts
  FOR SELECT TO authenticated
  USING (public.has_admin_role(auth.uid()));

-- Admins can update all
CREATE POLICY "admins update all feedback" ON public.feedback_posts
  FOR UPDATE TO authenticated
  USING (public.has_admin_role(auth.uid()))
  WITH CHECK (public.has_admin_role(auth.uid()));

CREATE INDEX idx_feedback_posts_status ON public.feedback_posts(status);
CREATE INDEX idx_feedback_posts_user_id ON public.feedback_posts(user_id);

-- ===== feedback_votes =====
CREATE TABLE public.feedback_votes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.feedback_posts(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  UNIQUE (post_id, user_id)
);

ALTER TABLE public.feedback_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own vote" ON public.feedback_votes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own vote" ON public.feedback_votes
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users select all votes" ON public.feedback_votes
  FOR SELECT TO authenticated
  USING (true);

CREATE INDEX idx_feedback_votes_post_id ON public.feedback_votes(post_id);

-- ===== user_preferences: welcome_modal_seen =====
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS welcome_modal_seen boolean not null default false;
