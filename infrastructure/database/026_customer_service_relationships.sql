-- Explicit provider responsibility. This migration does not move customer or financial records.
CREATE TABLE IF NOT EXISTS customer_service_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  service_location_id UUID NOT NULL REFERENCES customer_service_locations(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','ended')),
  relationship_source VARCHAR(30) NOT NULL DEFAULT 'company_onboarding' CHECK (
    relationship_source IN ('legacy_backfill','company_onboarding','reviewed_link','reviewed_transfer')
  ),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_by UUID REFERENCES users(id),
  ended_by UUID REFERENCES users(id),
  ended_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK ((status = 'ended') = (effective_to IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS one_current_provider_per_service_location
  ON customer_service_relationships(service_location_id)
  WHERE status IN ('active','suspended');
CREATE INDEX IF NOT EXISTS customer_relationships_org_status
  ON customer_service_relationships(organization_id,status,customer_id);
CREATE INDEX IF NOT EXISTS customer_relationships_customer_history
  ON customer_service_relationships(customer_id,effective_from DESC,created_at DESC);

INSERT INTO customer_service_relationships(
  customer_id,service_location_id,organization_id,status,relationship_source,effective_from
)
SELECT csl.customer_id,csl.id,csl.organization_id,
  CASE WHEN cp.service_status='suspended' THEN 'suspended' ELSE 'active' END,
  'legacy_backfill',csl.created_at::date
FROM customer_service_locations csl
JOIN customer_profiles cp ON cp.id=csl.customer_id
JOIN organizations o ON o.id=csl.organization_id
WHERE csl.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM customer_service_relationships csr
    WHERE csr.service_location_id=csl.id
  );
