-- Organization permissions for finance, inventory, procurement and payables.
INSERT INTO organization_permission_catalog(code,module,action,description) VALUES
 ('finance.read','finance','read','View expenses and financial position'),
 ('finance.expense.create','finance','expense_create','Record organization expenses'),
 ('finance.expense.approve','finance','expense_approve','Approve, pay or void organization expenses'),
 ('finance.settings.manage','finance','settings','Configure the reviewed opening balance'),
 ('inventory.read','inventory','read','View inventory and purchase requests'),
 ('inventory.manage','inventory','manage','Create stock items and record stock movements'),
 ('procurement.request.create','procurement','request','Create purchase requests'),
 ('procurement.request.approve','procurement','approve','Approve or reject purchase requests'),
 ('procurement.read','procurement','read','View suppliers and purchase orders'),
 ('procurement.manage','procurement','manage','Manage suppliers and purchase orders'),
 ('payables.read','payables','read','View supplier bills and payments'),
 ('payables.bill.manage','payables','bill','Create and manage supplier bills'),
 ('payables.payment.create','payables','payment','Record supplier payments')
ON CONFLICT(code) DO UPDATE SET module=EXCLUDED.module,action=EXCLUDED.action,description=EXCLUDED.description;

WITH grants(legacy_role_name,permission_code) AS (VALUES
 ('company_admin','finance.read'),('company_admin','finance.expense.create'),('company_admin','finance.expense.approve'),('company_admin','finance.settings.manage'),
 ('company_admin','inventory.read'),('company_admin','inventory.manage'),('company_admin','procurement.request.create'),('company_admin','procurement.request.approve'),
 ('company_admin','procurement.read'),('company_admin','procurement.manage'),('company_admin','payables.read'),('company_admin','payables.bill.manage'),('company_admin','payables.payment.create'),
 ('supervisor','finance.read'),('supervisor','finance.expense.create'),('supervisor','inventory.read'),('supervisor','inventory.manage'),
 ('supervisor','procurement.request.create'),('supervisor','procurement.read'),('supervisor','payables.read')
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
  SELECT org,role,code FROM organization_permission_catalog
  WHERE module<>'recycling' OR org_type='recycling_company'
  ON CONFLICT(role_id,permission_code) DO NOTHING;
 ELSIF p_role='supervisor' THEN
  INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
  SELECT org,role,code FROM organization_permission_catalog
  WHERE code IN ('finance.read','finance.expense.create','inventory.read','inventory.manage','procurement.request.create','procurement.read','payables.read')
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
