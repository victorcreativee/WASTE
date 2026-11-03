import { NextFunction, Request, Response } from "express";
import { ApiKey, authenticateKey, recordUsage } from "../repositories/open-api.repository";
import { ApiScope, MinuteLimiter, parseApiKey } from "../services/api-keys";

// Authentication for /api/v1 (migration 116). The key comes as `Authorization: Bearer kwms_...` or `X-API-Key`.

export type ApiKeyRequest = Request & { apiKey?: ApiKey };
const keys = new MinuteLimiter(), failures = new MinuteLimiter();
const FAILED_ATTEMPTS_PER_MINUTE = 20;

export const apiError = (res: Response, status: number, code: string, message: string) =>
  res.status(status).json({ error: { code, message } });

function presentedKey(req: Request) {
  const header = req.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7);
  return req.get("x-api-key");
}

export async function requireApiKey(req: ApiKeyRequest, res: Response, next: NextFunction) {
  try {
    res.setHeader("Cache-Control", "no-store");
    const address = req.ip ?? "unknown";
    const parsed = parseApiKey(presentedKey(req));
    const key = parsed ? await authenticateKey(parsed.prefix, parsed.hash, req.ip ?? null) : null;
    if (!key) {
      if (!failures.take(address, FAILED_ATTEMPTS_PER_MINUTE).allowed) return apiError(res, 429, "too_many_failures", "Too many requests with an invalid key. Wait one minute.");
      return apiError(res, 401, "invalid_key", "Send a valid, unrevoked API key as 'Authorization: Bearer kwms_...'.");
    }
    const limit = keys.take(key.id, key.rate_limit_per_minute);
    res.setHeader("X-RateLimit-Limit", String(key.rate_limit_per_minute));
    res.setHeader("X-RateLimit-Remaining", String(limit.remaining));
    res.setHeader("X-RateLimit-Reset", String(limit.resetSeconds));
    const endpoint = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`.slice(0, 120);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.resetSeconds));
      void recordUsage(key, endpoint, true).catch(() => undefined);
      return apiError(res, 429, "rate_limited", `This key allows ${key.rate_limit_per_minute} requests a minute.`);
    }
    req.apiKey = key;
    res.on("finish", () => { void recordUsage(key, `${req.method} ${req.baseUrl}${req.route?.path ?? ""}`.slice(0, 120), res.statusCode >= 400).catch(() => undefined); });
    next();
  } catch (error) {
    next(error);
  }
}

export const requireScope = (scope: ApiScope) => (req: ApiKeyRequest, res: Response, next: NextFunction) =>
  req.apiKey?.scopes.includes(scope) ? next() : apiError(res, 403, "missing_scope", `This key does not have the ${scope} scope.`);
