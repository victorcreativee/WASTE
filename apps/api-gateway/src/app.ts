import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import healthRoutes from "./routes/health.routes";
import proxyRoutes from "./routes/proxy.routes";
import { requestIdMiddleware } from "./middlewares/request-id.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";
import { AppError } from "./utils/app-error";

const app = express();

app.use(helmet());
app.use(cors());
app.use(requestIdMiddleware);
app.use(morgan("dev"));

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
