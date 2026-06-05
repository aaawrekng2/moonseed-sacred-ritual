alter table user_preferences add column if not exists ai_features_enabled boolean default null;
insert into admin_settings (key, value, updated_at) values ('ai_features_default', 'false'::jsonb, now()) on conflict (key) do nothing;
update user_preferences set ai_features_enabled = true where ai_features_enabled is null;