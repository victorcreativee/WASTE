INSERT INTO organizations (name, type, email)
VALUES ('Kampala Capital City Authority', 'kcca', 'admin@kcca.go.ug')
ON CONFLICT DO NOTHING;

INSERT INTO roles (name, description)
VALUES
('system_admin', 'Full platform administrator'),
('kcca_admin', 'KCCA city authority administrator'),
('company_admin', 'Waste or recycling company administrator'),
('driver', 'Waste truck driver'),
('citizen', 'Resident using citizen services'),
('iot_operator', 'IoT and smart infrastructure operator')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (code, description)
VALUES
('users:read', 'View users'),
('users:create', 'Create users'),
('users:update', 'Update users'),
('organizations:read', 'View organizations'),
('organizations:create', 'Create organizations'),
('organizations:update', 'Update organizations'),
('waste:read', 'View waste operations'),
('waste:create', 'Create waste operations'),
('fleet:read', 'View fleet data'),
('fleet:update', 'Update fleet data'),
('gis:read', 'View GIS maps'),
('iot:read', 'View IoT data'),
('reports:read', 'View reports'),
('admin:full_access', 'Full administrative access')
ON CONFLICT (code) DO NOTHING;