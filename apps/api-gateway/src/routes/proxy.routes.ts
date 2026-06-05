import { Router } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { env } from "../config/env";

const router = Router();

router.use(
  "/auth",
  createProxyMiddleware({
    target: env.authServiceUrl,
    changeOrigin: true,
    pathRewrite: (path) => {
      return `/api/auth${path.replace(/^\/auth/, "")}`;
    },
  })
);

router.use(
  "/organizations",
  createProxyMiddleware({
    target: env.organizationServiceUrl,
    changeOrigin: true,
    pathRewrite: (path) => {
      return `/api/organizations${path.replace(/^\/organizations/, "")}`;
    },
  })
);

router.use(
  "/waste",
  createProxyMiddleware({
    target: env.wasteServiceUrl,
    changeOrigin: true,
    pathRewrite: (path) => {
      return `/api/waste${path.replace(/^\/waste/, "")}`;
    },
  })
);

export default router;
