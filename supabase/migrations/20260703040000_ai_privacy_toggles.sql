-- v2.71 — seeker-facing AI privacy controls on user_preferences.
--
--  ai_opted_out               : the seeker turned AI off for themselves.
--                               Effective AI = admin-granted AND global-on AND
--                               NOT opted out. Only ever turns AI OFF; it never
--                               grants access the admin didn't (that stays in
--                               ai_features_enabled).
--  never_send_personal_to_ai  : when true, identifiable data (birth date/time/
--                               place, name) is never included in AI requests
--                               (deep readings), while non-identifiable reading
--                               content still flows so AI features work.
--
-- Idempotent so it is safe to re-run.

alter table public.user_preferences
  add column if not exists ai_opted_out boolean not null default false;

alter table public.user_preferences
  add column if not exists never_send_personal_to_ai boolean not null default false;
