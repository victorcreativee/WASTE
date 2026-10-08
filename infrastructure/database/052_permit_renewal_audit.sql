ALTER TABLE organization_permit_applications
 ADD COLUMN IF NOT EXISTS renewal_count INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS last_renewed_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS last_renewed_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_permits_validity
 ON organization_permit_applications(status,valid_until)
 WHERE permit_number IS NOT NULL;
