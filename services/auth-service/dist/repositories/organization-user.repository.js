"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findOrganizationUsers = findOrganizationUsers;
exports.replaceSupervisorDrivers = replaceSupervisorDrivers;
exports.createOrganizationStaffRecord = createOrganizationStaffRecord;
exports.createOrganizationCustomerRecord = createOrganizationCustomerRecord;
exports.updateOrganizationUserStatus = updateOrganizationUserStatus;
const database_1 = require("../config/database");
const staff_authorization_1 = require("./staff-authorization");
async function findOrganizationUsers(organizationId) {
    const result = await database_1.dbPool.query(`SELECT u.id, u.full_name, u.email, u.phone, u.status, u.last_login_at, u.created_at,
       (SELECT m.status FROM organization_memberships m WHERE m.user_id=u.id AND m.organization_id=u.organization_id) AS membership_status,
       EXISTS(SELECT 1 FROM organization_memberships m JOIN organization_membership_roles mr ON mr.membership_id=m.id AND mr.organization_id=m.organization_id
         JOIN organization_role_permissions rp ON rp.role_id=mr.role_id AND rp.organization_id=mr.organization_id
         WHERE m.user_id=u.id AND m.organization_id=u.organization_id AND rp.permission_code IN ('staff.manage','access.manage')) AS management_protected,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.name), NULL) AS roles,
       d.id AS driver_id, d.license_number, d.status AS driver_status,
       COUNT(DISTINCT sd.driver_id)::int AS supervised_driver_count,
       COALESCE(ARRAY_AGG(DISTINCT sd.driver_id) FILTER (WHERE sd.driver_id IS NOT NULL), '{}') AS supervised_driver_ids
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     LEFT JOIN drivers d ON d.user_id = u.id
     LEFT JOIN supervisor_drivers sd ON sd.supervisor_user_id = u.id
     WHERE u.organization_id = $1::uuid
       AND EXISTS (SELECT 1 FROM user_roles staff_ur JOIN roles staff_role ON staff_role.id=staff_ur.role_id
         WHERE staff_ur.user_id=u.id AND staff_role.name IN ('company_admin','supervisor','driver','iot_operator'))
       AND NOT EXISTS (
         SELECT 1 FROM user_roles customer_ur
         JOIN roles customer_role ON customer_role.id = customer_ur.role_id
         WHERE customer_ur.user_id = u.id AND customer_role.name = 'citizen'
       )
     GROUP BY u.id, d.id
     ORDER BY u.created_at DESC`, [organizationId]);
    return result.rows;
}
async function replaceSupervisorDrivers(supervisorUserId, driverIds, organizationId, actorId) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        await (0, staff_authorization_1.authorizeStaffWrite)(client, organizationId, actorId);
        if (supervisorUserId === actorId)
            (0, staff_authorization_1.protectedStaff)("You cannot change your own supervisor team");
        const previous = await client.query("SELECT driver_id FROM supervisor_drivers WHERE supervisor_user_id=$1::uuid AND organization_id=$2::uuid", [supervisorUserId, organizationId]);
        const supervisorResult = await client.query(`SELECT u.id FROM users u
       JOIN organization_memberships m ON m.user_id=u.id AND m.organization_id=u.organization_id AND m.status='active'
       JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1::uuid AND u.organization_id = $2::uuid
         AND u.status = 'active' AND r.name = 'supervisor'
         AND NOT EXISTS(SELECT 1 FROM user_roles x JOIN roles xr ON xr.id=x.role_id WHERE x.user_id=u.id AND xr.name IN ('company_admin','citizen','kcca_admin','system_admin'))
       FOR UPDATE OF u,m`, [supervisorUserId, organizationId]);
        if (!supervisorResult.rows[0]) {
            await client.query("ROLLBACK");
            return null;
        }
        const driversResult = await client.query(`SELECT d.id FROM drivers d JOIN users u ON u.id=d.user_id AND u.organization_id=d.organization_id
       JOIN organization_memberships m ON m.user_id=u.id AND m.organization_id=u.organization_id AND m.status='active'
       WHERE d.organization_id = $1::uuid AND d.id = ANY($2::uuid[]) AND u.status='active' AND d.status<>'inactive'
       AND EXISTS(SELECT 1 FROM user_roles x JOIN roles xr ON xr.id=x.role_id WHERE x.user_id=u.id AND xr.name='driver')
       AND NOT EXISTS(SELECT 1 FROM user_roles x JOIN roles xr ON xr.id=x.role_id WHERE x.user_id=u.id AND xr.name IN ('company_admin','citizen','kcca_admin','system_admin'))
       ORDER BY u.id FOR UPDATE OF u,m`, [organizationId, driverIds]);
        if (driversResult.rowCount !== new Set(driverIds).size) {
            await client.query("ROLLBACK");
            return null;
        }
        await client.query(`DELETE FROM supervisor_drivers WHERE supervisor_user_id = $1::uuid AND organization_id=$2::uuid`, [supervisorUserId, organizationId]);
        for (const driverId of driverIds) {
            await client.query(`INSERT INTO supervisor_drivers (supervisor_user_id, driver_id, organization_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid)`, [supervisorUserId, driverId, organizationId]);
        }
        await client.query("INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,previous_value,new_value) VALUES($1,$2,'team_assigned','supervisor', $3,$4::jsonb,$5::jsonb)", [organizationId, actorId, supervisorUserId, JSON.stringify({ driver_ids: previous.rows.map(r => r.driver_id) }), JSON.stringify({ driver_ids: driverIds })]);
        await client.query("COMMIT");
        return { supervisor_user_id: supervisorUserId, driver_ids: driverIds };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
