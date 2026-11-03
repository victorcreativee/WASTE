-- External investors receive a tenant-scoped, read-only view of company performance.
-- Deliberately exclude customer, staff, attendance, contract and access-management data.
INSERT INTO roles(name,description) VALUES
 ('company_investor','Read-only investor guest with business performance access')
ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO organization_roles(organization_id,name,legacy_role_name)
SELECT id,'Investor / guest','company_investor'
FROM organizations WHERE type='recycling_company'
ON CONFLICT(organization_id,legacy_role_name) DO NOTHING;

WITH read_grants(permission_code) AS (VALUES
 ('reports.organization.read'),('finance.read'),('inventory.read'),('recycling.read')
)
INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT role.organization_id,role.id,read_grants.permission_code
FROM organization_roles role
JOIN organizations organization ON organization.id=role.organization_id AND organization.type='recycling_company'
CROSS JOIN read_grants
WHERE role.legacy_role_name='company_investor'
  AND EXISTS(SELECT 1 FROM organization_permission_catalog permission WHERE permission.code=read_grants.permission_code)
ON CONFLICT(role_id,permission_code) DO NOTHING;
