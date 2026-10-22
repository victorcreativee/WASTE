// Illegal dumping rules: when a new report joins an existing site, how long a cleanup may take, which status moves are
// allowed, and what makes a site a hotspot or a company a repeat offender. Pure so KCCA can review the thresholds and
// tests can pin them; the database guard (migration 100) enforces the same status moves.

export const DUMPING_RULES = {
  /** A report within this distance of an open site (or of a site cleared recently) belongs to that site. */
  mergeRadiusM: 75,
  /** A report at a site cleared within this many days counts as the dumping coming back. */
  recurrenceDays: 90,
  /** Days allowed for a cleanup, by size; hazardous waste always gets the shortest time. */
  cleanupDays: { small: 3, medium: 5, large: 7 } as Record<Size, number>,
  hazardousCleanupDays: 2,
  /** Reports or recurrences at one site that make it a hotspot. */
  hotspotReports: 3,
  hotspotRecurrences: 1,
  /** Sites attributed to one company within the window that make it a repeat offender. */
  repeatOffences: 3,
  repeatWindowDays: 90,
  /** Greater Kampala, generously; reports outside it are refused. */
  bounds: { south: 0.1, north: 0.55, west: 32.35, east: 32.85 },
  maxPhotosPerSite: 20,
};

export const SIZES = ["small", "medium", "large"] as const;
export type Size = typeof SIZES[number];
export const WASTE_TYPES = ["household", "commercial", "construction", "organic", "hazardous", "other"] as const;
export const STATUSES = ["reported", "verified", "cleanup_ordered", "cleanup_reported", "cleared", "dismissed"] as const;
export type SiteStatus = typeof STATUSES[number];
export const OPEN_STATUSES: SiteStatus[] = ["reported", "verified", "cleanup_ordered", "cleanup_reported"];

const MOVES: Record<SiteStatus, SiteStatus[]> = {
  reported: ["verified", "dismissed"],
  verified: ["cleanup_ordered", "dismissed"],
  cleanup_ordered: ["cleanup_reported", "cleared"],
  cleanup_reported: ["cleared", "cleanup_ordered"],
  cleared: ["reported"],
  dismissed: [],
};

export function canMove(from: SiteStatus, to: SiteStatus): boolean {
  return MOVES[from].includes(to);
}

export function insideKampala(latitude: number, longitude: number): boolean {
  const b = DUMPING_RULES.bounds;
  return latitude >= b.south && latitude <= b.north && longitude >= b.west && longitude <= b.east;
}

/** Days allowed for the cleanup of a site of this size. */
export function cleanupDaysFor(size: Size, hazardous: boolean): number {
  return hazardous ? DUMPING_RULES.hazardousCleanupDays : DUMPING_RULES.cleanupDays[size];
}

/** The due date KCCA may set: from today up to the allowed days; defaults to the allowed days. */
export function cleanupDueError(dueOn: string, today: string, size: Size, hazardous: boolean): string | null {
  if (dueOn < today) return "The cleanup deadline cannot be in the past";
  const latest = new Date(Date.parse(`${today}T00:00:00Z`) + cleanupDaysFor(size, hazardous) * 86400000).toISOString().slice(0, 10);
  return dueOn > latest ? `A ${hazardous ? "hazardous" : size} site must be cleaned up within ${cleanupDaysFor(size, hazardous)} days` : null;
}

export function isHotspot(site: { report_count: number; recurrence_count: number }): boolean {
  return site.report_count >= DUMPING_RULES.hotspotReports || site.recurrence_count >= DUMPING_RULES.hotspotRecurrences;
}

/** Whether a report at an existing site joins it as a further report, brings it back, or starts a new site. */
export function reportOutcome(site: { status: SiteStatus; cleared_days_ago: number | null } | null): "new_site" | "additional_report" | "recurred" {
  if (!site) return "new_site";
  if (OPEN_STATUSES.includes(site.status)) return "additional_report";
  if (site.status === "cleared" && site.cleared_days_ago !== null && site.cleared_days_ago <= DUMPING_RULES.recurrenceDays) return "recurred";
  return "new_site";
}

/** Days from the first report to clearance, median, one decimal place; null without cleared sites. */
export function medianDays(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(median * 10) / 10;
}

export const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
