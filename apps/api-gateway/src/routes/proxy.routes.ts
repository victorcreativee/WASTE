import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Router } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { env } from "../config/env";

const router = Router();

/** Upstream service unavailable: answer with the platform's JSON shape instead of hanging or sending HTML. */
function upstreamUnavailable(service: string) {
  return (error: Error, req: IncomingMessage, res: ServerResponse | Socket) => {
    console.error(`[api-gateway] ${service} proxy error for ${req.method} ${req.url}: ${error.message}`);
    if (!("writeHead" in res) || res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, message: "This service is temporarily unavailable. Please try again shortly." }));
  };
}

function serviceProxy(prefix: string, target: string, service: string) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    // Forward X-Forwarded-For/Proto so services can rate-limit and audit the real client.
    xfwd: true,
    proxyTimeout: 120000,
    timeout: 125000,
    pathRewrite: (path) => `/api${prefix}${path.replace(new RegExp(`^\\${prefix}`), "")}`,
    on: { error: upstreamUnavailable(service) },
  });
}

router.use("/auth", serviceProxy("/auth", env.authServiceUrl, "auth-service"));
router.use("/organizations", serviceProxy("/organizations", env.organizationServiceUrl, "organization-service"));
router.use("/waste", serviceProxy("/waste", env.wasteServiceUrl, "waste-service"));

export default router;
