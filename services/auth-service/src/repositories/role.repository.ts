import { dbPool } from "../config/database";

export async function findRoleByName(roleName: string) {
  const result = await dbPool.query(
    `
    SELECT id, name, description
    FROM roles
    WHERE name = $1
    LIMIT 1
    `,
    [roleName]
  );

  return result.rows[0] ?? null;
}

export async function assignRoleToUser(userId: string, roleId: string) {
  await dbPool.query(
    `
    INSERT INTO user_roles (user_id, role_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
    `,
    [userId, roleId]
  );
}

export async function getUserRoles(userId: string) {
  const result = await dbPool.query(
    `
    SELECT r.id, r.name, r.description
    FROM roles r
    INNER JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = $1
    ORDER BY r.name ASC
    `,
    [userId]
  );

  return result.rows;
}

export async function getUserPermissions(userId: string) {
  const result = await dbPool.query(
    `
      SELECT DISTINCT p.code, p.description
      FROM permissions p
      INNER JOIN role_permissions rp ON rp.permission_id = p.id
      INNER JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = $1
      ORDER BY p.code ASC
      `,
    [userId]
  );

  return result.rows;
}
