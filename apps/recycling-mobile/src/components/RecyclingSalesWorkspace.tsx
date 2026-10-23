import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SyncStatus } from "./SyncStatus";
import { mobileRequest, readCachedResponse } from "../lib/mobile-api";
import { AccountWorkspace } from "./AccountWorkspace";
import { useBottomNavigationSpace, RoleBottomNavigation, RoleNavigationItem } from "./RoleBottomNavigation";
import { AppHeader, Banner, Button, Card, Chips, DateField, EmptyState, Field, Input, ListRow, MoneyInput, QuickActions, ReferenceInput, SectionHeader, Segmented, SummaryCard, page } from "../ui/kit";
import { color, radius, space, type, ugx } from "../ui/theme";
import { formatDay, localDay } from "../lib/dates";

type User = { fullName: string; email: string; roles: string[] };
type Lot = {
  id: string;
  material_type: string;
  source_name: string;
  available_kg: string;
  quality: string;
};
type Partner = {
  id: string;
  name: string;
  partner_type: string;
  active: boolean;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  local_sync_status?: string;
};
type Sale = {
  id: string;
  material_type: string;
  buyer_name: string;
  industry: string;
  invoice_number: string | null;
  quantity_kg: string;
  unit_price_ugx: string;
  total_ugx: string;
  balance_ugx: string;
  status: string;
  payment_state: string;
  sold_on: string;
};
type Workspace = {
  organization: { name: string };
  operations: { operatingDate: string; isClosed: boolean; soldTodayKg: number };
  lots: Lot[];
  partners: Partner[];
  sales: Sale[];
  myActivity?: {
    sales?: number;
    soldKg?: number;
    saleValueUgx?: number;
    outstandingUgx?: number;
  };
  dailyClosures?: { operating_date: string; status: string }[];
};
type Screen = "today" | "sell" | "history" | "account";

