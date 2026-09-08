"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const http_proxy_middleware_1 = require("http-proxy-middleware");
const env_1 = require("../config/env");
const router = (0, express_1.Router)();
router.use("/auth", (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: env_1.env.authServiceUrl,
    changeOrigin: true,
    pathRewrite: (path) => {
        return `/api/auth${path.replace(/^\/auth/, "")}`;
    },
}));
router.use("/organizations", (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: env_1.env.organizationServiceUrl,
    changeOrigin: true,
    pathRewrite: (path) => {
        return `/api/organizations${path.replace(/^\/organizations/, "")}`;
    },
}));
router.use("/waste", (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: env_1.env.wasteServiceUrl,
    changeOrigin: true,
    pathRewrite: (path) => {
        return `/api/waste${path.replace(/^\/waste/, "")}`;
    },
}));
exports.default = router;
