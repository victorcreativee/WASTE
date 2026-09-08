-- Additive first-administrator setup. Raw bearer tokens are never stored.
CREATE TABLE IF NOT EXISTS organization_admin_invitations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 email TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 issued_by UUID NOT NULL REFERENCES users(id),
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revoked_at TIMESTAMPTZ,
 accepted_at TIMESTAMPTZ,
 accepted_user_id UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_org_admin_invite ON organization_admin_invitations(organization_id)
 WHERE revoked_at IS NULL AND accepted_at IS NULL;
