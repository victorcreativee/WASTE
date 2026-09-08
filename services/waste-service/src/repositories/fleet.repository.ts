import { dbPool } from "../config/database";

export async function fleetOverview(organizationId:string|null){
  const params=[organizationId];
  const trucks=await dbPool.query(`SELECT wt.id,wt.organization_id,wt.plate_number,wt.truck_name,wt.capacity_tons,wt.status,
    COALESCE((SELECT SUM(cost_ugx) FROM truck_maintenance_records m WHERE m.truck_id=wt.id AND m.status='completed'),0)::bigint AS maintenance_cost_ugx,
    COALESCE((SELECT SUM(cost_ugx) FROM truck_fuel_records f WHERE f.truck_id=wt.id),0)::bigint AS fuel_cost_ugx,
    (SELECT MIN(scheduled_date) FROM truck_maintenance_records m WHERE m.truck_id=wt.id AND m.status IN ('scheduled','in_progress')) AS next_service_date,
    (SELECT MIN(expires_on) FROM truck_documents d WHERE d.truck_id=wt.id) AS next_document_expiry,
    (SELECT COUNT(*)::int FROM collection_jobs j WHERE j.truck_id=wt.id AND j.status IN ('assigned','in_progress')) AS active_jobs
    FROM waste_trucks wt WHERE ($1::uuid IS NULL OR wt.organization_id=$1::uuid) ORDER BY wt.plate_number`,params);
  const summary=await dbPool.query(`SELECT COUNT(*)::int total,
    COUNT(*) FILTER(WHERE status='available')::int available,COUNT(*) FILTER(WHERE status='assigned')::int assigned,
    COUNT(*) FILTER(WHERE status='maintenance')::int maintenance,COUNT(*) FILTER(WHERE status='inactive')::int inactive
    FROM waste_trucks WHERE ($1::uuid IS NULL OR organization_id=$1::uuid)`,params);
  const costs=await dbPool.query(`SELECT
    COALESCE((SELECT SUM(cost_ugx) FROM truck_maintenance_records WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND scheduled_date>=date_trunc('month',CURRENT_DATE)),0)::bigint maintenance_month,
    COALESCE((SELECT SUM(cost_ugx) FROM truck_fuel_records WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND fuel_date>=date_trunc('month',CURRENT_DATE)),0)::bigint fuel_month,
    (SELECT COUNT(*)::int FROM truck_documents WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE+30) expiring_documents`,params);
  return {summary:{...summary.rows[0],...costs.rows[0]},trucks:trucks.rows};
}

export async function fleetTruckDetail(truckId:string,organizationId:string|null){
  const truck=await dbPool.query(`SELECT id,organization_id,plate_number,truck_name,capacity_tons,status,created_at FROM waste_trucks WHERE id=$1::uuid AND ($2::uuid IS NULL OR organization_id=$2::uuid)`,[truckId,organizationId]);
  if(!truck.rows[0])return null;
  const [maintenance,documents,fuel]=await Promise.all([
    dbPool.query(`SELECT m.*,e.id expense_id,e.expense_number,e.status expense_status FROM truck_maintenance_records m LEFT JOIN organization_expenses e ON e.organization_id=m.organization_id AND e.source_type='fleet_maintenance' AND e.source_id=m.id WHERE m.truck_id=$1::uuid ORDER BY m.scheduled_date DESC,m.created_at DESC`,[truckId]),
    dbPool.query(`SELECT *,CASE WHEN expires_on<CURRENT_DATE THEN 'expired' WHEN expires_on<=CURRENT_DATE+30 THEN 'expiring' ELSE 'valid' END AS compliance_status FROM truck_documents WHERE truck_id=$1::uuid ORDER BY expires_on`,[truckId]),
    dbPool.query(`SELECT f.*,e.id expense_id,e.expense_number,e.status expense_status FROM truck_fuel_records f LEFT JOIN organization_expenses e ON e.organization_id=f.organization_id AND e.source_type='fleet_fuel' AND e.source_id=f.id WHERE f.truck_id=$1::uuid ORDER BY f.fuel_date DESC,f.created_at DESC LIMIT 100`,[truckId]),
  ]);
  return {...truck.rows[0],maintenance:maintenance.rows,documents:documents.rows,fuel:fuel.rows};
}

