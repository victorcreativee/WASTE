import type { PoolClient } from "pg";

// Thin wrappers over the SQL notification functions (migration 098). Call them inside the transaction that records the
// event, so a notification exists exactly when the event does. Before 098 is applied they do nothing.

export type Category = "permit" | "renewal" | "returns" | "compliance" | "custody" | "disposal" | "dumping" | "penalties" | "billing" | "system";
export type Severity = "info" | "warning" | "critical";
type Message = { category: Category; severity: Severity; title: string; body: string; link: string; dedupeKey: string };

async function tolerant(client: PoolClient, sql: string, params: unknown[]) {
  await client.query("SAVEPOINT notify");
  try {
    await client.query(sql, params);
    await client.query("RELEASE SAVEPOINT notify");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT notify");
    if ((error as { code?: string }).code !== "42883") throw error;
  }
}

/** Notifies active members of an organization with one of the roles (company_admin, supervisor, ...). */
export function notifyOrganization(client: PoolClient, organizationId: string, roles: string[], m: Message) {
  return tolerant(client, "SELECT notify_organization($1::uuid,$2::text[],$3,$4,$5,$6,$7,$8)",
    [organizationId, roles, m.category, m.severity, m.title, m.body, m.link, m.dedupeKey]);
}

/** Notifies every active holder of a platform role, e.g. all KCCA administrators. */
export function notifyRole(client: PoolClient, role: string, m: Message, organizationId: string | null = null) {
  return tolerant(client, "SELECT notify_role($1,$2,$3,$4,$5,$6,$7,$8::uuid)",
    [role, m.category, m.severity, m.title, m.body, m.link, m.dedupeKey, organizationId]);
}

export const complianceSeverity = (severity: string): Severity => severity === "critical" ? "critical" : severity === "warning" ? "warning" : "info";
