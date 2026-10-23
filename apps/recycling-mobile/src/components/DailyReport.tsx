import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Share, StyleSheet, Text, View } from "react-native";
import { formatDay, localDay } from "../lib/dates";
import { mobileRequest, readCachedResponse } from "../lib/mobile-api";
import { Banner, Button, Card, DateField, EmptyState, ListRow, SectionHeader, SummaryCard } from "../ui/kit";
import { color, space, type, ugx } from "../ui/theme";

type Row = Record<string, unknown>;
type Workspace = {
  organization?: { name?: string };
  lots?: Row[];
  sales?: Row[];
  salePayments?: Row[];
  purchasePayments?: Row[];
  floatTransactions?: Row[];
  sortingBatches?: Row[];
  stockAdjustments?: Row[];
  cashMovements?: Row[];
  dailyClosures?: Row[];
};

const num = (value: unknown) => Number(value || 0);
const kg = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })} kg`;
const on = (day: string, value: unknown) => localDay(String(value || "")) === day;
const lotCost = (lot: Row) =>
  num(lot.total_cost_ugx) ||
  Math.round(num(lot.quantity_kg) * num(lot.unit_purchase_price_ugx)) + num(lot.worker_wages_ugx) + num(lot.food_ugx) + num(lot.transport_ugx) + num(lot.driver_fee_ugx) + num(lot.other_expense_ugx);
const floatSign = (row: Row) => (row.transaction_type === "given" ? 1 : -1);

/** Everything recorded for one business day: purchases, sales, money in and out, the manager float, sorting and stock. */
function buildReport(data: Workspace, day: string) {
  const lots = (data.lots || []).filter((lot) => (lot.origin ?? "purchase") === "purchase" && on(day, lot.collected_on));
  const sales = (data.sales || []).filter((sale) => on(day, sale.sold_on));
  const received = (data.salePayments || []).filter((payment) => on(day, payment.paid_on));
  const lotsById = new Map((data.lots || []).map((lot) => [String(lot.id), lot]));
  // A purchase paid on the spot writes its payment in the same moment as the purchase; anything later is a
  // payment against a credit purchase.
  const spot = (payment: Row) => {
    const lot = lotsById.get(String(payment.lot_id));
    return Boolean(lot) && Math.abs(new Date(String(payment.created_at)).getTime() - new Date(String(lot?.created_at)).getTime()) < 60_000;
  };
  const payments = data.purchasePayments || [];
  const supplierPayments = payments.filter((payment) => on(day, payment.paid_on) && !spot(payment));
  const todaysLotIds = new Set(lots.map((lot) => String(lot.id)));
  const paidNow = payments.filter((payment) => todaysLotIds.has(String(payment.lot_id)) && spot(payment)).reduce((sum, payment) => sum + num(payment.amount_ugx), 0);
  const float = data.floatTransactions || [];
  const floatBefore = float.filter((row) => localDay(String(row.transaction_date || "")) < day).reduce((sum, row) => sum + floatSign(row) * num(row.amount_ugx), 0);
  const floatToday = float.filter((row) => on(day, row.transaction_date));
  const floatIn = floatToday.filter((row) => row.transaction_type === "given").reduce((sum, row) => sum + num(row.amount_ugx), 0);
  const floatReturned = floatToday.filter((row) => row.transaction_type === "returned").reduce((sum, row) => sum + num(row.amount_ugx), 0);
  const floatSpent = floatToday.filter((row) => row.transaction_type === "spent").reduce((sum, row) => sum + num(row.amount_ugx), 0);
  const sorting = (data.sortingBatches || []).filter((batch) => on(day, batch.processed_on));
  const adjustments = (data.stockAdjustments || []).filter((item) => on(day, item.adjustment_date));
  const cash = (data.cashMovements || []).filter((item) => on(day, item.movement_date));
  const closure = (data.dailyClosures || []).find((item) => on(day, item.operating_date));
  return {
    lots, sales, received, supplierPayments, floatToday, sorting, adjustments, cash, closure,
    purchasedKg: lots.reduce((sum, lot) => sum + num(lot.quantity_kg), 0),
    purchaseValue: lots.reduce((sum, lot) => sum + lotCost(lot), 0),
    paidNow,
    onCredit: Math.max(lots.reduce((sum, lot) => sum + lotCost(lot), 0) - paidNow, 0),
    soldKg: sales.reduce((sum, sale) => sum + num(sale.quantity_kg), 0),
    saleValue: sales.reduce((sum, sale) => sum + num(sale.total_ugx), 0),
    saleCosts: sales.reduce((sum, sale) => sum + num(sale.expenses_ugx), 0),
    receivedTotal: received.reduce((sum, payment) => sum + num(payment.amount_ugx), 0),
    supplierPaid: supplierPayments.reduce((sum, payment) => sum + num(payment.amount_ugx), 0),
    hasFloat: float.length > 0,
    floatOpening: floatBefore, floatIn, floatReturned, floatSpent,
    floatClosing: floatBefore + floatIn - floatReturned - floatSpent,
    sortedIn: sorting.reduce((sum, batch) => sum + num(batch.input_kg), 0),
    sortedOut: sorting.reduce((sum, batch) => sum + num(batch.output_kg), 0),
    rejected: sorting.reduce((sum, batch) => sum + num(batch.rejected_kg), 0),
    processingCost: sorting.reduce((sum, batch) => sum + num(batch.processing_cost_ugx), 0),
  };
}

function reportText(organization: string, day: string, r: ReturnType<typeof buildReport>) {
  const lines = [
    `${organization} · daily report`,
    formatDay(day),
    r.closure ? `Day ${r.closure.status === "closed" ? "closed" : "reopened"}` : "Day open",
    "",
    `Purchases: ${r.lots.length} · ${kg(r.purchasedKg)} · ${ugx(r.purchaseValue)}`,
    `  Paid now ${ugx(r.paidNow)} · on credit ${ugx(r.onCredit)}`,
    `Sales: ${r.sales.length} · ${kg(r.soldKg)} · ${ugx(r.saleValue)}`,
    `  Sale costs ${ugx(r.saleCosts)}`,
    `Money received from buyers: ${ugx(r.receivedTotal)}`,
    `Paid to suppliers for credit purchases: ${ugx(r.supplierPaid)}`,
  ];
  if (r.hasFloat) lines.push(
    "",
    `Manager float opening: ${ugx(r.floatOpening)}`,
    `  Issued ${ugx(r.floatIn)} · spent ${ugx(r.floatSpent)} · returned ${ugx(r.floatReturned)}`,
    `Manager float closing: ${ugx(r.floatClosing)}`,
  );
  if (r.sorting.length) lines.push("", `Sorting: ${kg(r.sortedIn)} in → ${kg(r.sortedOut)} out, ${kg(r.rejected)} rejected · cost ${ugx(r.processingCost)}`);
  if (r.adjustments.length) lines.push(`Stock corrections: ${r.adjustments.length}`);
  return lines.join("\n");
}

/** Pick a day and see, or share, what happened on it. Works from the copy saved on the phone when offline. */
export function DailyReport({ token, email }: { token: string; email: string }) {
  const [day, setDay] = useState(localDay());
  const [data, setData] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await mobileRequest<{ data: Workspace }>("/api/waste/recycling", token, email);
      setData(result.data);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [token, email]);

  useEffect(() => {
    let cancelled = false;
    void readCachedResponse<{ data: Workspace }>("/api/waste/recycling", email).then((cached) => {
      if (cancelled || !cached?.data) return;
      setData((current) => current ?? cached.data);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => { cancelled = true; };
  }, [email, load]);

  if (loading && !data) return <View style={s.center}><ActivityIndicator color={color.action} /><Text style={type.small}>Preparing the report…</Text></View>;
  if (!data) return <EmptyState icon="cloud-offline-outline" title="No report data yet" text="Connect once so this phone can save the company records, then the report also works offline." action={{ label: "Try again", onPress: () => void load() }} />;

  const r = buildReport(data, day);
  const organization = data.organization?.name || "Recycling company";
  const empty = !r.lots.length && !r.sales.length && !r.received.length && !r.supplierPayments.length && !r.floatToday.length && !r.sorting.length && !r.adjustments.length && !r.cash.length;

  return <View style={{ gap: space.lg }}>
    <Card>
      <Text style={type.heading}>Report date</Text>
      <DateField value={day} onChange={setDay} />
    </Card>
    {offline ? <Banner tone="warning" text="Showing the copy saved on this phone. Pull down to refresh when connected." /> : null}
    {r.closure ? <Banner tone={r.closure.status === "closed" ? "neutral" : "warning"} title={r.closure.status === "closed" ? "Day closed" : "Day reopened"}
      text={String(r.closure.status === "closed" ? `Closed by ${r.closure.closed_by_name || "a manager"}.` : `Reopened: ${r.closure.reopen_reason || "no reason given"}.`)} /> : null}

    <SummaryCard label={`Purchases · ${formatDay(day, false)}`} value={ugx(r.purchaseValue)}
      stats={[{ label: "Purchases", value: r.lots.length }, { label: "Weight", value: kg(r.purchasedKg) }, { label: "On credit", value: ugx(r.onCredit).replace("UGX ", "") }]} />

    {empty ? <EmptyState icon="calendar-clear-outline" title="Nothing recorded on this day" text="Choose another date, or check that the phone has synchronized." /> : null}

    {r.hasFloat ? <>
      <SectionHeader title="Manager float" />
      <Card style={{ gap: space.sm }}>
        <Line label="Opening balance" value={ugx(r.floatOpening)} />
        <Line label="Issued by the office" value={`+ ${ugx(r.floatIn)}`} tone={color.success} />
        <Line label="Spent on purchases and costs" value={`− ${ugx(r.floatSpent)}`} tone={color.danger} />
        <Line label="Returned to the office" value={`− ${ugx(r.floatReturned)}`} />
        <View style={s.rule} />
        <Line label="Closing balance" value={ugx(r.floatClosing)} strong />
      </Card>
    </> : null}

    <SectionHeader title="Money" />
    <Card style={{ gap: space.sm }}>
      <Line label="Purchases paid on the spot" value={ugx(r.paidNow)} />
      <Line label="Paid to suppliers for credit purchases" value={ugx(r.supplierPaid)} />
      <Line label="Received from buyers" value={ugx(r.receivedTotal)} tone={color.success} />
      <Line label="Sale costs" value={ugx(r.saleCosts)} />
      {r.processingCost ? <Line label="Sorting costs" value={ugx(r.processingCost)} /> : null}
      {r.cash.map((item, index) => <Line key={String(item.id || index)} label={`Office cash ${item.direction === "in" ? "in" : "out"}: ${String(item.category || "").replaceAll("_", " ")}`}
        value={`${item.direction === "in" ? "+" : "−"} ${ugx(num(item.amount_ugx))}`} />)}
    </Card>

    {r.lots.length ? <>
      <SectionHeader title={`Purchases · ${r.lots.length}`} />
      {r.lots.map((lot, index) => <ListRow key={String(lot.id || index)} icon="cube-outline" iconTone="action" title={String(lot.material_type || "Material")}
        subtitle={String(lot.source_name || "")} value={kg(num(lot.quantity_kg))} detail={ugx(lotCost(lot))}
        badge={lot.purchase_payment_status === "credit" ? { label: "Owed", tone: "warning" } : lot.purchase_payment_status === "partially_paid" ? { label: "Part paid", tone: "warning" } : { label: "Paid", tone: "success" }} />)}
    </> : null}

    {r.sales.length ? <>
      <SectionHeader title={`Sales · ${r.sales.length} · ${kg(r.soldKg)}`} />
      {r.sales.map((sale, index) => <ListRow key={String(sale.id || index)} icon="trending-up-outline" iconTone="success" title={String(sale.material_type || "Sale")}
        subtitle={String(sale.buyer_name || "")} value={ugx(num(sale.total_ugx))} detail={kg(num(sale.quantity_kg))}
        badge={sale.status === "paid" ? { label: "Paid", tone: "success" } : { label: `${ugx(num(sale.balance_ugx))} due`, tone: "warning" }} />)}
    </> : null}

    {r.floatToday.filter((row) => row.transaction_type === "spent").length ? <>
      <SectionHeader title="Float spending" />
      {r.floatToday.filter((row) => row.transaction_type === "spent").map((row, index) => <ListRow key={String(row.id || index)} icon="wallet-outline"
        title={String(row.notes || "Float spending")} subtitle={row.reference && !/^(SALE|PROCESS)-[0-9a-f-]{36}$/i.test(String(row.reference)) ? String(row.reference) : undefined} value={ugx(num(row.amount_ugx))} />)}
    </> : null}

    {r.sorting.length ? <>
      <SectionHeader title="Sorting" />
      <Card style={{ gap: space.sm }}>
        <Line label="Material in" value={kg(r.sortedIn)} />
        <Line label="Recovered" value={kg(r.sortedOut)} tone={color.success} />
        <Line label="Rejected" value={kg(r.rejected)} />
      </Card>
    </> : null}

    {r.adjustments.length ? <>
      <SectionHeader title="Stock corrections" />
      {r.adjustments.map((item, index) => <ListRow key={String(item.id || index)} icon="swap-vertical-outline" title={String(item.reason || "Correction")}
        subtitle={String(item.adjustment_type || "").replaceAll("_", " ")} value={kg(num(item.quantity_kg))} />)}
    </> : null}

    <Button variant="secondary" icon="share-outline" title="Share this report" onPress={() => void Share.share({ message: reportText(organization, day, r) })} />
  </View>;
}

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return <View style={s.line}>
    <Text style={[type.body, { flex: 1 }, strong && s.strong]}>{label}</Text>
    <Text style={[type.body, s.amount, tone ? { color: tone } : null, strong && s.strong]}>{value}</Text>
  </View>;
}

const s = StyleSheet.create({
  center: { alignItems: "center", gap: space.sm, paddingVertical: space.xxl },
  line: { flexDirection: "row", alignItems: "center", gap: space.md },
  amount: { fontWeight: "600", color: color.ink },
  strong: { fontWeight: "700", color: color.ink },
  rule: { height: 1, backgroundColor: color.line, marginVertical: space.xs },
});
