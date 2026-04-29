alter table public.detect_weaves_runs
  add column if not exists mode text not null default 'scheduled',
  add column if not exists triggered_by uuid;