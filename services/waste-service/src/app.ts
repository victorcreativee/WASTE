import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";

import healthRoutes from "./routes/health.routes";
import wasteRoutes from "./routes/waste.routes";
import routingRoutes from "./routes/routing.routes";
import { requireAuth, requireRoles } from "./middlewares/auth.middleware";
import driverRoutes from "./routes/driver.routes";
import citizenIssueRoutes from "./routes/citizen-issue.routes";
import commandCenterRoutes from "./routes/command-center.routes";
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

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

app.use("/api/waste", healthRoutes);
app.use("/api/waste/public", regulatoryPublicRoutes);
app.use("/api/waste", requireAuth);
app.use("/api/waste", desktopIdempotency);
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
app.use("/api/waste/compliance/organization",requirePackageFeature("compliance"));
app.use("/api/waste/regulatory", regulatoryRoutes);
app.use("/api/waste/regulatory", applicantOnboardingRoutes);
app.use("/api/waste/regulatory", platformOnboardingRoutes);
app.use("/api/waste", driverRoutes);
app.use("/api/waste", citizenIssueRoutes);
app.use("/api/waste", jobProblemRoutes);
app.use("/api/waste", customerServiceRoutes);
app.use("/api/waste", providerRequestRoutes);
app.use("/api/waste", customerStopRoutes);
app.use("/api/waste", serviceRouteRoutes);
app.use("/api/waste", tripRoutes);
app.use("/api/waste", weighbridgeRoutes);
app.use("/api/waste", complianceRoutes);
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
  (
    error: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const field = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      return res.status(400).json({
        success: false,
        message: `${field}${issue?.message || "Please check the submitted information"}`,
      });
    }
    if ((error as { code?: string; constraint?: string }).code === "23505") {
      const constraint = (error as { constraint?: string }).constraint;
      const message = constraint === "one_open_permit_per_registration"
        ? "An active permit application already exists for this company registration number"
        : constraint === "one_open_account_application_per_admin_email"
          ? "This administrator email is already connected to an active account application"
          : constraint === "one_active_weighbridge_ticket_per_trip"
            ? "This trip already has an active weighbridge ticket"
          : "This information is already registered";
      return res.status(409).json({ success: false, message });
    }
    if (["22P02", "23502", "23514", "42P08"].includes((error as { code?: string }).code || "")) {
      return res.status(400).json({
        success: false,
        message: "This record could not be saved. Check the entered values and try again.",
      });
    }
    return res.status((error as any).statusCode || 400).json({
      success: false,
      message: error.message || "Waste service error",
    });
  }
);

export default app;
