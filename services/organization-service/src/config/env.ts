import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT) || 8092,
  nodeEnv: process.env.NODE_ENV || "development",
  serviceName: process.env.SERVICE_NAME || "organization-service",
  databaseUrl: process.env.DATABASE_URL || "",
};
