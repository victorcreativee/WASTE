"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.env = {
    port: Number(process.env.PORT) || 8090,
    nodeEnv: process.env.NODE_ENV || "development",
    serviceName: process.env.SERVICE_NAME || "api-gateway",
    databaseUrl: process.env.DATABASE_URL || "",
    redisUrl: process.env.REDIS_URL || "",
    authServiceUrl: process.env.AUTH_SERVICE_URL || "http://localhost:8091",
    organizationServiceUrl: process.env.ORGANIZATION_SERVICE_URL || "http://localhost:8092",
    wasteServiceUrl: process.env.WASTE_SERVICE_URL || "http://localhost:8093",
};
