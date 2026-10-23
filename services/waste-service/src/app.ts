import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { dbPool } from "./config/database";
import { corsOptions, createErrorHandler, readinessHandler, requestContext, trustProxySetting } from "./runtime";

import healthRoutes from "./routes/health.routes";
import wasteRoutes from "./routes/waste.routes";
import routingRoutes from "./routes/routing.routes";
import { requireAuth, requireRoles } from "./middlewares/auth.middleware";
import driverRoutes from "./routes/driver.routes";
import citizenIssueRoutes from "./routes/citizen-issue.routes";
import householdRoutes from "./routes/household.routes";
import commandCenterRoutes from "./routes/command-center.routes";
import recyclingOversightRoutes from "./routes/recycling-oversight.routes";
import cityReportRoutes from "./routes/city-report.routes";
import factoryRoutes from "./routes/factory.routes";
import notificationRoutes from "./routes/notification.routes";
import disposalRoutes from "./routes/disposal.routes";
import dumpingRoutes from "./routes/dumping.routes";
import penaltyRoutes from "./routes/penalty.routes";
import trackRoutes from "./routes/track.routes";
import subscriptionRoutes from "./routes/subscription.routes";
import { subscriptionAccess } from "./middlewares/subscription-access.middleware";
import { getPublicPlans } from "./controllers/subscription.controller";
import jobProblemRoutes from "./routes/job-problem.routes";
import customerServiceRoutes from "./routes/customer-service.routes";
import routeExecutionRoutes from "./routes/route-execution.routes";
import billingRoutes from "./routes/billing.routes";
import fleetRoutes from "./routes/fleet.routes";
import expenseRoutes from "./routes/expense.routes";
import inventoryRoutes from "./routes/inventory.routes";
import procurementRoutes from "./routes/procurement.routes";
import payablesRoutes from "./routes/payables.routes";
import reportRoutes from "./routes/report.routes";
import contractRoutes from "./routes/contract.routes";
import providerRequestRoutes from "./routes/provider-request.routes";
import customerStopRoutes from "./routes/customer-stop.routes";
import regulatoryPublicRoutes from "./routes/regulatory-public.routes";
import regulatoryRoutes from "./routes/regulatory.routes";
import applicantOnboardingRoutes from "./routes/applicant-onboarding.routes";
import platformOnboardingRoutes from "./routes/platform-onboarding.routes";
import serviceRouteRoutes from "./routes/service-route.routes";
import tripRoutes from "./routes/trip.routes";
import weighbridgeRoutes from "./routes/weighbridge.routes";
import complianceRoutes from "./routes/compliance.routes";
import recyclingRoutes from "./routes/recycling.routes";
import { requirePackageFeature } from "./middlewares/package-access.middleware";
import { desktopIdempotency } from "./middlewares/desktop-idempotency.middleware";

const app = express();

app.set("trust proxy", trustProxySetting());
app.disable("x-powered-by");

app.use(helmet());
app.use(cors(corsOptions()));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(requestContext("waste-service"));
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

app.use("/api/waste", healthRoutes);
app.get("/api/waste/ready", readinessHandler("waste-service", (sql, params) => dbPool.query(sql, params), ["organization_permit_activities", "permit_renewal_requests", "regulatory_returns", "city_reports", "user_sessions"]));
app.use("/api/waste/public", regulatoryPublicRoutes);
app.get("/api/waste/public/plans", (req, res, next) => { getPublicPlans(req, res).catch(next); });
app.use("/api/waste", requireAuth);
app.use("/api/waste", desktopIdempotency);
app.use("/api/waste", subscriptionAccess);
app.use("/api/waste/trips",requirePackageFeature("core_operations"));
app.use("/api/waste/operations",requirePackageFeature("core_operations"));
app.use("/api/waste/service-areas",requirePackageFeature("service_areas"));
app.use("/api/waste/service-routes",requirePackageFeature("service_areas"));
app.use("/api/waste/fleet",requirePackageFeature("fleet"));
app.use("/api/waste/customers",requirePackageFeature("customers"));
app.use("/api/waste/contracts",requirePackageFeature("contracts"));
app.use("/api/waste/billing",requirePackageFeature("billing"));
app.use("/api/waste/finance",requirePackageFeature("finance"));
app.use("/api/waste/inventory",requirePackageFeature("inventory"));
app.use("/api/waste/procurement",requirePackageFeature("procurement"));
app.use("/api/waste/reports/organization",requirePackageFeature("reports"));
// Compliance cases are part of the free regulatory portal, not a paid package feature.
app.use("/api/waste/regulatory", regulatoryRoutes);
app.use("/api/waste/regulatory", applicantOnboardingRoutes);
app.use("/api/waste/regulatory", platformOnboardingRoutes);
app.use("/api/waste", driverRoutes);
app.use("/api/waste", citizenIssueRoutes);
app.use("/api/waste", householdRoutes);
app.use("/api/waste", jobProblemRoutes);
app.use("/api/waste", customerServiceRoutes);
app.use("/api/waste", providerRequestRoutes);
app.use("/api/waste", customerStopRoutes);
app.use("/api/waste", serviceRouteRoutes);
app.use("/api/waste", tripRoutes);
app.use("/api/waste", weighbridgeRoutes);
app.use("/api/waste", complianceRoutes);
app.use("/api/waste", recyclingOversightRoutes);
app.use("/api/waste", cityReportRoutes);
app.use("/api/waste", factoryRoutes);
app.use("/api/waste", notificationRoutes);
app.use("/api/waste", disposalRoutes);
app.use("/api/waste", dumpingRoutes);
app.use("/api/waste", penaltyRoutes);
app.use("/api/waste", trackRoutes);
app.use("/api/waste", subscriptionRoutes);
app.use("/api/waste", recyclingRoutes);
app.use("/api/waste", routeExecutionRoutes);
app.use("/api/waste", billingRoutes);
app.use("/api/waste", fleetRoutes);
app.use("/api/waste", expenseRoutes);
app.use("/api/waste", inventoryRoutes);
app.use("/api/waste", procurementRoutes);
app.use("/api/waste", payablesRoutes);
app.use("/api/waste", reportRoutes);
app.use("/api/waste", contractRoutes);
app.use(
  "/api/waste",
  requireRoles("system_admin", "kcca_admin", "company_admin", "supervisor")
);
app.use("/api/waste/routing", routingRoutes);
app.use("/api/waste", commandCenterRoutes);
app.use("/api/waste", wasteRoutes);

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

app.use(
  createErrorHandler({
    serviceName: "waste-service",
    uniqueViolationMessage: (constraint) =>
      constraint === "one_open_permit_per_registration"
        ? "An active permit application already exists for this company registration number"
        : constraint === "one_open_account_application_per_admin_email"
          ? "This administrator email is already connected to an active account application"
          : constraint === "one_active_weighbridge_ticket_per_trip"
            ? "This trip already has an active weighbridge ticket"
            : constraint === "one_live_explanation_per_trip"
              ? "This trip already has an explanation"
              : "This information is already registered",
  })
);

export default app;
