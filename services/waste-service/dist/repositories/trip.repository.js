"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findOperationalSupervisors = findOperationalSupervisors;
exports.findTrips = findTrips;
exports.verifyTripWeight = verifyTripWeight;
exports.createTrip = createTrip;
const database_1 = require("../config/database");
async function findOperationalSupervisors(organizationId) {
    const result = await database_1.dbPool.query(`SELECT u.id,u.full_name,u.status,m.status membership_status,ARRAY['supervisor']::text[] roles
  FROM users u JOIN organization_memberships m ON m.user_id=u.id AND m.organization_id=u.organization_id
  WHERE u.organization_id=$1::uuid AND u.status='active' AND m.status='active'
    AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='supervisor')
  ORDER BY u.full_name`, [organizationId]);
    return result.rows;
}
async function findTrips(organizationId) {
    const result = await database_1.dbPool.query(`SELECT trip.id,trip.organization_id,trip.service_route_id,trip.trip_number,trip.truck_id,trip.driver_id,trip.route_date,trip.status,trip.started_at,trip.completed_at,trip.weighbridge_ticket_number,trip.weighbridge_facility,trip.verified_weight_kg,trip.weight_verified_at,
  service.name route_name,zone.name zone_name,division.name division_name,organization.name organization_name,
  truck.plate_number,driver.full_name driver_name,supervisor.full_name supervisor_name,
  COUNT(stops.id)::int customer_count,COUNT(stops.id) FILTER(WHERE stops.status='completed')::int collected_count,
  COUNT(stops.id) FILTER(WHERE stops.status='skipped')::int not_collected_count
  FROM collection_routes trip JOIN organizations organization ON organization.id=trip.organization_id
  LEFT JOIN service_routes service ON service.id=trip.service_route_id LEFT JOIN waste_zones zone ON zone.id=service.zone_id
  LEFT JOIN kampala_divisions division ON division.id=service.division_id LEFT JOIN waste_trucks truck ON truck.id=trip.truck_id
  LEFT JOIN drivers driver ON driver.id=trip.driver_id LEFT JOIN users supervisor ON supervisor.id=trip.supervisor_user_id
  LEFT JOIN collection_route_jobs link ON link.route_id=trip.id LEFT JOIN customer_collection_stops stops ON stops.collection_job_id=link.job_id
  WHERE ($1::uuid IS NULL OR trip.organization_id=$1::uuid) AND trip.service_route_id IS NOT NULL
  GROUP BY trip.id,service.name,zone.name,division.name,organization.name,truck.plate_number,driver.full_name,supervisor.full_name
  ORDER BY trip.route_date DESC,CASE trip.status WHEN 'in_progress' THEN 1 WHEN 'dispatched' THEN 2 WHEN 'planned' THEN 3 ELSE 4 END,trip.created_at DESC`, [organizationId]);
    return result.rows;
}
async function verifyTripWeight(tripId, organizationId, userId, input) { const result = await database_1.dbPool.query(`UPDATE collection_routes SET weighbridge_ticket_number=$4,weighbridge_facility=$5,verified_weight_kg=$6::numeric,weight_verified_at=CURRENT_TIMESTAMP,weight_verified_by=$3::uuid,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid AND status='completed' RETURNING *`, [tripId, organizationId, userId, input.ticketNumber, input.facility, input.verifiedWeightKg]); if (!result.rows[0])
    throw Object.assign(new Error("Only a completed trip in your organization can be verified"), { statusCode: 400 }); return result.rows[0]; }
