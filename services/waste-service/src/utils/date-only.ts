/**
 * YYYY-MM-DD for a value read from a PostgreSQL DATE column or sent by a client.
 * node-postgres turns DATE into a JS Date at local midnight on this server, and String(date) gives
 * "Fri Oct 23 2026 …", so slicing the string never matches an ISO day. Read the local calendar parts instead.
 */
export function dateOnly(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value || "").slice(0, 10);
}
