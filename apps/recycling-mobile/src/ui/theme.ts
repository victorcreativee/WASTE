// Design tokens for the mobile app. Colours follow the web platform (action blue, slate neutrals); shapes are moderate
// rather than bubbly, and weights stop at 700 so screens read calmly in the field.

export const color = {
  page: "#f5f7fa",
  surface: "#ffffff",
  fill: "#f1f4f8",
  line: "#e3e8ef",
  ink: "#0f172a",
  text: "#334155",
  muted: "#64748b",
  subtle: "#94a3b8",
  action: "#2952cc",
  actionPressed: "#2145b0",
  actionSoft: "#eef2fd",
  actionInk: "#1e3a8a",
  success: "#15803d",
  successSoft: "#ecf8f0",
  warning: "#b45309",
  warningSoft: "#fef6e7",
  danger: "#b91c1c",
  dangerSoft: "#fdf0f0",
  brand: "#14213d",
  brandAccent: "#f2b657",
};

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };

export const type = {
  display: { fontSize: 26, lineHeight: 32, fontWeight: "700" as const, color: color.ink },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "700" as const, color: color.ink },
  heading: { fontSize: 16, lineHeight: 22, fontWeight: "600" as const, color: color.ink },
  body: { fontSize: 15, lineHeight: 22, color: color.text },
  small: { fontSize: 13, lineHeight: 19, color: color.muted },
  caption: { fontSize: 12, lineHeight: 16, color: color.muted },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "600" as const, color: color.text },
};

export const shadow = {
  card: { shadowColor: "#0f172a", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  float: { shadowColor: "#0f172a", shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
};

export type Tone = "action" | "success" | "warning" | "danger" | "neutral";
export const tone: Record<Tone, { ink: string; soft: string }> = {
  action: { ink: color.action, soft: color.actionSoft },
  success: { ink: color.success, soft: color.successSoft },
  warning: { ink: color.warning, soft: color.warningSoft },
  danger: { ink: color.danger, soft: color.dangerSoft },
  neutral: { ink: color.muted, soft: color.fill },
};

export const ugx = (amount: number | string | null | undefined) => `UGX ${Math.round(Number(amount || 0)).toLocaleString("en-GB")}`;
export const initials = (name: string | null | undefined) =>
  (name || "KW").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "KW";
