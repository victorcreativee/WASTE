import app from "./app";
import { env } from "./config/env";
import { dbPool } from "./config/database";
import { redisClient } from "./config/redis";
import { assertProductionConfig, startServer } from "./runtime";

assertProductionConfig(env.serviceName, {
  DATABASE_URL: env.databaseUrl,
  REDIS_URL: env.redisUrl,
  AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL,
  ORGANIZATION_SERVICE_URL: process.env.ORGANIZATION_SERVICE_URL,
  WASTE_SERVICE_URL: process.env.WASTE_SERVICE_URL,
});
startServer(app, {
  port: env.port,
  serviceName: env.serviceName,
  resources: [dbPool, { end: async () => { if (redisClient.isOpen) await redisClient.quit(); } }],
});
