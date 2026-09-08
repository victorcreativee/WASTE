import bcrypt from "bcrypt";
import { PoolClient } from "pg";
import { dbPool } from "../src/config/database";

type AccountSpec = {
  email: string;
  fullName: string;
  password: string;
  role: "system_admin" | "kcca_admin" | "company_admin" | "driver" | "citizen";
  organizationId: string | null;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function upsertAccount(client: PoolClient, spec: AccountSpec) {
  const passwordHash = await bcrypt.hash(spec.password, 12);
  const userResult = await client.query(
    `INSERT INTO users (organization_id, full_name, email, password_hash, status)
     VALUES ($1::uuid, $2, LOWER($3), $4, 'active')
     ON CONFLICT (email) DO UPDATE SET
       organization_id = EXCLUDED.organization_id,
       full_name = EXCLUDED.full_name,
       password_hash = EXCLUDED.password_hash,
       status = 'active',
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, email`,
    [spec.organizationId, spec.fullName, spec.email, passwordHash]
  );
  const user = userResult.rows[0];

  await client.query("DELETE FROM user_roles WHERE user_id = $1::uuid", [user.id]);
  await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1::uuid, id FROM roles WHERE name = $2`,
    [user.id, spec.role]
  );

  return user;
}

async function main() {
  const companyOrganizationId = required("COMPANY_ORGANIZATION_ID");
  const driverId = required("DRIVER_ID");
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    const company = await client.query(
      `SELECT id FROM organizations
       WHERE id = $1::uuid AND type = 'waste_collection_company' AND is_active = true`,
      [companyOrganizationId]
    );
    if (!company.rows[0]) throw new Error("Active waste collection company not found");

    const accounts: AccountSpec[] = [
      {
        email: required("SYSTEM_ADMIN_EMAIL"),
        fullName: required("SYSTEM_ADMIN_NAME"),
        password: required("SYSTEM_ADMIN_PASSWORD"),
        role: "system_admin",
        organizationId: null,
      },
      {
        email: required("COMPANY_ADMIN_EMAIL"),
        fullName: required("COMPANY_ADMIN_NAME"),
        password: required("COMPANY_ADMIN_PASSWORD"),
        role: "company_admin",
        organizationId: companyOrganizationId,
      },
      {
        email: required("DRIVER_EMAIL"),
        fullName: required("DRIVER_NAME"),
        password: required("DRIVER_PASSWORD"),
        role: "driver",
        organizationId: companyOrganizationId,
      },
      {
        email: required("CITIZEN_EMAIL"),
        fullName: required("CITIZEN_NAME"),
        password: required("CITIZEN_PASSWORD"),
        role: "citizen",
        organizationId: null,
      },
    ];

    const created = [];
    for (const account of accounts) created.push({ ...(await upsertAccount(client, account)), role: account.role });
    const driverUser = created.find((account) => account.role === "driver");

    const driverResult = await client.query(
      `UPDATE drivers
       SET organization_id = $2::uuid, user_id = $3::uuid, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid
       RETURNING id`,
      [driverId, companyOrganizationId, driverUser?.id]
    );
    if (!driverResult.rows[0]) throw new Error("Driver record not found");

    await client.query("COMMIT");
    console.log(JSON.stringify({ success: true, accounts: created.map(({ email, role }) => ({ email, role })), driverId }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await dbPool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
