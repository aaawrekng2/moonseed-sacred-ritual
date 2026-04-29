-- Phase 9 — nightly weave detection cron
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Unschedule any previous version of this job (no-op the first time).
do $$
begin
  perform cron.unschedule('detect-weaves-nightly');
exception when others then
  -- job did not exist
  null;
end $$;

select cron.schedule(
  'detect-weaves-nightly',
  '30 3 * * *',
  $$
  select net.http_post(
    url := 'https://project--ba6ec5a7-7b63-4a64-8eba-dff94a3cdd6a.lovable.app/api/public/detect-weaves',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);