import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT) || 8093,
  nodeEnv: process.env.NODE_ENV || "development",
  serviceName: process.env.SERVICE_NAME || "waste-service",
  databaseUrl: process.env.DATABASE_URL || "",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "",

  routingProvider: process.env.ROUTING_PROVIDER || "osrm",

  osrmBaseUrl: process.env.OSRM_BASE_URL || "https://router.project-osrm.org",

  osrmProfile: process.env.OSRM_PROFILE || "driving",

  routingRequestTimeoutMs:
    Number(process.env.ROUTING_REQUEST_TIMEOUT_MS) || 10000,

  routingHealthCheckLatitude:
    Number(process.env.ROUTING_HEALTHCHECK_LATITUDE) || 0.3476,

  routingHealthCheckLongitude:
    Number(process.env.ROUTING_HEALTHCHECK_LONGITUDE) || 32.5825,
};