async function request<T>(
  path: string,
  token: string,
  owner: string,
  init: RequestInit = {},
): Promise<T> {
  return mobileRequest<T>(path, token, owner, init);
}
export function RecyclingSalesWorkspace({
  token,
  user,
  onLogout,
  onOpenOperations,
  onOpenPurchasing,
  active = true,
}: {
  token: string;
  user: User;
  onLogout: () => Promise<void>;
  onOpenOperations?: (target?: "dashboard" | "operations") => void;
  onOpenPurchasing?: () => void;
  active?: boolean;
}) {
  const navSpace = useBottomNavigationSpace();
  const scrollRef = useRef<ScrollView>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [screen, setScreen] = useState<Screen>("today"),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [partnerForm, setPartnerForm] = useState({ name: "", contactPerson: "", phone: "", email: "" });
  const [savingPartner, setSavingPartner] = useState(false);
  const [paymentSaleId, setPaymentSaleId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingSale, setSavingSale] = useState(false);
  const [lotId, setLotId] = useState(""),
    [partnerId, setPartnerId] = useState(""),
    [buyerName, setBuyerName] = useState(""),
    [invoice, setInvoice] = useState(""),
    [quantity, setQuantity] = useState(""),
    [unitPrice, setUnitPrice] = useState(""),
    [transport, setTransport] = useState("0"),
    [saleDate, setSaleDate] = useState(""),
    [saleCosts, setSaleCosts] = useState({ wages: "", food: "", other: "" }),
    [showSaleCosts, setShowSaleCosts] = useState(false),
    [paymentDate, setPaymentDate] = useState(localDay()),
    [notes, setNotes] = useState("");
  // A new screen starts at the top rather than at the previous screen's scroll position.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [screen]);
  // Messages appear at the top of the screen, so bring them into view when a save fails further down.
  useEffect(() => {
    if (error) scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [error]);

  const load = useCallback(async () => {
    try {
      setError("");
      const result = await request<{ data: Workspace }>(
        "/api/waste/recycling",
        token,
        user.email,
      );
      setWorkspace(result.data);
    } catch (c) {
      setError(
        c instanceof Error ? c.message : "Could not load industrial sales",
      );
    } finally {
      setLoading(false);
    }
  }, [token, user.email]);
  useEffect(() => {
    // Show the saved copy straight away, then replace it with the server's answer.
    let cancelled = false;
    void readCachedResponse<{ data: Workspace }>("/api/waste/recycling", user.email).then((cached) => {
      if (cancelled || !cached?.data) return;
      setWorkspace((current) => current ?? cached.data);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => { cancelled = true; };
  }, [load, user.email]);

  // Coming back to this screen refreshes quietly in the background; the last figures stay visible meanwhile.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) void load();
    wasActive.current = active;
  }, [active, load]);
  const stock = useMemo(
      () => workspace?.lots.filter((x) => Number(x.available_kg) > 0) || [],
      [workspace],
    ),
    selectedLot = stock.find((x) => x.id === lotId),
    total = Number(quantity || 0) * Number(unitPrice || 0);
  const closedDays = [
    ...(workspace?.dailyClosures || []).filter((item) => item.status === "closed").map((item) => localDay(item.operating_date)),
    ...(workspace?.operations.isClosed ? [workspace.operations.operatingDate] : []),
  ];
  // The form follows the business day until someone picks another date.
  const saleDay = saleDate || workspace?.operations.operatingDate || localDay();
  const saleCostTotal = Number(transport || 0) + Number(saleCosts.wages || 0) + Number(saleCosts.food || 0) + Number(saleCosts.other || 0);
  const todaySales =
    workspace?.sales.filter(
      (x) =>
        localDay(x.sold_on) === workspace.operations.operatingDate,
    ) || [];
  // Sales staff get a personal summary from the server; managers see the company's figures from the sales themselves.
  const todayValue = todaySales.reduce((sum, x) => sum + Number(x.total_ugx || 0), 0);
  const todayKg = todaySales.reduce((sum, x) => sum + Number(x.quantity_kg || 0), 0);
  const owedToUs = (workspace?.sales || []).filter((x) => x.status !== "paid").reduce((sum, x) => sum + Number(x.balance_ugx ?? x.total_ugx ?? 0), 0);
  const filteredSales = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) return workspace?.sales || [];
    return (workspace?.sales || []).filter((sale) =>
      [sale.material_type, sale.buyer_name, sale.industry, sale.invoice_number, sale.payment_state, sale.status]
        .some((value) => String(value || "").toLowerCase().includes(query)),
    );
  }, [historyQuery, workspace]);
  const historyPageSize = 10;
  const historyPages = Math.max(1, Math.ceil(filteredSales.length / historyPageSize));
  const visibleSales = filteredSales.slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize);
  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }
  async function savePartner() {
    const name = partnerForm.name.trim() || buyerName.trim();
    if (name.length < 2) return setError("Enter the buyer or industry name.");
    try {
      setSavingPartner(true);
      setError("");
      const result = await request<{ queuedOffline?: boolean; localId?: string }>("/api/waste/recycling/partners", token, user.email, {
        method: "POST",
        body: JSON.stringify({ partnerType: "buyer", name, contactPerson: partnerForm.contactPerson.trim() || undefined, phone: partnerForm.phone.trim() || undefined, email: partnerForm.email.trim().toLowerCase() || undefined }),
      });
      const localPartner: Partner = { id: result.localId || `local-${Date.now()}`, name, partner_type: "buyer", active: true, contact_person: partnerForm.contactPerson.trim() || null, phone: partnerForm.phone.trim() || null, email: partnerForm.email.trim().toLowerCase() || null };
      if (result.queuedOffline) setWorkspace((current) => current ? { ...current, partners: [localPartner, ...current.partners] } : current);
      else void load();
      // Until the queued partner receives its server ID, sales use the entered
      // buyer name instead of creating an invalid local foreign key.
      setPartnerId("");
      setBuyerName(name);
      setPartnerForm({ name: "", contactPerson: "", phone: "", email: "" });
      Alert.alert(result.queuedOffline ? "Buyer saved offline" : "Trade partner saved", result.queuedOffline ? "The buyer is available on this device and will synchronize automatically." : "The buyer is now available for future sales.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the buyer.");
    } finally { setSavingPartner(false); }
  }

  async function recordPayment(sale: Sale) {
    const amount = Number(paymentAmount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > Number(sale.balance_ugx) || paymentReference.trim().length < 2)
      return setError("Enter a whole UGX amount within the outstanding balance and a payment reference.");
    try {
      setSavingPayment(true);
      setError("");
      const result = await request<{ queuedOffline?: boolean }>(`/api/waste/recycling/sales/${sale.id}/paid`, token, user.email, {
        method: "PATCH",
        body: JSON.stringify({ amountUgx: amount, paymentReceivedOn: paymentDate, paymentReference: paymentReference.trim() }),
      });
      if (result.queuedOffline) setWorkspace((current) => current ? { ...current, sales: current.sales.map((item) => item.id === sale.id ? { ...item, balance_ugx: String(Math.max(0, Number(item.balance_ugx) - amount)), payment_state: amount >= Number(item.balance_ugx) ? "paid" : "partial" } : item) } : current);
      else void load();
      setPaymentSaleId(""); setPaymentAmount(""); setPaymentReference("");
      Alert.alert(result.queuedOffline ? "Payment saved offline" : "Payment recorded", result.queuedOffline ? "The receipt information will synchronize automatically." : "The customer balance and sales income have been updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the payment.");
    } finally { setSavingPayment(false); }
  }
  async function saveSale() {
    if (
      !lotId ||
      (!partnerId && buyerName.trim().length < 2) ||
      Number(quantity) <= 0 ||
      Number(unitPrice) <= 0
    )
      return setError(
        "Choose stock and a buyer, then enter a valid weight and price.",
      );
    if (saleDay > localDay())
      return setError("The sale date cannot be in the future.");
    if (closedDays.includes(saleDay))
      return setError(`${formatDay(saleDay)} is closed. Choose another date or ask a manager to reopen it.`);
    if (selectedLot && Number(quantity) > Number(selectedLot.available_kg))
      return setError(
        `Only ${Number(selectedLot.available_kg).toLocaleString()} kg is available in this stock lot.`,
      );
    try {
      setSavingSale(true);
      setError("");
      const partner = workspace?.partners.find((x) => x.id === partnerId);
      const result = await request<{
        queuedOffline?: boolean;
        localId?: string;
      }>("/api/waste/recycling/sales", token, user.email, {
        method: "POST",
        body: JSON.stringify({
          lotId,
          buyerPartnerId: partnerId || undefined,
          buyerName: partnerId ? undefined : buyerName.trim(),
          saleChannel: "industrial",
          industry: partner?.name || buyerName.trim(),
          invoiceNumber: invoice.trim() || undefined,
          quantityKg: Number(quantity),
          unitPriceUgx: Number(unitPrice),
          soldOn: saleDay,
          workerWagesUgx: Number(saleCosts.wages || 0),
          foodUgx: Number(saleCosts.food || 0),
          transportUgx: Number(transport || 0),
          otherExpenseUgx: Number(saleCosts.other || 0),
          notes: notes.trim() || undefined,
        }),
      });
      if (result.queuedOffline && workspace && selectedLot) {
        const localSale: Sale = {
          id: result.localId || `local-${Date.now()}`,
          material_type: selectedLot.material_type,
          buyer_name: partner?.name || buyerName.trim(),
          industry: partner?.name || buyerName.trim(),
          invoice_number: invoice.trim() || null,
          quantity_kg: String(Number(quantity)),
          unit_price_ugx: String(Number(unitPrice)),
          total_ugx: String(total),
          balance_ugx: String(total),
          status: "pending_sync",
          payment_state: "unpaid",
          sold_on: saleDay,
        };
        setWorkspace((current) =>
          current
            ? {
                ...current,
                lots: current.lots.map((x) =>
                  x.id === lotId
                    ? {
                        ...x,
                        available_kg: String(
                          Number(x.available_kg) - Number(quantity),
                        ),
                      }
                    : x,
                ),
                sales: [localSale, ...current.sales],
                // Only roles with a personal summary from the server get it updated here.
                myActivity: current.myActivity && saleDay === current.operations.operatingDate ? {
                  ...current.myActivity,
                  sales: (current.myActivity.sales || 0) + 1,
                  soldKg: (current.myActivity.soldKg || 0) + Number(quantity),
                  saleValueUgx: (current.myActivity.saleValueUgx || 0) + total,
                  outstandingUgx: (current.myActivity.outstandingUgx || 0) + total,
                } : current.myActivity,
              }
            : current,
        );
      }
      setLotId("");
      setPartnerId("");
      setBuyerName("");
      setInvoice("");
      setQuantity("");
      setUnitPrice("");
      setTransport("0");
      setNotes("");
      setSaleDate("");
      setSaleCosts({ wages: "", food: "", other: "" });
      setShowSaleCosts(false);
      if (!result.queuedOffline) void load();
      setScreen("today");
      Alert.alert(
        result.queuedOffline ? "Sale saved offline" : "Industrial sale saved",
        result.queuedOffline
          ? "It is safely stored on this phone and will synchronize automatically."
          : "Stock, sales income and company receivables were updated together.",
      );
    } catch (c) {
      setError(c instanceof Error ? c.message : "Could not save the sale");
    } finally {
      setSavingSale(false);
    }
  }
  if (loading && !workspace)
    return (
      <View style={page.center}>
        <ActivityIndicator size="large" color={color.action} />
        <Text style={type.small}>Loading sales…</Text>
      </View>
    );
  const closed = Boolean(workspace?.operations.isClosed);
  const managerMode = Boolean(onOpenOperations || onOpenPurchasing);
  const navigation: RoleNavigationItem[] = managerMode
    ? [
        { id: "dashboard", label: "Dashboard", icon: "home-outline", onPress: () => onOpenOperations?.("dashboard") },
        { id: "purchases", label: "Purchases", icon: "download-outline", onPress: onOpenPurchasing || (() => undefined) },
        { id: "operations", label: "Operations", icon: "grid-outline", onPress: () => onOpenOperations?.("operations") },
        { id: "sales", label: "Sales", icon: "trending-up-outline", active: screen !== "account", onPress: () => setScreen("today") },
        { id: "account", label: "Account", icon: "person-outline", active: screen === "account", onPress: () => setScreen("account") },
      ]
    : [
        { id: "dashboard", label: "Home", icon: "home-outline", active: screen === "today", onPress: () => setScreen("today") },
        { id: "sell", label: "Sell", icon: "add-circle-outline", active: screen === "sell", onPress: () => setScreen("sell") },
        { id: "history", label: "Sales", icon: "time-outline", active: screen === "history", onPress: () => setScreen("history") },
        { id: "account", label: "Account", icon: "person-outline", active: screen === "account", onPress: () => setScreen("account") },
      ];
  const savedBuyers = (workspace?.partners || []).filter((x) => x.active && !x.local_sync_status && ["buyer", "both"].includes(x.partner_type));
  const stockKg = stock.reduce((sum, x) => sum + Number(x.available_kg || 0), 0);
  return (
    <SafeAreaView style={page.safe} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <AppHeader name={user.fullName} organization={workspace?.organization.name || "Industrial sales"}
        right={<SyncStatus token={token} email={user.email} onSynced={() => void load()} />} />
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[page.content, { paddingBottom: navSpace }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <Banner tone="danger" text={error} /> : null}
        {managerMode && screen !== "account" ? (
          <Segmented value={screen} onChange={setScreen} options={[
            { value: "today", label: "Overview" }, { value: "sell", label: "New sale" }, { value: "history", label: "History" },
          ]} />
        ) : null}
        {screen === "today" && (
          <>
            {closed ? <Banner tone="warning" title="Day closed" text="Management has closed today. Sales for today are locked until a manager reopens the day; an earlier open day can still be chosen." /> : null}
            <SummaryCard label="Sold today" value={ugx(workspace?.myActivity?.saleValueUgx ?? todayValue)}
              stats={[
                { label: "Sales", value: workspace?.myActivity?.sales ?? todaySales.length },
                { label: "Kg sold", value: Number(workspace?.myActivity?.soldKg ?? todayKg).toLocaleString("en-GB") },
                { label: "Owed to us", value: Number(workspace?.myActivity?.outstandingUgx ?? owedToUs).toLocaleString("en-GB") },
              ]} />
            <QuickActions items={[
              { icon: "add-circle-outline", label: "New sale", onPress: () => setScreen("sell"), disabled: !stock.length },
              { icon: "cash-outline", label: "Record payment", onPress: () => setScreen("history"), tone: "success" },
              { icon: "time-outline", label: "Sales history", onPress: () => setScreen("history"), tone: "neutral" },
            ]} />
            <SectionHeader title={`Stock to sell · ${stockKg.toLocaleString("en-GB")} kg`} />
            {stock.slice(0, 8).map((x) => (
              <ListRow key={x.id} icon="cube-outline" iconTone="action" title={x.material_type} subtitle={`${x.source_name} · ${x.quality}`}
                value={`${Number(x.available_kg).toLocaleString("en-GB")} kg`} chevron
                onPress={() => { setLotId(x.id); setScreen("sell"); }} />
            ))}
            {!stock.length && <EmptyState icon="cube-outline" title="No stock to sell" text="Stock appears here once purchases are received or sorted." />}
          </>
        )}
        {screen === "sell" && (
          <>
            <View>
              <Text style={page.title}>New sale</Text>
              <Text style={[type.small, { marginTop: 4 }]}>Pick the stock, the buyer, then the weight and price.</Text>
            </View>
            <Card>
              <Text style={type.heading}>Sale date</Text>
              <DateField value={saleDay} onChange={setSaleDate} blocked={closedDays} />
              {closedDays.includes(saleDay) ? <Banner tone="warning" text={`${formatDay(saleDay)} is closed. Choose another date or ask a manager to reopen it.`} /> : null}
            </Card>
            <Card>
              <Text style={type.heading}>Stock</Text>
              {stock.length ? <Chips value={lotId} onChange={setLotId}
                options={stock.map((x) => ({ value: x.id, label: `${x.material_type} · ${Number(x.available_kg).toLocaleString("en-GB")} kg` }))} />
                : <Text style={type.small}>No stock is available to sell.</Text>}
            </Card>
            <Card>
              <Text style={type.heading}>Buyer</Text>
              <Chips value={partnerId || "__new"} onChange={(value) => { if (value === "__new") { setPartnerId(""); } else { setPartnerId(value); setBuyerName(savedBuyers.find((x) => x.id === value)?.name || ""); } }}
                options={[{ value: "__new", label: "New buyer" }, ...savedBuyers.map((x) => ({ value: x.id, label: x.name }))]} />
              {!partnerId && (
                <>
                  <Field label="Buyer or industry"><Input value={buyerName} onChangeText={setBuyerName} placeholder="The company receiving the material" /></Field>
                  <View style={s.saveBuyer}>
                    <Text style={type.label}>Save this buyer for next time (optional)</Text>
                    <Field label="Contact person"><Input value={partnerForm.contactPerson} onChangeText={(contactPerson) => setPartnerForm((current) => ({ ...current, contactPerson }))} placeholder="Optional" /></Field>
                    <View style={page.columns}>
                      <Field label="Phone" style={page.column}><Input value={partnerForm.phone} onChangeText={(phone) => setPartnerForm((current) => ({ ...current, phone }))} keyboardType="phone-pad" placeholder="Optional" /></Field>
                      <Field label="Email" style={page.column}><Input value={partnerForm.email} onChangeText={(email) => setPartnerForm((current) => ({ ...current, email }))} autoCapitalize="none" keyboardType="email-address" placeholder="Optional" /></Field>
                    </View>
                    <Button variant="ghost" icon="bookmark-outline" title={savingPartner ? "Saving…" : "Save buyer"} loading={savingPartner} onPress={() => void savePartner()} />
                  </View>
                </>
              )}
            </Card>
            <Card>
              <Text style={type.heading}>Weight and price</Text>
              <View style={page.columns}>
                <Field label="Weight (kg)" style={page.column} hint={selectedLot ? `${Number(selectedLot.available_kg).toLocaleString("en-GB")} kg available` : undefined}>
                  <Input value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="0" />
                </Field>
                <Field label="Price per kg" style={page.column}><MoneyInput value={unitPrice} onChangeText={setUnitPrice} /></Field>
              </View>
              <Field label="Invoice or delivery note number" hint="The number on the invoice or delivery note you give the buyer, if any.">
                <ReferenceInput value={invoice} onChangeText={setInvoice} prefix="INV" placeholder="Optional" />
              </Field>
            </Card>
            <Card>
              <Text style={type.heading}>Costs of this sale</Text>
              <Field label="Transport (UGX)"><MoneyInput value={transport === "0" ? "" : transport} onChangeText={(value) => setTransport(value || "0")} /></Field>
              {showSaleCosts ? <>
                <View style={page.columns}>
                  <Field label="Loading wages" style={page.column}><MoneyInput value={saleCosts.wages} onChangeText={(wages) => setSaleCosts((current) => ({ ...current, wages }))} /></Field>
                  <Field label="Food" style={page.column}><MoneyInput value={saleCosts.food} onChangeText={(food) => setSaleCosts((current) => ({ ...current, food }))} /></Field>
                </View>
                <Field label="Other costs"><MoneyInput value={saleCosts.other} onChangeText={(other) => setSaleCosts((current) => ({ ...current, other }))} /></Field>
              </> : <Button variant="ghost" icon="add-outline" title="Add wages, food or other costs" onPress={() => setShowSaleCosts(true)} />}
              <Field label="Delivery note (optional)"><Input value={notes} onChangeText={setNotes} multiline placeholder="Truck, driver, anything the office should know" /></Field>
            </Card>
            <Card style={{ backgroundColor: color.actionSoft }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                <View>
                  <Text style={type.small}>Sale value</Text>
                  <Text style={[type.display, { color: color.actionInk }]}>{ugx(total)}</Text>
                </View>
                {Number(quantity) > 0 && Number(unitPrice) > 0 ? <Text style={type.caption}>{Number(quantity).toLocaleString("en-GB")} kg × {ugx(unitPrice)}</Text> : null}
              </View>
              <Text style={type.small}>{saleCostTotal > 0 ? `Costs ${ugx(saleCostTotal)} · ` : ""}{formatDay(saleDay)}</Text>
              <Button title={savingSale ? "Saving…" : "Save sale"} icon="checkmark-circle-outline" loading={savingSale} disabled={closedDays.includes(saleDay)} onPress={saveSale} />
            </Card>
          </>
        )}
        {screen === "history" && (
          <>
            <View>
              <Text style={page.title}>Sales</Text>
              <Text style={[type.small, { marginTop: 4 }]}>{filteredSales.length} sale{filteredSales.length === 1 ? "" : "s"}. Tap “Record payment” when a buyer pays.</Text>
            </View>
            <Input accessibilityLabel="Search sales" value={historyQuery} onChangeText={(value) => { setHistoryQuery(value); setHistoryPage(1); }} placeholder="Search material, buyer or invoice" />
            {visibleSales.map((x) => {
              const due = Number(x.balance_ugx);
              return (
                <View key={x.id} style={{ gap: space.sm }}>
                  <ListRow icon="trending-up-outline" iconTone={due > 0 ? "warning" : "success"} title={x.material_type}
                    subtitle={`${x.buyer_name} · ${new Date(x.sold_on).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}${x.invoice_number ? ` · ${x.invoice_number}` : ""}`}
                    value={ugx(x.total_ugx)} detail={`${Number(x.quantity_kg).toLocaleString("en-GB")} kg`}
                    badge={x.status === "pending_sync" ? { label: "Waiting to sync", tone: "warning" } : due > 0 ? { label: `${ugx(due)} due`, tone: "warning" } : { label: "Paid", tone: "success" }} />
                  {due > 0 && x.status !== "pending_sync" ? (
                    paymentSaleId === x.id ? (
                      <Card>
                        <Text style={type.heading}>Payment from {x.buyer_name}</Text>
                        <Field label="Amount received" hint={`Up to ${ugx(due)} is outstanding.`}><MoneyInput value={paymentAmount} onChangeText={setPaymentAmount} /></Field>
                        <Field label="Date received"><DateField value={paymentDate} onChange={setPaymentDate} min={localDay(x.sold_on)} /></Field>
                        <Field label="Payment reference" hint="The mobile-money transaction ID, bank reference or receipt number for this payment. It must not have been used before.">
                          <ReferenceInput value={paymentReference} onChangeText={setPaymentReference} prefix="RCV" placeholder="e.g. MoMo ID or bank ref" />
                        </Field>
                        <Button title={savingPayment ? "Saving…" : "Record payment"} icon="checkmark-circle-outline" loading={savingPayment} onPress={() => void recordPayment(x)} />
                        <Button title="Cancel" variant="ghost" onPress={() => { setPaymentSaleId(""); setPaymentAmount(""); setPaymentReference(""); }} />
                      </Card>
                    ) : (
                      <Button variant="ghost" icon="cash-outline" title="Record payment" onPress={() => { setPaymentSaleId(x.id); setPaymentAmount(String(due)); setPaymentReference(""); setPaymentDate(localDay()); }} />
                    )
                  ) : null}
                </View>
              );
            })}
            {!filteredSales.length && <EmptyState icon="search-outline" title={historyQuery ? "No matching sales" : "No sales yet"} text={historyQuery ? "Try another word." : "Recorded sales appear here."} />}
            {filteredSales.length > historyPageSize ? (
              <View style={s.pagination}>
                <Button title="Previous" variant="secondary" disabled={historyPage === 1} onPress={() => setHistoryPage((n) => Math.max(1, n - 1))} style={{ flex: 1 }} />
                <Text style={type.small}>{historyPage} / {historyPages}</Text>
                <Button title="Next" variant="secondary" disabled={historyPage === historyPages} onPress={() => setHistoryPage((n) => Math.min(historyPages, n + 1))} style={{ flex: 1 }} />
              </View>
            ) : null}
          </>
        )}
        {screen === "account" && (
          <AccountWorkspace user={user} organizationName={workspace?.organization.name} onLogout={onLogout} />
        )}
      </ScrollView>
      <RoleBottomNavigation items={navigation} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  saveBuyer: { gap: space.md, backgroundColor: color.fill, borderRadius: radius.md, padding: space.md },
  pagination: { flexDirection: "row", alignItems: "center", gap: space.md },
});
