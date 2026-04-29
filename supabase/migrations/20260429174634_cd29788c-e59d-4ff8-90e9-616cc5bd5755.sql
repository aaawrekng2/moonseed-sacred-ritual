-- Public status reporter. Safe to expose because it returns only:
--   - cooldown_active (bool)
--   - cooldown_remaining_seconds (int)
--   - last_run_cap_hit (bool)
-- No user ids, no per-user counts, no totals, no run ids.
create or replace function public.get_detect_weaves_status(
  _min_interval_seconds integer,
  _max_users_per_run integer
)
returns table (
  cooldown_active boolean,
  cooldown_remaining_seconds integer,
  last_run_cap_hit boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  _last timestamptz;
  _now timestamptz := now();
  _elapsed_seconds numeric;
  _last_users_scanned integer;
begin
  if _min_interval_seconds is null or _min_interval_seconds < 0 then
    raise exception 'min_interval_seconds must be a non-negative integer';
  end if;
  if _max_users_per_run is null or _max_users_per_run < 1 then
    raise exception 'max_users_per_run must be a positive integer';
  end if;

  select dwl.last_run_at into _last
  from public.detect_weaves_lock dwl
  where dwl.id = 'singleton';

  if _last is null then
    _elapsed_seconds := _min_interval_seconds; -- treat as past cooldown
  else
    _elapsed_seconds := extract(epoch from (_now - _last));
  end if;

  -- Most recent successful or partial run (skip refusals/errors so we
  -- report cap-hit on actual scans only).
  select dwr.users_scanned into _last_users_scanned
  from public.detect_weaves_runs dwr
  where dwr.status in ('success', 'partial')
  order by dwr.finished_at desc
  limit 1;

  return query select
    (_elapsed_seconds < _min_interval_seconds)::boolean,
    greatest(0, ceil(_min_interval_seconds - _elapsed_seconds))::int,
    coalesce(_last_users_scanned, 0) >= _max_users_per_run;
end;
$$;

revoke all on function public.get_detect_weaves_status(integer, integer) from public;
revoke all on function public.get_detect_weaves_status(integer, integer) from anon, authenticated;
grant execute on function public.get_detect_weaves_status(integer, integer) to service_role;