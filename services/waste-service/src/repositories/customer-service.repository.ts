import { Page, queryPage } from "../utils/pagination";
import { dbPool } from "../config/database";

export async function upsertCustomerService(
  userId: string,
  input: { customerType: string; label: string; address: string; latitude: number; longitude: number }
) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const customerResult = await client.query(
      `INSERT INTO customer_profiles (user_id, customer_type)
       VALUES ($1::uuid, $2)
       ON CONFLICT (user_id) DO UPDATE SET customer_type = EXCLUDED.customer_type,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, input.customerType]
    );
    const customer = customerResult.rows[0];
    // Provider responsibility is not inferred from an address edit.
    const existing=await client.query(`SELECT csr.organization_id
      FROM customer_service_locations csl
      LEFT JOIN customer_service_relationships csr ON csr.service_location_id=csl.id AND csr.status IN ('active','suspended')
      WHERE csl.customer_id=$1::uuid AND csl.is_primary=true FOR UPDATE OF csl`,[customer.id]);
    const owner=existing.rows[0]?.organization_id??null;
    const zoneResult=await client.query(`SELECT id,organization_id FROM waste_zones
      WHERE is_active AND organization_id=$3::uuid AND boundary IS NOT NULL
        AND ST_Covers(boundary,ST_SetSRID(ST_Point($1,$2),4326))
      ORDER BY id LIMIT 1`,[input.longitude,input.latitude,owner]);
    const zone = zoneResult.rows[0] ?? null;
    const locationResult = await client.query(
      `INSERT INTO customer_service_locations (
         customer_id, zone_id, organization_id, label, address, location, is_primary
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5,
         ST_SetSRID(ST_Point($6, $7), 4326)::geography, true)
       ON CONFLICT (customer_id) WHERE is_primary = true DO UPDATE SET
         -- Outside the provider's drawn zones the assigned zone stays until the provider reviews it.
         zone_id = COALESCE(EXCLUDED.zone_id, customer_service_locations.zone_id),
         label = EXCLUDED.label, address = EXCLUDED.address, location = EXCLUDED.location, location_precise = true,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [customer.id, zone?.id ?? null, owner, input.label,
       input.address, input.longitude, input.latitude]
    );
    await client.query("COMMIT");
    return { customer, location: locationResult.rows[0], coverageReviewRequired:!zone, providerAssignmentRequired:!owner };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function findCustomerServiceOverview(userId: string) {
  const profileResult = await dbPool.query(
    `SELECT cp.id, cp.customer_number, cp.customer_type, cp.service_status,
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
     WHERE cp.user_id = $1::uuid`,
    [userId]
  );
  const profile = profileResult.rows[0];
  if (!profile) return null;

  const schedulesResult = await dbPool.query(
    `SELECT id, name, frequency, preferred_time
     FROM pickup_schedules WHERE zone_id = $1::uuid AND organization_id=$2::uuid AND is_active = true
     ORDER BY name`,
    [profile.zone_id,profile.organization_id]
  );
  const historyResult = await dbPool.query(
    `SELECT cs.id,cs.scheduled_date job_date,cs.status,cj.waste_type,cs.completed_at,
       cs.evidence_url,cs.completion_notes
     FROM customer_collection_stops cs JOIN collection_jobs cj ON cj.id=cs.collection_job_id
     WHERE cs.customer_id=$1::uuid AND cs.organization_id=$2::uuid AND cs.scheduled_date<=CURRENT_DATE
     ORDER BY cs.scheduled_date DESC,cs.created_at DESC LIMIT 12`,
    [profile.id,profile.organization_id]
  );
  const upcomingResult = await dbPool.query(
    `SELECT cs.id,cs.scheduled_date job_date,cs.status,cj.waste_type
     FROM customer_collection_stops cs JOIN collection_jobs cj ON cj.id=cs.collection_job_id
     WHERE cs.customer_id=$1::uuid AND cs.organization_id=$2::uuid AND cs.scheduled_date>=CURRENT_DATE
       AND cs.status NOT IN ('cancelled','completed','skipped')
     ORDER BY cs.scheduled_date,cs.created_at LIMIT 1`,
    [profile.id,profile.organization_id]
  );
  return {
    ...profile,
    schedules: schedulesResult.rows,
    upcoming_collection: upcomingResult.rows[0] ?? null,
    collection_history: historyResult.rows,
  };
}

