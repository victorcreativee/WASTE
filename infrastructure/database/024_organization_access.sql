-- Phase 1A: additive membership and administration-permission foundation.
CREATE TABLE IF NOT EXISTS organization_permission_catalog (
 code TEXT PRIMARY KEY, module TEXT NOT NULL, action TEXT NOT NULL, description TEXT NOT NULL
);
INSERT INTO organization_permission_catalog(code,module,action,description) VALUES
 ('access.read','administration','read','View memberships and role templates'),
 ('access.manage','administration','manage','Suspend or restore staff memberships'),
 ('audit.read','administration','audit','Read organization administration audit events'),
 ('staff.read','staff','read','View organization staff'),
 ('staff.manage','staff','manage','Create staff and manage staff status and teams'),
 ('customer.manage','customers','manage','Create customer accounts and locations'),
 ('attendance.read','attendance','read','Read attendance'),
 ('attendance.manage','attendance','manage','Record attendance'),
 ('payroll.read','payroll','read','Read payroll'),
 ('payroll.manage','payroll','manage','Prepare, approve and pay payroll')
ON CONFLICT(code) DO NOTHING;

CREATE TABLE IF NOT EXISTS organization_memberships (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 user_id UUID NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','inactive')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,user_id), UNIQUE(id,organization_id)
);
CREATE TABLE IF NOT EXISTS organization_roles (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 name TEXT NOT NULL,
 legacy_role_name TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,name), UNIQUE(organization_id,legacy_role_name), UNIQUE(id,organization_id)
);
CREATE TABLE IF NOT EXISTS organization_role_permissions (
 organization_id UUID NOT NULL,
 role_id UUID NOT NULL,
 permission_code TEXT NOT NULL REFERENCES organization_permission_catalog(code),
 PRIMARY KEY(role_id,permission_code),
 FOREIGN KEY(role_id,organization_id) REFERENCES organization_roles(id,organization_id)
);
CREATE TABLE IF NOT EXISTS organization_membership_roles (
 organization_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 role_id UUID NOT NULL,
 PRIMARY KEY(membership_id,role_id),
 FOREIGN KEY(membership_id,organization_id) REFERENCES organization_memberships(id,organization_id),
 FOREIGN KEY(role_id,organization_id) REFERENCES organization_roles(id,organization_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON organization_memberships(user_id,status);
CREATE TABLE IF NOT EXISTS organization_audit_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 actor_id UUID REFERENCES users(id),
 action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id UUID,
 previous_value JSONB, new_value JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_org_audit_time ON organization_audit_events(organization_id,created_at DESC,id);

-- Compatibility bridge. Only existing tenant roles get memberships; citizens and
-- platform/regulatory actors never acquire organization-administration grants here.
CREATE OR REPLACE FUNCTION provision_legacy_membership(p_user UUID,p_role TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE org UUID; member UUID; role UUID; new_role BOOLEAN;
BEGIN
 IF p_role NOT IN ('company_admin','supervisor','driver','iot_operator') THEN RETURN; END IF;
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

CREATE OR REPLACE FUNCTION sync_legacy_membership_role()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE role_name TEXT; org UUID;
BEGIN
 IF TG_OP='INSERT' THEN
   SELECT name INTO role_name FROM roles WHERE id=NEW.role_id;
   PERFORM provision_legacy_membership(NEW.user_id,role_name);
 ELSE
   SELECT name INTO role_name FROM roles WHERE id=OLD.role_id;
   SELECT organization_id INTO org FROM users WHERE id=OLD.user_id;
   DELETE FROM organization_membership_roles mr USING organization_memberships m,organization_roles r
   WHERE mr.membership_id=m.id AND mr.role_id=r.id AND m.user_id=OLD.user_id
     AND m.organization_id=org AND r.legacy_role_name=role_name;
 END IF;
 RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_legacy_membership_role ON user_roles;
CREATE TRIGGER trg_legacy_membership_role AFTER INSERT OR DELETE ON user_roles
 FOR EACH ROW EXECUTE FUNCTION sync_legacy_membership_role();

CREATE OR REPLACE FUNCTION sync_legacy_membership_organization()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE role_name TEXT;
BEGIN
 IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
   UPDATE organization_memberships SET status='inactive',updated_at=CURRENT_TIMESTAMP
   WHERE user_id=NEW.id AND organization_id=OLD.organization_id;
   FOR role_name IN SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=NEW.id LOOP
     PERFORM provision_legacy_membership(NEW.id,role_name);
   END LOOP;
 END IF;
 RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_legacy_membership_organization ON users;
CREATE TRIGGER trg_legacy_membership_organization AFTER UPDATE OF organization_id ON users
 FOR EACH ROW EXECUTE FUNCTION sync_legacy_membership_organization();

-- Backfill current identities without changing global roles, account status or passwords.
DO $$ DECLARE row RECORD; BEGIN
 FOR row IN SELECT ur.user_id,r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id LOOP
   PERFORM provision_legacy_membership(row.user_id,row.name);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION organization_effective_permissions(p_user UUID,p_org UUID)
RETURNS TABLE(code TEXT) LANGUAGE sql STABLE AS $$
 SELECT DISTINCT rp.permission_code
 FROM organization_memberships m
 JOIN users u ON u.id=m.user_id AND u.organization_id=m.organization_id AND u.status='active'
 JOIN organizations o ON o.id=m.organization_id AND o.is_active
 JOIN organization_membership_roles mr ON mr.membership_id=m.id AND mr.organization_id=m.organization_id
 JOIN organization_role_permissions rp ON rp.role_id=mr.role_id AND rp.organization_id=mr.organization_id
 WHERE m.user_id=p_user AND m.organization_id=p_org AND m.status='active'
$$;

CREATE OR REPLACE FUNCTION record_organization_access_audit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE before_row JSONB; after_row JSONB; value JSONB; org UUID;
BEGIN
 before_row := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 after_row := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 value := COALESCE(after_row,before_row);
 org := (value->>'organization_id')::uuid;
 IF before_row IS NOT DISTINCT FROM after_row THEN RETURN NULL; END IF;
 INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,previous_value,new_value)
 VALUES(org,NULLIF(current_setting('wms.actor_id',true),'')::uuid,lower(TG_OP),TG_TABLE_NAME,
   COALESCE(value->>'id',value->>'membership_id',value->>'role_id')::uuid,before_row,after_row);
 RETURN NULL;
END;
$$;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['organization_memberships','organization_roles','organization_role_permissions','organization_membership_roles'] LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS trg_access_audit ON %I',t);
   EXECUTE format('CREATE TRIGGER trg_access_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION record_organization_access_audit()',t);
 END LOOP;
END $$;

-- Explicit allowlist: never copy passwords, tokens, contacts or arbitrary user columns.
CREATE OR REPLACE FUNCTION record_staff_status_audit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IS DISTINCT FROM NEW.status AND NEW.organization_id IS NOT NULL THEN
  INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,previous_value,new_value)
  VALUES(NEW.organization_id,NULLIF(current_setting('wms.actor_id',true),'')::uuid,'status_changed','staff_account',NEW.id,
    jsonb_build_object('status',OLD.status),jsonb_build_object('status',NEW.status));
 END IF;
 RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_staff_status_audit ON users;
CREATE TRIGGER trg_staff_status_audit AFTER UPDATE OF status ON users FOR EACH ROW EXECUTE FUNCTION record_staff_status_audit();

CREATE OR REPLACE FUNCTION prevent_organization_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Organization audit events cannot be changed or deleted'; END;
$$;
DROP TRIGGER IF EXISTS trg_immutable_org_audit ON organization_audit_events;
CREATE TRIGGER trg_immutable_org_audit BEFORE UPDATE OR DELETE ON organization_audit_events
 FOR EACH ROW EXECUTE FUNCTION prevent_organization_audit_mutation();
