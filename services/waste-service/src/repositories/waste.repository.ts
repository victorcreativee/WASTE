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
} from "../validators/waste.validator";

export async function findZones() {
  const result = await dbPool.query(`
    SELECT 
      id,
      organization_id,
      name,
      description,
      area_type,
      ST_Y(center_point::geometry) AS latitude,
      ST_X(center_point::geometry) AS longitude,
      is_active,
      created_at,
      updated_at
    FROM waste_zones
    ORDER BY created_at DESC
  `);

  return result.rows;
}

export async function createZone(data: CreateZoneInput) {
  const hasPoint =
    typeof data.latitude === "number" && typeof data.longitude === "number";

  const result = await dbPool.query(
    `
    INSERT INTO waste_zones (
      organization_id,
      name,
      description,
      area_type,
      center_point
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      ${hasPoint ? "ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography" : "NULL"}
    )
    RETURNING 
      id,
      organization_id,
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
          data.name,
          data.description ?? null,
          data.areaType,
          data.latitude,
          data.longitude,
        ]
      : [
          data.organizationId ?? null,
          data.name,
          data.description ?? null,
          data.areaType,
        ]
  );

  return result.rows[0];
}

export async function findTrucks() {
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
    ORDER BY created_at DESC
  `);

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

export async function findDrivers() {
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
    ORDER BY created_at DESC
  `);

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
export async function findPickupSchedules() {
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
    ORDER BY ps.created_at DESC
  `);

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

export async function findCollectionJobs() {
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
      cj.created_at,
      cj.updated_at
    FROM collection_jobs cj
    LEFT JOIN waste_zones wz ON wz.id = cj.zone_id
    LEFT JOIN waste_trucks wt ON wt.id = cj.truck_id
    LEFT JOIN drivers d ON d.id = cj.driver_id
    LEFT JOIN pickup_schedules ps ON ps.id = cj.schedule_id
    ORDER BY cj.job_date DESC, cj.created_at DESC
  `);

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
  data: UpdateCollectionJobStatusInput
) {
  const result = await dbPool.query(
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
      AND (
        ($2::text = 'assigned' AND status = 'pending' AND truck_id IS NOT NULL AND driver_id IS NOT NULL)
        OR ($2::text = 'in_progress' AND status = 'assigned' AND truck_id IS NOT NULL AND driver_id IS NOT NULL)
        OR ($2::text = 'completed' AND status = 'in_progress')
        OR ($2::text = 'missed' AND status IN ('pending', 'assigned'))
        OR ($2::text = 'cancelled' AND status IN ('pending', 'assigned'))
      )
    RETURNING *
    `,
    [jobId, data.status, data.collectedWeightKg ?? null, data.notes ?? null]
  );

  return result.rows[0];
}
export async function findPickupScheduleById(scheduleId: string) {
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
    `,
    [scheduleId]
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
  data: GenerateCollectionJobsInput
) {
  const schedule = await findPickupScheduleById(scheduleId);

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
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
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

    createdJobs.push(result.rows[0]);
  }

  return {
    schedule,
    jobs: createdJobs,
    skipped,
  };
}
export async function assignCollectionJob(
  jobId: string,
  data: AssignCollectionJobInput
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
      AND status IN ('pending', 'assigned')
    RETURNING *
    `,
    [jobId, data.truckId, data.driverId]
  );

  return result.rows[0];
}
export async function findJobsByDriverId(driverId: string) {
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
    WHERE cj.driver_id = $1::uuid
      AND cj.status IN ('assigned', 'in_progress')
    ORDER BY cj.job_date ASC, cj.created_at ASC
    `,
    [driverId]
  );

  return result.rows;
}

export async function startDriverCollectionJob(jobId: string) {
  const result = await dbPool.query(
    `
    UPDATE collection_jobs
    SET
      status = 'in_progress',
      started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1::uuid
      AND status = 'assigned'
      AND truck_id IS NOT NULL
      AND driver_id IS NOT NULL
    RETURNING *
    `,
    [jobId]
  );

  return result.rows[0];
}

export async function completeDriverCollectionJob(
  jobId: string,
  collectedWeightKg?: number
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
      AND status = 'in_progress'
    RETURNING *
    `,
    [jobId, collectedWeightKg ?? null]
  );

  return result.rows[0];
}
export async function findCollectionRoutes() {
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
    GROUP BY cr.id, wt.plate_number, wt.truck_name, d.full_name
    ORDER BY cr.route_date DESC, cr.created_at DESC
  `);

  return result.rows;
}

export async function createCollectionRoute(data: CreateCollectionRouteInput) {
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

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

export async function findCollectionRouteById(routeId: string) {
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
      cr.notes,
      cr.created_at,
      cr.updated_at
    FROM collection_routes cr
    LEFT JOIN waste_trucks wt ON wt.id = cr.truck_id
    LEFT JOIN drivers d ON d.id = cr.driver_id
    WHERE cr.id = $1::uuid
    `,
    [routeId]
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
  
    ORDER BY crj.stop_order ASC
    `,
    [routeId]
  );

  if (!routeResult.rows[0]) {
    return null;
  }

  return {
    ...routeResult.rows[0],
    jobs: jobsResult.rows,
  };
}
