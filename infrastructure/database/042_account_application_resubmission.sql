-- Preserve rejected applications as review history while allowing a corrected
-- certificate to be submitted against the same current KCCA permit.
ALTER TABLE organization_account_applications
  DROP CONSTRAINT IF EXISTS organization_account_applications_permit_application_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS one_open_account_application_per_permit
ON organization_account_applications(permit_application_id)
WHERE status IN ('submitted','under_review','approved');
