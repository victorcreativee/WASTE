ALTER TABLE organization_applicant_profiles
  ADD COLUMN IF NOT EXISTS company_type text NOT NULL DEFAULT 'waste_collection_company';
ALTER TABLE organization_applicant_profiles DROP CONSTRAINT IF EXISTS organization_applicant_profiles_company_type_check;
ALTER TABLE organization_applicant_profiles ADD CONSTRAINT organization_applicant_profiles_company_type_check
  CHECK(company_type IN('waste_collection_company','recycling_company'));
