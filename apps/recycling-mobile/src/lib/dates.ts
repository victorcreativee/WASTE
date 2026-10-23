/**
 * The calendar day (YYYY-MM-DD) on this phone for a date or timestamp from the server, or for now.
 * PostgreSQL DATE columns arrive as the server's local midnight written in UTC (for example
 * "2026-10-22T21:00:00.000Z" for 23 October in Kampala), so cutting the string at 10 characters gives the wrong day.
 */
export function localDay(value?: string | Date | null) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value.slice(0, 10) : "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The calendar day `days` after (or before, when negative) a YYYY-MM-DD day. */
export function addDays(day: string, days: number) {
  const [year, month, date] = day.split("-").map(Number);
  return localDay(new Date(year, month - 1, date + days));
}

/** "Friday 23 October 2026" for a YYYY-MM-DD day; the year is left out when it is the current one. */
export function formatDay(day: string, withWeekday = true) {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year, month - 1, date);
  return value.toLocaleDateString("en-GB", {
    ...(withWeekday ? { weekday: "long" as const } : {}),
    day: "numeric",
    month: "long",
    ...(year !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
  });
}
