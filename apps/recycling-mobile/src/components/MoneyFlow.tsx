import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Share, StyleSheet, Text, View } from "react-native";
import { addDays, formatDay, localDay } from "../lib/dates";
import { mobileRequest, readCachedResponse } from "../lib/mobile-api";
import { Banner, Button, Card, Chips, DateField, EmptyState, Field, SectionHeader, SummaryCard } from "../ui/kit";
import { color, radius, space, type, ugx } from "../ui/theme";

type Line = { direction: "in" | "out" | "transfer"; kind: string; amount: number; entries: number };
type Flow = { from: string; to: string; moneyIn: number; moneyOut: number; net: number; lines: Line[]; days: { day: string; in: number; out: number }[]; cashNow: number; floatNow?: number; officeCashNow?: number };
type Period = "today" | "week" | "month" | "last-month" | "custom";

const LABEL: Record<string, string> = {
  buyer_payments: "Paid by buyers",
  customer_payments: "Customer payments",
  office_capital_contribution: "Capital put in",
  office_other_income: "Other income",
  office_owner_withdrawal: "Owner withdrawals",
  office_correction: "Corrections",
  supplier_payments: "Paid to suppliers",
  supplier_bills: "Supplier bills",
  sale_costs: "Sale costs (loading, transport, food)",
  sorting_costs: "Sorting costs",
  float_expenses: "Expenses paid from float",
  office_expenses: "Expenses paid by the office",
  float_given: "Float issued to the manager",
  float_returned: "Float returned to the office",
};

/** Short amounts for the narrow summary figures: 7,986,000 becomes 7.99M. */
const short = (amount: number) =>
  Math.abs(amount) >= 1_000_000 ? `${(amount / 1_000_000).toLocaleString("en-GB", { maximumFractionDigits: 2 })}M` : Math.round(amount).toLocaleString("en-GB");