export async function findCustomers(organizationId: string | null, page?: Page) {
  const result = await queryPage<any>(
    `SELECT cp.id, cp.customer_number, u.full_name, u.email, u.phone, cp.customer_type, cp.service_status,
       csl.address, wz.name AS zone_name, o.name AS organization_name,
       csr.id relationship_id,csr.status relationship_status,csr.effective_from relationship_started_on,
       u.status account_status,o.is_active provider_active,
       -- A zone without a drawn boundary is confirmed by the company assigning it; a drawn one must contain the address.
       COALESCE(wz.is_active AND (wz.boundary IS NULL OR ST_Covers(wz.boundary,csl.location::geometry)),false) coverage_confirmed,
       csl.location_precise,
       EXISTS(SELECT 1 FROM customer_contracts c JOIN customer_subscriptions s ON s.id=c.subscription_id
         JOIN service_plans p ON p.id=c.plan_id AND p.id=s.plan_id AND p.organization_id=c.organization_id
         WHERE c.customer_id=cp.id AND c.organization_id=csr.organization_id AND c.status IN ('active','expiring')
         AND c.starts_on<=CURRENT_DATE AND c.ends_on>=CURRENT_DATE
         AND s.customer_id=cp.id AND s.service_location_id=csl.id AND s.organization_id=c.organization_id
         AND s.status='active' AND s.starts_on<=CURRENT_DATE AND p.is_active
         AND (p.customer_type IS NULL OR p.customer_type=cp.customer_type)) agreement_confirmed,
       (SELECT c.status FROM customer_contracts c WHERE c.customer_id=cp.id AND c.organization_id=csr.organization_id
         ORDER BY (c.status IN ('active','expiring')) DESC,c.created_at DESC LIMIT 1) latest_contract_status
     FROM customer_profiles cp
     JOIN users u ON u.id = cp.user_id
     JOIN customer_service_locations csl ON csl.customer_id = cp.id AND csl.is_primary = true
     JOIN customer_service_relationships csr ON csr.service_location_id=csl.id AND csr.customer_id=cp.id
       AND csr.status IN ('active','suspended')
     LEFT JOIN waste_zones wz ON wz.id = csl.zone_id AND wz.organization_id=csr.organization_id
     JOIN organizations o ON o.id = csr.organization_id
     WHERE csr.organization_id = $1::uuid
     ORDER BY u.full_name, cp.id`,
    [organizationId],
    page
  );
  const rows = result.rows.map(row=>{
    const planning_reasons:string[]=[];
    if(row.account_status!=='active')planning_reasons.push('Customer account is not active');
    if(row.service_status!=='active')planning_reasons.push('Customer service is not active');
    if(!row.provider_active)planning_reasons.push('Provider is not active');
    if(!row.coverage_confirmed)planning_reasons.push('Provider coverage needs review');
    if(!row.location_precise)planning_reasons.push('Exact location not recorded: ask the customer to share it from their page');
    if(!row.agreement_confirmed)planning_reasons.push('Current matching contract and subscription required');
    return {...row,planning_ready:planning_reasons.length===0,planning_reasons};
  });
  return { rows, total: result.total };
}

export async function updateCustomerServiceStatus(
  customerId: string, organizationId: string, status: "active" | "suspended" | "inactive", actorId:string
) {
  const client=await dbPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
    `UPDATE customer_profiles cp SET service_status = $3, updated_at = CURRENT_TIMESTAMP
     WHERE cp.id = $1::uuid
       AND EXISTS (
         SELECT 1 FROM customer_service_relationships csr
         WHERE csr.customer_id=cp.id AND csr.organization_id=$2::uuid
           AND csr.status IN ('active','suspended')
       )
     RETURNING cp.id, cp.customer_type, cp.service_status, cp.updated_at`,
    [customerId, organizationId, status]
  );
    if(!result.rows[0]){await client.query('ROLLBACK');return null;}
    await client.query(`UPDATE customer_service_relationships SET status=$3,updated_at=CURRENT_TIMESTAMP
      WHERE customer_id=$1::uuid AND organization_id=$2::uuid AND status IN ('active','suspended')`,
      [customerId,organizationId,status==='active'?'active':'suspended']);
    if(status!=='active'){
      const subscriptionStatus=status==='inactive'?'cancelled':'suspended';
      const contractStatus=status==='inactive'?'cancelled':'suspended';
      await client.query(`UPDATE customer_subscriptions SET status=$3,updated_at=CURRENT_TIMESTAMP
        WHERE customer_id=$1::uuid AND organization_id=$2::uuid AND status IN ('pending','active','suspended')`,[customerId,organizationId,subscriptionStatus]);
      await client.query(`UPDATE customer_contracts SET status=$3,updated_at=CURRENT_TIMESTAMP
        WHERE customer_id=$1::uuid AND organization_id=$2::uuid AND status IN ('draft','active','expiring','suspended')`,[customerId,organizationId,contractStatus]);
    }
    await client.query(`INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,new_value)
      VALUES($1::uuid,$2::uuid,'service_status_changed','customer',$3::uuid,$4::jsonb)`,[organizationId,actorId,customerId,JSON.stringify({service_status:status})]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch(error) { await client.query('ROLLBACK');throw error; }
  finally { client.release(); }
}
