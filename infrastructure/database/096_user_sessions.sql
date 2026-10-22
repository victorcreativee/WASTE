-- Module 5: server-side sign-in sessions, so signing out (or "sign out everywhere", or a password change) ends a
-- session immediately instead of when its tokens expire. Additive and idempotent.

CREATE TABLE IF NOT EXISTS user_sessions(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 user_agent TEXT,
 ip_address TEXT,
 revoked_at TIMESTAMPTZ,
 revoked_reason TEXT CHECK(revoked_reason IS NULL OR revoked_reason IN('signed_out','signed_out_everywhere','password_changed','administrator')),
 CHECK((revoked_at IS NULL)=(revoked_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id) WHERE revoked_at IS NULL;

-- Ended sessions older than 30 days carry no value; this keeps the table small when called by the auth service.
CREATE OR REPLACE FUNCTION prune_user_sessions() RETURNS INTEGER LANGUAGE sql AS $$
  WITH removed AS (
    DELETE FROM user_sessions
    WHERE (revoked_at IS NOT NULL AND revoked_at<CURRENT_TIMESTAMP-interval '30 days')
       OR (revoked_at IS NULL AND last_used_at<CURRENT_TIMESTAMP-interval '30 days')
    RETURNING 1
  ) SELECT count(*)::int FROM removed
$$;
