
-- user_preferences
create table public.user_preferences (
  user_id uuid references auth.users(id) on delete cascade primary key,
  resting_opacity integer not null default 60,
  show_labels boolean not null default true,
  card_back text not null default 'celestial',
  accent text not null default 'gold',
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy "Users can read own preferences"
  on public.user_preferences for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own preferences"
  on public.user_preferences for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own preferences"
  on public.user_preferences for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_streaks
create table public.user_streaks (
  user_id uuid references auth.users(id) on delete cascade primary key,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_draw_date date,
  updated_at timestamptz not null default now()
);

alter table public.user_streaks enable row level security;

create policy "Users can read own streak"
  on public.user_streaks for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own streak"
  on public.user_streaks for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own streak"
  on public.user_streaks for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