async function createOrganizationStaffRecord(client, input) {
    const userResult = await client.query(`INSERT INTO users (organization_id, full_name, email, phone, password_hash)
     VALUES ($1::uuid, $2, LOWER($3), $4, $5)
     RETURNING id, organization_id, full_name, email, phone, status, created_at`, [input.organizationId, input.fullName, input.email, input.phone ?? null, input.passwordHash]);
    const user = userResult.rows[0];
    await client.query(`INSERT INTO user_roles (user_id, role_id)
     SELECT $1::uuid, id FROM roles WHERE name = $2`, [user.id, input.role]);
    let driver = null;
    if (input.role === "driver") {
        const driverResult = await client.query(`INSERT INTO drivers (organization_id, user_id, full_name, phone, license_number)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING *`, [input.organizationId, user.id, input.fullName, input.phone ?? null, input.licenseNumber ?? null]);
        driver = driverResult.rows[0];
    }
    return { user, roles: [input.role], driver };
}
async function createOrganizationCustomerRecord(client, input) {
    const userResult = await client.query(`INSERT INTO users (organization_id, full_name, email, phone, password_hash)
     VALUES ($1::uuid, $2, LOWER($3), $4, $5)
     RETURNING id, organization_id, full_name, email, phone, status, created_at`, [input.organizationId, input.fullName, input.email, input.phone ?? null, input.passwordHash]);
    const user = userResult.rows[0];
    await client.query(`INSERT INTO user_roles (user_id, role_id)
     SELECT $1::uuid, id FROM roles WHERE name = 'citizen'`, [user.id]);
    const customerResult = await client.query(`INSERT INTO customer_profiles (user_id, customer_type, service_status)
     VALUES ($1::uuid, $2, 'active') RETURNING id, customer_type, service_status`, [user.id, input.customerType]);
    const customer = customerResult.rows[0];
    const zoneResult = await client.query(`SELECT id FROM waste_zones
     WHERE organization_id = $1::uuid AND is_active = true
       AND boundary IS NOT NULL
       AND ST_Covers(boundary, ST_SetSRID(ST_Point($2, $3), 4326))
     ORDER BY id
     LIMIT 1`, [input.organizationId, input.longitude, input.latitude]);
    const locationResult = await client.query(`INSERT INTO customer_service_locations
       (customer_id, zone_id, organization_id, label, address, location, is_primary)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5,
       ST_SetSRID(ST_Point($6, $7), 4326)::geography, true)
     RETURNING id, zone_id, organization_id, label, address, is_primary`, [customer.id, zoneResult.rows[0]?.id ?? null, input.organizationId,
        input.locationLabel, input.address, input.longitude, input.latitude]);
    await client.query(`INSERT INTO customer_service_relationships(
    customer_id,service_location_id,organization_id,status,relationship_source,created_by
  ) VALUES($1::uuid,$2::uuid,$3::uuid,'active','company_onboarding',NULLIF(current_setting('wms.actor_id',true),'')::uuid)`, [customer.id, locationResult.rows[0].id, input.organizationId]);
    await client.query("INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,new_value) VALUES($1,NULLIF(current_setting('wms.actor_id',true),'')::uuid,'created','customer',$2,$3::jsonb)", [input.organizationId, customer.id, JSON.stringify({ user_id: user.id, location_id: locationResult.rows[0].id })]);
    return { user, roles: ["citizen"], customer, location: locationResult.rows[0] };
}
async function updateOrganizationUserStatus(userId, organizationId, status, actorId) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query('BEGIN');
        const actor = await (0, staff_authorization_1.authorizeStaffWrite)(client, organizationId, actorId);
        if (userId === actorId)
            (0, staff_authorization_1.protectedStaff)("You cannot change your own account status");
        const target = await client.query(`SELECT u.id,ARRAY(SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id) roles
    FROM users u WHERE u.id=$1::uuid AND u.organization_id=$2::uuid FOR UPDATE`, [userId, organizationId]);
        if (!target.rowCount) {
            await client.query('ROLLBACK');
            return null;
        }
        const roles = target.rows[0].roles;
        if (roles.some(r => ['company_admin', 'citizen', 'kcca_admin', 'system_admin'].includes(r)) || !roles.some(r => ['driver', 'supervisor', 'iot_operator'].includes(r))) {
            await client.query('ROLLBACK');
            return null;
        }
        if (!actor.isAdministrator && (!roles.includes('driver') || roles.some(r => r !== 'driver')))
            (0, staff_authorization_1.protectedStaff)("Only company administrators can change non-driver staff accounts");
        if (!actor.isAdministrator) {
            const privileged = await client.query(`SELECT 1 FROM organization_memberships m JOIN organization_membership_roles mr ON mr.membership_id=m.id AND mr.organization_id=m.organization_id
      JOIN organization_role_permissions rp ON rp.role_id=mr.role_id AND rp.organization_id=mr.organization_id
      WHERE m.user_id=$1::uuid AND m.organization_id=$2::uuid AND rp.permission_code IN ('staff.manage','access.manage')`, [userId, organizationId]);
            if (privileged.rowCount)
                (0, staff_authorization_1.protectedStaff)("Staff-management and access-management accounts require a company administrator");
        }
        const result = await client.query(`UPDATE users SET status = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1::uuid AND organization_id = $2::uuid
       AND NOT EXISTS (
         SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = users.id AND r.name = 'company_admin'
       )
     RETURNING id, full_name, email, status`, [userId, organizationId, status]);
        await client.query('COMMIT');
        return result.rows[0] ?? null;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
