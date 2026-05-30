import { dbPool } from "../config/database";

export type UserRecord = {
  id: string;
  organization_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  password_hash: string;
  status: string;
  created_at: Date;
};

export async function findUserByEmail(
  email: string
): Promise<UserRecord | null> {
  const result = await dbPool.query(
    `
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
    `,
    [email.toLowerCase()]
  );

  return result.rows[0] ?? null;
}

export async function createUser(data: {
  organizationId?: string;
  fullName: string;
  email: string;
  phone?: string;
  passwordHash: string;
}): Promise<UserRecord> {
  const result = await dbPool.query(
    `
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
    `,
    [
      data.organizationId ?? null,
      data.fullName,
      data.email.toLowerCase(),
      data.phone ?? null,
      data.passwordHash,
    ]
  );

  return result.rows[0];
}

export async function updateLastLogin(userId: string) {
  await dbPool.query(
    `
    UPDATE users
    SET last_login_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [userId]
  );
}
export async function findUserById(userId: string): Promise<UserRecord | null> {
  const result = await dbPool.query(
    `
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
      `,
    [userId]
  );

  return result.rows[0] ?? null;
}
