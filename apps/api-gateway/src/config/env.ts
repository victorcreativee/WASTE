import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT) || 8090,
  nodeEnv: process.env.NODE_ENV || "development",
  serviceName: process.env.SERVICE_NAME || "api-gateway",
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  authServiceUrl: process.env.AUTH_SERVICE_URL || "http://localhost:8091",
  organizationServiceUrl:
    process.env.ORGANIZATION_SERVICE_URL || "http://localhost:8092",
};
