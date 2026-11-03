import { Pool, types } from "pg";
import { env } from "./env";
import { enforceRowSecurity } from "../runtime";

// Keep DATE columns as "YYYY-MM-DD". node-postgres would otherwise build a JS Date at this server's local midnight,
// which on a Kampala machine is sent as "2026-10-21T21:00:00.000Z" for 22 October, and any client that reads the
// first 10 characters then saves or files the entry on the day before.
types.setTypeParser(types.builtins.DATE, (value) => value);

export const dbPool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: env.serviceName,
});
enforceRowSecurity(dbPool);

// An idle client can error when PostgreSQL restarts or the network drops.
// Without a listener Node treats it as an uncaught 'error' event and the whole service crashes.
dbPool.on("error", (error) => {
  console.error(`${env.serviceName} idle database connection error`, error.message);
});

export async function checkDatabaseHealth() {
  const result = await dbPool.query(`
    SELECT 
      NOW() AS current_time,
      PostGIS_Version() AS postgis_version
  `);

  return {
    connected: true,
    currentTime: result.rows[0].current_time,
    postgisVersion: result.rows[0].postgis_version,
  };
}
