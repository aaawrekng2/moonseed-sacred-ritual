-- v3.52 — first-party activity event stream + rollup + retention.

create table if not exists public.activity_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete cascade,
  session_id  text,
  event_name  text not null,
  properties  jsonb not null default '{}'::jsonb,
  user_agent  text,
  time_zone   text
);

create index if not exists activity_events_created_idx on public.activity_events (created_at desc);
create index if not exists activity_events_user_idx    on public.activity_events (user_id, created_at desc);
create index if not exists activity_events_name_idx     on public.activity_events (event_name, created_at desc);

alter table public.activity_events enable row level security;

-- Admins read (via the existing has_admin_role security-definer fn). Inserts happen
-- through the service role in the recordActivityEvent server fn, which bypasses RLS.
drop policy if exists activity_events_admin_read on public.activity_events;
create policy activity_events_admin_read on public.activity_events
  for select using (public.has_admin_role(auth.uid()));

-- Long-term rollup so trends survive the 12-month raw purge.
create table if not exists public.activity_daily (
  day            date not null,
  event_name     text not null,
  event_count    integer not null default 0,
  distinct_users integer not null default 0,
  primary key (day, event_name)
);
alter table public.activity_daily enable row level security;
drop policy if exists activity_daily_admin_read on public.activity_daily;
create policy activity_daily_admin_read on public.activity_daily
  for select using (public.has_admin_role(auth.uid()));

create or replace function public.rollup_activity(_day date)
returns void language sql security definer as $$
  insert into public.activity_daily (day, event_name, event_count, distinct_users)
  select _day, event_name, count(*), count(distinct user_id)
  from public.activity_events
  where created_at >= _day and created_at < _day + interval '1 day'
  group by event_name
  on conflict (day, event_name) do update
    set event_count = excluded.event_count,
        distinct_users = excluded.distinct_users;
$$;

-- Nightly: roll up yesterday, then purge raw events older than 12 months.
create or replace function public.activity_maintenance()
returns void language plpgsql security definer as $$
begin
  perform public.rollup_activity((now() - interval '1 day')::date);
  delete from public.activity_events where created_at < now() - interval '12 months';
end;
$$;

-- Schedule (pg_cron). Safe to re-run: unschedule first if it already exists.
select cron.unschedule('activity-maintenance')
  where exists (select 1 from cron.job where jobname = 'activity-maintenance');
select cron.schedule('activity-maintenance', '15 3 * * *',
  $$select public.activity_maintenance();$$);

-- Deletion note: activity_events.user_id is ON DELETE CASCADE, so removing an
-- auth user (the account-deletion flow) also removes their activity rows.