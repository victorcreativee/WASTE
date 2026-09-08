CREATE TABLE IF NOT EXISTS driver_job_problems (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES collection_jobs(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    category VARCHAR(40) NOT NULL CHECK (
        category IN ('blocked_access', 'truck_problem', 'unsafe_site', 'waste_mismatch', 'other')
    ),
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'acknowledged', 'resolved')
    ),
    resolution_notes TEXT,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_driver_job_problems_job ON driver_job_problems(job_id);
CREATE INDEX IF NOT EXISTS idx_driver_job_problems_driver ON driver_job_problems(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_job_problems_org_status ON driver_job_problems(organization_id, status);
