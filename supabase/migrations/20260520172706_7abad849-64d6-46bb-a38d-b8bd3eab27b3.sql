create table if not exists public.ai_circuit_breaker_trips (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  threshold_type text not null check (threshold_type in ('hourly', '12h')),
  threshold_usd numeric(12,4) not null,
  actual_cost_usd numeric(12,4) not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  call_count_in_window integer not null,
  top_users jsonb,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text
);

create index if not exists ai_circuit_breaker_trips_created_at_idx
  on public.ai_circuit_breaker_trips(created_at desc);

create index if not exists ai_circuit_breaker_trips_unresolved_idx
  on public.ai_circuit_breaker_trips(created_at desc)
  where resolved_at is null;

alter table public.ai_circuit_breaker_trips enable row level security;

drop policy if exists "circuit_breaker_trips_admin_select" on public.ai_circuit_breaker_trips;
create policy "circuit_breaker_trips_admin_select"
  on public.ai_circuit_breaker_trips
  for select
  to authenticated
  using (has_admin_role(auth.uid()));

drop policy if exists "circuit_breaker_trips_admin_write" on public.ai_circuit_breaker_trips;
create policy "circuit_breaker_trips_admin_write"
  on public.ai_circuit_breaker_trips
  for all
  to authenticated
  using (has_admin_role(auth.uid()))
  with check (has_admin_role(auth.uid()));

insert into public.admin_settings (key, value, description) values
  ('ai_global_cost_cap_hourly_usd', to_jsonb(5),
    'Phase 13 — hourly global AI cost cap in USD. When exceeded, master kill switch trips.'),
  ('ai_global_cost_cap_12h_usd', to_jsonb(30),
    'Phase 13 — 12-hour global AI cost cap in USD. When exceeded, master kill switch trips.'),
  ('ai_threshold_window_start', to_jsonb(extract(epoch from now())::bigint),
    'Phase 13 — unix epoch (seconds) of the most recent re-enable. Caps count from max(now()-window, window_start).')
on conflict (key) do nothing;