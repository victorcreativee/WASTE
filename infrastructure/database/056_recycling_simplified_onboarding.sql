ALTER TABLE organization_account_applications ALTER COLUMN permit_application_id DROP NOT NULL;
ALTER TABLE organization_account_applications ADD COLUMN IF NOT EXISTS evidence_type text NOT NULL DEFAULT 'kcca_certificate';
ALTER TABLE organization_account_applications DROP CONSTRAINT IF EXISTS organization_account_applications_evidence_type_check;
ALTER TABLE organization_account_applications ADD CONSTRAINT organization_account_applications_evidence_type_check CHECK(evidence_type IN('kcca_certificate','company_registration'));
CREATE OR REPLACE FUNCTION enforce_account_application_evidence() RETURNS trigger AS $$
BEGIN
 IF NEW.permit_application_id IS NULL AND NOT EXISTS(
  SELECT 1 FROM organization_applicant_profiles p WHERE p.user_id=NEW.applicant_user_id AND p.company_type='recycling_company'
 ) THEN RAISE EXCEPTION 'A KCCA permit is required for waste collection company access'; END IF;
 IF NEW.permit_application_id IS NULL AND NEW.evidence_type<>'company_registration' THEN RAISE EXCEPTION 'Recycling onboarding requires company registration evidence'; END IF;
 IF NEW.permit_application_id IS NOT NULL AND NEW.evidence_type<>'kcca_certificate' THEN RAISE EXCEPTION 'Waste collection onboarding requires KCCA certificate evidence'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_account_application_evidence ON organization_account_applications;
CREATE TRIGGER trg_account_application_evidence BEFORE INSERT OR UPDATE OF permit_application_id,evidence_type,applicant_user_id ON organization_account_applications FOR EACH ROW EXECUTE FUNCTION enforce_account_application_evidence();
