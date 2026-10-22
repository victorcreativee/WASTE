import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import healthRoutes from "./routes/health.routes";
import proxyRoutes from "./routes/proxy.routes";
import { requestIdMiddleware } from "./middlewares/request-id.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";
import { AppError } from "./utils/app-error";
import { trustProxySetting } from "./runtime";

const app = express();

app.set("trust proxy", trustProxySetting());
app.disable("x-powered-by");

app.use(helmet());
// CORS_ORIGINS="https://a,https://b" restricts browser origins; unset keeps the permissive development default.
const corsOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map(origin => origin.trim().replace(/\/+$/, "")).filter(Boolean);
app.use(cors({ ...(corsOrigins.length ? { origin: corsOrigins } : {}), exposedHeaders: ["X-Request-Id", "Content-Disposition"] }));
app.use(requestIdMiddleware);
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

app.use("/api", healthRoutes);

/**
 * IMPORTANT:
 * Proxy routes must come BEFORE express.json().
 * Otherwise POST body can be consumed by API Gateway before reaching services.
 */
app.use("/api", proxyRoutes);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  next(new AppError(`Route not found: ${req.originalUrl}`, 404));
});

app.use(errorMiddleware);

export default app;
