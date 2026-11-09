-- One-time password reset links. Only a hash of each link's token is stored; the link itself goes by email, or to the
-- administrator who sent it. A user has at most one open link at a time.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_password_reset_current ON password_reset_tokens(user_id) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_password_reset_expiry ON password_reset_tokens(expires_at) WHERE consumed_at IS NULL;
COMMENT ON COLUMN password_reset_tokens.requested_by IS 'The administrator who sent the link; empty when the user asked for it.';
