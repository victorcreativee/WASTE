import { dbPool } from "../config/database";
import {
  AssignCollectionJobInput,
  CreateCollectionJobInput,
  CreateCollectionRouteInput,
  CreateDriverInput,
  CreatePickupScheduleInput,
  CreateTruckInput,
  CreateZoneInput,
  GenerateCollectionJobsInput,
  UpdateCollectionJobStatusInput,
  AssignZoneServiceAreaInput,
} from "../validators/waste.validator";

type OrganizationResource =
  | "users"
  | "waste_zones"
  | "waste_trucks"
  | "drivers"
  | "pickup_schedules"
  | "collection_jobs";

export async function resourcesBelongToOrganization(
  resource: OrganizationResource,
  ids: string[],
  organizationId: string
) {
  if (ids.length === 0) return true;

  const result = await dbPool.query(
    `SELECT COUNT(DISTINCT id)::int AS count
     FROM ${resource}
     WHERE organization_id = $1::uuid
       AND id = ANY($2::uuid[])`,
    [organizationId, ids]
  );

  return result.rows[0].count === new Set(ids).size;
}

export async function findZones(organizationId: string | null) {
  const result = await dbPool.query(`
    SELECT 
      wz.id,
      wz.organization_id,
      o.name AS organization_name,
      wz.division_id,
      division.name AS division_name,
      wz.catalog_area_id,
      wz.name,
      wz.description,
      wz.area_type,
      ST_Y(wz.center_point::geometry) AS latitude,
      ST_X(wz.center_point::geometry) AS longitude,
      wz.is_active,
      COUNT(csl.id)::int AS customer_count,
      wz.created_at,
      wz.updated_at
    FROM waste_zones wz
    LEFT JOIN organizations o ON o.id = wz.organization_id
    LEFT JOIN kampala_divisions division ON division.id=wz.division_id
    LEFT JOIN customer_service_locations csl ON csl.zone_id = wz.id
    WHERE ($1::uuid IS NULL OR wz.organization_id = $1::uuid)
    GROUP BY wz.id, o.name, division.name
    ORDER BY wz.created_at DESC
  `, [organizationId]);

  return result.rows;
}

export async function createZone(data: CreateZoneInput) {
  const hasPoint =
    typeof data.latitude === "number" && typeof data.longitude === "number";

  const result = await dbPool.query(
    `
    INSERT INTO waste_zones (
      organization_id,
      division_id,
      catalog_area_id,
      name,
      description,
      area_type,
      center_point
    )
    VALUES (
      $1,
      $2::uuid,
      $3::uuid,
      $4,
      $5,
      $6,
      ${hasPoint ? "ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography" : "NULL"}
    )
    RETURNING 
      id,
      organization_id,
      division_id,
      catalog_area_id,
      name,
      description,
      area_type,
      ST_Y(center_point::geometry) AS latitude,
      ST_X(center_point::geometry) AS longitude,
      is_active,
      created_at,
      updated_at
    `,
    hasPoint
      ? [
          data.organizationId ?? null,
          data.divisionId ?? null,
          data.catalogAreaId ?? null,
          data.name,
          data.description ?? null,
          data.areaType,
          data.latitude,
          data.longitude,
        ]
      : [
          data.organizationId ?? null,
          data.divisionId ?? null,
          data.catalogAreaId ?? null,
          data.name,
          data.description ?? null,
          data.areaType,
        ]
  );

  return result.rows[0];
}

