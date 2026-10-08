const crypto = require("node:crypto");
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

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
      throw new Error("System Administrator already exists");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    await client.query(`
      DELETE FROM system_bootstrap_tokens
      WHERE consumed_at IS NULL
    `);

    await client.query(
      `INSERT INTO system_bootstrap_tokens
       (token_hash, expires_at)
       VALUES ($1, NOW() + INTERVAL '15 minutes')`,
      [tokenHash]
    );

    await client.query("COMMIT");

    console.log("\nONE-TIME SYSTEM SETUP TOKEN:\n");
    console.log(token);
    console.log("\nExpires in 15 minutes. Keep it private.\n");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