async function createTrip(organizationId, userId, input) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        const ready = await client.query(`SELECT route.id,route.name,route.zone_id,route.division_id FROM service_routes route
  WHERE route.id=$1::uuid AND route.organization_id=$2::uuid AND route.is_active
    AND EXTRACT(ISODOW FROM $3::date)::smallint=ANY(route.operating_days) FOR UPDATE`, [input.serviceRouteId, organizationId, input.tripDate]);
        if (!ready.rows[0])
            throw Object.assign(new Error("Choose an active route scheduled to operate on the selected date"), { statusCode: 400 });
        const service = ready.rows[0];
        const resources = await client.query(`SELECT
  EXISTS(SELECT 1 FROM waste_trucks WHERE id=$1::uuid AND organization_id=$4::uuid AND status='available') truck_ready,
  EXISTS(SELECT 1 FROM drivers WHERE id=$2::uuid AND organization_id=$4::uuid AND status='available') driver_ready,
  EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
    WHERE u.id=$3::uuid AND u.organization_id=$4::uuid AND u.status='active' AND r.name='supervisor') supervisor_ready`, [input.truckId, input.driverId, input.supervisorUserId, organizationId]);
        if (!resources.rows[0].truck_ready)
            throw Object.assign(new Error("Choose an available vehicle from your fleet"), { statusCode: 400 });
        if (!resources.rows[0].driver_ready)
            throw Object.assign(new Error("Choose an available driver"), { statusCode: 400 });
        if (!resources.rows[0].supervisor_ready)
            throw Object.assign(new Error("Choose an active supervisor from your organization"), { statusCode: 400 });
        const eligible = await client.query(`SELECT assignment.service_location_id,location.customer_id,relationship.id relationship_id,
   contract.id contract_id,subscription.id subscription_id,assignment.stop_order
  FROM service_route_customers assignment JOIN customer_service_locations location ON location.id=assignment.service_location_id
  JOIN customer_profiles customer ON customer.id=location.customer_id AND customer.service_status='active'
  JOIN customer_service_relationships relationship ON relationship.service_location_id=location.id AND relationship.organization_id=$2::uuid AND relationship.status='active'
  JOIN LATERAL(SELECT c.id,c.subscription_id FROM customer_contracts c WHERE c.customer_id=location.customer_id AND c.organization_id=$2::uuid
    AND c.status IN('active','expiring') AND c.starts_on<=$3::date AND c.ends_on>=$3::date ORDER BY c.created_at DESC LIMIT 1) contract ON true
  JOIN customer_subscriptions subscription ON subscription.id=contract.subscription_id AND subscription.status='active'
  WHERE assignment.service_route_id=$1::uuid AND assignment.organization_id=$2::uuid AND assignment.is_active ORDER BY assignment.stop_order`, [input.serviceRouteId, organizationId, input.tripDate]);
        if (!eligible.rowCount)
            throw Object.assign(new Error("This route has no active customers with valid contracts. Assign customers in Service Areas first."), { statusCode: 400 });
        const job = (await client.query(`INSERT INTO collection_jobs(organization_id,zone_id,truck_id,driver_id,job_date,status,waste_type,notes)
  VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::date,'assigned','mixed','Created automatically from service route') RETURNING id`, [organizationId, service.zone_id, input.truckId, input.driverId, input.tripDate])).rows[0];
        const number = `TRIP-${input.tripDate.replaceAll("-", "")}-${Date.now().toString().slice(-6)}`;
        const trip = (await client.query(`INSERT INTO collection_routes(organization_id,service_route_id,name,trip_number,truck_id,driver_id,supervisor_user_id,route_date,status,created_by)
  VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8::date,'planned',$9::uuid) RETURNING *`, [organizationId, input.serviceRouteId, service.name, number, input.truckId, input.driverId, input.supervisorUserId, input.tripDate, userId])).rows[0];
        await client.query(`INSERT INTO collection_route_jobs(route_id,job_id,stop_order) VALUES($1::uuid,$2::uuid,1)`, [trip.id, job.id]);
        for (const stop of eligible.rows)
            await client.query(`INSERT INTO customer_collection_stops(organization_id,collection_job_id,relationship_id,customer_id,service_location_id,contract_id,subscription_id,scheduled_date,stop_order)
  VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::date,$9)`, [organizationId, job.id, stop.relationship_id, stop.customer_id, stop.service_location_id, stop.contract_id, stop.subscription_id, input.tripDate, stop.stop_order]);
        await client.query("COMMIT");
        return { ...trip, customer_count: eligible.rowCount };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
