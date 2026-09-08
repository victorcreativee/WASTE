INSERT INTO roles (name, description)
VALUES ('supervisor', 'Organization field supervisor and dispatcher')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (code, description)
VALUES
  ('organization_users:read', 'View organization staff accounts'),
  ('organization_users:manage', 'Create and manage organization staff accounts'),
  ('dispatch:manage', 'Supervise drivers, jobs, routes, and incidents')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'company_admin'
  AND p.code IN ('organization_users:read', 'organization_users:manage', 'dispatch:manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'supervisor'
  AND p.code IN ('waste:read', 'fleet:read', 'gis:read', 'dispatch:manage')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS supervisor_drivers (
    supervisor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (supervisor_user_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_supervisor_drivers_org ON supervisor_drivers(organization_id);
