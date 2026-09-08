ALTER TABLE organization_account_applications
  ADD COLUMN IF NOT EXISTS certificate_file_name TEXT,
  ADD COLUMN IF NOT EXISTS certificate_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS certificate_file_data TEXT;

ALTER TABLE organization_account_applications DROP CONSTRAINT IF EXISTS account_certificate_mime_type;
ALTER TABLE organization_account_applications ADD CONSTRAINT account_certificate_mime_type CHECK(certificate_mime_type IS NULL OR certificate_mime_type IN('application/pdf','image/jpeg'));
