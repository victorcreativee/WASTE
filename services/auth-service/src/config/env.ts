import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

type ExpiresIn = jwt.SignOptions["expiresIn"];

export const env = {
  port: Number(process.env.PORT) || 8091,
  nodeEnv: process.env.NODE_ENV || "development",
  serviceName: process.env.SERVICE_NAME || "auth-service",
  databaseUrl: process.env.DATABASE_URL || "",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "",
  jwtAccessExpiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || "15m") as ExpiresIn,
  jwtRefreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ||
    "7d") as ExpiresIn,
};
