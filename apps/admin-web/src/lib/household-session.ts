// Sign-in state shared by the household pages (/my and /join). A household stays signed in on its phone: the refresh
// token is kept in localStorage, the short-lived access token in sessionStorage like the rest of the app.

export type HouseholdSession = { user: { id: string; fullName: string; email: string; organizationId: string | null }; roles: { name: string }[]; tokens: { accessToken: string; refreshToken: string } };

export const HOUSEHOLD_REFRESH_KEY = "kwms.household.refresh";

export function storeHouseholdSession(session: HouseholdSession) {
  sessionStorage.setItem("accessToken", session.tokens.accessToken);
  sessionStorage.setItem("refreshToken", session.tokens.refreshToken);
  sessionStorage.setItem("currentUser", JSON.stringify({ ...session.user, roles: session.roles.map((role) => role.name) }));
  try { localStorage.setItem(HOUSEHOLD_REFRESH_KEY, session.tokens.refreshToken); } catch { /* private browsing: stays signed in for this visit only */ }
}

/** POST without a signed-in session (sign-up and sign-in). Errors carry the HTTP status. */
export async function publicPost<T>(path: string, body: unknown) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as { message?: string; data?: T };
  if (!response.ok) throw Object.assign(new Error(payload.message || "Something went wrong. Try again."), { status: response.status });
  return payload.data as T;
}

export async function publicGet<T>(path: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}${path}`);
  const payload = await response.json().catch(() => ({})) as { message?: string; data?: T };
  if (!response.ok) throw new Error(payload.message || "Something went wrong. Try again.");
  return payload.data as T;
}

/** Greater Kampala, generously: a phone position outside it is a GPS error or someone away from home. */
export function inKampala(latitude: number, longitude: number) {
  return latitude > 0.05 && latitude < 0.65 && longitude > 32.25 && longitude < 32.95;
}

export type Collector = { id: string; name: string; phone: string | null; email: string | null; match: "location" | "area" | "division"; from_fee_ugx: string | null };

export const CUSTOMER_TYPES = [
  ["residential", "Home"],
  ["office_business", "Office or business"],
  ["commercial", "Shop, market or restaurant"],
  ["industrial", "Factory or industry"],
] as const;

/** Why a company is suggested for a place, in the customer's words. */
export function matchLabel(collector: Pick<Collector, "match">, areaName?: string | null, divisionName?: string | null) {
  if (collector.match === "location") return "Serves your exact location";
  if (collector.match === "area") return areaName ? `Serves ${areaName}` : "Serves your area";
  return divisionName ? `Works in ${divisionName}` : "Works in your division";
}
