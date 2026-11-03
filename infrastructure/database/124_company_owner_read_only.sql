-- Company owners/directors need complete business visibility without any
-- operational mutation rights. Keep this role intentionally read-only.
INSERT INTO roles(name,description) VALUES
 ('company_owner','Read-only company owner with complete reporting access')
ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO organization_roles(organization_id,name,legacy_role_name)
SELECT id,'Company owner','company_owner' FROM organizations WHERE type='recycling_company'
ON CONFLICT(organization_id,legacy_role_name) DO NOTHING;

WITH read_grants(permission_code) AS (VALUES
 ('reports.organization.read'),('finance.read'),('inventory.read'),('procurement.read'),
 ('payables.read'),('billing.read'),('customers.read'),('contracts.read'),('fleet.read'),
 ('staff.read'),('attendance.read'),('recycling.read')
)
INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT role.organization_id,role.id,read_grants.permission_code
FROM organization_roles role
JOIN organizations organization ON organization.id=role.organization_id AND organization.type='recycling_company'
CROSS JOIN read_grants
WHERE role.legacy_role_name='company_owner'
  AND EXISTS(SELECT 1 FROM organization_permission_catalog permission WHERE permission.code=read_grants.permission_code)
ON CONFLICT(role_id,permission_code) DO NOTHING;
