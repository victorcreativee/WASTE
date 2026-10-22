import { Pool } from "pg";
import { env } from "./env";

export const dbPool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: env.serviceName,
});

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
