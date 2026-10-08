import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { dbPool } from "../config/database";

export async function systemBootstrapStatus() {
  const result = await dbPool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE r.name = 'system_admin'
    ) AS initialized
  `);

  return { setupRequired: !result.rows[0].initialized };
}

type BootstrapInput = {
  fullName: string;
  email: string;
  password: string;
  setupToken: string;
};

export async function createFirstSystemAdmin(data: BootstrapInput) {
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('wms:first-system-admin'))"
    );

    const existing = await client.query(`
      SELECT 1
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE r.name = 'system_admin'
      LIMIT 1
    `);

    if (existing.rowCount) {
      throw Object.assign(
        new Error("System setup is already complete"),
        { statusCode: 409 }
      );
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(data.setupToken)
      .digest("hex");

    const token = await client.query(
      `SELECT id
       FROM system_bootstrap_tokens
       WHERE token_hash = $1
         AND consumed_at IS NULL
         AND expires_at > NOW()
       FOR UPDATE`,
      [tokenHash]
    );

    if (!token.rowCount) {
      throw Object.assign(
        new Error("Invalid or expired setup token"),
        { statusCode: 403 }
      );
    }

    const duplicate = await client.query(
      "SELECT 1 FROM users WHERE lower(email) = lower($1)",
      [data.email]
    );

    if (duplicate.rowCount) {
      throw Object.assign(
        new Error("Email is already registered"),
        { statusCode: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await client.query(
      `INSERT INTO users
       (organization_id, full_name, email, password_hash, status)
       VALUES (NULL, $1, lower($2), $3, 'active')
       RETURNING id, full_name, email`,
      [data.fullName, data.email, passwordHash]
    );

    const role = await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id
       FROM roles
       WHERE name = 'system_admin'
       RETURNING user_id`,
      [user.rows[0].id]
    );

    if (!role.rowCount) {
      throw new Error("System Admin role is not initialized");
    }

    await client.query(
      `UPDATE system_bootstrap_tokens
       SET consumed_at = NOW()
       WHERE id = $1`,
      [token.rows[0].id]
    );

    await client.query("COMMIT");

    return user.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