function range(period: Period, custom: { from: string; to: string }) {
  const today = localDay();
  const [year, month] = today.split("-").map(Number);
  if (period === "today") return { from: today, to: today };
  if (period === "week") {
    const weekday = (new Date().getDay() + 6) % 7; // Monday first
    return { from: addDays(today, -weekday), to: today };
  }
  if (period === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (period === "last-month") {
    const first = localDay(new Date(year, month - 2, 1));
    return { from: first, to: localDay(new Date(year, month - 1, 0)) };
  }
  return custom;
}

/** Money that came into and went out of the business over a period, with float hand-overs kept apart. */
export function MoneyFlow({ token, email }: { token: string; email: string }) {
  const [period, setPeriod] = useState<Period>("month");
  const [custom, setCustom] = useState({ from: addDays(localDay(), -6), to: localDay() });
  const [flow, setFlow] = useState<Flow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { from, to } = range(period, custom);
  const path = `/api/waste/recycling/cash-flow?from=${from}&to=${to}`;

  const load = useCallback(async () => {
    setLoading(true);
    const cached = await readCachedResponse<{ data: Flow }>(path, email);
    if (cached?.data) setFlow(cached.data);
    try {
      const result = await mobileRequest<{ data: Flow }>(path, token, email);
      setFlow(result.data);
      setError("");
    } catch (cause) {
      setError(cached?.data
        ? "Showing the copy saved on this phone for this period."
        : cause instanceof Error ? cause.message : "Connect to load this period.");
    } finally {
      setLoading(false);
    }
  }, [path, token, email]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const showing = flow && flow.from === from && flow.to === to ? flow : null;
  const lines = (direction: Line["direction"]) => (showing?.lines || []).filter((line) => line.direction === direction);
  const peak = Math.max(1, ...(showing?.days || []).map((day) => Math.max(day.in, day.out)));
  const label = from === to ? formatDay(from) : `${formatDay(from, false)} – ${formatDay(to, false)}`;

  function share() {
    if (!showing) return;
    const text = [
      `Money in and out · ${label}`,
      `Money in: ${ugx(showing.moneyIn)}`,
      ...lines("in").map((line) => `  ${LABEL[line.kind] || line.kind}: ${ugx(line.amount)}`),
      `Money out: ${ugx(showing.moneyOut)}`,
      ...lines("out").map((line) => `  ${LABEL[line.kind] || line.kind}: ${ugx(line.amount)}`),
      `Net: ${showing.net >= 0 ? "+" : "−"}${ugx(Math.abs(showing.net))}`,
      ...(lines("transfer").length ? ["Moved between office and float:", ...lines("transfer").map((line) => `  ${LABEL[line.kind] || line.kind}: ${ugx(line.amount)}`)] : []),
      ...(showing.floatNow !== undefined ? [`Manager float now: ${ugx(showing.floatNow)}`, `Office cash now: ${ugx(showing.officeCashNow ?? showing.cashNow - showing.floatNow)}`] : []),
      `Company cash now: ${ugx(showing.cashNow)}`,
    ].join("\n");
    void Share.share({ message: text });
  }

  return <View style={{ gap: space.lg }}>
    <Card>
      <Text style={type.heading}>Period</Text>
      <Chips value={period} onChange={(value) => setPeriod(value as Period)} options={[
        { value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" },
        { value: "last-month", label: "Last month" }, { value: "custom", label: "Choose dates" },
      ]} />
      {period === "custom" ? <>
        <Field label="From"><DateField value={custom.from} onChange={(value) => setCustom((current) => ({ from: value, to: current.to < value ? value : current.to }))} /></Field>
        <Field label="To"><DateField value={custom.to} min={custom.from} onChange={(value) => setCustom((current) => ({ ...current, to: value }))} /></Field>
      </> : <Text style={type.small}>{label}</Text>}
    </Card>

    {error ? <Banner tone="warning" text={error} /> : null}
    {loading && !showing ? <View style={s.center}><ActivityIndicator color={color.action} /><Text style={type.small}>Adding up the money…</Text></View> : null}

    {showing ? <>
      <SummaryCard label={`Net · ${showing.net >= 0 ? "more came in than went out" : "more went out than came in"}`}
        value={`${showing.net >= 0 ? "+" : "−"} ${ugx(Math.abs(showing.net))}`}
        stats={[
          { label: "Money in", value: short(showing.moneyIn) },
          { label: "Money out", value: short(showing.moneyOut) },
          { label: "Cash now", value: short(showing.cashNow) },
        ]} />

      {showing.floatNow !== undefined ? <Card style={{ gap: space.sm }}>
        <Text style={type.heading}>Where the money is now</Text>
        <View style={s.row}><Text style={[type.body, { flex: 1 }]}>Manager float · available to spend</Text><Text style={[type.body, s.amount]}>{ugx(showing.floatNow)}</Text></View>
        <View style={s.row}><Text style={[type.body, { flex: 1 }]}>Office cash</Text><Text style={[type.body, s.amount]}>{ugx(showing.officeCashNow ?? showing.cashNow - showing.floatNow)}</Text></View>
        <View style={s.row}><Text style={[type.body, { flex: 1 }, s.strong]}>Company cash</Text><Text style={[type.body, s.amount, s.strong]}>{ugx(showing.cashNow)}</Text></View>
      </Card> : null}

      {!showing.lines.length ? <EmptyState icon="swap-vertical-outline" title="No money moved in this period" text="Choose another period." /> : null}

      {lines("in").length ? <>
        <SectionHeader title={`Money in · ${ugx(showing.moneyIn)}`} />
        <Card style={{ gap: space.sm }}>{lines("in").map((line) => <Row key={line.kind} line={line} sign="+" tone={color.success} />)}</Card>
      </> : null}

      {lines("out").length ? <>
        <SectionHeader title={`Money out · ${ugx(showing.moneyOut)}`} />
        <Card style={{ gap: space.sm }}>{lines("out").map((line) => <Row key={line.kind} line={line} sign="−" tone={color.danger} />)}</Card>
      </> : null}

      {lines("transfer").length ? <>
        <SectionHeader title="Moved between office and float" />
        <Card style={{ gap: space.sm }}>
          {lines("transfer").map((line) => <Row key={line.kind} line={line} sign="" />)}
          <Text style={type.caption}>This changes who holds the money, not how much the business has, so it is not counted as money in or out.</Text>
        </Card>
      </> : null}

      {showing.days.length > 1 ? <>
        <SectionHeader title="Day by day" />
        <Card style={{ gap: space.md }}>
          {showing.days.slice().reverse().map((day) => <View key={day.day} style={{ gap: 4 }}>
            <View style={s.dayHead}>
              <Text style={type.label}>{formatDay(day.day, false)}</Text>
              <Text style={[type.small, { color: day.in - day.out >= 0 ? color.success : color.danger }]}>{day.in - day.out >= 0 ? "+" : "−"} {ugx(Math.abs(day.in - day.out))}</Text>
            </View>
            <Bar value={day.in} peak={peak} tint={color.success} label={`In ${ugx(day.in)}`} />
            <Bar value={day.out} peak={peak} tint={color.danger} label={`Out ${ugx(day.out)}`} />
          </View>)}
        </Card>
      </> : null}

      <Button variant="secondary" icon="share-outline" title="Share this summary" onPress={share} />
    </> : null}
  </View>;
}

function Row({ line, sign, tone }: { line: Line; sign: string; tone?: string }) {
  return <View style={s.row}>
    <View style={{ flex: 1 }}>
      <Text style={type.body}>{LABEL[line.kind] || line.kind.replaceAll("_", " ")}</Text>
      <Text style={type.caption}>{line.entries} record{line.entries === 1 ? "" : "s"}</Text>
    </View>
    <Text style={[type.body, s.amount, tone ? { color: tone } : null]}>{sign ? `${sign} ` : ""}{ugx(line.amount)}</Text>
  </View>;
}

function Bar({ value, peak, tint, label }: { value: number; peak: number; tint: string; label: string }) {
  return <View style={s.barRow} accessibilityLabel={label}>
    <View style={s.barTrack}><View style={[s.barFill, { width: `${Math.max(value ? 2 : 0, (value / peak) * 100)}%`, backgroundColor: tint }]} /></View>
    <Text style={[type.caption, s.barValue]}>{ugx(value).replace("UGX ", "")}</Text>
  </View>;
}

const s = StyleSheet.create({
  center: { alignItems: "center", gap: space.sm, paddingVertical: space.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  amount: { fontWeight: "600", color: color.ink },
  strong: { fontWeight: "700" },
  dayHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  barRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  barTrack: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: color.fill, overflow: "hidden" },
  barFill: { height: 8, borderRadius: radius.pill },
  barValue: { width: 84, textAlign: "right" },
});
