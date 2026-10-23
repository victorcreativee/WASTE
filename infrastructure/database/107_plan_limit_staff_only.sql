-- Plan staff limits count staff, not households. Households registered by a collection company (citizen accounts,
-- see 106) belong to the company's organization but are its customers; counting them would block a company on a
-- 15-staff plan after about 15 households.
-- A new account gets its role after the users row is written, so the staff check moves to the moment a role is
-- attached (user_roles). Reactivating a staff account is still checked on users.

CREATE OR REPLACE FUNCTION is_household_account(p_user_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = p_user_id AND r.name = 'citizen');
$$;

CREATE OR REPLACE FUNCTION plan_limit_reason(p_organization_id UUID,p_kind TEXT) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE plan RECORD; used INTEGER;
BEGIN
  SELECT p.name,p.max_vehicles,p.max_users,s.status INTO plan FROM organization_subscriptions s JOIN platform_packages p ON p.id=s.package_id WHERE s.organization_id=p_organization_id;
  IF NOT FOUND OR plan.status='complimentary' THEN RETURN NULL; END IF;
  IF p_kind='vehicle' AND plan.max_vehicles IS NOT NULL THEN
    SELECT COUNT(*) INTO used FROM waste_trucks WHERE organization_id=p_organization_id;
    IF used>=plan.max_vehicles THEN RETURN format('The %s plan allows %s vehicles. Upgrade the plan to add more.',plan.name,plan.max_vehicles); END IF;
  ELSIF p_kind='user' AND plan.max_users IS NOT NULL THEN
    SELECT COUNT(*) INTO used FROM users u WHERE u.organization_id=p_organization_id AND u.status='active' AND NOT is_household_account(u.id);
    IF used>=plan.max_users THEN RETURN format('The %s plan allows %s active staff accounts. Upgrade the plan to add more.',plan.name,plan.max_users); END IF;
  END IF;
  RETURN NULL;
END $$;

-- Reactivation or a move between organizations: checked unless the account is a household.
CREATE OR REPLACE FUNCTION enforce_user_plan_limit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE reason TEXT;
BEGIN
  IF TG_OP='UPDATE' AND NEW.organization_id IS NOT NULL AND NEW.status='active'
     AND (OLD.status IS DISTINCT FROM 'active' OR OLD.organization_id IS DISTINCT FROM NEW.organization_id)
     AND EXISTS (SELECT 1 FROM user_roles WHERE user_id=NEW.id) AND NOT is_household_account(NEW.id) THEN
    reason := plan_limit_reason(NEW.organization_id,'user');
    IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_user_plan_limit ON users;
CREATE TRIGGER trg_user_plan_limit BEFORE UPDATE OF organization_id,status ON users FOR EACH ROW EXECUTE FUNCTION enforce_user_plan_limit();

-- A new staff account is counted when it receives its first staff role. The count already includes it, so the limit
-- is exceeded when it goes above the plan's allowance.
CREATE OR REPLACE FUNCTION enforce_staff_role_plan_limit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE account RECORD; plan RECORD; used INTEGER;
BEGIN
  SELECT u.organization_id, u.status INTO account FROM users u WHERE u.id = NEW.user_id;
  IF account.organization_id IS NULL OR account.status <> 'active' OR is_household_account(NEW.user_id) THEN RETURN NEW; END IF;
  -- Only the first role counts the account; further roles on the same person are not a new staff member.
  IF (SELECT COUNT(*) FROM user_roles WHERE user_id = NEW.user_id) > 1 THEN RETURN NEW; END IF;
  SELECT p.name, p.max_users, s.status INTO plan FROM organization_subscriptions s JOIN platform_packages p ON p.id = s.package_id
   WHERE s.organization_id = account.organization_id;
  IF NOT FOUND OR plan.status = 'complimentary' OR plan.max_users IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO used FROM users u WHERE u.organization_id = account.organization_id AND u.status = 'active'
     AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id) AND NOT is_household_account(u.id);
  IF used > plan.max_users THEN
    RAISE EXCEPTION 'The % plan allows % active staff accounts. Upgrade the plan to add more.', plan.name, plan.max_users;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_staff_role_plan_limit ON user_roles;
CREATE TRIGGER trg_staff_role_plan_limit AFTER INSERT ON user_roles FOR EACH ROW EXECUTE FUNCTION enforce_staff_role_plan_limit();
