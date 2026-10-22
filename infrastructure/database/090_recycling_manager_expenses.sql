-- Recycling field managers may view and submit expenses for their own
-- organization. They cannot approve, pay, void, configure cash, or access
-- banking and payroll controls.
WITH grants(permission_code) AS (VALUES
  ('finance.read'),
  ('finance.expense.create')
)
INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT role.organization_id,role.id,grant_row.permission_code
FROM organization_roles role
JOIN organizations organization
  ON organization.id=role.organization_id
 AND organization.type='recycling_company'
CROSS JOIN grants grant_row
WHERE role.legacy_role_name='recycling_field_manager'
ON CONFLICT(role_id,permission_code) DO NOTHING;
