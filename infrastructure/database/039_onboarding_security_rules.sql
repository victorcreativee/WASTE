CREATE UNIQUE INDEX IF NOT EXISTS one_open_permit_per_registration
ON organization_permit_applications(lower(registration_number))
WHERE status IN ('submitted','under_review','information_required','approved','suspended');

CREATE UNIQUE INDEX IF NOT EXISTS one_open_account_application_per_admin_email
ON organization_account_applications(lower(administrator_email))
WHERE status IN ('submitted','under_review','approved');

CREATE INDEX IF NOT EXISTS idx_permit_applicant_email
ON organization_permit_applications(lower(email), created_at DESC);
