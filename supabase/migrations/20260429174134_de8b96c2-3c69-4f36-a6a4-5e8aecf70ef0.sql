-- Singleton lock row. We use a fixed primary key so there is exactly one row.
create table if not exists public.detect_weaves_lock (
  id text primary key default 'singleton' check (id = 'singleton'),
  last_run_at timestamptz not null default 'epoch'::timestamptz,
  updated_at timestamptz not null default now()
);

-- Seed the singleton row.
insert into public.detect_weaves_lock (id) values ('singleton')
on conflict (id) do nothing;

alter table public.detect_weaves_lock enable row level security;

-- Admins may inspect the lock for debugging. The endpoint never reads
-- this table directly — it goes through the security-definer function below.
create policy "Admins read detect_weaves_lock"
on public.detect_weaves_lock
for select
to authenticated
using (public.has_admin_role(auth.uid()));

-- Atomic try-acquire:
--   1. Take a transaction-scoped advisory lock keyed to this feature.
--      pg_try_advisory_xact_lock returns immediately; if another server
--      is already inside this function the call returns acquired=false.
--   2. Compare the stored last_run_at against the cooldown window.
--   3. If past the cooldown, stamp a new last_run_at and report acquired.
--      Otherwise report how many whole seconds until the next allowed run.
--
-- The advisory lock is automatically released at transaction end, so we
-- never leak a held lock even if the caller crashes.
create or replace function public.try_acquire_detect_weaves_slot(
  _min_interval_seconds integer
)
returns table (
  acquired boolean,
  last_run_at timestamptz,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Stable 64-bit key derived from the feature name. Keep this constant
  -- so all callers contend on the same advisory lock slot.
  _lock_key constant bigint := 7426918273645012345;
  _last timestamptz;
  _now timestamptz := now();
  _elapsed_seconds numeric;
begin
  if _min_interval_seconds is null or _min_interval_seconds < 0 then
    raise exception 'min_interval_seconds must be a non-negative integer';
  end if;

  -- Concurrent-instance guard. If another transaction holds the lock, we
  -- refuse without touching last_run_at.
  if not pg_try_advisory_xact_lock(_lock_key) then
    select dwl.last_run_at into _last
    from public.detect_weaves_lock dwl
    where dwl.id = 'singleton';
    return query select
      false,
      _last,
      greatest(1, _min_interval_seconds)::int;
    return;
  end if;

  select dwl.last_run_at into _last
  from public.detect_weaves_lock dwl
  where dwl.id = 'singleton'
  for update;

  if _last is null then
    -- Should not happen (the row is seeded by the migration), but be safe.
    insert into public.detect_weaves_lock (id, last_run_at, updated_at)
    values ('singleton', 'epoch'::timestamptz, _now)
    on conflict (id) do nothing;
    _last := 'epoch'::timestamptz;
  end if;

  _elapsed_seconds := extract(epoch from (_now - _last));

  if _elapsed_seconds < _min_interval_seconds then
    return query select
      false,
      _last,
      greatest(1, ceil(_min_interval_seconds - _elapsed_seconds))::int;
    return;
  end if;

  update public.detect_weaves_lock
  set last_run_at = _now,
      updated_at = _now
  where id = 'singleton';

  return query select
    true,
    _now,
    0;
end;
$$;

-- Lock down execution: only the service role / postgres roles call this.
revoke all on function public.try_acquire_detect_weaves_slot(integer) from public;
revoke all on function public.try_acquire_detect_weaves_slot(integer) from anon, authenticated;
grant execute on function public.try_acquire_detect_weaves_slot(integer) to service_role;