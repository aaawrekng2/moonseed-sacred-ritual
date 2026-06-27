-- Phase 2 per-seeker feature gate.
--
-- phase2_enabled defaults to false: every Phase 2 feature (Gallery tab on
-- Journal, photo-add on journal entries, and anything wrapped in <Phase2Gate>
-- later) is hidden for ALL seekers until an admin turns it on for a specific
-- seeker from /admin/usage/users/$userId.
--
-- RLS: user_preferences already grants each seeker read/write on their own row
-- and the admin mutates via the service role (supabaseAdmin) after an
-- has_admin_role check — no new policy is required.

alter table public.user_preferences
  add column if not exists phase2_enabled boolean not null default false;
