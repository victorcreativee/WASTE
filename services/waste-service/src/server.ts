import app from "./app";
import { env } from "./config/env";
import { dbPool } from "./config/database";
import { assertProductionConfig, startServer } from "./runtime";
import { startPermitLifecycleScheduler } from "./services/permit-lifecycle.scheduler";
import { startNotificationScheduler } from "./services/notification.scheduler";

assertProductionConfig(env.serviceName, { DATABASE_URL: env.databaseUrl }, { JWT_ACCESS_SECRET: env.jwtAccessSecret });
startServer(app, { port: env.port, serviceName: env.serviceName, resources: [dbPool] });
if (process.env.PERMIT_LIFECYCLE_SCHEDULER !== "off") startPermitLifecycleScheduler();
if (process.env.NOTIFICATION_WORKER !== "off") startNotificationScheduler();