export async function addMaintenance(truckId:string,orgId:string,userId:string,data:any){
  const r=await dbPool.query(`INSERT INTO truck_maintenance_records(truck_id,organization_id,category,title,description,status,scheduled_date,completed_at,odometer_km,cost_ugx,service_provider,created_by)
    SELECT id,organization_id,$3,$4,$5,$6,$7,CASE WHEN $6='completed' THEN CURRENT_TIMESTAMP END,$8,$9,$10,$11::uuid FROM waste_trucks WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,
    [truckId,orgId,data.category,data.title,data.description??null,data.status,data.scheduledDate,data.odometerKm??null,data.costUgx,data.serviceProvider??null,userId]);
  if(r.rows[0]&&data.status==='in_progress')await dbPool.query(`UPDATE waste_trucks SET status='maintenance',updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[truckId]);
  return r.rows[0]??null;
}
export async function updateMaintenanceStatus(id:string,orgId:string,status:string){
  const client=await dbPool.connect();try{await client.query('BEGIN');const r=await client.query(`UPDATE truck_maintenance_records SET status=$3,completed_at=CASE WHEN $3='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,[id,orgId,status]);
    const row=r.rows[0];if(row&&status==='in_progress')await client.query(`UPDATE waste_trucks SET status='maintenance',updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[row.truck_id]);
    if(row&&status==='completed')await client.query(`UPDATE waste_trucks SET status='available',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM truck_maintenance_records WHERE truck_id=$1 AND status='in_progress')`,[row.truck_id]);
    await client.query('COMMIT');return row??null;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function addTruckDocument(truckId:string,orgId:string,userId:string,data:any){const r=await dbPool.query(`INSERT INTO truck_documents(truck_id,organization_id,document_type,document_number,issued_on,expires_on,file_url,created_by) SELECT id,organization_id,$3,$4,$5,$6,$7,$8::uuid FROM waste_trucks WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,[truckId,orgId,data.documentType,data.documentNumber,data.issuedOn??null,data.expiresOn,data.fileUrl||null,userId]);return r.rows[0]??null;}
export async function addFuelRecord(truckId:string,orgId:string,userId:string,data:any){const r=await dbPool.query(`INSERT INTO truck_fuel_records(truck_id,organization_id,litres,cost_ugx,odometer_km,fuel_date,station,recorded_by) SELECT id,organization_id,$3,$4,$5,$6,$7,$8::uuid FROM waste_trucks WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,[truckId,orgId,data.litres,data.costUgx,data.odometerKm??null,data.fuelDate,data.station??null,userId]);return r.rows[0]??null;}
export async function updateTruckStatus(truckId:string,orgId:string,status:string){const r=await dbPool.query(`UPDATE waste_trucks SET status=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,[truckId,orgId,status]);return r.rows[0]??null;}

export async function liveFleet(organizationId:string|null){const r=await dbPool.query(`SELECT wt.id,wt.organization_id,o.name organization_name,wt.plate_number,wt.truck_name,wt.status,
  ST_Y(wt.current_location::geometry) latitude,ST_X(wt.current_location::geometry) longitude,
  latest.accuracy_m,latest.speed_kph,latest.heading_degrees,latest.recorded_at,
  cr.id route_id,cr.name route_name,cr.status route_status,d.full_name driver_name,
  CASE WHEN latest.recorded_at IS NULL THEN 'never' WHEN latest.recorded_at>=CURRENT_TIMESTAMP-INTERVAL '1 minute' THEN 'current' WHEN latest.recorded_at>=CURRENT_TIMESTAMP-INTERVAL '5 minutes' THEN 'delayed' ELSE 'stale' END signal_status,
  CASE WHEN cr.id IS NOT NULL AND latest.recorded_at>=CURRENT_TIMESTAMP-INTERVAL '5 minutes' AND COALESCE(latest.accuracy_m,101)<=100 AND cr.route_geometry IS NOT NULL AND wt.current_location IS NOT NULL THEN ROUND(ST_Distance(wt.current_location,cr.route_geometry::geography))::int ELSE NULL END distance_from_route_m,
  CASE WHEN cr.id IS NOT NULL AND latest.recorded_at>=CURRENT_TIMESTAMP-INTERVAL '5 minutes' AND COALESCE(latest.accuracy_m,101)<=100 AND cr.route_geometry IS NOT NULL AND wt.current_location IS NOT NULL AND NOT ST_DWithin(wt.current_location,cr.route_geometry::geography,500) THEN true ELSE false END is_off_route,
  CASE WHEN cr.status='in_progress' AND recent.speed_samples>=3 AND recent.moving_samples=0 THEN true ELSE false END is_stopped_too_long,
  CASE
   WHEN cr.status IN ('dispatched','in_progress') AND (latest.recorded_at IS NULL OR latest.recorded_at<CURRENT_TIMESTAMP-INTERVAL '5 minutes') THEN 'signal_missing'
   WHEN cr.id IS NOT NULL AND latest.recorded_at>=CURRENT_TIMESTAMP-INTERVAL '5 minutes' AND COALESCE(latest.accuracy_m,101)<=100 AND cr.route_geometry IS NOT NULL AND wt.current_location IS NOT NULL AND NOT ST_DWithin(wt.current_location,cr.route_geometry::geography,500) THEN 'off_route'
   WHEN cr.status='in_progress' AND recent.speed_samples>=3 AND recent.moving_samples=0 THEN 'stopped_too_long'
   ELSE NULL END alert_code
 FROM waste_trucks wt JOIN organizations o ON o.id=wt.organization_id
 LEFT JOIN LATERAL(SELECT * FROM vehicle_location_events e WHERE e.truck_id=wt.id ORDER BY e.recorded_at DESC LIMIT 1) latest ON true
 LEFT JOIN collection_routes cr ON cr.truck_id=wt.id AND cr.status IN ('dispatched','in_progress')
 LEFT JOIN drivers d ON d.id=cr.driver_id
 LEFT JOIN LATERAL(SELECT COUNT(*) FILTER(WHERE e.speed_kph IS NOT NULL)::int speed_samples,COUNT(*) FILTER(WHERE e.speed_kph>2)::int moving_samples FROM vehicle_location_events e WHERE e.truck_id=wt.id AND e.recorded_at>=CURRENT_TIMESTAMP-INTERVAL '10 minutes') recent ON true
 WHERE ($1::uuid IS NULL OR wt.organization_id=$1::uuid) ORDER BY latest.recorded_at DESC NULLS LAST,wt.plate_number`,[organizationId]);
 const ids=r.rows.filter(row=>row.alert_code).map(row=>row.id);if(!ids.length)return r.rows;
 const reviews=await dbPool.query(`SELECT DISTINCT ON(truck_id,alert_code) truck_id,alert_code,action review_status,outcome review_outcome,notes review_notes,created_at reviewed_at FROM fleet_alert_reviews WHERE truck_id=ANY($1::uuid[]) ORDER BY truck_id,alert_code,created_at DESC`,[ids]);
 const byKey=new Map(reviews.rows.map(review=>[`${review.truck_id}:${review.alert_code}`,review]));return r.rows.map(row=>({...row,...(byKey.get(`${row.id}:${row.alert_code}`)||{})}));}

export async function recordDriverLocation(userId:string,data:any){if(data.recordedAt&&Math.abs(Date.now()-new Date(data.recordedAt).getTime())>300000)throw Object.assign(new Error('Location timestamp must be within five minutes of receipt'),{statusCode:400});const client=await dbPool.connect();try{await client.query('BEGIN');const assigned=await client.query(`SELECT cr.id route_id,cr.organization_id,cr.truck_id,cr.driver_id FROM collection_routes cr JOIN drivers d ON d.id=cr.driver_id WHERE cr.id=$1::uuid AND d.user_id=$2::uuid AND cr.status='in_progress' FOR UPDATE OF cr`,[data.routeId,userId]);const route=assigned.rows[0];if(!route)throw Object.assign(new Error('Live location is accepted only for your active route'),{statusCode:403});const point=await client.query(`INSERT INTO vehicle_location_events(organization_id,truck_id,driver_id,route_id,location,accuracy_m,speed_kph,heading_degrees,recorded_at) VALUES($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326)::geography,$7,$8,$9,COALESCE($10::timestamptz,CURRENT_TIMESTAMP)) RETURNING id,recorded_at`,[route.organization_id,route.truck_id,route.driver_id,route.route_id,data.longitude,data.latitude,data.accuracyM??null,data.speedKph??null,data.headingDegrees??null,data.recordedAt??null]);await client.query(`UPDATE waste_trucks SET current_location=ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[route.truck_id,data.longitude,data.latitude]);await client.query('COMMIT');return point.rows[0];}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}

