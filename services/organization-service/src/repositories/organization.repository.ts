import { dbPool } from "../config/database";
import { CreateOrganizationInput } from "../validators/organization.validator";

export async function findOrganizations() {
  const result = await dbPool.query(`
    SELECT 
      id,
      name,
      type,
      email,
      phone,
      address,
      is_active,
      created_at,
      updated_at
    FROM organizations
    ORDER BY created_at DESC
  `);

  return result.rows;
}

export async function findOrganizationById(id: string) {
  const result = await dbPool.query(
    `
    SELECT 
      id,
      name,
      type,
      email,
      phone,
      address,
      is_active,
      created_at,
      updated_at
    FROM organizations
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function createOrganization(data: CreateOrganizationInput) {
  const result = await dbPool.query(
    `
    INSERT INTO organizations (
      name,
      type,
      email,
      phone,
      address
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING 
      id,
      name,
      type,
      email,
      phone,
      address,
      is_active,
      created_at,
      updated_at
    `,
    [
      data.name,
      data.type,
      data.email ?? null,
      data.phone ?? null,
      data.address ?? null,
    ]
  );

  return result.rows[0];
}
