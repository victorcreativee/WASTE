INSERT INTO organization_permission_catalog(code,module,action,description) VALUES
 ('customers.read','customers','read','View organization customers and service status'),
 ('customers.manage','customers','manage','Update customer service status'),
 ('contracts.read','contracts','read','View organization contracts'),
 ('contracts.manage','contracts','manage','Create and update organization contracts'),
 ('fleet.read','fleet','read','View organization fleet, vehicle history and alerts'),
 ('fleet.manage','fleet','manage','Manage vehicle readiness, maintenance, documents and fuel'),
 ('fleet.alert.review','fleet','alert_review','Review and resolve organization fleet alerts'),
 ('reports.organization.read','reports','organization_read','View organization operational reports')
ON CONFLICT(code) DO UPDATE SET module=EXCLUDED.module,action=EXCLUDED.action,description=EXCLUDED.description;

WITH grants(legacy_role_name,permission_code) AS (VALUES
 ('company_admin','customers.read'),('company_admin','customers.manage'),
 ('company_admin','contracts.read'),('company_admin','contracts.manage'),
 ('company_admin','fleet.read'),('company_admin','fleet.manage'),('company_admin','fleet.alert.review'),
 ('company_admin','reports.organization.read'),
 ('supervisor','customers.read'),('supervisor','contracts.read'),
 ('supervisor','fleet.read'),('supervisor','fleet.manage'),('supervisor','fleet.alert.review'),
 ('supervisor','reports.organization.read')
)
INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT role.organization_id,role.id,grant_row.permission_code
FROM organization_roles role JOIN grants grant_row ON grant_row.legacy_role_name=role.legacy_role_name
ON CONFLICT(role_id,permission_code) DO NOTHING;

CREATE OR REPLACE FUNCTION provision_legacy_membership(p_user UUID,p_role TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE org UUID; org_type TEXT; member UUID; role UUID;
BEGIN
 IF p_role NOT IN ('company_admin','supervisor','driver','iot_operator','recycling_collector','recycling_sales') THEN RETURN; END IF;
 SELECT organization_id INTO org FROM users WHERE id=p_user;
 IF org IS NULL THEN RETURN; END IF;
 SELECT type INTO org_type FROM organizations WHERE id=org;
 INSERT INTO organization_memberships(organization_id,user_id) VALUES(org,p_user)
 ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active',updated_at=CURRENT_TIMESTAMP;
 SELECT id INTO member FROM organization_memberships WHERE organization_id=org AND user_id=p_user;
 INSERT INTO organization_roles(organization_id,name,legacy_role_name) VALUES(org,p_role,p_role)
 ON CONFLICT(organization_id,legacy_role_name) DO NOTHING;
 SELECT id INTO role FROM organization_roles WHERE organization_id=org AND legacy_role_name=p_role;
 IF p_role='company_admin' THEN
  INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
  SELECT org,role,code FROM organization_permission_catalog WHERE module<>'recycling' OR org_type='recycling_company'
  ON CONFLICT(role_id,permission_code) DO NOTHING;
 ELSIF p_role='supervisor' THEN
  INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
  SELECT org,role,code FROM organization_permission_catalog WHERE code IN (
   'finance.read','finance.expense.create','inventory.read','inventory.manage','procurement.request.create','procurement.read',
   'payables.read','billing.read','customers.read','contracts.read','fleet.read','fleet.manage','fleet.alert.review',
   'reports.organization.read')
  ON CONFLICT(role_id,permission_code) DO NOTHING;
 END IF;
 IF org_type='recycling_company' THEN
  INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
  SELECT org,role,code FROM organization_permission_catalog WHERE module='recycling' AND (
   p_role IN ('company_admin','supervisor')
   OR (p_role='recycling_collector' AND code IN ('recycling.read','recycling.purchase.create','recycling.local_sale.create'))
   OR (p_role='recycling_sales' AND code IN ('recycling.read','recycling.industrial_sale.manage')))
  ON CONFLICT(role_id,permission_code) DO NOTHING;
 END IF;
 INSERT INTO organization_membership_roles(organization_id,membership_id,role_id) VALUES(org,member,role) ON CONFLICT DO NOTHING;
END;
$$;
