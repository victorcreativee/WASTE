"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchCollectionRoute = dispatchCollectionRoute;
exports.cancelCollectionRoute = cancelCollectionRoute;
exports.findDriverRoutes = findDriverRoutes;
exports.findDriverRouteDetails = findDriverRouteDetails;
exports.startDriverRoute = startDriverRoute;
exports.arriveAtRouteStop = arriveAtRouteStop;
exports.completeRouteStop = completeRouteStop;
const database_1 = require("../config/database");
async function dispatchCollectionRoute(routeId, organizationId) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        const lockedRoute = await client.query("SELECT id FROM collection_routes WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE", [routeId, organizationId]);
        if (!lockedRoute.rows[0])
            throw Object.assign(new Error("Route not found in your organization"), { statusCode: 404 });
        const routeResult = await client.query(`SELECT cr.id, cr.truck_id, cr.driver_id, cr.route_date::text AS route_date,
         cr.route_date < CURRENT_DATE AS route_in_past,
         cr.status, wt.status AS truck_status, d.status AS driver_status,
         EXISTS (SELECT 1 FROM truck_documents td
           WHERE td.truck_id = cr.truck_id AND td.expires_on < cr.route_date) AS has_expired_document,
         COUNT(crj.id)::int AS job_count,
         COUNT(crj.id) FILTER (WHERE cj.status NOT IN ('pending','assigned')
           OR cj.job_date <> cr.route_date
           OR cj.truck_id IS DISTINCT FROM cr.truck_id
           OR cj.driver_id IS DISTINCT FROM cr.driver_id)::int AS invalid_job_count
       FROM collection_routes cr
       JOIN waste_trucks wt ON wt.id = cr.truck_id
       JOIN drivers d ON d.id = cr.driver_id
       LEFT JOIN collection_route_jobs crj ON crj.route_id = cr.id
       LEFT JOIN collection_jobs cj ON cj.id = crj.job_id
       WHERE cr.id = $1::uuid AND cr.organization_id = $2::uuid
       GROUP BY cr.id, wt.status, d.status`, [routeId, organizationId]);
        const route = routeResult.rows[0];
        if (!route)
            throw Object.assign(new Error("The route driver or vehicle is no longer available"), { statusCode: 409 });
        if (route.status !== "planned")
            throw Object.assign(new Error("Only a planned route can be dispatched"), { statusCode: 409 });
        if (route.route_in_past)
            throw Object.assign(new Error("A route scheduled in the past cannot be dispatched"), { statusCode: 409 });
        if (!route.job_count)
            throw Object.assign(new Error("Add at least one collection job before dispatch"), { statusCode: 409 });
        if (route.invalid_job_count)
            throw Object.assign(new Error("Every route job must match the route date, driver and vehicle before dispatch"), { statusCode: 409 });
        if (!["available", "assigned"].includes(route.truck_status) || route.has_expired_document)
            throw Object.assign(new Error("The route vehicle is not ready or has expired compliance documents"), { statusCode: 409 });
        if (!["available", "assigned"].includes(route.driver_status))
            throw Object.assign(new Error("The route driver is not available for dispatch"), { statusCode: 409 });
        await client.query("UPDATE collection_routes SET status='dispatched',updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid", [routeId]);
        await client.query("UPDATE waste_trucks SET status='assigned',updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid", [route.truck_id]);
        await client.query("UPDATE drivers SET status='assigned',updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid", [route.driver_id]);
        await client.query("COMMIT");
        return { id: routeId, status: "dispatched" };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
