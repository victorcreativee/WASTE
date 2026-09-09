import {dbPool} from "../config/database";
import {CreateServiceRouteInput} from "../validators/service-route.validator";

export async function findAuthorizedDivisions(organizationId:string){
  const result=await dbPool.query(`SELECT d.id,d.code,d.name,a.expires_on
    FROM organization_division_authorizations a
    JOIN kampala_divisions d ON d.id=a.division_id AND d.is_active
    WHERE a.organization_id=$1::uuid AND a.status='active'
      AND (a.expires_on IS NULL OR a.expires_on>=CURRENT_DATE)
    ORDER BY d.name`,[organizationId]);
  return result.rows;
}
export async function findDivisionAreaCatalog(organizationId:string){
  const result=await dbPool.query(`SELECT area.id,area.division_id,area.name
    FROM kampala_division_areas area
    JOIN organization_division_authorizations authz ON authz.division_id=area.division_id
      AND authz.organization_id=$1::uuid AND authz.status='active'
      AND (authz.expires_on IS NULL OR authz.expires_on>=CURRENT_DATE)
    WHERE area.is_active ORDER BY area.name`,[organizationId]);
  return result.rows;
}

export async function findServiceRoutes(organizationId:string){
  const result=await dbPool.query(`SELECT route.id,route.name,route.code,route.division_id,
      division.name division_name,route.zone_id,zone.name zone_name,route.is_active,
      route.default_truck_id,truck.plate_number default_truck_plate,
      route.default_driver_id,driver.full_name default_driver_name,
      route.default_supervisor_user_id,supervisor.full_name default_supervisor_name,
      route.estimated_duration_minutes,route.estimated_distance_km,
      COUNT(assignment.id) FILTER(WHERE assignment.is_active)::int customer_count
    FROM service_routes route
    JOIN kampala_divisions division ON division.id=route.division_id
    JOIN waste_zones zone ON zone.id=route.zone_id
    LEFT JOIN waste_trucks truck ON truck.id=route.default_truck_id
    LEFT JOIN drivers driver ON driver.id=route.default_driver_id
    LEFT JOIN users supervisor ON supervisor.id=route.default_supervisor_user_id
    LEFT JOIN service_route_customers assignment ON assignment.service_route_id=route.id
    WHERE route.organization_id=$1::uuid
    GROUP BY route.id,division.name,zone.name,truck.plate_number,driver.full_name,supervisor.full_name
    ORDER BY division.name,zone.name,route.name`,[organizationId]);
  return result.rows;
}

export async function insertServiceRoute(organizationId:string,userId:string,input:CreateServiceRouteInput){
  const result=await dbPool.query(`INSERT INTO service_routes(organization_id,division_id,zone_id,name,code,
      default_truck_id,default_driver_id,default_supervisor_user_id,estimated_duration_minutes,
      estimated_distance_km,created_by)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7::uuid,$8::uuid,$9,$10,$11::uuid)
    RETURNING *`,[organizationId,input.divisionId,input.zoneId,input.name,input.code??null,
      input.defaultTruckId??null,input.defaultDriverId??null,input.defaultSupervisorUserId??null,
      input.estimatedDurationMinutes??null,input.estimatedDistanceKm??null,userId]);
  return result.rows[0];
}
export async function updateServiceRoute(organizationId:string,routeId:string,input:any){
  const result=await dbPool.query(`UPDATE service_routes SET
    name=COALESCE($3,name),code=CASE WHEN $4::boolean THEN $5 ELSE code END,
    is_active=COALESCE($6,is_active),estimated_duration_minutes=CASE WHEN $7::boolean THEN $8 ELSE estimated_duration_minutes END,
    estimated_distance_km=CASE WHEN $9::boolean THEN $10 ELSE estimated_distance_km END,updated_at=CURRENT_TIMESTAMP
    WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,[routeId,organizationId,input.name??null,
      Object.prototype.hasOwnProperty.call(input,"code"),input.code??null,input.isActive??null,
      Object.prototype.hasOwnProperty.call(input,"estimatedDurationMinutes"),input.estimatedDurationMinutes??null,
      Object.prototype.hasOwnProperty.call(input,"estimatedDistanceKm"),input.estimatedDistanceKm??null]);
  return result.rows[0]??null;
}

export async function findServiceRouteCustomers(organizationId:string,routeId:string){
  const route=await dbPool.query(`SELECT id,zone_id FROM service_routes
    WHERE id=$1::uuid AND organization_id=$2::uuid`,[routeId,organizationId]);
  if(!route.rows[0])return null;
  const result=await dbPool.query(`SELECT location.id service_location_id,customer.id customer_id,
      account.full_name customer_name,account.phone,account.email,location.address,
      ST_Y(location.location::geometry) latitude,ST_X(location.location::geometry) longitude,
      assignment.stop_order,COALESCE(assignment.is_active,false) assigned,
      customer.customer_type,customer.service_status
    FROM customer_service_locations location
    JOIN customer_profiles customer ON customer.id=location.customer_id
    JOIN users account ON account.id=customer.user_id
    JOIN customer_service_relationships relationship ON relationship.service_location_id=location.id
      AND relationship.organization_id=$2::uuid AND relationship.status='active'
    LEFT JOIN service_route_customers assignment ON assignment.service_location_id=location.id
      AND assignment.service_route_id=$1::uuid AND assignment.is_active
    WHERE location.zone_id=$3::uuid
    ORDER BY COALESCE(assignment.stop_order,2147483647),account.full_name`,
    [routeId,organizationId,route.rows[0].zone_id]);
  return result.rows;
}

export async function replaceServiceRouteCustomers(organizationId:string,userId:string,routeId:string,locationIds:string[]){
  const client=await dbPool.connect();
  try{
    await client.query("BEGIN");
    const route=await client.query(`SELECT id FROM service_routes WHERE id=$1::uuid AND organization_id=$2::uuid AND is_active FOR UPDATE`,[routeId,organizationId]);
    if(!route.rows[0]){await client.query("ROLLBACK");return null;}
    await client.query(`UPDATE service_route_customers SET is_active=false,updated_at=CURRENT_TIMESTAMP
      WHERE service_route_id=$1::uuid AND organization_id=$2::uuid`,[routeId,organizationId]);
    for(let index=0;index<locationIds.length;index+=1){
      await client.query(`INSERT INTO service_route_customers(organization_id,service_route_id,service_location_id,stop_order,is_active,assigned_by)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4,true,$5::uuid)
        ON CONFLICT(service_route_id,service_location_id) DO UPDATE SET stop_order=EXCLUDED.stop_order,
          is_active=true,assigned_by=EXCLUDED.assigned_by,updated_at=CURRENT_TIMESTAMP`,
        [organizationId,routeId,locationIds[index],index+1,userId]);
    }
    await client.query("COMMIT");
    return {routeId,customerCount:locationIds.length};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
