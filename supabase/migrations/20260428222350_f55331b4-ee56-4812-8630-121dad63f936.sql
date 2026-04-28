-- Audit log
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  admin_user_id uuid not null,
  admin_email text,
  action text not null,
  target_user_id uuid,
  target_email text,
  details jsonb not null default '{}'::jsonb
);

alter table public.admin_audit_log enable row level security;

create policy "Admins read audit log"
on public.admin_audit_log
for select to authenticated
using (public.has_admin_role(auth.uid()));

create policy "Admins insert audit log"
on public.admin_audit_log
for insert to authenticated
with check (public.has_admin_role(auth.uid()) and admin_user_id = auth.uid());

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_action_idx on public.admin_audit_log (action);

-- Helper RPC to log an action with the caller's identity
create or replace function public.log_admin_action(
  _action text,
  _target_user_id uuid,
  _target_email text,
  _details jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _id uuid;
  _email text;
begin
  if not public.has_admin_role(auth.uid()) then
    raise exception 'not authorized';
  end if;
  select email into _email from auth.users where id = auth.uid();
  insert into public.admin_audit_log (admin_user_id, admin_email, action, target_user_id, target_email, details)
  values (auth.uid(), _email, _action, _target_user_id, _target_email, coalesce(_details, '{}'::jsonb))
  returning id into _id;
  return _id;
end;
$$;

-- Backups
create table public.admin_backups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  kind text not null default 'manual',
  status text not null default 'ready',
  size_bytes bigint not null default 0,
  storage_path text,
  notes text
);

alter table public.admin_backups enable row level security;

create policy "Admins read backups"
on public.admin_backups
for select to authenticated
using (public.has_admin_role(auth.uid()));

create policy "Admins insert backups"
on public.admin_backups
for insert to authenticated
with check (public.has_admin_role(auth.uid()));

create policy "Admins update backups"
on public.admin_backups
for update to authenticated
using (public.has_admin_role(auth.uid()))
with check (public.has_admin_role(auth.uid()));

-- Storage bucket for backup blobs
insert into storage.buckets (id, name, public)
values ('admin-backups', 'admin-backups', false)
on conflict (id) do nothing;

create policy "Admins read backup files"
on storage.objects for select to authenticated
using (bucket_id = 'admin-backups' and public.has_admin_role(auth.uid()));

create policy "Admins write backup files"
on storage.objects for insert to authenticated
with check (bucket_id = 'admin-backups' and public.has_admin_role(auth.uid()));

create policy "Admins update backup files"
on storage.objects for update to authenticated
using (bucket_id = 'admin-backups' and public.has_admin_role(auth.uid()))
with check (bucket_id = 'admin-backups' and public.has_admin_role(auth.uid()));

create policy "Admins delete backup files"
on storage.objects for delete to authenticated
using (bucket_id = 'admin-backups' and public.has_admin_role(auth.uid()));
