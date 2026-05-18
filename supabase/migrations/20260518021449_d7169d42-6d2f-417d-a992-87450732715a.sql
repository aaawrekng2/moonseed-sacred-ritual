DO $$
DECLARE
  _n integer;
BEGIN
  SELECT public.purge_stale_anonymous_users() INTO _n;
  RAISE NOTICE 'Purged % stale anonymous users', _n;
END $$;