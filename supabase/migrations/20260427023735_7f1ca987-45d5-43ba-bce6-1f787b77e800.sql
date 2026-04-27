-- Memory snapshots: curated AI-readable summaries of a user's practice
create table public.memory_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  snapshot_type text not null check (snapshot_type in ('recent_echoes', 'deeper_threads', 'full_archive')),
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  card_frequencies jsonb not null default '{}'::jsonb,
  active_threads_summary text,
  active_patterns_summary text,
  recent_tags text[] not null default '{}',
  token_count integer not null default 0,
  unique(user_id, snapshot_type)
);

create index memory_snapshots_user_id_idx on public.memory_snapshots(user_id);

alter table public.memory_snapshots enable row level security;

create policy "Users select own snapshots"
  on public.memory_snapshots for select
  to authenticated
  using ((select auth.role()) = 'authenticated' and auth.uid() = user_id);

create policy "Users insert own snapshots"
  on public.memory_snapshots for insert
  to authenticated
  with check ((select auth.role()) = 'authenticated' and auth.uid() = user_id);

create policy "Users update own snapshots"
  on public.memory_snapshots for update
  to authenticated
  using ((select auth.role()) = 'authenticated' and auth.uid() = user_id)
  with check ((select auth.role()) = 'authenticated' and auth.uid() = user_id);

create policy "Users delete own snapshots"
  on public.memory_snapshots for delete
  to authenticated
  using ((select auth.role()) = 'authenticated' and auth.uid() = user_id);

-- Symbolic threads: system-detected recurring patterns across readings
create table public.symbolic_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text,
  summary text not null,
  card_ids integer[] not null default '{}',
  tags text[] not null default '{}',
  reading_ids uuid[] not null default '{}',
  status text not null default 'emerging' check (status in ('emerging', 'active', 'quieting', 'retired', 'reawakened')),
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index symbolic_threads_user_id_idx on public.symbolic_threads(user_id);
create index symbolic_threads_status_idx on public.symbolic_threads(user_id, status);

alter table public.symbolic_threads enable row level security;

create policy "Users select own threads"
  on public.symbolic_threads for select
  to authenticated
  using ((select auth.role()) = 'authenticated' and auth.uid() = user_id);

create policy "Users insert own threads"
  on public.symbolic_threads for insert
  to authenticated
  with check ((select auth.role()) = 'authenticated' and auth.uid() = user_id);

create policy "Users update own threads"
  on public.symbolic_threads for update
  to authenticated
  using ((select auth.role()) = 'authenticated' and auth.uid() = user_id)
  with check ((select auth.role()) = 'authenticated' and auth.uid() = user_id);

create policy "Users delete own threads"
  on public.symbolic_threads for delete
  to authenticated
  using ((select auth.role()) = 'authenticated' and auth.uid() = user_id);

-- Touch trigger for symbolic_threads.updated_at
create or replace function public.touch_symbolic_threads_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_symbolic_threads_updated_at_trigger
  before update on public.symbolic_threads
  for each row execute function public.touch_symbolic_threads_updated_at();

-- Add memory permission flag to user_preferences
alter table public.user_preferences
  add column if not exists memory_ai_permission boolean not null default true;