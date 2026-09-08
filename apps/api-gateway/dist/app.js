"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const health_routes_1 = __importDefault(require("./routes/health.routes"));
const proxy_routes_1 = __importDefault(require("./routes/proxy.routes"));
const request_id_middleware_1 = require("./middlewares/request-id.middleware");
const error_middleware_1 = require("./middlewares/error.middleware");
const app_error_1 = require("./utils/app-error");
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use(request_id_middleware_1.requestIdMiddleware);
app.use((0, morgan_1.default)("dev"));
app.use("/api", health_routes_1.default);
/**
 * IMPORTANT:
 * Proxy routes must come BEFORE express.json().
 * Otherwise POST body can be consumed by API Gateway before reaching services.
 */
app.use("/api", proxy_routes_1.default);
app.use(express_1.default.json({ limit: "10mb" }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((req, res, next) => {
    next(new app_error_1.AppError(`Route not found: ${req.originalUrl}`, 404));
});
app.use(error_middleware_1.errorMiddleware);
exports.default = app;
