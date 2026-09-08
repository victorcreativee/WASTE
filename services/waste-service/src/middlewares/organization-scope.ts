import { AuthenticatedRequest } from "./auth.middleware";

/** Private organization data never has a platform-wide/null scope. */
export function requireOrganizationScope(req: AuthenticatedRequest): string {
  const auth = req.auth;
  if (!auth) throw Object.assign(new Error("Authentication is required"), { statusCode: 401 });
  if (!auth.roles.some(role => ["company_admin", "supervisor"].includes(role)) || !auth.organizationId) {
    throw Object.assign(new Error("An authorized organization context is required"), { statusCode: 403 });
  }
  return auth.organizationId;
}

/** Only explicitly admitted city/platform roles may use city-wide operational queries. */
export function operationalOrganizationScope(req: AuthenticatedRequest): string | null {
  const auth = req.auth;
  if (!auth) throw Object.assign(new Error("Authentication is required"), { statusCode: 401 });
  if (auth.roles.some(role => ["company_admin", "supervisor"].includes(role))) {
    return requireOrganizationScope(req);
  }
  // Driver endpoints add their own user/assignment filter as well as this tenant scope.
  if (auth.roles.includes("driver")) {
    if (auth.organizationId) return auth.organizationId;
    throw Object.assign(new Error("An organization context is required"), { statusCode: 403 });
  }
  if (auth.roles.some(role => ["kcca_admin", "system_admin"].includes(role))) return null;
  throw Object.assign(new Error("Operational access is not permitted"), { statusCode: 403 });
}
