-- Security fix: existing plaintext MFA recovery codes are wiped from
-- the database. Users will be prompted to regenerate the next time
-- they need codes; new codes are stored only as SHA-256 hashes via
-- the server function.
UPDATE public.user_preferences
SET mfa_recovery_codes = NULL
WHERE mfa_recovery_codes IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(mfa_recovery_codes) AS c
    WHERE c NOT LIKE 'sha256:%'
  );