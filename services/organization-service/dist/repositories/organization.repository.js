"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findOrganizations = findOrganizations;
exports.findOrganizationById = findOrganizationById;
exports.createOrganization = createOrganization;
const database_1 = require("../config/database");
async function findOrganizations(organizationId) {
    const result = await database_1.dbPool.query(`
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
async function findOrganizationById(id, organizationId) {
    const result = await database_1.dbPool.query(`
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
    `, [id, organizationId]);
    return result.rows[0] ?? null;
}
async function createOrganization(data) {
    const result = await database_1.dbPool.query(`
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
    `, [
        data.name,
        data.type,
        data.email ?? null,
        data.phone ?? null,
        data.address ?? null,
    ]);
    return result.rows[0];
}
