"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertCustomerService = upsertCustomerService;
exports.findCustomerServiceOverview = findCustomerServiceOverview;
exports.findCustomers = findCustomers;
exports.updateCustomerServiceStatus = updateCustomerServiceStatus;
const database_1 = require("../config/database");
async function upsertCustomerService(userId, input) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        const customerResult = await client.query(`INSERT INTO customer_profiles (user_id, customer_type)
       VALUES ($1::uuid, $2)
       ON CONFLICT (user_id) DO UPDATE SET customer_type = EXCLUDED.customer_type,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`, [userId, input.customerType]);
        const customer = customerResult.rows[0];
        const zoneResult = await client.query(`SELECT id, organization_id
       FROM waste_zones
       WHERE is_active = true AND (boundary IS NOT NULL OR center_point IS NOT NULL)
       ORDER BY
         CASE WHEN boundary IS NOT NULL AND ST_Covers(boundary, ST_SetSRID(ST_Point($1, $2), 4326)) THEN 0 ELSE 1 END,
         CASE WHEN center_point IS NULL THEN NULL ELSE ST_Distance(center_point, ST_SetSRID(ST_Point($1, $2), 4326)::geography) END
       LIMIT 1`, [input.longitude, input.latitude]);
        const zone = zoneResult.rows[0] ?? null;
        const locationResult = await client.query(`INSERT INTO customer_service_locations (
         customer_id, zone_id, organization_id, label, address, location, is_primary
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5,
         ST_SetSRID(ST_Point($6, $7), 4326)::geography, true)
       ON CONFLICT (customer_id) WHERE is_primary = true DO UPDATE SET
         zone_id = EXCLUDED.zone_id, organization_id = EXCLUDED.organization_id,
         label = EXCLUDED.label, address = EXCLUDED.address, location = EXCLUDED.location,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`, [customer.id, zone?.id ?? null, zone?.organization_id ?? null, input.label,
            input.address, input.longitude, input.latitude]);
        await client.query("COMMIT");
        return { customer, location: locationResult.rows[0] };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
async function findCustomerServiceOverview(userId) {
    const profileResult = await database_1.dbPool.query(`SELECT cp.id, cp.customer_type, cp.service_status,
       csl.label, csl.address,
       ST_Y(csl.location::geometry) AS latitude,
       ST_X(csl.location::geometry) AS longitude,
       wz.id AS zone_id, wz.name AS zone_name, wz.area_type,
       o.id AS organization_id, o.name AS organization_name, o.phone AS organization_phone
     FROM customer_profiles cp
     LEFT JOIN customer_service_locations csl ON csl.customer_id = cp.id AND csl.is_primary = true
     LEFT JOIN waste_zones wz ON wz.id = csl.zone_id
     LEFT JOIN organizations o ON o.id = csl.organization_id
     WHERE cp.user_id = $1::uuid`, [userId]);
    const profile = profileResult.rows[0];
    if (!profile)
        return null;
    const schedulesResult = await database_1.dbPool.query(`SELECT id, name, frequency, preferred_time
     FROM pickup_schedules WHERE zone_id = $1::uuid AND is_active = true
     ORDER BY name`, [profile.zone_id]);
    const historyResult = await database_1.dbPool.query(`SELECT id, job_date, status, waste_type, completed_at
     FROM collection_jobs WHERE zone_id = $1::uuid AND job_date <= CURRENT_DATE
     ORDER BY job_date DESC, created_at DESC LIMIT 12`, [profile.zone_id]);
    const upcomingResult = await database_1.dbPool.query(`SELECT id, job_date, status, waste_type
     FROM collection_jobs WHERE zone_id = $1::uuid AND job_date >= CURRENT_DATE
       AND status NOT IN ('cancelled', 'completed')
     ORDER BY job_date, created_at LIMIT 1`, [profile.zone_id]);
    return {
        ...profile,
        schedules: schedulesResult.rows,
        upcoming_collection: upcomingResult.rows[0] ?? null,
        collection_history: historyResult.rows,
    };
}
async function findCustomers(organizationId) {
    const result = await database_1.dbPool.query(`SELECT cp.id, u.full_name, u.email, u.phone, cp.customer_type, cp.service_status,
       csl.address, wz.name AS zone_name, o.name AS organization_name
     FROM customer_profiles cp
     JOIN users u ON u.id = cp.user_id
     LEFT JOIN customer_service_locations csl ON csl.customer_id = cp.id AND csl.is_primary = true
     LEFT JOIN waste_zones wz ON wz.id = csl.zone_id
     LEFT JOIN organizations o ON o.id = csl.organization_id
     WHERE ($1::uuid IS NULL OR csl.organization_id = $1::uuid)
     ORDER BY u.full_name`, [organizationId]);
    return result.rows;
}
async function updateCustomerServiceStatus(customerId, organizationId, status) {
    const result = await database_1.dbPool.query(`UPDATE customer_profiles cp SET service_status = $3, updated_at = CURRENT_TIMESTAMP
     WHERE cp.id = $1::uuid
       AND EXISTS (
         SELECT 1 FROM customer_service_locations csl
         WHERE csl.customer_id = cp.id AND csl.is_primary = true
           AND csl.organization_id = $2::uuid
       )
     RETURNING cp.id, cp.customer_type, cp.service_status, cp.updated_at`, [customerId, organizationId, status]);
    return result.rows[0] ?? null;
}
