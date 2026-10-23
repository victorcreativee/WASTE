-- Household self-service access without email or passwords.
-- A collection company shares a private link with each household (by WhatsApp, SMS or printed card); only a hash of
-- the link's secret is stored. Where SMS delivery is configured, a household can also sign in with its phone number
-- and a short-lived one-time code.
CREATE TABLE IF NOT EXISTS household_access_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
-- One working link per household: making a new link retires the previous one.
CREATE UNIQUE INDEX IF NOT EXISTS household_access_links_active
  ON household_access_links(customer_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS household_login_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS household_login_codes_user
  ON household_login_codes(user_id, created_at DESC);

-- Households are found by phone number regardless of how it was typed (0772…, +256772…, 256 772…):
-- the last nine digits identify a Ugandan mobile number.
CREATE INDEX IF NOT EXISTS users_phone_last9
  ON users ((RIGHT(regexp_replace(phone, '\D', '', 'g'), 9))) WHERE phone IS NOT NULL;
