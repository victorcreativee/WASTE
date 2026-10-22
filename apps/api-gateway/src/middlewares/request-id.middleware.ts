import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Assigns the request id that every service logs and returns. A client-supplied id is kept only when well-formed,
 * so arbitrary text cannot be injected into logs. In production one JSON line is logged per request.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers["x-request-id"]?.toString() ?? "";
  const requestId = REQUEST_ID.test(incoming) ? incoming : randomUUID();

  req.headers["x-request-id"] = requestId;
  res.setHeader("x-request-id", requestId);
  if (process.env.NODE_ENV === "production") {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      console.log(JSON.stringify({
        time: new Date().toISOString(), service: "api-gateway", request_id: requestId, method: req.method,
        path: req.originalUrl.split("?")[0], status: res.statusCode, ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
      }));
    });
  }
  next();
}
