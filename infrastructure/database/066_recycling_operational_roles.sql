INSERT INTO roles(name,description) VALUES
 ('recycling_collector','Recycling material collection and local purchasing worker'),
 ('recycling_sales','Recycling industrial sales and buyer relationship worker')
ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description;

ALTER TABLE recycling_material_sales
  ADD COLUMN IF NOT EXISTS sale_channel TEXT NOT NULL DEFAULT 'industrial'
  CHECK(sale_channel IN('local','industrial'));

CREATE OR REPLACE FUNCTION provision_legacy_membership(p_user UUID,p_role TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE org UUID; member UUID; role UUID; new_role BOOLEAN;
BEGIN
 IF p_role NOT IN ('company_admin','supervisor','driver','iot_operator','recycling_collector','recycling_sales') THEN RETURN; END IF;
 SELECT organization_id INTO org FROM users WHERE id=p_user;
 IF org IS NULL THEN RETURN; END IF;
 INSERT INTO organization_memberships(organization_id,user_id) VALUES(org,p_user)
 ON CONFLICT(organization_id,user_id) DO NOTHING;
 SELECT id INTO member FROM organization_memberships WHERE organization_id=org AND user_id=p_user;
 INSERT INTO organization_roles(organization_id,name,legacy_role_name) VALUES(org,p_role,p_role)
 ON CONFLICT(organization_id,legacy_role_name) DO NOTHING RETURNING id INTO role;
 new_role := role IS NOT NULL;
 IF role IS NULL THEN SELECT id INTO role FROM organization_roles WHERE organization_id=org AND legacy_role_name=p_role; END IF;
 IF new_role AND p_role='company_admin' THEN
   INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
   SELECT org,role,code FROM organization_permission_catalog;
 END IF;
 INSERT INTO organization_membership_roles(organization_id,membership_id,role_id)
 VALUES(org,member,role) ON CONFLICT DO NOTHING;
END;
$$;
