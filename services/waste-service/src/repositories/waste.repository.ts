import { dbPool } from "../config/database";
import {
  CreateDriverInput,
  CreateTruckInput,
  CreateZoneInput,
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
