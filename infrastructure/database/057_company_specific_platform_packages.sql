ALTER TABLE platform_packages
 ADD COLUMN IF NOT EXISTS organization_type TEXT NOT NULL DEFAULT 'waste_collection_company';

ALTER TABLE platform_packages DROP CONSTRAINT IF EXISTS platform_packages_organization_type_check;
ALTER TABLE platform_packages ADD CONSTRAINT platform_packages_organization_type_check
 CHECK (organization_type IN ('waste_collection_company','recycling_company'));

INSERT INTO platform_packages(code,name,description,monthly_fee_ugx,organization_type) VALUES
 ('recycling_starter','Starter','Material purchasing, basic stock records and recycling transaction history.',0,'recycling_company'),
 ('recycling_standard','Standard','Starter features plus material grading, supplier records, inventory controls and sales to industries.',0,'recycling_company'),
 ('recycling_professional','Professional','Standard features plus advanced reporting, multi-site operations, team controls and recycling performance insights.',0,'recycling_company')
ON CONFLICT(code) DO UPDATE SET
 name=EXCLUDED.name,
 description=EXCLUDED.description,
 organization_type=EXCLUDED.organization_type;
