-- 1. Violations table (append-only audit trail).
create table if not exists public.ai_gate_violations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  call_log_id uuid references public.ai_call_log(id) on delete set null,
  user_id uuid not null,
  call_type text,
  model text,
  provider text,
  status text not null,
  cost_usd numeric(10,6) default 0,
  credits_consumed integer default 0,
  user_override boolean,
  global_default boolean,
  effective_gate boolean,
  category text not null check (category in ('money_spent', 'blocked_attempt')),
  reviewed_at timestamptz,
  reviewed_by uuid,
  reviewed_note text
);

grant select, update on public.ai_gate_violations to authenticated;
grant all on public.ai_gate_violations to service_role;

create index if not exists ai_gate_violations_created_at_idx
  on public.ai_gate_violations(created_at desc);
create index if not exists ai_gate_violations_user_id_idx
  on public.ai_gate_violations(user_id);
create index if not exists ai_gate_violations_unresolved_idx
  on public.ai_gate_violations(reviewed_at) where reviewed_at is null;
create index if not exists ai_gate_violations_category_idx
  on public.ai_gate_violations(category, reviewed_at);

alter table public.ai_gate_violations enable row level security;

drop policy if exists "admins read violations" on public.ai_gate_violations;
create policy "admins read violations" on public.ai_gate_violations
  for select to authenticated
  using (
    exists (
      select 1 from public.user_preferences
      where user_preferences.user_id = auth.uid()
        and user_preferences.role in ('admin', 'super_admin')
    )
  );

drop policy if exists "admins update violations" on public.ai_gate_violations;
create policy "admins update violations" on public.ai_gate_violations
  for update to authenticated
  using (
    exists (
      select 1 from public.user_preferences
      where user_preferences.user_id = auth.uid()
        and user_preferences.role in ('admin', 'super_admin')
    )
  );

create or replace function public.ai_effective_gate(_user_id uuid)
  returns table (
    user_override boolean,
    global_default boolean,
    effective_gate boolean
  )
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_override boolean;
  v_global boolean;
begin
  select up.ai_features_enabled into v_override
  from public.user_preferences up
  where up.user_id = _user_id
  limit 1;

  select coalesce((value)::text::boolean, false) into v_global
  from public.admin_settings
  where key = 'ai_features_default'
  limit 1;

  v_global := coalesce(v_global, false);

  user_override := v_override;
  global_default := v_global;
  effective_gate := coalesce(v_override, v_global);
  return next;
end;
$$;

create or replace function public.ai_gate_violation_check()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  gate_row record;
  v_category text;
  v_admin_emails text[];
  v_email text;
  v_subject text;
  v_html text;
  v_text text;
  v_user_email text;
begin
  if new.user_id is null then
    return new;
  end if;

  select * into gate_row from public.ai_effective_gate(new.user_id);

  if gate_row.effective_gate is true then
    return new;
  end if;

  if new.status = 'success' then
    v_category := 'money_spent';
  elsif new.status in ('rate_limited', 'quota_exceeded', 'ai_disabled') then
    v_category := 'blocked_attempt';
  else
    v_category := 'blocked_attempt';
  end if;

  insert into public.ai_gate_violations(
    call_log_id, user_id, call_type, model, provider, status,
    cost_usd, credits_consumed, user_override, global_default,
    effective_gate, category
  ) values (
    new.id, new.user_id, new.call_type, new.model, new.provider, new.status,
    coalesce(new.cost_usd, 0), coalesce(new.credits_consumed, 0),
    gate_row.user_override, gate_row.global_default, gate_row.effective_gate,
    v_category
  );

  if v_category = 'money_spent' then
    select array_agg(au.email) into v_admin_emails
    from auth.users au
    join public.user_preferences up on up.user_id = au.id
    where up.role in ('admin', 'super_admin')
      and au.email is not null;

    select au.email into v_user_email
    from auth.users au
    where au.id = new.user_id
    limit 1;

    v_subject := '[Tarot Seed] ⚠️ AI gate violation: money spent';
    v_html := format(
      '<h2>AI gate violation — money spent</h2>' ||
      '<p>A user without AI enabled triggered a successful AI call. Real cost was charged.</p>' ||
      '<table cellpadding="6" style="border-collapse: collapse;">' ||
      '<tr><td><b>User</b></td><td>%s (%s)</td></tr>' ||
      '<tr><td><b>Call type</b></td><td>%s</td></tr>' ||
      '<tr><td><b>Model</b></td><td>%s</td></tr>' ||
      '<tr><td><b>Cost</b></td><td>$%s</td></tr>' ||
      '<tr><td><b>Credits</b></td><td>%s</td></tr>' ||
      '<tr><td><b>User override</b></td><td>%s</td></tr>' ||
      '<tr><td><b>Global default</b></td><td>%s</td></tr>' ||
      '<tr><td><b>When</b></td><td>%s</td></tr>' ||
      '</table>' ||
      '<p>Review at /admin/usage → Gate Violations.</p>',
      coalesce(v_user_email, '(unknown email)'),
      new.user_id,
      coalesce(new.call_type, '?'),
      coalesce(new.model, '?'),
      coalesce(new.cost_usd::text, '0'),
      coalesce(new.credits_consumed::text, '0'),
      coalesce(gate_row.user_override::text, 'null (follows global)'),
      coalesce(gate_row.global_default::text, 'false'),
      new.created_at
    );
    v_text := format(
      'AI gate violation — money spent.%sUser: %s (%s)%sCall: %s, Model: %s%sCost: $%s, Credits: %s%sOverride: %s, Global: %s%sWhen: %s',
      E'\n', coalesce(v_user_email, '(unknown email)'), new.user_id,
      E'\n', coalesce(new.call_type, '?'), coalesce(new.model, '?'),
      E'\n', coalesce(new.cost_usd::text, '0'), coalesce(new.credits_consumed::text, '0'),
      E'\n', coalesce(gate_row.user_override::text, 'null'), coalesce(gate_row.global_default::text, 'false'),
      E'\n', new.created_at
    );

    if v_admin_emails is not null then
      foreach v_email in array v_admin_emails loop
        begin
          perform public.enqueue_email(
            'transactional_emails',
            jsonb_build_object(
              'to', v_email,
              'subject', v_subject,
              'html', v_html,
              'text', v_text,
              'template_name', 'ai_gate_violation'
            )
          );
        exception when others then
          null;
        end;
      end loop;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ai_gate_violation_check on public.ai_call_log;
create trigger trg_ai_gate_violation_check
  after insert on public.ai_call_log
  for each row
  execute function public.ai_gate_violation_check();

create or replace view public.ai_gate_violations_unresolved as
  select
    v.*,
    au.email as user_email
  from public.ai_gate_violations v
  left join auth.users au on au.id = v.user_id
  where v.reviewed_at is null
  order by v.created_at desc;

grant select on public.ai_gate_violations_unresolved to authenticated;