export async function vehicleLocationHistory(truckId:string,organizationId:string|null,minutes:number){const r=await dbPool.query(`SELECT e.id,e.route_id,ST_Y(e.location::geometry) latitude,ST_X(e.location::geometry) longitude,e.speed_kph,e.heading_degrees,e.accuracy_m,e.recorded_at
 FROM vehicle_location_events e JOIN waste_trucks wt ON wt.id=e.truck_id
 WHERE e.truck_id=$1::uuid AND ($2::uuid IS NULL OR wt.organization_id=$2::uuid)
   AND e.recorded_at>=CURRENT_TIMESTAMP-($3::int*INTERVAL '1 minute')
 ORDER BY e.recorded_at ASC LIMIT 2000`,[truckId,organizationId,minutes]);return r.rows;}

export async function reviewFleetAlert(truckId:string,organizationId:string,userId:string,data:any){
 const owned=await dbPool.query('SELECT 1 FROM waste_trucks WHERE id=$1::uuid AND organization_id=$2::uuid',[truckId,organizationId]);if(!owned.rowCount)throw Object.assign(new Error('Vehicle not found'),{statusCode:404});
 const vehicles=await liveFleet(organizationId);const vehicle=vehicles.find(row=>row.id===truckId&&row.alert_code===data.alertCode);
 if(!vehicle)throw Object.assign(new Error('This warning is no longer active. Refresh Fleet control.'),{statusCode:409});
 const r=await dbPool.query(`INSERT INTO fleet_alert_reviews(organization_id,truck_id,route_id,alert_code,action,outcome,notes,signal_recorded_at,reviewed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[organizationId,truckId,vehicle.route_id,data.alertCode,data.action,data.outcome??null,data.notes??null,vehicle.recorded_at,userId]);return r.rows[0];
}

export async function fleetAlertHistory(truckId:string,organizationId:string|null){const r=await dbPool.query(`SELECT ar.*,u.full_name reviewed_by_name FROM fleet_alert_reviews ar JOIN users u ON u.id=ar.reviewed_by JOIN waste_trucks wt ON wt.id=ar.truck_id WHERE ar.truck_id=$1::uuid AND ($2::uuid IS NULL OR wt.organization_id=$2::uuid) ORDER BY ar.created_at DESC LIMIT 100`,[truckId,organizationId]);return r.rows;}
