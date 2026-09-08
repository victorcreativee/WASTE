import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";
import authRoutes from "./routes/auth.routes";
import organizationAccessRoutes from "./routes/organization-access.routes";
import onboardingRoutes from "./routes/onboarding.routes";
import organizationUserRoutes from "./routes/organization-user.routes";
import systemBootstrapRoutes from "./routes/system-bootstrap.routes";
import platformUserRoutes from "./routes/platform-user.routes";

import healthRoutes from "./routes/health.routes";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

app.use("/api/auth", healthRoutes);
app.use("/api/auth", systemBootstrapRoutes);
app.use("/api/auth", platformUserRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/auth", organizationAccessRoutes);
app.use("/api/auth", onboardingRoutes);
app.use("/api/auth", organizationUserRoutes);

app.use((error: Error & { statusCode?: number }, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if(error instanceof ZodError){const issue=error.issues[0];return res.status(400).json({success:false,message:`${issue.path.length?issue.path.join('.')+': ':''}${issue.message}`});}
  return res.status(error.statusCode || 400).json({ success: false, message: error.message || "Authentication service error" });
});

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

export default app;
