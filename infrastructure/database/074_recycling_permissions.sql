-- Fine-grained recycling permissions. These grants are tenant-scoped and are
-- resolved through organization_effective_permissions at request time.
INSERT INTO organization_permission_catalog(code,module,action,description) VALUES
 ('recycling.read','recycling','read','View recycling operations and records'),
 ('recycling.purchase.create','recycling','purchase','Record material purchases'),
 ('recycling.local_sale.create','recycling','local_sale','Record approved local material sales'),
 ('recycling.industrial_sale.manage','recycling','industrial_sale','Manage industrial buyers, sales and collections'),
 ('recycling.inventory.manage','recycling','inventory','Manage sorting, material catalog and stock adjustments'),
 ('recycling.finance.manage','recycling','finance','Manage recycling float and purchase payments'),
 ('recycling.daily_close.manage','recycling','daily_close','Close and review recycling operating days')
ON CONFLICT(code) DO UPDATE SET
 module=EXCLUDED.module,
 action=EXCLUDED.action,
 description=EXCLUDED.description;

-- Backfill only recycling-company roles. Waste-collection organizations do not
-- receive recycling capabilities even when their legacy role name is the same.
WITH grants(legacy_role_name,permission_code) AS (VALUES
 ('company_admin','recycling.read'),
 ('company_admin','recycling.purchase.create'),
 ('company_admin','recycling.local_sale.create'),
 ('company_admin','recycling.industrial_sale.manage'),
 ('company_admin','recycling.inventory.manage'),
 ('company_admin','recycling.finance.manage'),
 ('company_admin','recycling.daily_close.manage'),
 ('supervisor','recycling.read'),
 ('supervisor','recycling.purchase.create'),
 ('supervisor','recycling.local_sale.create'),
 ('supervisor','recycling.industrial_sale.manage'),
 ('supervisor','recycling.inventory.manage'),
 ('supervisor','recycling.finance.manage'),
 ('supervisor','recycling.daily_close.manage'),
 ('recycling_collector','recycling.read'),
 ('recycling_collector','recycling.purchase.create'),
 ('recycling_collector','recycling.local_sale.create'),
 ('recycling_sales','recycling.read'),
 ('recycling_sales','recycling.industrial_sale.manage')
)
INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT role.organization_id,role.id,grant_row.permission_code
FROM organization_roles role
JOIN organizations organization ON organization.id=role.organization_id
JOIN grants grant_row ON grant_row.legacy_role_name=role.legacy_role_name
WHERE organization.type='recycling_company'
ON CONFLICT(role_id,permission_code) DO NOTHING;

-- Keep the compatibility bridge safe for newly created users. Company admins
-- retain every non-recycling organization permission, while recycling grants
-- are issued only inside recycling companies and by operational responsibility.
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
   SELECT org,role,code
   FROM organization_permission_catalog
   WHERE module <> 'recycling' OR org_type='recycling_company'
   ON CONFLICT(role_id,permission_code) DO NOTHING;
 END IF;

 IF org_type='recycling_company' THEN
   INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
   SELECT org,role,code
   FROM organization_permission_catalog
   WHERE module='recycling' AND (
     p_role IN ('company_admin','supervisor')
     OR (p_role='recycling_collector' AND code IN ('recycling.read','recycling.purchase.create','recycling.local_sale.create'))
     OR (p_role='recycling_sales' AND code IN ('recycling.read','recycling.industrial_sale.manage'))
   )
   ON CONFLICT(role_id,permission_code) DO NOTHING;
 END IF;

 INSERT INTO organization_membership_roles(organization_id,membership_id,role_id)
 VALUES(org,member,role) ON CONFLICT DO NOTHING;
END;
$$;
