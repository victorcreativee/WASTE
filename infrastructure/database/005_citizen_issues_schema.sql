CREATE TABLE IF NOT EXISTS citizen_issues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    category VARCHAR(40) NOT NULL CHECK (
        category IN ('illegal_dumping', 'missed_collection', 'overflowing_bin', 'pickup_request')
    ),
    title VARCHAR(180) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'submitted' CHECK (
        status IN ('submitted', 'triaged', 'assigned', 'in_progress', 'resolved', 'rejected')
    ),
    address TEXT,
    location GEOGRAPHY(POINT, 4326),
    resolution_notes TEXT,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_citizen_issues_reporter ON citizen_issues(reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_citizen_issues_organization ON citizen_issues(assigned_organization_id);
CREATE INDEX IF NOT EXISTS idx_citizen_issues_status ON citizen_issues(status);
CREATE INDEX IF NOT EXISTS idx_citizen_issues_category ON citizen_issues(category);
CREATE INDEX IF NOT EXISTS idx_citizen_issues_location ON citizen_issues USING GIST(location);
