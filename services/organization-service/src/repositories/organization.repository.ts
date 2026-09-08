import { dbPool } from "../config/database";
import { CreateOrganizationInput } from "../validators/organization.validator";

export async function findOrganizations(organizationId: string | null) {
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
    WHERE ($1::uuid IS NULL OR id = $1::uuid)
    ORDER BY created_at DESC
  `, [organizationId]);

  return result.rows;
}

export async function findOrganizationById(id: string, organizationId: string | null) {
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
      AND ($2::uuid IS NULL OR id = $2::uuid)
    LIMIT 1
    `,
    [id, organizationId]
  );

  return result.rows[0] ?? null;
}

export async function createOrganization(data: CreateOrganizationInput) {
  const client=await dbPool.connect();try{await client.query('BEGIN');
  if(data.type==='waste_collection_company'){
    throw Object.assign(new Error('Waste-collection companies must be created by approving a company account application'),{statusCode:409});
  }
  const result = await client.query(
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
  await client.query('COMMIT');return result.rows[0];
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
