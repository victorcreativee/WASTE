ALTER TABLE organization_permit_applications
  ADD COLUMN IF NOT EXISTS certificate_issued_at TIMESTAMPTZ;

UPDATE organization_permit_applications
SET certificate_issued_at = COALESCE(reviewed_at, updated_at, CURRENT_TIMESTAMP)
WHERE status = 'approved'
  AND permit_number IS NOT NULL
  AND certificate_issued_at IS NULL;

CREATE OR REPLACE FUNCTION record_permit_certificate_issuance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND NEW.permit_number IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'approved' OR NEW.permit_number IS DISTINCT FROM OLD.permit_number) THEN
    NEW.certificate_issued_at = CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_permit_certificate_issuance ON organization_permit_applications;
CREATE TRIGGER trg_permit_certificate_issuance
BEFORE UPDATE OF status, permit_number ON organization_permit_applications
FOR EACH ROW EXECUTE FUNCTION record_permit_certificate_issuance();