export async function updateZoneForOrganization(zoneId:string,organizationId:string,data:any){
  const hasPoint=data.latitude!==undefined&&data.longitude!==undefined;
  const result=await dbPool.query(`UPDATE waste_zones SET
    name=COALESCE($3,name),catalog_area_id=CASE WHEN $4::boolean THEN $5::uuid ELSE catalog_area_id END,
    description=CASE WHEN $6::boolean THEN $7 ELSE description END,area_type=COALESCE($8,area_type),
    center_point=CASE WHEN $9::boolean THEN ST_SetSRID(ST_MakePoint($11,$10),4326)::geography ELSE center_point END,
    updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,
    [zoneId,organizationId,data.name??null,Object.prototype.hasOwnProperty.call(data,"catalogAreaId"),data.catalogAreaId??null,
      Object.prototype.hasOwnProperty.call(data,"description"),data.description??null,data.areaType??null,hasPoint,data.latitude??null,data.longitude??null]);
  return result.rows[0]??null;
}

export async function assignZoneServiceArea(
  zoneId: string,
  data: AssignZoneServiceAreaInput
) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const organizationResult = await client.query(
      `SELECT id FROM organizations
       WHERE id = $1::uuid AND type = 'waste_collection_company' AND is_active = true`,
      [data.organizationId]
    );
    if (!organizationResult.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    const hasPoint = data.latitude !== undefined && data.longitude !== undefined;
    const zoneResult = await client.query(
      `UPDATE waste_zones SET organization_id = $2::uuid,
         center_point = CASE WHEN $3::boolean
           THEN ST_SetSRID(ST_Point($4, $5), 4326)::geography
           ELSE center_point END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid
       RETURNING id, organization_id, name, area_type,
         ST_Y(center_point::geometry) AS latitude,
         ST_X(center_point::geometry) AS longitude, is_active`,
      [zoneId, data.organizationId, hasPoint, data.longitude ?? null, data.latitude ?? null]
    );
    if (!zoneResult.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    // Regulatory coverage reassignment must not transfer private customer relationships.
    await client.query("COMMIT");
    return { ...zoneResult.rows[0], rematched_customers: 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function findTrucks(organizationId: string | null) {
  const result = await dbPool.query(`
    SELECT 
      id,
      organization_id,
      plate_number,
      truck_name,
      capacity_tons,
      status,
      ST_Y(current_location::geometry) AS latitude,
      ST_X(current_location::geometry) AS longitude,
      created_at,
      updated_at
    FROM waste_trucks
    WHERE ($1::uuid IS NULL OR organization_id = $1::uuid)
    ORDER BY created_at DESC
  `, [organizationId]);

  return result.rows;
}

export async function createTruck(data: CreateTruckInput) {
  const result = await dbPool.query(
    `
    INSERT INTO waste_trucks (
      organization_id,
      plate_number,
      truck_name,
      capacity_tons
    )
    VALUES ($1, $2, $3, $4)
    RETURNING 
      id,
      organization_id,
      plate_number,
      truck_name,
      capacity_tons,
      status,
      created_at,
      updated_at
    `,
    [
      data.organizationId ?? null,
      data.plateNumber,
      data.truckName ?? null,
      data.capacityTons ?? null,
    ]
  );

  return result.rows[0];
}

export async function findDrivers(organizationId: string | null) {
  const result = await dbPool.query(`
    SELECT 
      id,
      organization_id,
      user_id,
      full_name,
      phone,
      license_number,
      status,
      created_at,
      updated_at
    FROM drivers
    WHERE ($1::uuid IS NULL OR organization_id = $1::uuid)
    ORDER BY created_at DESC
  `, [organizationId]);

  return result.rows;
}

export async function createDriver(data: CreateDriverInput) {
  const result = await dbPool.query(
    `
    INSERT INTO drivers (
      organization_id,
      user_id,
      full_name,
      phone,
      license_number
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING 
      id,
      organization_id,
      user_id,
      full_name,
      phone,
      license_number,
      status,
      created_at,
      updated_at
    `,
    [
      data.organizationId ?? null,
      data.userId ?? null,
      data.fullName,
      data.phone ?? null,
      data.licenseNumber ?? null,
    ]
  );

  return result.rows[0];
}
export async function findPickupSchedules(organizationId: string | null) {
  const result = await dbPool.query(`
    SELECT 
      ps.id,
      ps.organization_id,
      ps.zone_id,
      wz.name AS zone_name,
      ps.name,
      ps.frequency,
      ps.preferred_time,
      ps.is_active,
      ps.created_at,
      ps.updated_at
    FROM pickup_schedules ps
    LEFT JOIN waste_zones wz ON wz.id = ps.zone_id
    WHERE ($1::uuid IS NULL OR ps.organization_id = $1::uuid)
    ORDER BY ps.created_at DESC
  `, [organizationId]);

  return result.rows;
}

export async function createPickupSchedule(data: CreatePickupScheduleInput) {
  const result = await dbPool.query(
    `
    INSERT INTO pickup_schedules (
      organization_id,
      zone_id,
      name,
      frequency,
      preferred_time
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING 
      id,
      organization_id,
      zone_id,
      name,
      frequency,
      preferred_time,
      is_active,
      created_at,
      updated_at
    `,
    [
      data.organizationId ?? null,
      data.zoneId,
      data.name,
      data.frequency,
      data.preferredTime ?? null,
    ]
  );

  return result.rows[0];
}

export async function findCollectionJobs(organizationId: string | null) {
  const result = await dbPool.query(`
    SELECT
      cj.id,
      cj.organization_id,
      cj.zone_id,
      wz.name AS zone_name,
      cj.truck_id,
      wt.plate_number,
      wt.truck_name,
      cj.driver_id,
      d.full_name AS driver_name,
      cj.schedule_id,
      ps.name AS schedule_name,
      cj.job_date,
      cj.status,
      cj.waste_type,
      cj.estimated_weight_kg,
      cj.collected_weight_kg,
      cj.started_at,
      cj.completed_at,
      cj.notes,
      EXISTS (
        SELECT 1 FROM collection_route_jobs crj
        JOIN collection_routes cr ON cr.id=crj.route_id
        WHERE crj.job_id = cj.id AND cr.status <> 'cancelled'
      ) AS is_routed,
      (SELECT COUNT(*)::int FROM customer_collection_stops cs
       WHERE cs.collection_job_id = cj.id) AS customer_stop_count,
      (SELECT COUNT(*)::int FROM customer_collection_stops cs
       WHERE cs.collection_job_id = cj.id
         AND cs.status IN ('completed', 'skipped', 'cancelled')) AS resolved_customer_stop_count,
      cj.created_at,
      cj.updated_at
    FROM collection_jobs cj
    LEFT JOIN waste_zones wz ON wz.id = cj.zone_id
    LEFT JOIN waste_trucks wt ON wt.id = cj.truck_id
    LEFT JOIN drivers d ON d.id = cj.driver_id
    LEFT JOIN pickup_schedules ps ON ps.id = cj.schedule_id
    WHERE ($1::uuid IS NULL OR cj.organization_id = $1::uuid)
    ORDER BY cj.job_date DESC, cj.created_at DESC
  `, [organizationId]);

  return result.rows;
}

export async function createCollectionJob(data: CreateCollectionJobInput) {
  const result = await dbPool.query(
    `
    INSERT INTO collection_jobs (
      organization_id,
      zone_id,
      truck_id,
      driver_id,
      schedule_id,
      job_date,
      waste_type,
      estimated_weight_kg,
      notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
    `,
    [
      data.organizationId ?? null,
      data.zoneId,
      data.truckId ?? null,
      data.driverId ?? null,
      data.scheduleId ?? null,
      data.jobDate,
      data.wasteType ?? "mixed",
      data.estimatedWeightKg ?? null,
      data.notes ?? null,
    ]
  );

  return result.rows[0];
}

export async function updateCollectionJobStatus(
  jobId: string,
  data: UpdateCollectionJobStatusInput,
  organizationId: string | null
) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
    UPDATE collection_jobs
    SET
      status = $2::text,
      collected_weight_kg = COALESCE($3::numeric, collected_weight_kg),
      notes = COALESCE($4::text, notes),
      started_at = CASE 
        WHEN $2::text = 'in_progress' AND started_at IS NULL THEN CURRENT_TIMESTAMP
        ELSE started_at
      END,
      completed_at = CASE
        WHEN $2::text = 'completed' AND completed_at IS NULL THEN CURRENT_TIMESTAMP
        ELSE completed_at
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1::uuid
      AND ($5::uuid IS NULL OR organization_id = $5::uuid)
      AND ($2::text <> 'completed' OR NOT EXISTS (
        SELECT 1 FROM customer_collection_stops cs WHERE cs.collection_job_id=collection_jobs.id
          AND cs.status NOT IN ('completed','skipped','cancelled')
      ))
      AND (
        ($2::text = 'assigned' AND status = 'pending' AND truck_id IS NOT NULL AND driver_id IS NOT NULL)
        OR ($2::text = 'in_progress' AND status = 'assigned' AND truck_id IS NOT NULL AND driver_id IS NOT NULL)
        OR ($2::text = 'completed' AND status = 'in_progress')
        OR ($2::text = 'missed' AND status IN ('pending', 'assigned'))
        OR ($2::text = 'cancelled' AND status IN ('pending', 'assigned'))
      )
    RETURNING *
      `,
      [jobId, data.status, data.collectedWeightKg ?? null, data.notes ?? null, organizationId]
    );

    if (result.rows[0] && data.status === "cancelled") {
      await client.query(
        `UPDATE customer_collection_stops
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE collection_job_id = $1::uuid
           AND status IN ('pending', 'arrived')`,
        [jobId]
      );
    }

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function findPickupScheduleById(scheduleId: string, organizationId: string | null) {
  const result = await dbPool.query(
    `
    SELECT
      id,
      organization_id,
      zone_id,
      name,
      frequency,
      preferred_time,
      is_active,
      created_at,
      updated_at
    FROM pickup_schedules
    WHERE id = $1
      AND ($2::uuid IS NULL OR organization_id = $2::uuid)
    `,
    [scheduleId, organizationId]
  );

  return result.rows[0];
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function formatDate(date: Date) {
  return date.toISOString().split("T")[0];
}

function getFrequencyStepDays(frequency: string) {
  if (frequency === "daily") return 1;
  if (frequency === "weekly") return 7;
  if (frequency === "biweekly") return 14;
  if (frequency === "monthly") return 30;
  return null;
}

export async function generateCollectionJobsFromSchedule(
  scheduleId: string,
  data: GenerateCollectionJobsInput,
  organizationId: string | null
) {
  const schedule = await findPickupScheduleById(scheduleId, organizationId);

  if (!schedule) {
    return {
      schedule: null,
      jobs: [],
      skipped: 0,
    };
  }

  if (!schedule.is_active) {
    return {
      schedule,
      jobs: [],
      skipped: 0,
    };
  }

  const stepDays = getFrequencyStepDays(schedule.frequency);

  if (!stepDays) {
    return {
      schedule,
      jobs: [],
      skipped: 0,
    };
  }

  const startDate = new Date(data.startDate);
  const endDate = addDays(startDate, data.daysAhead);

  const candidateDates: string[] = [];
  let currentDate = startDate;

  while (currentDate <= endDate) {
    candidateDates.push(formatDate(currentDate));
    currentDate = addDays(currentDate, stepDays);
  }

  const createdJobs = [];
  let skipped = 0;

  for (const jobDate of candidateDates) {
    const existingJob = await dbPool.query(
      `
      SELECT id
      FROM collection_jobs
      WHERE schedule_id = $1
      AND job_date = $2
      LIMIT 1
      `,
      [scheduleId, jobDate]
    );

    if (existingJob.rows.length > 0) {
      skipped += 1;
      continue;
    }

    const result = await dbPool.query(
      `
      INSERT INTO collection_jobs (
        organization_id,
        zone_id,
        truck_id,
        driver_id,
        schedule_id,
        job_date,
        status,
        waste_type,
        estimated_weight_kg,
        notes,
        schedule_occurrence_key
      )
      VALUES ($1, $2, $3, $4, $5::uuid, $6, 'pending', $7, $8, $9, $5::uuid::text || ':' || $6::date::text)
      ON CONFLICT (schedule_occurrence_key) WHERE schedule_occurrence_key IS NOT NULL DO NOTHING
      RETURNING *
      `,
      [
        schedule.organization_id,
        schedule.zone_id,
        data.truckId ?? null,
        data.driverId ?? null,
        schedule.id,
        jobDate,
        data.wasteType ?? "mixed",
        data.estimatedWeightKg ?? null,
        data.notes ?? `Auto-generated from pickup schedule: ${schedule.name}`,
      ]
    );

    if(result.rows[0])createdJobs.push(result.rows[0]);
    else skipped+=1;
  }

  return {
    schedule,
    jobs: createdJobs,
    skipped,
  };
}
export async function assignCollectionJob(
  jobId: string,
  data: AssignCollectionJobInput,
  organizationId: string | null
) {
  const result = await dbPool.query(
    `
    UPDATE collection_jobs
    SET
      truck_id = $2::uuid,
      driver_id = $3::uuid,
      status = 'assigned',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1::uuid
      AND ($4::uuid IS NULL OR organization_id = $4::uuid)
      AND ($4::uuid IS NULL OR EXISTS (
        SELECT 1 FROM waste_trucks wt
        WHERE wt.id = $2::uuid AND wt.organization_id = $4::uuid
          AND wt.status IN ('available','assigned')
          AND NOT EXISTS (
            SELECT 1 FROM truck_documents td
            WHERE td.truck_id=wt.id AND td.expires_on<collection_jobs.job_date
          )
      ))
      AND ($4::uuid IS NULL OR EXISTS (
        SELECT 1 FROM drivers d
        WHERE d.id = $3::uuid AND d.organization_id = $4::uuid AND d.status IN ('available','assigned')
      ))
      AND status IN ('pending', 'assigned')
    RETURNING *
    `,
    [jobId, data.truckId, data.driverId, organizationId]
  );

  return result.rows[0];
}
export async function findJobsByDriverId(
  driverId: string,
  organizationId: string | null,
  userId: string | null
) {
  const result = await dbPool.query(
    `
    SELECT
      cj.id,
      cj.organization_id,
      cj.zone_id,
      wz.name AS zone_name,
      cj.truck_id,
      wt.plate_number,
      wt.truck_name,
      cj.driver_id,
      d.full_name AS driver_name,
      cj.schedule_id,
      ps.name AS schedule_name,
      cj.job_date,
      cj.status,
      cj.waste_type,
      cj.estimated_weight_kg,
      cj.collected_weight_kg,
      cj.started_at,
      cj.completed_at,
      cj.notes,
      cj.created_at,
      cj.updated_at
    FROM collection_jobs cj
    LEFT JOIN waste_zones wz ON wz.id = cj.zone_id
    LEFT JOIN waste_trucks wt ON wt.id = cj.truck_id
    LEFT JOIN drivers d ON d.id = cj.driver_id
    LEFT JOIN pickup_schedules ps ON ps.id = cj.schedule_id
    WHERE ($3::uuid IS NULL OR d.user_id = $3::uuid)
      AND ($3::uuid IS NOT NULL OR cj.driver_id = NULLIF($1, '')::uuid)
      AND ($2::uuid IS NULL OR cj.organization_id = $2::uuid)
      AND cj.status IN ('assigned', 'in_progress')
    ORDER BY cj.job_date ASC, cj.created_at ASC
    `,
    [driverId, organizationId, userId]
  );

  return result.rows;
}

export async function startDriverCollectionJob(
  jobId: string,
  organizationId: string | null,
  userId: string | null
) {
  const result = await dbPool.query(
    `
    UPDATE collection_jobs
    SET
      status = 'in_progress',
      started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1::uuid
      AND ($2::uuid IS NULL OR organization_id = $2::uuid)
      AND ($3::uuid IS NULL OR EXISTS (
        SELECT 1 FROM drivers d
        WHERE d.id = collection_jobs.driver_id AND d.user_id = $3::uuid
      ))
      AND status = 'assigned'
      AND truck_id IS NOT NULL
      AND driver_id IS NOT NULL
    RETURNING *
    `,
    [jobId, organizationId, userId]
  );

  return result.rows[0];
}

export async function completeDriverCollectionJob(
  jobId: string,
  collectedWeightKg: number | undefined,
  organizationId: string | null,
  userId: string | null
) {
  const result = await dbPool.query(
    `
    UPDATE collection_jobs
    SET
      status = 'completed',
      collected_weight_kg = COALESCE($2::numeric, collected_weight_kg),
      completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1::uuid
      AND ($3::uuid IS NULL OR organization_id = $3::uuid)
      AND ($4::uuid IS NULL OR EXISTS (
        SELECT 1 FROM drivers d
        WHERE d.id = collection_jobs.driver_id AND d.user_id = $4::uuid
      ))
      AND status = 'in_progress'
      AND NOT EXISTS (SELECT 1 FROM customer_collection_stops cs
        WHERE cs.collection_job_id=collection_jobs.id AND cs.status NOT IN ('completed','skipped','cancelled'))
    RETURNING *
    `,
    [jobId, collectedWeightKg ?? null, organizationId, userId]
  );

  return result.rows[0];
}
export async function findCollectionRoutes(organizationId: string | null) {
  const result = await dbPool.query(`
    SELECT
      cr.id,
      cr.organization_id,
      cr.name,
      cr.truck_id,
      wt.plate_number,
      wt.truck_name,
      cr.driver_id,
      d.full_name AS driver_name,
      cr.route_date,
      cr.status,
      cr.total_distance_km,
      cr.estimated_duration_minutes,
      cr.notes,
      COUNT(crj.job_id)::int AS job_count,
      cr.created_at,
      cr.updated_at
    FROM collection_routes cr
    LEFT JOIN waste_trucks wt ON wt.id = cr.truck_id
    LEFT JOIN drivers d ON d.id = cr.driver_id
    LEFT JOIN collection_route_jobs crj ON crj.route_id = cr.id
    WHERE ($1::uuid IS NULL OR cr.organization_id = $1::uuid)
    GROUP BY cr.id, wt.plate_number, wt.truck_name, d.full_name
    ORDER BY cr.route_date DESC, cr.created_at DESC
  `, [organizationId]);

  return result.rows;
}

export async function createCollectionRoute(data: CreateCollectionRouteInput) {
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    for(const jobId of [...data.jobIds].sort()){
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[jobId]);
    }
    const resources=await client.query(`SELECT
      EXISTS(SELECT 1 FROM waste_trucks wt WHERE wt.id=$2::uuid AND wt.organization_id=$1::uuid AND wt.status IN ('available','assigned')
        AND NOT EXISTS(SELECT 1 FROM truck_documents td WHERE td.truck_id=wt.id AND td.expires_on<$4::date)) truck_ready,
      EXISTS(SELECT 1 FROM drivers d WHERE d.id=$3::uuid AND d.organization_id=$1::uuid AND d.status IN ('available','assigned')) driver_ready,
      EXISTS(SELECT 1 FROM collection_routes cr WHERE cr.organization_id=$1::uuid AND cr.route_date=$4::date
        AND cr.status IN ('planned','dispatched','in_progress') AND (cr.truck_id=$2::uuid OR cr.driver_id=$3::uuid)) route_conflict`,
      [data.organizationId,data.truckId,data.driverId,data.routeDate]);
    if(!resources.rows[0].truck_ready)throw Object.assign(new Error('Choose an available, compliant vehicle for this route'),{statusCode:409});
    if(!resources.rows[0].driver_ready)throw Object.assign(new Error('Choose an available driver for this route'),{statusCode:409});
    if(resources.rows[0].route_conflict)throw Object.assign(new Error('This driver or vehicle already has an active route on the selected date'),{statusCode:409});

    const selectedJobs=await client.query(`SELECT cj.id,cj.job_date::text AS job_date,cj.status,cj.truck_id,cj.driver_id,
      EXISTS(SELECT 1 FROM collection_route_jobs crj JOIN collection_routes cr ON cr.id=crj.route_id
        WHERE crj.job_id=cj.id AND cr.status<>'cancelled') already_routed
      FROM collection_jobs cj WHERE cj.id=ANY($1::uuid[]) AND cj.organization_id=$2::uuid FOR UPDATE`,[data.jobIds,data.organizationId]);
    if(selectedJobs.rows.length!==new Set(data.jobIds).size)throw Object.assign(new Error('Every selected job must belong to this organization'),{statusCode:400});
    const invalid=selectedJobs.rows.find(job=>String(job.job_date).slice(0,10)!==data.routeDate||!['pending','assigned'].includes(job.status)||job.already_routed||(job.truck_id&&job.truck_id!==data.truckId)||(job.driver_id&&job.driver_id!==data.driverId));
    if(invalid)throw Object.assign(new Error('Selected jobs must be open, unrouted, on the route date, and compatible with the chosen driver and vehicle'),{statusCode:409});

    const routeResult = await client.query(
      `
      INSERT INTO collection_routes (
        organization_id,
        name,
        truck_id,
        driver_id,
        route_date,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        data.organizationId ?? null,
        data.name,
        data.truckId ?? null,
        data.driverId ?? null,
        data.routeDate,
        data.notes ?? null,
      ]
    );

    const route = routeResult.rows[0];

    await client.query(`UPDATE collection_jobs SET truck_id=$2::uuid,driver_id=$3::uuid,status='assigned',updated_at=CURRENT_TIMESTAMP
      WHERE id=ANY($1::uuid[])`,[data.jobIds,data.truckId,data.driverId]);

    for (let index = 0; index < data.jobIds.length; index += 1) {
      await client.query(
        `
        INSERT INTO collection_route_jobs (
          route_id,
          job_id,
          stop_order
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (route_id, job_id) DO NOTHING
        `,
        [route.id, data.jobIds[index], index + 1]
      );
    }

    await client.query("COMMIT");

    return route;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function updateCollectionRouteRoutingData(
  routeId: string,
  routeGeometryGeoJson: string,
  totalDistanceKm: number,
  estimatedDurationMinutes: number,
  organizationId: string | null
) {
  const result = await dbPool.query(
    `
    UPDATE collection_routes
    SET
      route_geometry = ST_SetSRID(ST_GeomFromGeoJSON($2::text), 4326),
      total_distance_km = $3::numeric,
      estimated_duration_minutes = $4::integer,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1::uuid
      AND ($5::uuid IS NULL OR organization_id = $5::uuid)
    RETURNING id
    `,
    [routeId, routeGeometryGeoJson, totalDistanceKm, estimatedDurationMinutes, organizationId]
  );

  return result.rows[0] ?? null;
}

export async function findCollectionRouteById(routeId: string, organizationId: string | null) {
  const routeResult = await dbPool.query(
    `
    SELECT
      cr.id,
      cr.organization_id,
      cr.name,
      cr.truck_id,
      wt.plate_number,
      wt.truck_name,
      cr.driver_id,
      d.full_name AS driver_name,
      cr.route_date,
      cr.status,
      cr.total_distance_km,
      cr.estimated_duration_minutes,
      CASE
        WHEN cr.route_geometry IS NULL THEN NULL
        ELSE ST_AsGeoJSON(cr.route_geometry)::json
      END AS route_geometry,
      cr.notes,
      cr.created_at,
      cr.updated_at
    FROM collection_routes cr
    LEFT JOIN waste_trucks wt ON wt.id = cr.truck_id
    LEFT JOIN drivers d ON d.id = cr.driver_id
    WHERE cr.id = $1::uuid
      AND ($2::uuid IS NULL OR cr.organization_id = $2::uuid)
    `,
    [routeId, organizationId]
  );

  const jobsResult = await dbPool.query(
    `
    SELECT
      cj.id,
      cj.zone_id,
      wz.name AS zone_name,
      ST_Y(wz.center_point::geometry) AS latitude,
      ST_X(wz.center_point::geometry) AS longitude,
  
      cj.truck_id,
      wt.plate_number,
      wt.truck_name,
  
      cj.driver_id,
      d.full_name AS driver_name,
  
      cj.job_date,
      cj.status,
      cj.waste_type,
      cj.estimated_weight_kg,
      cj.collected_weight_kg,
      cj.notes,
  
      crj.stop_order
  
    FROM collection_route_jobs crj
  
    JOIN collection_jobs cj
      ON cj.id = crj.job_id
  
    LEFT JOIN waste_zones wz
      ON wz.id = cj.zone_id
  
    LEFT JOIN waste_trucks wt
      ON wt.id = cj.truck_id
  
    LEFT JOIN drivers d
      ON d.id = cj.driver_id
  
    WHERE crj.route_id = $1::uuid
      AND ($2::uuid IS NULL OR cj.organization_id = $2::uuid)
  
    ORDER BY crj.stop_order ASC
    `,
    [routeId, organizationId]
  );

  if (!routeResult.rows[0]) {
    return null;
  }

  return {
    ...routeResult.rows[0],
    jobs: jobsResult.rows,
  };
}
