import app from "./app";
import { env } from "./config/env";
import { dbPool } from "./config/database";
import { assertProductionConfig, startServer } from "./runtime";

assertProductionConfig(
  env.serviceName,
  { DATABASE_URL: env.databaseUrl },
  { JWT_ACCESS_SECRET: env.jwtAccessSecret, JWT_REFRESH_SECRET: env.jwtRefreshSecret }
);
if (env.nodeEnv === "production" && env.jwtAccessSecret === env.jwtRefreshSecret) {
  throw new Error(`${env.serviceName} cannot start in production: JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET`);
}
startServer(app, { port: env.port, serviceName: env.serviceName, resources: [dbPool] });
