create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email_to text not null,
  email_type text not null,
  triggered_by text not null,
  triggered_by_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'sent',
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists email_log_created_at_idx on public.email_log (created_at desc);
create index if not exists email_log_user_id_idx on public.email_log (user_id);
create index if not exists email_log_email_to_idx on public.email_log (lower(email_to));
create index if not exists email_log_type_idx on public.email_log (email_type);

alter table public.email_log enable row level security;

drop policy if exists "admins can read email_log" on public.email_log;
create policy "admins can read email_log"
  on public.email_log
  for select
  to authenticated
  using (public.has_admin_role(auth.uid()));