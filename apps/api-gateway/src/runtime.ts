import type { Server } from "node:http";

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
