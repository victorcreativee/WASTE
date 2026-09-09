"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const zod_1 = require("zod");
const health_routes_1 = __importDefault(require("./routes/health.routes"));
const waste_routes_1 = __importDefault(require("./routes/waste.routes"));
const routing_routes_1 = __importDefault(require("./routes/routing.routes"));
const auth_middleware_1 = require("./middlewares/auth.middleware");
const driver_routes_1 = __importDefault(require("./routes/driver.routes"));
const citizen_issue_routes_1 = __importDefault(require("./routes/citizen-issue.routes"));
const command_center_routes_1 = __importDefault(require("./routes/command-center.routes"));
const job_problem_routes_1 = __importDefault(require("./routes/job-problem.routes"));
const customer_service_routes_1 = __importDefault(require("./routes/customer-service.routes"));
const route_execution_routes_1 = __importDefault(require("./routes/route-execution.routes"));
const billing_routes_1 = __importDefault(require("./routes/billing.routes"));
const fleet_routes_1 = __importDefault(require("./routes/fleet.routes"));
const expense_routes_1 = __importDefault(require("./routes/expense.routes"));
const inventory_routes_1 = __importDefault(require("./routes/inventory.routes"));
const procurement_routes_1 = __importDefault(require("./routes/procurement.routes"));
const payables_routes_1 = __importDefault(require("./routes/payables.routes"));
const report_routes_1 = __importDefault(require("./routes/report.routes"));
const contract_routes_1 = __importDefault(require("./routes/contract.routes"));
const provider_request_routes_1 = __importDefault(require("./routes/provider-request.routes"));
const customer_stop_routes_1 = __importDefault(require("./routes/customer-stop.routes"));
const regulatory_public_routes_1 = __importDefault(require("./routes/regulatory-public.routes"));
const regulatory_routes_1 = __importDefault(require("./routes/regulatory.routes"));
const applicant_onboarding_routes_1 = __importDefault(require("./routes/applicant-onboarding.routes"));
const platform_onboarding_routes_1 = __importDefault(require("./routes/platform-onboarding.routes"));
const service_route_routes_1 = __importDefault(require("./routes/service-route.routes"));
const trip_routes_1 = __importDefault(require("./routes/trip.routes"));
const weighbridge_routes_1 = __importDefault(require("./routes/weighbridge.routes"));
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "10mb" }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, morgan_1.default)("dev"));
app.use("/api/waste", health_routes_1.default);
app.use("/api/waste/public", regulatory_public_routes_1.default);
app.use("/api/waste", auth_middleware_1.requireAuth);
app.use("/api/waste/regulatory", regulatory_routes_1.default);
app.use("/api/waste/regulatory", applicant_onboarding_routes_1.default);
app.use("/api/waste/regulatory", platform_onboarding_routes_1.default);
app.use("/api/waste", driver_routes_1.default);
app.use("/api/waste", citizen_issue_routes_1.default);
app.use("/api/waste", job_problem_routes_1.default);
app.use("/api/waste", customer_service_routes_1.default);
app.use("/api/waste", provider_request_routes_1.default);
app.use("/api/waste", customer_stop_routes_1.default);
app.use("/api/waste", service_route_routes_1.default);
app.use("/api/waste", trip_routes_1.default);
app.use("/api/waste", weighbridge_routes_1.default);
app.use("/api/waste", route_execution_routes_1.default);
app.use("/api/waste", billing_routes_1.default);
app.use("/api/waste", fleet_routes_1.default);
app.use("/api/waste", expense_routes_1.default);
app.use("/api/waste", inventory_routes_1.default);
app.use("/api/waste", procurement_routes_1.default);
app.use("/api/waste", payables_routes_1.default);
app.use("/api/waste", report_routes_1.default);
app.use("/api/waste", contract_routes_1.default);
app.use("/api/waste", (0, auth_middleware_1.requireRoles)("system_admin", "kcca_admin", "company_admin", "supervisor"));
app.use("/api/waste/routing", routing_routes_1.default);
app.use("/api/waste", command_center_routes_1.default);
app.use("/api/waste", waste_routes_1.default);
app.use((req, res) => {
    return res.status(404).json({
        success: false,
        message: "Route not found",
        path: req.originalUrl,
    });
});
app.use((error, req, res, next) => {
    if (error instanceof zod_1.ZodError) {
        const issue = error.issues[0];
        const field = issue?.path.length ? `${issue.path.join(".")}: ` : "";
        return res.status(400).json({
            success: false,
            message: `${field}${issue?.message || "Please check the submitted information"}`,
        });
    }
    if (error.code === "23505") {
        const constraint = error.constraint;
        const message = constraint === "one_open_permit_per_registration"
            ? "An active permit application already exists for this company registration number"
            : constraint === "one_open_account_application_per_admin_email"
                ? "This administrator email is already connected to an active account application"
                : "This information is already registered";
        return res.status(409).json({ success: false, message });
    }
    return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message || "Waste service error",
    });
});
exports.default = app;
