-- Field managers control money issued to employees for operational purchasing,
-- without receiving unrestricted finance, billing, payroll or banking access.
INSERT INTO organization_permission_catalog(code,module,action,description) VALUES
 ('recycling.field_float.manage','recycling','field_float','Issue and reconcile recycling field-operation float')
ON CONFLICT(code) DO UPDATE SET
 module=EXCLUDED.module,action=EXCLUDED.action,description=EXCLUDED.description;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT role.organization_id,role.id,'recycling.field_float.manage'
FROM organization_roles role
JOIN organizations organization ON organization.id=role.organization_id
WHERE organization.type='recycling_company' AND role.legacy_role_name='recycling_field_manager'
ON CONFLICT(role_id,permission_code) DO NOTHING;
