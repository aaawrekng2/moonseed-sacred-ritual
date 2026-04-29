create table public.detect_weaves_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  duration_ms integer not null default 0,
  users_scanned integer not null default 0,
  weaves_detected integer not null default 0,
  status text not null default 'success',
  message text,
  per_user_errors jsonb not null default '[]'::jsonb
);

alter table public.detect_weaves_runs enable row level security;

create policy "Admins read detect_weaves_runs"
  on public.detect_weaves_runs
  for select
  to authenticated
  using (public.has_admin_role(auth.uid()));

create index detect_weaves_runs_started_at_idx
  on public.detect_weaves_runs (started_at desc);