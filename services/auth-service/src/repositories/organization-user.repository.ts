import { PoolClient } from "pg";
import { dbPool } from "../config/database";
import { authorizeStaffWrite, protectedStaff } from "./staff-authorization";

export async function findOrganizationUsers(organizationId: string) {
  const result = await dbPool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.last_login_at, u.created_at,
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
         WHERE staff_ur.user_id=u.id AND staff_role.name IN ('company_admin','supervisor','driver','iot_operator','recycling_collector','recycling_sales'))
       AND NOT EXISTS (
         SELECT 1 FROM user_roles customer_ur
         JOIN roles customer_role ON customer_role.id = customer_ur.role_id
         WHERE customer_ur.user_id = u.id AND customer_role.name = 'citizen'
       )
     GROUP BY u.id, d.id
     ORDER BY u.created_at DESC`,
    [organizationId]
  );
  return result.rows;
}

export async function replaceSupervisorDrivers(
  supervisorUserId: string,
  driverIds: string[],
  organizationId: string,
  actorId: string
) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await authorizeStaffWrite(client,organizationId,actorId);
    if(supervisorUserId===actorId)protectedStaff("You cannot change your own supervisor team");
    const previous = await client.query("SELECT driver_id FROM supervisor_drivers WHERE supervisor_user_id=$1::uuid AND organization_id=$2::uuid",[supervisorUserId,organizationId]);
    const supervisorResult = await client.query(
      `SELECT u.id FROM users u
       JOIN organization_memberships m ON m.user_id=u.id AND m.organization_id=u.organization_id AND m.status='active'
       JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1::uuid AND u.organization_id = $2::uuid
         AND u.status = 'active' AND r.name = 'supervisor'
         AND NOT EXISTS(SELECT 1 FROM user_roles x JOIN roles xr ON xr.id=x.role_id WHERE x.user_id=u.id AND xr.name IN ('company_admin','citizen','kcca_admin','system_admin'))
       FOR UPDATE OF u,m`,
      [supervisorUserId, organizationId]
    );
    if (!supervisorResult.rows[0]) { await client.query("ROLLBACK"); return null; }
    const driversResult = await client.query(
      `SELECT d.id FROM drivers d JOIN users u ON u.id=d.user_id AND u.organization_id=d.organization_id
       JOIN organization_memberships m ON m.user_id=u.id AND m.organization_id=u.organization_id AND m.status='active'
       WHERE d.organization_id = $1::uuid AND d.id = ANY($2::uuid[]) AND u.status='active' AND d.status<>'inactive'
       AND EXISTS(SELECT 1 FROM user_roles x JOIN roles xr ON xr.id=x.role_id WHERE x.user_id=u.id AND xr.name='driver')
       AND NOT EXISTS(SELECT 1 FROM user_roles x JOIN roles xr ON xr.id=x.role_id WHERE x.user_id=u.id AND xr.name IN ('company_admin','citizen','kcca_admin','system_admin'))
       ORDER BY u.id FOR UPDATE OF u,m`,
      [organizationId, driverIds]
    );
    if (driversResult.rowCount !== new Set(driverIds).size) { await client.query("ROLLBACK"); return null; }
    await client.query(`DELETE FROM supervisor_drivers WHERE supervisor_user_id = $1::uuid AND organization_id=$2::uuid`, [supervisorUserId,organizationId]);
    for (const driverId of driverIds) {
      await client.query(
        `INSERT INTO supervisor_drivers (supervisor_user_id, driver_id, organization_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid)`,
        [supervisorUserId, driverId, organizationId]
      );
    }
    await client.query("INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,previous_value,new_value) VALUES($1,$2,'team_assigned','supervisor', $3,$4::jsonb,$5::jsonb)",
      [organizationId,actorId,supervisorUserId,JSON.stringify({driver_ids:previous.rows.map(r=>r.driver_id)}),JSON.stringify({driver_ids:driverIds})]);
    await client.query("COMMIT");
    return { supervisor_user_id: supervisorUserId, driver_ids: driverIds };
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
}

export async function createOrganizationStaffRecord(
  client: PoolClient,
  input: {
    organizationId: string;
    fullName: string;
    email: string;
    phone?: string;
    passwordHash: string;
    role: "supervisor" | "driver" | "recycling_collector" | "recycling_sales";
    licenseNumber?: string;
  }
) {
  const userResult = await client.query(
    `INSERT INTO users (organization_id, full_name, email, phone, password_hash)
     VALUES ($1::uuid, $2, LOWER($3), $4, $5)
     RETURNING id, organization_id, full_name, email, phone, status, created_at`,
    [input.organizationId, input.fullName, input.email, input.phone ?? null, input.passwordHash]
  );
  const user = userResult.rows[0];
  await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1::uuid, id FROM roles WHERE name = $2`,
    [user.id, input.role]
  );
  let driver = null;
  if (input.role === "driver") {
    const driverResult = await client.query(
      `INSERT INTO drivers (organization_id, user_id, full_name, phone, license_number)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING *`,
      [input.organizationId, user.id, input.fullName, input.phone ?? null, input.licenseNumber ?? null]
    );
    driver = driverResult.rows[0];
  }
  return { user, roles: [input.role], driver };
}

