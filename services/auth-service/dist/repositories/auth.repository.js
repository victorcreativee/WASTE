"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUserByEmail = findUserByEmail;
exports.createUser = createUser;
exports.updateLastLogin = updateLastLogin;
exports.findUserById = findUserById;
const database_1 = require("../config/database");
async function findUserByEmail(email) {
    const result = await database_1.dbPool.query(`
    SELECT 
      id,
      organization_id,
      full_name,
      email,
      phone,
      password_hash,
      status,
      created_at
    FROM users
    WHERE email = $1
    LIMIT 1
    `, [email.toLowerCase()]);
    return result.rows[0] ?? null;
}
async function createUser(data) {
    const result = await database_1.dbPool.query(`
    INSERT INTO users (
      organization_id,
      full_name,
      email,
      phone,
      password_hash
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING 
      id,
      organization_id,
      full_name,
      email,
      phone,
      password_hash,
      status,
      created_at
    `, [
        data.organizationId ?? null,
        data.fullName,
        data.email.toLowerCase(),
        data.phone ?? null,
        data.passwordHash,
    ]);
    return result.rows[0];
}
async function updateLastLogin(userId) {
    await database_1.dbPool.query(`
    UPDATE users
    SET last_login_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `, [userId]);
}
async function findUserById(userId) {
    const result = await database_1.dbPool.query(`
      SELECT 
        id,
        organization_id,
        full_name,
        email,
        phone,
        password_hash,
        status,
        created_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `, [userId]);
    return result.rows[0] ?? null;
}
