CREATE TABLE IF NOT EXISTS customer_collection_stops (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 collection_job_id UUID NOT NULL REFERENCES collection_jobs(id) ON DELETE CASCADE,
 relationship_id UUID NOT NULL REFERENCES customer_service_relationships(id),
 customer_id UUID NOT NULL REFERENCES customer_profiles(id),
 service_location_id UUID NOT NULL REFERENCES customer_service_locations(id),
 contract_id UUID NOT NULL REFERENCES customer_contracts(id),
 subscription_id UUID NOT NULL REFERENCES customer_subscriptions(id),
 scheduled_date DATE NOT NULL,
 stop_order INTEGER,
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','arrived','completed','skipped','cancelled')),
 arrived_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ,
 completed_by UUID REFERENCES users(id),
 collected_weight_kg NUMERIC(12,2) CHECK(collected_weight_kg IS NULL OR collected_weight_kg>=0),
 completion_notes TEXT,
 evidence_url TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(collection_job_id,service_location_id)
);
CREATE INDEX IF NOT EXISTS customer_stops_job_status ON customer_collection_stops(collection_job_id,status,stop_order);
CREATE INDEX IF NOT EXISTS customer_stops_customer_history ON customer_collection_stops(customer_id,scheduled_date DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS customer_stops_org_date ON customer_collection_stops(organization_id,scheduled_date,status);
