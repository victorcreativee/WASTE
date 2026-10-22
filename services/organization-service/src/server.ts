import app from "./app";
import { env } from "./config/env";
import { dbPool } from "./config/database";
import { assertProductionConfig, startServer } from "./runtime";

assertProductionConfig(env.serviceName, { DATABASE_URL: env.databaseUrl }, { JWT_ACCESS_SECRET: env.jwtAccessSecret });
startServer(app, { port: env.port, serviceName: env.serviceName, resources: [dbPool] });
