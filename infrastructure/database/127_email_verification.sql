-- Email ownership verification for every new password-based account.
-- Existing users are grandfathered so this release cannot lock active operations unexpectedly.
DO $$
DECLARE verification_was_already_installed BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='email_verification_required'
  ) INTO verification_was_already_installed;

  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_required BOOLEAN NOT NULL DEFAULT TRUE;

  -- This executes only on the first installation. Re-running migrations must never
  -- accidentally verify accounts created after this feature was introduced.
  IF NOT verification_was_already_installed THEN
    UPDATE users
    SET email_verified_at=COALESCE(email_verified_at,last_login_at,created_at),
        email_verification_required=FALSE
    WHERE email_verification_required=TRUE AND email_verified_at IS NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_verification_current
  ON email_verification_tokens(user_id) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_verification_expiry
  ON email_verification_tokens(expires_at) WHERE consumed_at IS NULL;

COMMENT ON COLUMN users.email_verification_required IS
  'True when email/password sessions must be blocked until email_verified_at is set.';
