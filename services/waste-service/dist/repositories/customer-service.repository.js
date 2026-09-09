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
        // Provider responsibility is not inferred from an address edit.
        const existing = await client.query(`SELECT csr.organization_id
      FROM customer_service_locations csl
      LEFT JOIN customer_service_relationships csr ON csr.service_location_id=csl.id AND csr.status IN ('active','suspended')
      WHERE csl.customer_id=$1::uuid AND csl.is_primary=true FOR UPDATE OF csl`, [customer.id]);
        const owner = existing.rows[0]?.organization_id ?? null;
        const zoneResult = await client.query(`SELECT id,organization_id FROM waste_zones
      WHERE is_active AND organization_id=$3::uuid AND boundary IS NOT NULL
        AND ST_Covers(boundary,ST_SetSRID(ST_Point($1,$2),4326))
      ORDER BY id LIMIT 1`, [input.longitude, input.latitude, owner]);
        const zone = zoneResult.rows[0] ?? null;
        const locationResult = await client.query(`INSERT INTO customer_service_locations (
         customer_id, zone_id, organization_id, label, address, location, is_primary
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5,
         ST_SetSRID(ST_Point($6, $7), 4326)::geography, true)
       ON CONFLICT (customer_id) WHERE is_primary = true DO UPDATE SET
         zone_id = EXCLUDED.zone_id,
         label = EXCLUDED.label, address = EXCLUDED.address, location = EXCLUDED.location,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`, [customer.id, zone?.id ?? null, owner, input.label,
            input.address, input.longitude, input.latitude]);
        await client.query("COMMIT");
        return { customer, location: locationResult.rows[0], coverageReviewRequired: !zone, providerAssignmentRequired: !owner };
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
       csr.id AS relationship_id, csr.status AS relationship_status,
       csr.effective_from AS relationship_started_on,
       o.id AS organization_id, o.name AS organization_name, o.phone AS organization_phone
     FROM customer_profiles cp
     LEFT JOIN customer_service_locations csl ON csl.customer_id = cp.id AND csl.is_primary = true
     LEFT JOIN customer_service_relationships csr ON csr.service_location_id=csl.id
       AND csr.customer_id=cp.id AND csr.status IN ('active','suspended')
     LEFT JOIN waste_zones wz ON wz.id = csl.zone_id AND wz.organization_id=csr.organization_id
     LEFT JOIN organizations o ON o.id = csr.organization_id
     WHERE cp.user_id = $1::uuid`, [userId]);
    const profile = profileResult.rows[0];
    if (!profile)
        return null;
    const schedulesResult = await database_1.dbPool.query(`SELECT id, name, frequency, preferred_time
     FROM pickup_schedules WHERE zone_id = $1::uuid AND organization_id=$2::uuid AND is_active = true
     ORDER BY name`, [profile.zone_id, profile.organization_id]);
    const historyResult = await database_1.dbPool.query(`SELECT cs.id,cs.scheduled_date job_date,cs.status,cj.waste_type,cs.completed_at,
       cs.evidence_url,cs.completion_notes
     FROM customer_collection_stops cs JOIN collection_jobs cj ON cj.id=cs.collection_job_id
     WHERE cs.customer_id=$1::uuid AND cs.organization_id=$2::uuid AND cs.scheduled_date<=CURRENT_DATE
     ORDER BY cs.scheduled_date DESC,cs.created_at DESC LIMIT 12`, [profile.id, profile.organization_id]);
    const upcomingResult = await database_1.dbPool.query(`SELECT cs.id,cs.scheduled_date job_date,cs.status,cj.waste_type
     FROM customer_collection_stops cs JOIN collection_jobs cj ON cj.id=cs.collection_job_id
     WHERE cs.customer_id=$1::uuid AND cs.organization_id=$2::uuid AND cs.scheduled_date>=CURRENT_DATE
       AND cs.status NOT IN ('cancelled','completed','skipped')
     ORDER BY cs.scheduled_date,cs.created_at LIMIT 1`, [profile.id, profile.organization_id]);
    return {
        ...profile,
        schedules: schedulesResult.rows,
        upcoming_collection: upcomingResult.rows[0] ?? null,
        collection_history: historyResult.rows,
    };
}
async function findCustomers(organizationId) {
    const result = await database_1.dbPool.query(`SELECT cp.id, u.full_name, u.email, u.phone, cp.customer_type, cp.service_status,
       csl.address, wz.name AS zone_name, o.name AS organization_name,
       csr.id relationship_id,csr.status relationship_status,csr.effective_from relationship_started_on,
       u.status account_status,o.is_active provider_active,
       COALESCE(wz.is_active AND wz.boundary IS NOT NULL AND ST_Covers(wz.boundary,csl.location::geometry),false) coverage_confirmed,
       EXISTS(SELECT 1 FROM customer_contracts c JOIN customer_subscriptions s ON s.id=c.subscription_id
         JOIN service_plans p ON p.id=c.plan_id AND p.id=s.plan_id AND p.organization_id=c.organization_id
         WHERE c.customer_id=cp.id AND c.organization_id=csr.organization_id AND c.status IN ('active','expiring')
         AND c.starts_on<=CURRENT_DATE AND c.ends_on>=CURRENT_DATE
         AND s.customer_id=cp.id AND s.service_location_id=csl.id AND s.organization_id=c.organization_id
         AND s.status='active' AND s.starts_on<=CURRENT_DATE AND p.is_active
         AND (p.customer_type IS NULL OR p.customer_type=cp.customer_type)) agreement_confirmed
     FROM customer_profiles cp
     JOIN users u ON u.id = cp.user_id
     JOIN customer_service_locations csl ON csl.customer_id = cp.id AND csl.is_primary = true
     JOIN customer_service_relationships csr ON csr.service_location_id=csl.id AND csr.customer_id=cp.id
       AND csr.status IN ('active','suspended')
     LEFT JOIN waste_zones wz ON wz.id = csl.zone_id AND wz.organization_id=csr.organization_id
     JOIN organizations o ON o.id = csr.organization_id
     WHERE csr.organization_id = $1::uuid
     ORDER BY u.full_name`, [organizationId]);
    return result.rows.map(row => {
        const planning_reasons = [];
        if (row.account_status !== 'active')
            planning_reasons.push('Customer account is not active');
        if (row.service_status !== 'active')
            planning_reasons.push('Customer service is not active');
        if (!row.provider_active)
            planning_reasons.push('Provider is not active');
        if (!row.coverage_confirmed)
            planning_reasons.push('Provider coverage needs review');
        if (!row.agreement_confirmed)
            planning_reasons.push('Current matching contract and subscription required');
        return { ...row, planning_ready: planning_reasons.length === 0, planning_reasons };
    });
}
async function updateCustomerServiceStatus(customerId, organizationId, status) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`UPDATE customer_profiles cp SET service_status = $3, updated_at = CURRENT_TIMESTAMP
     WHERE cp.id = $1::uuid
       AND EXISTS (
         SELECT 1 FROM customer_service_relationships csr
         WHERE csr.customer_id=cp.id AND csr.organization_id=$2::uuid
           AND csr.status IN ('active','suspended')
       )
     RETURNING cp.id, cp.customer_type, cp.service_status, cp.updated_at`, [customerId, organizationId, status]);
        if (!result.rows[0]) {
            await client.query('ROLLBACK');
            return null;
        }
        await client.query(`UPDATE customer_service_relationships SET status=$3,updated_at=CURRENT_TIMESTAMP
      WHERE customer_id=$1::uuid AND organization_id=$2::uuid AND status IN ('active','suspended')`, [customerId, organizationId, status === 'active' ? 'active' : 'suspended']);
        await client.query('COMMIT');
        return result.rows[0];
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
