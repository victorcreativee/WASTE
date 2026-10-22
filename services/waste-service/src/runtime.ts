import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { CorsOptions } from "cors";
import { ZodError } from "zod";

/**
 * Production-safety helpers shared by this service's entry points.
 * Kept inside the service (not a shared package) because each service is
 * built independently by infrastructure/production/Dockerfile.backend.
 */

type Closable = { end: () => Promise<void> };

const weakSecret = /^(dev|test|change|replace|secret|password|example)/i;

/** Refuse to boot in production with missing or placeholder configuration. Values are never printed. */
export function assertProductionConfig(
  serviceName: string,
  required: Record<string, string | undefined>,
  secrets: Record<string, string | undefined> = {},
  nodeEnv = process.env.NODE_ENV
) {
  if (nodeEnv !== "production") return;
  const problems: string[] = [];
  for (const [name, value] of Object.entries(required)) {
    if (!value) problems.push(`${name} is missing`);
  }
  for (const [name, value] of Object.entries(secrets)) {
    if (!value) problems.push(`${name} is missing`);
    else if (value.length < 32 || weakSecret.test(value)) {
      problems.push(`${name} must be a random value of at least 32 characters`);
    }
  }
  if (problems.length) {
    throw new Error(`${serviceName} cannot start in production: ${problems.join("; ")}`);
  }
}

/** Express "trust proxy" setting so req.ip is the real client behind nginx and the gateway. */
export function trustProxySetting(value = process.env.TRUST_PROXY): string | number | boolean {
  if (!value) return "loopback, linklocal, uniquelocal";
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/** Start listening and close connections cleanly on SIGTERM/SIGINT (docker stop, deploys). */
export function startServer(
  app: { listen: (port: number, callback: () => void) => Server },
  options: { port: number; serviceName: string; resources?: Closable[]; shutdownTimeoutMs?: number }
) {
  const server = app.listen(options.port, () => {
    console.log(`${options.serviceName} running on port ${options.port}`);
  });
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${options.serviceName} received ${signal}; finishing in-flight requests`);
    const force = setTimeout(() => {
      console.error(`${options.serviceName} did not stop in time; exiting`);
      process.exit(1);
    }, options.shutdownTimeoutMs ?? 10000);
    force.unref();
    server.close(async () => {
      for (const resource of options.resources ?? []) {
        try {
          await resource.end();
        } catch (error) {
          console.error(`${options.serviceName} resource shutdown failed`, error);
        }
      }
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    console.error(`${options.serviceName} unhandled promise rejection`, reason);
  });
  return server;
}

type HttpError = Error & {
  statusCode?: number;
  status?: number;
  code?: string;
  constraint?: string;
  expose?: boolean;
};

const invalidInputCodes = new Set(["22P02", "23502", "23514", "42P08", "22001", "22003", "22007", "22008"]);

/**
 * JSON error responses that keep intentional business messages but never leak
 * unexpected internal errors (database outages, bugs) to clients.
 */
export function createErrorHandler(options: {
  serviceName: string;
  uniqueViolationMessage?: (constraint?: string) => string;
}) {
  return (error: HttpError, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const field = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      return res.status(400).json({
        success: false,
        message: `${field}${issue?.message || "Please check the submitted information"}`,
      });
    }
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: options.uniqueViolationMessage?.(error.constraint) ?? "This information is already registered",
      });
    }
    if (error.code === "23503") {
      return res.status(409).json({
        success: false,
        message: "A related record is unavailable or still in use. Refresh and try again.",
      });
    }
    // Business rules raised by database triggers (RAISE EXCEPTION) carry user-facing messages.
    if (error.code === "P0001") {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.code && invalidInputCodes.has(error.code)) {
      return res.status(400).json({
        success: false,
        message: "This record could not be saved. Check the entered values and try again.",
      });
    }
    const status = Number(error.statusCode ?? error.status);
    if (Number.isInteger(status) && status >= 400 && status < 600) {
      if (status >= 500) console.error(`${options.serviceName} ${req.method} ${req.originalUrl} failed [${requestIdOf(req)}]`, error);
      return res.status(status).json({ success: false, message: error.message || "Request failed", ...(status >= 500 ? { request_id: requestIdOf(req) } : {}) });
    }
    console.error(`${options.serviceName} ${req.method} ${req.originalUrl} unexpected error [${requestIdOf(req)}]`, error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong on our side. Please try again shortly.",
      request_id: requestIdOf(req),
    });
  };
}

// ---------- Request context, CORS and readiness (release hardening) ----------

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Gives every request an id (the gateway's X-Request-Id when well-formed, otherwise a new one), returns it in the
 * response header, and in production writes one JSON log line per request so a support report can be traced across
 * the gateway and services.
 */
export function requestContext(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = String(req.headers["x-request-id"] ?? "");
    const requestId = REQUEST_ID.test(incoming) ? incoming : randomUUID();
    (req as Request & { requestId?: string }).requestId = requestId;
    req.headers["x-request-id"] = requestId;
    res.setHeader("X-Request-Id", requestId);
    if (process.env.NODE_ENV === "production") {
      const started = process.hrtime.bigint();
      res.on("finish", () => {
        console.log(JSON.stringify({
          time: new Date().toISOString(), service: serviceName, request_id: requestId, method: req.method,
          path: req.originalUrl.split("?")[0], status: res.statusCode, ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
        }));
      });
    }
    next();
  };
}

export function requestIdOf(req: Request) {
  return (req as Request & { requestId?: string }).requestId ?? null;
}

/** CORS_ORIGINS="https://a,https://b" restricts browser origins; unset keeps the permissive development default. */
export function corsOptions(value = process.env.CORS_ORIGINS): CorsOptions {
  const origins = (value ?? "").split(",").map(origin => origin.trim().replace(/\/+$/, "")).filter(Boolean);
  return origins.length ? { origin: origins, exposedHeaders: ["X-Request-Id", "Content-Disposition"] } : { exposedHeaders: ["X-Request-Id", "Content-Disposition"] };
}

/**
 * Readiness: the database answers and the tables this release needs exist. Returns 503 with the missing objects
 * otherwise, so a deployment that skipped a migration is caught before it takes traffic.
 */
export function readinessHandler(serviceName: string, query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ missing: string[] | null }> }>, relations: string[]) {
  return async (_req: Request, res: Response) => {
    try {
      const { rows } = await query("SELECT array_agg(r) FILTER (WHERE to_regclass(r) IS NULL) AS missing FROM unnest($1::text[]) r", [relations]);
      const missing = rows[0]?.missing ?? [];
      res.setHeader("Cache-Control", "no-store");
      if (missing.length) return res.status(503).json({ success: false, service: serviceName, status: "not_ready", missing });
      return res.json({ success: true, service: serviceName, status: "ready" });
    } catch {
      return res.status(503).json({ success: false, service: serviceName, status: "not_ready", message: "Database unavailable" });
    }
  };
}