async function cancelCollectionRoute(routeId, organizationId, userId, input) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        const routeResult = await client.query(`SELECT id,truck_id,driver_id,status FROM collection_routes
       WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`, [routeId, organizationId]);
        const route = routeResult.rows[0];
        if (!route)
            throw Object.assign(new Error("Route not found in your organization"), { statusCode: 404 });
        if (!["planned", "dispatched", "in_progress"].includes(route.status))
            throw Object.assign(new Error("Only an open route can be cancelled"), { statusCode: 409 });
        await client.query(`INSERT INTO collection_route_status_history(route_id,organization_id,previous_status,new_status,reason,notes,changed_by)
       VALUES($1,$2,$3,'cancelled',$4,$5,$6)`, [routeId, organizationId, route.status, input.reason, input.notes, userId]);
        await client.query(`UPDATE collection_routes SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,
       cancelled_by=$2::uuid,cancellation_reason=$3,cancellation_notes=$4,updated_at=CURRENT_TIMESTAMP
       WHERE id=$1::uuid`, [routeId, userId, input.reason, input.notes]);
        await client.query(`UPDATE collection_route_jobs SET status='cancelled'
       WHERE route_id=$1::uuid AND status NOT IN ('completed','skipped')`, [routeId]);
        const returnedJobs = await client.query(`UPDATE collection_jobs cj SET status='pending',truck_id=NULL,driver_id=NULL,
       started_at=NULL,updated_at=CURRENT_TIMESTAMP
       FROM collection_route_jobs crj
       WHERE crj.route_id=$1::uuid AND crj.job_id=cj.id
         AND cj.status NOT IN ('completed','cancelled') RETURNING cj.id`, [routeId]);
        if (returnedJobs.rows.length) {
            await client.query(`UPDATE customer_collection_stops SET status='pending',arrived_at=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE collection_job_id=ANY($1::uuid[]) AND status IN ('pending','arrived')`, [returnedJobs.rows.map((job) => job.id)]);
        }
        await client.query(`UPDATE waste_trucks SET status='available',updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid
       AND NOT EXISTS(SELECT 1 FROM collection_routes WHERE truck_id=$1::uuid AND status IN ('dispatched','in_progress'))
       AND NOT EXISTS(SELECT 1 FROM collection_jobs WHERE truck_id=$1::uuid AND status IN ('assigned','in_progress'))`, [route.truck_id]);
        await client.query(`UPDATE drivers SET status='available',updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid
       AND NOT EXISTS(SELECT 1 FROM collection_routes WHERE driver_id=$1::uuid AND status IN ('dispatched','in_progress'))
       AND NOT EXISTS(SELECT 1 FROM collection_jobs WHERE driver_id=$1::uuid AND status IN ('assigned','in_progress'))`, [route.driver_id]);
        await client.query("COMMIT");
        return { id: routeId, status: "cancelled", returned_job_count: returnedJobs.rowCount ?? 0 };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
