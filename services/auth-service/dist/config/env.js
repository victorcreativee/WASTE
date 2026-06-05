"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.env = {
    port: Number(process.env.PORT) || 8091,
    nodeEnv: process.env.NODE_ENV || "development",
    serviceName: process.env.SERVICE_NAME || "auth-service",
    databaseUrl: process.env.DATABASE_URL || "",
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "",
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "",
    jwtAccessExpiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || "15m"),
    jwtRefreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ||
        "7d"),
};
