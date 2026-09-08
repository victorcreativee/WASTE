"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findDriverRoutes = findDriverRoutes;
exports.findDriverRouteDetails = findDriverRouteDetails;
exports.startDriverRoute = startDriverRoute;
exports.arriveAtRouteStop = arriveAtRouteStop;
exports.completeRouteStop = completeRouteStop;
const database_1 = require("../config/database");
async function findDriverRoutes(driverId, organizationId, userId) {
    const result = await database_1.dbPool.query(`SELECT cr.id, cr.name, cr.route_date, cr.status, cr.total_distance_km,
       cr.estimated_duration_minutes, cr.started_at, cr.completed_at,
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
    return { ...route.rows[0], stops: stops.rows };
}
async function startDriverRoute(routeId, userId) {
    const result = await database_1.dbPool.query(`UPDATE collection_routes cr SET status = 'in_progress',
       started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
     FROM drivers d WHERE cr.id = $1::uuid AND d.id = cr.driver_id AND d.user_id = $2::uuid
       AND cr.status IN ('planned', 'dispatched') RETURNING cr.id`, [routeId, userId]);
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
