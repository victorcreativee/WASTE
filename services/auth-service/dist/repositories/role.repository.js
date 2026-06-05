"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findRoleByName = findRoleByName;
exports.assignRoleToUser = assignRoleToUser;
exports.getUserRoles = getUserRoles;
exports.getUserPermissions = getUserPermissions;
const database_1 = require("../config/database");
async function findRoleByName(roleName) {
    const result = await database_1.dbPool.query(`
    SELECT id, name, description
    FROM roles
    WHERE name = $1
    LIMIT 1
    `, [roleName]);
    return result.rows[0] ?? null;
}
async function assignRoleToUser(userId, roleId) {
    await database_1.dbPool.query(`
    INSERT INTO user_roles (user_id, role_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
    `, [userId, roleId]);
}
async function getUserRoles(userId) {
    const result = await database_1.dbPool.query(`
    SELECT r.id, r.name, r.description
    FROM roles r
    INNER JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = $1
    ORDER BY r.name ASC
    `, [userId]);
    return result.rows;
}
async function getUserPermissions(userId) {
    const result = await database_1.dbPool.query(`
      SELECT DISTINCT p.code, p.description
      FROM permissions p
      INNER JOIN role_permissions rp ON rp.permission_id = p.id
      INNER JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = $1
      ORDER BY p.code ASC
      `, [userId]);
    return result.rows;
}
