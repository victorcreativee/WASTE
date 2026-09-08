INSERT INTO roles(name,description) VALUES('organization_applicant','Restricted organization licensing and onboarding applicant') ON CONFLICT(name) DO NOTHING;

CREATE TABLE IF NOT EXISTS organization_applicant_profiles(
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 company_name TEXT NOT NULL,
 registration_number TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS one_applicant_company_registration ON organization_applicant_profiles(lower(registration_number));

ALTER TABLE organization_permit_applications ADD COLUMN IF NOT EXISTS applicant_user_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_permit_applicant_user ON organization_permit_applications(applicant_user_id,created_at DESC);

ALTER TABLE organization_account_applications ADD COLUMN IF NOT EXISTS applicant_user_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_account_applicant_user ON organization_account_applications(applicant_user_id,created_at DESC);