export async function createOrganizationCustomerRecord(
  client: PoolClient,
  input: {
    organizationId: string; fullName: string; email: string; phone?: string;
    passwordHash: string; customerType: string; locationLabel: string;
    address: string; zoneId:string; latitude?: number; longitude?: number;
  }
) {
  const userResult = await client.query(
    `INSERT INTO users (organization_id, full_name, email, phone, password_hash)
     VALUES ($1::uuid, $2, LOWER($3), $4, $5)
     RETURNING id, organization_id, full_name, email, phone, status, created_at`,
    [input.organizationId, input.fullName, input.email, input.phone ?? null, input.passwordHash]
  );
  const user = userResult.rows[0];
  await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1::uuid, id FROM roles WHERE name = 'citizen'`,
    [user.id]
  );
  const customerResult = await client.query(
    `INSERT INTO customer_profiles (user_id, customer_type, service_status)
     VALUES ($1::uuid, $2, 'active') RETURNING id, customer_number, customer_type, service_status`,
    [user.id, input.customerType]
  );
  const customer = customerResult.rows[0];
  const zoneResult = await client.query(`SELECT id,ST_Y(center_point::geometry) latitude,ST_X(center_point::geometry) longitude FROM waste_zones WHERE id=$1::uuid AND organization_id=$2::uuid AND is_active=true`,[input.zoneId,input.organizationId]);
  if(!zoneResult.rows[0])throw Object.assign(new Error("Choose an active service zone belonging to your organization"),{statusCode:400});
  const latitude=input.latitude??Number(zoneResult.rows[0].latitude),longitude=input.longitude??Number(zoneResult.rows[0].longitude);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude))throw Object.assign(new Error("This zone has no map location. Add its coordinates in Service Areas before onboarding customers."),{statusCode:409});
  const locationResult = await client.query(
    `INSERT INTO customer_service_locations
       (customer_id, zone_id, organization_id, label, address, location, is_primary)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5,
       ST_SetSRID(ST_Point($6, $7), 4326)::geography, true)
     RETURNING id, zone_id, organization_id, label, address, is_primary`,
    [customer.id, zoneResult.rows[0].id, input.organizationId,
     input.locationLabel, input.address, longitude, latitude]
  );
  await client.query(`INSERT INTO customer_service_relationships(
    customer_id,service_location_id,organization_id,status,relationship_source,created_by
  ) VALUES($1::uuid,$2::uuid,$3::uuid,'active','company_onboarding',NULLIF(current_setting('wms.actor_id',true),'')::uuid)`,
    [customer.id,locationResult.rows[0].id,input.organizationId]);
  await client.query("INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,new_value) VALUES($1,NULLIF(current_setting('wms.actor_id',true),'')::uuid,'created','customer',$2,$3::jsonb)",
    [input.organizationId,customer.id,JSON.stringify({user_id:user.id,location_id:locationResult.rows[0].id})]);
  return { user, roles: ["citizen"], customer, location: locationResult.rows[0] };
}

export async function updateOrganizationUserStatus(
  userId: string,
  organizationId: string,
  status: string,
  actorId: string
) {
  const client=await dbPool.connect();
  try {
  await client.query('BEGIN');
  const actor=await authorizeStaffWrite(client,organizationId,actorId);
  if(userId===actorId)protectedStaff("You cannot change your own account status");
  const target=await client.query(`SELECT u.id,ARRAY(SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id) roles
    FROM users u WHERE u.id=$1::uuid AND u.organization_id=$2::uuid FOR UPDATE`,[userId,organizationId]);
  if(!target.rowCount){await client.query('ROLLBACK');return null;}
  const roles:string[]=target.rows[0].roles;
  if(roles.some(r=>['company_admin','citizen','kcca_admin','system_admin'].includes(r))||!roles.some(r=>['driver','supervisor','iot_operator'].includes(r))){await client.query('ROLLBACK');return null;}
  if(!actor.isAdministrator&&(!roles.includes('driver')||roles.some(r=>r!=='driver')))protectedStaff("Only company administrators can change non-driver staff accounts");
  if(!actor.isAdministrator){
    const privileged=await client.query(`SELECT 1 FROM organization_memberships m JOIN organization_membership_roles mr ON mr.membership_id=m.id AND mr.organization_id=m.organization_id
      JOIN organization_role_permissions rp ON rp.role_id=mr.role_id AND rp.organization_id=mr.organization_id
      WHERE m.user_id=$1::uuid AND m.organization_id=$2::uuid AND rp.permission_code IN ('staff.manage','access.manage')`,[userId,organizationId]);
    if(privileged.rowCount)protectedStaff("Staff-management and access-management accounts require a company administrator");
  }
  const result = await client.query(
    `UPDATE users SET status = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1::uuid AND organization_id = $2::uuid
       AND NOT EXISTS (
         SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = users.id AND r.name = 'company_admin'
       )
     RETURNING id, full_name, email, status`,
    [userId, organizationId, status]
  );
  await client.query('COMMIT');
  return result.rows[0] ?? null;
  } catch(error) { await client.query('ROLLBACK');throw error; } finally { client.release(); }
}