async function findDriverRoutes(driverId, organizationId, userId) {
    const result = await database_1.dbPool.query(`SELECT cr.id, cr.name, cr.route_date, cr.status, cr.total_distance_km,
       cr.estimated_duration_minutes, cr.started_at, cr.completed_at,cr.cancelled_at,
       cr.cancellation_reason,cr.cancellation_notes,
       wt.plate_number, wt.truck_name, d.full_name AS driver_name,
       COUNT(crj.id)::int AS stop_count,
       COUNT(crj.id) FILTER (WHERE crj.status = 'completed')::int AS completed_stop_count
     FROM collection_routes cr
     JOIN drivers d ON d.id = cr.driver_id
     LEFT JOIN waste_trucks wt ON wt.id = cr.truck_id
     LEFT JOIN collection_route_jobs crj ON crj.route_id = cr.id
     WHERE ($1::uuid IS NULL OR cr.organization_id = $1::uuid)
       AND ($2::uuid IS NULL OR d.user_id = $2::uuid)
       AND ($2::uuid IS NOT NULL OR cr.driver_id = NULLIF($3, '')::uuid)
       AND cr.status IN ('planned', 'dispatched', 'in_progress')
     GROUP BY cr.id, wt.plate_number, wt.truck_name, d.full_name
     ORDER BY cr.route_date, cr.created_at`, [organizationId, userId, driverId]);
    return result.rows;
}
async function findDriverRouteDetails(routeId, organizationId, userId) {
    const route = await database_1.dbPool.query(`SELECT cr.id, cr.name, cr.route_date, cr.status, cr.total_distance_km,
       cr.estimated_duration_minutes, cr.started_at, cr.completed_at,
       CASE WHEN cr.route_geometry IS NULL THEN NULL ELSE ST_AsGeoJSON(cr.route_geometry)::json END AS route_geometry,
       wt.plate_number, wt.truck_name, d.full_name AS driver_name
     FROM collection_routes cr JOIN drivers d ON d.id = cr.driver_id
     LEFT JOIN waste_trucks wt ON wt.id = cr.truck_id
     WHERE cr.id = $1::uuid AND ($2::uuid IS NULL OR cr.organization_id = $2::uuid)
       AND ($3::uuid IS NULL OR d.user_id = $3::uuid)`, [routeId, organizationId, userId]);
    if (!route.rows[0])
        return null;
    const stops = await database_1.dbPool.query(`SELECT crj.id, crj.job_id, crj.stop_order, crj.status, crj.arrived_at,
       crj.completed_at, crj.collected_weight_kg, crj.completion_notes, crj.evidence_url,
       wz.name AS zone_name, ST_Y(wz.center_point::geometry) AS latitude,
       ST_X(wz.center_point::geometry) AS longitude, cj.waste_type, cj.estimated_weight_kg
     FROM collection_route_jobs crj JOIN collection_jobs cj ON cj.id = crj.job_id
     LEFT JOIN waste_zones wz ON wz.id = cj.zone_id
     WHERE crj.route_id = $1::uuid ORDER BY crj.stop_order`, [routeId]);
    const household = stops.rows.length ? await database_1.dbPool.query(`SELECT cs.id,cs.collection_job_id,cs.status,cs.stop_order,cs.arrived_at,cs.completed_at,
       cs.collected_weight_kg,cs.completion_notes,cs.evidence_url,cs.exception_reason,cs.exception_notes,
       cs.exception_review_status,u.full_name customer_name,l.address
     FROM customer_collection_stops cs JOIN customer_profiles cp ON cp.id=cs.customer_id
     JOIN users u ON u.id=cp.user_id JOIN customer_service_locations l ON l.id=cs.service_location_id
     WHERE cs.collection_job_id=ANY($1::uuid[]) ORDER BY cs.collection_job_id,cs.stop_order`, [stops.rows.map(stop => stop.job_id)]) : { rows: [] };
    const history = await database_1.dbPool.query(`SELECT h.id,h.previous_status,h.new_status,h.reason,h.notes,h.created_at,
       u.full_name AS changed_by_name
     FROM collection_route_status_history h LEFT JOIN users u ON u.id=h.changed_by
     WHERE h.route_id=$1::uuid ORDER BY h.created_at DESC`, [routeId]);
    return { ...route.rows[0], history: history.rows, stops: stops.rows.map(stop => ({
            ...stop, customer_stops: household.rows.filter(item => item.collection_job_id === stop.job_id)
        })) };
}
async function startDriverRoute(routeId, userId) {
    const result = await database_1.dbPool.query(`UPDATE collection_routes cr SET status = 'in_progress',
       started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
     FROM drivers d WHERE cr.id = $1::uuid AND d.id = cr.driver_id AND d.user_id = $2::uuid
       AND cr.status = 'dispatched' RETURNING cr.id`, [routeId, userId]);
    return result.rows[0] ?? null;
}
async function arriveAtRouteStop(stopId, userId) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(`UPDATE collection_route_jobs crj SET status = 'arrived', arrived_at = COALESCE(arrived_at, CURRENT_TIMESTAMP)
       FROM collection_routes cr, drivers d
       WHERE crj.id = $1::uuid AND cr.id = crj.route_id AND d.id = cr.driver_id
         AND d.user_id = $2::uuid AND cr.status = 'in_progress' AND crj.status = 'pending'
         AND NOT EXISTS (SELECT 1 FROM collection_route_jobs previous
           WHERE previous.route_id = crj.route_id AND previous.stop_order < crj.stop_order
             AND previous.status NOT IN ('completed', 'skipped'))
       RETURNING crj.id, crj.job_id`, [stopId, userId]);
        const stop = result.rows[0];
        if (!stop) {
            await client.query("ROLLBACK");
            return null;
        }
        await client.query(`UPDATE collection_jobs SET status = 'in_progress', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid AND status IN ('assigned', 'pending')`, [stop.job_id]);
        await client.query("COMMIT");
        return stop;
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
async function completeRouteStop(stopId, userId, input) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(`UPDATE collection_route_jobs crj SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
         collected_weight_kg = $3, completion_notes = $4, evidence_url = $5
       FROM collection_routes cr, drivers d
       WHERE crj.id = $1::uuid AND cr.id = crj.route_id AND d.id = cr.driver_id
         AND d.user_id = $2::uuid AND cr.status = 'in_progress' AND crj.status = 'arrived'
         AND NOT EXISTS (SELECT 1 FROM customer_collection_stops cs WHERE cs.collection_job_id=crj.job_id
           AND cs.status NOT IN ('completed','skipped','cancelled'))
       RETURNING crj.id, crj.job_id, crj.route_id`, [stopId, userId, input.collectedWeightKg ?? null, input.completionNotes ?? null, input.evidenceUrl ?? null]);
        const stop = result.rows[0];
        if (!stop) {
            await client.query("ROLLBACK");
            return null;
        }
        await client.query(`UPDATE collection_jobs SET status = 'completed', collected_weight_kg = COALESCE($2, collected_weight_kg),
       completed_at = CURRENT_TIMESTAMP, notes = COALESCE($3, notes), updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid`, [stop.job_id, input.collectedWeightKg ?? null, input.completionNotes ?? null]);
        const pending = await client.query(`SELECT COUNT(*)::int AS count FROM collection_route_jobs
       WHERE route_id = $1::uuid AND status NOT IN ('completed', 'skipped')`, [stop.route_id]);
        const routeCompleted = pending.rows[0].count === 0;
        if (routeCompleted) {
            await client.query(`UPDATE collection_routes SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`, [stop.route_id]);
            await client.query(`UPDATE waste_trucks wt SET status='available',updated_at=CURRENT_TIMESTAMP
         FROM collection_routes completed
         WHERE completed.id=$1::uuid AND wt.id=completed.truck_id
           AND NOT EXISTS (SELECT 1 FROM collection_routes active
             WHERE active.truck_id=wt.id AND active.id<>completed.id
               AND active.status IN ('dispatched','in_progress'))
           AND NOT EXISTS (SELECT 1 FROM collection_jobs work
             WHERE work.truck_id=wt.id AND work.id<>$2::uuid
               AND work.status IN ('assigned','in_progress'))`, [stop.route_id, stop.job_id]);
            await client.query(`UPDATE drivers d SET status='available',updated_at=CURRENT_TIMESTAMP
         FROM collection_routes completed
         WHERE completed.id=$1::uuid AND d.id=completed.driver_id
           AND NOT EXISTS (SELECT 1 FROM collection_routes active
             WHERE active.driver_id=d.id AND active.id<>completed.id
               AND active.status IN ('dispatched','in_progress'))
           AND NOT EXISTS (SELECT 1 FROM collection_jobs work
             WHERE work.driver_id=d.id AND work.id<>$2::uuid
               AND work.status IN ('assigned','in_progress'))`, [stop.route_id, stop.job_id]);
        }
        await client.query("COMMIT");
        return { ...stop, route_completed: routeCompleted };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
