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
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const organization_access_routes_1 = __importDefault(require("./routes/organization-access.routes"));
const onboarding_routes_1 = __importDefault(require("./routes/onboarding.routes"));
const organization_user_routes_1 = __importDefault(require("./routes/organization-user.routes"));
const system_bootstrap_routes_1 = __importDefault(require("./routes/system-bootstrap.routes"));
const platform_user_routes_1 = __importDefault(require("./routes/platform-user.routes"));
const health_routes_1 = __importDefault(require("./routes/health.routes"));
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "10mb" }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, morgan_1.default)("dev"));
app.use("/api/auth", health_routes_1.default);
app.use("/api/auth", system_bootstrap_routes_1.default);
app.use("/api/auth", platform_user_routes_1.default);
app.use("/api/auth", auth_routes_1.default);
app.use("/api/auth", organization_access_routes_1.default);
app.use("/api/auth", onboarding_routes_1.default);
app.use("/api/auth", organization_user_routes_1.default);
app.use((error, req, res, next) => {
    if (error instanceof zod_1.ZodError) {
        const issue = error.issues[0];
        return res.status(400).json({ success: false, message: `${issue.path.length ? issue.path.join('.') + ': ' : ''}${issue.message}` });
    }
    return res.status(error.statusCode || 400).json({ success: false, message: error.message || "Authentication service error" });
});
app.use((req, res) => {
    return res.status(404).json({
        success: false,
        message: "Route not found",
        path: req.originalUrl,
    });
});
exports.default = app;
