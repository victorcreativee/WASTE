const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const apply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL || "";
const migrationDirectory = path.resolve(__dirname, "../../../infrastructure/database");
const migrationFiles = [
  "054_recycling_materials.sql",
  "055_applicant_company_type.sql",
  "056_recycling_simplified_onboarding.sql",
  "057_company_specific_platform_packages.sql",
  "058_recycling_trade_operations.sql",
  "059_recycling_sorting_batches.sql",
  "060_recycling_trade_partners.sql",
  "061_recycling_stock_adjustments.sql",
  "062_recycling_finance_integration.sql",
  "063_recycling_payment_terms.sql",
  "064_recycling_payment_followups.sql",
  "065_recycling_partial_payments.sql",
  "066_recycling_operational_roles.sql",
  "067_recycling_material_catalog.sql",
  "069_recycling_daily_closures.sql",
  "070_recycling_field_collection.sql",
  "071_recycling_material_catalog_source_defaults.sql",
];

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!/(localhost|127\.0\.0\.1)/.test(databaseUrl) && process.env.ALLOW_NON_LOCAL_MIGRATION !== "true") {
  throw new Error("Refusing non-local migration without ALLOW_NON_LOCAL_MIGRATION=true");
}

for (const filename of migrationFiles) {
  const fullPath = path.join(migrationDirectory, filename);
  if (!fs.existsSync(fullPath)) throw new Error(`Missing recycling migration: ${filename}`);
}

const pool = new Pool({ connectionString: databaseUrl });

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const filename of migrationFiles) {
      process.stdout.write(`Checking ${filename}... `);
      await client.query(fs.readFileSync(path.join(migrationDirectory, filename), "utf8"));
      console.log("ok");
    }

    if (apply) {
      await client.query("COMMIT");
      console.log(`Recycling release applied (${migrationFiles.length} migrations).`);
    } else {
      await client.query("ROLLBACK");
      console.log(`Recycling release validated and rolled back (${migrationFiles.length} migrations).`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
