ALTER TABLE platform_packages
  ADD COLUMN IF NOT EXISTS feature_codes TEXT[] NOT NULL DEFAULT '{}';

INSERT INTO platform_packages(code,name,description,monthly_fee_ugx,organization_type,is_active,feature_codes) VALUES
 ('collector_standard','Standard','Essential waste collection operations: daily dispatch, service areas and routes, fleet, drivers, tonnage, service issues and customers.',0,'waste_collection_company',true,ARRAY['core_operations','service_areas','fleet','tonnage','service_issues','customers']),
 ('collector_professional','Professional','Complete waste collection access including commercial, finance, supply, reporting, compliance and access controls.',0,'waste_collection_company',true,ARRAY['core_operations','service_areas','fleet','tonnage','service_issues','customers','contracts','billing','finance','inventory','procurement','reports','compliance','access']),
 ('collector_custom','Custom','System Admin selects the exact operational and business capabilities included for this package.',0,'waste_collection_company',true,ARRAY[]::TEXT[])
ON CONFLICT(code) DO UPDATE SET
 name=EXCLUDED.name,
 description=EXCLUDED.description,
 organization_type=EXCLUDED.organization_type,
 is_active=true,
 feature_codes=EXCLUDED.feature_codes;

UPDATE organizations organization
SET platform_package_id=replacement.id
FROM platform_packages current_package,platform_packages replacement
WHERE organization.platform_package_id=current_package.id
  AND organization.type='waste_collection_company'
  AND replacement.code=CASE current_package.code
    WHEN 'core_collector' THEN 'collector_standard'
    WHEN 'operations_pro' THEN 'collector_professional'
  END;

UPDATE organizations organization
SET platform_package_id=replacement.id
FROM platform_packages replacement
WHERE organization.type='waste_collection_company'
  AND organization.platform_package_id IS NULL
  AND replacement.code='collector_standard';

UPDATE platform_packages
SET is_active=false
WHERE organization_type='waste_collection_company'
  AND code NOT IN ('collector_standard','collector_professional','collector_custom');

CREATE TABLE IF NOT EXISTS organization_package_feature_overrides (
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 feature_code TEXT NOT NULL,
 enabled BOOLEAN NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(organization_id,feature_code)
);

