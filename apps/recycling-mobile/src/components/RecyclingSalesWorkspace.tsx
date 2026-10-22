import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SyncStatus } from "./SyncStatus";
import { mobileRequest } from "../lib/mobile-api";
import { AccountWorkspace } from "./AccountWorkspace";
import { RoleBottomNavigation, RoleNavigationItem } from "./RoleBottomNavigation";
import { SectionNavigation } from "./SectionNavigation";

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
function Field({
  label,
  value,
  onChangeText,
  placeholder,
  numeric = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8793a6"
        keyboardType={numeric ? "number-pad" : "default"}
        multiline={multiline}
        style={[s.input, multiline && s.textarea]}
      />
    </View>
  );
}
function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.choice, selected && s.choiceActive]}>
      <Text style={[s.choiceText, selected && s.choiceTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function RecyclingSalesWorkspace({
  token,
  user,
  onLogout,
  onOpenOperations,
  onOpenPurchasing,
}: {
  token: string;
  user: User;
  onLogout: () => Promise<void>;
  onOpenOperations?: (target?: "dashboard" | "operations") => void;
  onOpenPurchasing?: () => void;
}) {
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
  const [lotId, setLotId] = useState(""),
    [partnerId, setPartnerId] = useState(""),
    [buyerName, setBuyerName] = useState(""),
    [invoice, setInvoice] = useState(""),
    [quantity, setQuantity] = useState(""),
    [unitPrice, setUnitPrice] = useState(""),
    [transport, setTransport] = useState("0"),
    [notes, setNotes] = useState("");
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
    // Initial cache hydration is intentionally started when this workspace mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const stock = useMemo(
      () => workspace?.lots.filter((x) => Number(x.available_kg) > 0) || [],
      [workspace],
    ),
    selectedLot = stock.find((x) => x.id === lotId),
    total = Number(quantity || 0) * Number(unitPrice || 0);
  const todaySales =
    workspace?.sales.filter(
      (x) =>
        String(x.sold_on).slice(0, 10) === workspace.operations.operatingDate,
    ) || [];
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
      else await load();
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
        body: JSON.stringify({ amountUgx: amount, paymentReceivedOn: new Date().toISOString().slice(0, 10), paymentReference: paymentReference.trim() }),
      });
      if (result.queuedOffline) setWorkspace((current) => current ? { ...current, sales: current.sales.map((item) => item.id === sale.id ? { ...item, balance_ugx: String(Math.max(0, Number(item.balance_ugx) - amount)), payment_state: amount >= Number(item.balance_ugx) ? "paid" : "partial" } : item) } : current);
      else await load();
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
    if (selectedLot && Number(quantity) > Number(selectedLot.available_kg))
      return setError(
        `Only ${Number(selectedLot.available_kg).toLocaleString()} kg is available in this stock lot.`,
      );
    try {
      setLoading(true);
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
          soldOn: workspace?.operations.operatingDate,
          workerWagesUgx: 0,
          foodUgx: 0,
          transportUgx: Number(transport || 0),
          otherExpenseUgx: 0,
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
          sold_on: workspace.operations.operatingDate,
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
                myActivity: {
                  ...current.myActivity,
                  sales: (current.myActivity?.sales || 0) + 1,
                  soldKg: (current.myActivity?.soldKg || 0) + Number(quantity),
                  saleValueUgx: (current.myActivity?.saleValueUgx || 0) + total,
                  outstandingUgx:
                    (current.myActivity?.outstandingUgx || 0) + total,
                },
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
      if (!result.queuedOffline) await load();
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
      setLoading(false);
    }
  }
  if (loading && !workspace)
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#3156a3" />
      </View>
    );
  const managerMode = Boolean(onOpenOperations || onOpenPurchasing);
  const navigation: RoleNavigationItem[] = managerMode
    ? [
        { id: "dashboard", label: "Dashboard", icon: "⌂", onPress: () => onOpenOperations?.("dashboard") },
        { id: "purchases", label: "Purchases", icon: "↓", onPress: onOpenPurchasing || (() => undefined) },
        { id: "operations", label: "Operations", icon: "◫", onPress: () => onOpenOperations?.("operations") },
        { id: "sales", label: "Sales", icon: "↗", active: screen !== "account", onPress: () => setScreen("today") },
        { id: "account", label: "Account", icon: "●", active: screen === "account", onPress: () => setScreen("account") },
      ]
    : [
        { id: "dashboard", label: "Dashboard", icon: "⌂", active: screen === "today", onPress: () => setScreen("today") },
        { id: "sell", label: "New", icon: "+", active: screen === "sell", onPress: () => setScreen("sell") },
        { id: "history", label: "History", icon: "▤", active: screen === "history", onPress: () => setScreen("history") },
        { id: "account", label: "Account", icon: "●", active: screen === "account", onPress: () => setScreen("account") },
      ];
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <View>
          <Text style={s.eyebrow}>INDUSTRIAL SALES</Text>
          <Text style={s.headerTitle}>
            {workspace?.organization.name || "Recycling operations"}
          </Text>
        </View>
        <SyncStatus
          token={token}
          email={user.email}
          onSynced={() => void load()}
        />
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.page}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        keyboardShouldPersistTaps="handled"
      >
        {screen !== "account" ? (
          <SectionNavigation
            title="INDUSTRIAL SALES"
            items={[
              { id: "overview", label: "Overview", active: screen === "today", onPress: () => setScreen("today") },
              { id: "new", label: "New sale", active: screen === "sell", onPress: () => setScreen("sell") },
              { id: "history", label: "History", active: screen === "history", onPress: () => setScreen("history") },
            ]}
          />
        ) : null}
        {screen === "today" && (
          <>
            <Text style={s.title}>Good day, {user.fullName.split(/\s+/)[0]}.</Text>
            <Text style={s.roleLabel}>{user.roles.map((role) => role.replaceAll("_", " ")).join(" · ")}</Text>
            <Text style={s.subtitle}>
              Sell available recovered material to approved industries and
              follow company receivables.
            </Text>
            {workspace?.operations.isClosed ? (
              <Text style={s.warning}>
                Management has closed today. New sales are unavailable until the
                day is reopened.
              </Text>
            ) : null}
            <View style={s.metrics}>
              <View style={s.metric}>
                <Text style={s.metricLabel}>MY SALES TODAY</Text>
                <Text style={s.metricValue}>
                  {workspace?.myActivity?.sales ?? todaySales.length}
                </Text>
              </View>
              <View style={s.metricBlue}>
                <Text style={s.metricLabelBlue}>KG SOLD</Text>
                <Text style={s.metricValueBlue}>
                  {Number(workspace?.myActivity?.soldKg ?? 0).toLocaleString()}
                </Text>
              </View>
            </View>
            <View style={s.summary}>
              <Text style={s.summaryLabel}>Sales value today</Text>
              <Text style={s.summaryValue}>
                UGX{" "}
                {Number(
                  workspace?.myActivity?.saleValueUgx ?? 0,
                ).toLocaleString()}
              </Text>
            </View>
            <View style={s.summary}>
              <Text style={s.summaryLabel}>My outstanding receivables</Text>
              <Text style={s.summaryValue}>
                UGX{" "}
                {Number(
                  workspace?.myActivity?.outstandingUgx ?? 0,
                ).toLocaleString()}
              </Text>
            </View>
            <Pressable
              disabled={workspace?.operations.isClosed || !stock.length}
              onPress={() => setScreen("sell")}
              style={[
                s.primary,
                (workspace?.operations.isClosed || !stock.length) && s.disabled,
              ]}
            >
              <Text style={s.primaryText}>
                {stock.length
                  ? "+ Record industrial sale"
                  : "No saleable stock available"}
              </Text>
            </Pressable>
            <Text style={s.sectionTitle}>Available stock</Text>
            {stock.slice(0, 8).map((x) => (
              <View key={x.id} style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{x.material_type}</Text>
                  <Text style={s.rowSub}>
                    {x.source_name} · {x.quality}
                  </Text>
                </View>
                <Text style={s.rowValue}>
                  {Number(x.available_kg).toLocaleString()} kg
                </Text>
              </View>
            ))}
            {!stock.length && (
              <Text style={s.empty}>
                Management must add or prepare stock before it can be sold.
              </Text>
            )}
          </>
        )}
        {screen === "sell" && (
          <>
            <Text style={s.title}>New industrial sale</Text>
            <Text style={s.subtitle}>
              Choose an available stock lot and the industry receiving it.
            </Text>
            <Text style={s.label}>Available material *</Text>
            <View style={s.chips}>
              {stock.map((x) => (
                <Choice
                  key={x.id}
                  label={`${x.material_type} · ${Number(x.available_kg).toLocaleString()} kg`}
                  selected={lotId === x.id}
                  onPress={() => setLotId(x.id)}
                />
              ))}
            </View>
            <Text style={s.label}>Saved industrial buyer</Text>
            <View style={s.chips}>
              <Choice
                label="New buyer"
                selected={!partnerId}
                onPress={() => setPartnerId("")}
              />
              {workspace?.partners
                .filter(
                  (x) => x.active && !x.local_sync_status && ["buyer", "both"].includes(x.partner_type),
                )
                .map((x) => (
                  <Choice
                    key={x.id}
                    label={x.name}
                    selected={partnerId === x.id}
                    onPress={() => {
                      setPartnerId(x.id);
                      setBuyerName(x.name);
                    }}
                  />
                ))}
            </View>
            {!partnerId && (
              <>
                <Field label="Industry / buyer name *" value={buyerName} onChangeText={setBuyerName} placeholder="Enter the receiving company" />
                <View style={s.partnerCard}>
                  <Text style={s.partnerTitle}>Save buyer for future sales</Text>
                  <Field label="Company name" value={partnerForm.name} onChangeText={(name) => setPartnerForm((current) => ({ ...current, name }))} placeholder={buyerName || "Buyer or industry"} />
                  <Field label="Contact person" value={partnerForm.contactPerson} onChangeText={(contactPerson) => setPartnerForm((current) => ({ ...current, contactPerson }))} placeholder="Optional" />
                  <View style={s.twoCol}>
                    <View style={{ flex: 1 }}><Field label="Phone" value={partnerForm.phone} onChangeText={(phone) => setPartnerForm((current) => ({ ...current, phone }))} placeholder="Optional" /></View>
                    <View style={{ flex: 1 }}><Field label="Email" value={partnerForm.email} onChangeText={(email) => setPartnerForm((current) => ({ ...current, email }))} placeholder="Optional" /></View>
                  </View>
                  <Pressable disabled={savingPartner} onPress={() => void savePartner()} style={[s.secondary, savingPartner && s.disabled]}><Text style={s.secondaryText}>{savingPartner ? "Saving…" : "Save trade partner"}</Text></Pressable>
                </View>
              </>
            )}
            <Field
              label="Invoice or delivery reference"
              value={invoice}
              onChangeText={setInvoice}
              placeholder="Optional"
            />
            <View style={s.twoCol}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Weight (kg) *"
                  value={quantity}
                  onChangeText={setQuantity}
                  numeric
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Price / kg (UGX) *"
                  value={unitPrice}
                  onChangeText={setUnitPrice}
                  numeric
                />
              </View>
            </View>
            <View style={s.total}>
              <Text style={s.totalLabel}>SALE VALUE</Text>
              <Text style={s.totalValue}>UGX {total.toLocaleString()}</Text>
            </View>
            <Field
              label="Transport expense (UGX)"
              value={transport}
              onChangeText={setTransport}
              numeric
            />
            <Field
              label="Delivery note"
              value={notes}
              onChangeText={setNotes}
              multiline
            />
            <Pressable
              disabled={loading || workspace?.operations.isClosed}
              onPress={saveSale}
              style={[
                s.primary,
                (loading || workspace?.operations.isClosed) && s.disabled,
              ]}
            >
              <Text style={s.primaryText}>
                {loading ? "Saving…" : "Save industrial sale"}
              </Text>
            </Pressable>
          </>
        )}
        {screen === "history" && (
          <>
            <Text style={s.title}>Industrial sales</Text>
            <Text style={s.subtitle}>
              Your company’s industrial sale records and payment position.
            </Text>
            <TextInput accessibilityLabel="Search industrial sales" value={historyQuery} onChangeText={(value) => { setHistoryQuery(value); setHistoryPage(1); }} placeholder="Search material, buyer, invoice or payment" placeholderTextColor="#8793a6" style={s.search} />
            <Text style={s.resultCount}>{filteredSales.length} sale{filteredSales.length === 1 ? "" : "s"}</Text>
            {visibleSales.map((x) => (
              <View key={x.id} style={s.card}>
                <View style={s.rowBetween}>
                  <Text style={s.rowTitle}>{x.material_type}</Text>
                  <Text style={s.rowValue}>
                    {Number(x.quantity_kg).toLocaleString()} kg
                  </Text>
                </View>
                <Text style={s.rowSub}>
                  {x.buyer_name} ·{" "}
                  {new Date(x.sold_on).toLocaleDateString("en-GB")}
                </Text>
                <Text style={s.money}>
                  UGX {Number(x.total_ugx).toLocaleString()}
                </Text>
                <Text
                  style={[s.status, Number(x.balance_ugx) > 0 && s.statusDue]}
                >
                  {Number(x.balance_ugx) > 0
                    ? `UGX ${Number(x.balance_ugx).toLocaleString()} due`
                    : "Paid"}
                  {x.invoice_number ? ` · ${x.invoice_number}` : ""}
                </Text>
                {Number(x.balance_ugx) > 0 && x.status !== "pending_sync" ? (
                  paymentSaleId === x.id ? (
                    <View style={s.paymentBox}>
                      <Field label="Amount received (UGX)" value={paymentAmount} onChangeText={setPaymentAmount} numeric />
                      <Field label="Payment reference" value={paymentReference} onChangeText={setPaymentReference} placeholder="Mobile money, bank or receipt reference" />
                      <View style={s.paymentActions}>
                        <Pressable disabled={savingPayment} onPress={() => void recordPayment(x)} style={[s.primarySmall, savingPayment && s.disabled]}><Text style={s.primaryText}>{savingPayment ? "Saving…" : "Record payment"}</Text></Pressable>
                        <Pressable onPress={() => { setPaymentSaleId(""); setPaymentAmount(""); setPaymentReference(""); }} style={s.cancelSmall}><Text style={s.cancelText}>Cancel</Text></Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable onPress={() => { setPaymentSaleId(x.id); setPaymentAmount(String(Number(x.balance_ugx))); setPaymentReference(""); }} style={s.secondary}><Text style={s.secondaryText}>Record customer payment</Text></Pressable>
                  )
                ) : null}
              </View>
            ))}
            {!filteredSales.length && (
              <Text style={s.empty}>
                {historyQuery ? "No industrial sales match this search." : "No industrial sales have been recorded."}
              </Text>
            )}
            {filteredSales.length > historyPageSize ? <View style={s.pagination}><Pressable disabled={historyPage===1} onPress={()=>setHistoryPage(page=>Math.max(1,page-1))} style={[s.pageButton,historyPage===1&&s.disabled]}><Text style={s.pageButtonText}>Previous</Text></Pressable><Text style={s.pageLabel}>Page {historyPage} of {historyPages}</Text><Pressable disabled={historyPage===historyPages} onPress={()=>setHistoryPage(page=>Math.min(historyPages,page+1))} style={[s.pageButton,historyPage===historyPages&&s.disabled]}><Text style={s.pageButtonText}>Next</Text></Pressable></View> : null}
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
  safe: { flex: 1, backgroundColor: "#f6f7f5" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f6f7f5",
  },
  header: {
    minHeight: 72,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#dfe4ea",
    paddingHorizontal: 20,
    paddingVertical: 13,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.7,
    color: "#3156a3",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    marginTop: 4,
  },
  connected: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#16a34a" },
  connectedText: { fontSize: 11, color: "#64748b", fontWeight: "700" },
  error: {
    backgroundColor: "#fff1f2",
    borderLeftWidth: 4,
    borderLeftColor: "#dc2626",
    color: "#991b1b",
    fontWeight: "700",
    padding: 13,
    marginHorizontal: 20,
    marginTop: 12,
  },
  page: { width: "100%", maxWidth: 1180, alignSelf: "center", padding: 20, paddingBottom: 110 },
  title: { fontSize: 30, fontWeight: "800", color: "#111827" },
  roleLabel: { alignSelf: "flex-start", color: "#3156a3", backgroundColor: "#eaf0fc", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, marginTop: 9, fontSize: 11, fontWeight: "900", textTransform: "capitalize", overflow: "hidden" },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "#64748b",
    marginTop: 7,
    marginBottom: 20,
  },
  warning: {
    backgroundColor: "#fff7df",
    borderLeftWidth: 4,
    borderLeftColor: "#d97706",
    padding: 13,
    color: "#92400e",
    fontWeight: "700",
    marginBottom: 16,
  },
  metrics: { flexDirection: "row", gap: 10 },
  metric: { flex: 1, minHeight: 106, padding: 16, backgroundColor: "#151b2b", borderRadius: 20 },
  metricBlue: {
    flex: 1,
    minHeight: 106,
    padding: 16,
    backgroundColor: "#3156a3",
    borderRadius: 20,
  },
  metricLabel: { fontSize: 10, fontWeight: "800", color: "#a7b1c2" },
  metricLabelBlue: { fontSize: 10, fontWeight: "800", color: "#dbeafe" },
  metricValue: {
    fontSize: 32,
    fontWeight: "800",
    color: "white",
    marginTop: 15,
  },
  metricValueBlue: {
    fontSize: 32,
    fontWeight: "800",
    color: "white",
    marginTop: 15,
  },
  summary: {
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    padding: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 16,
    marginTop: 9,
  },
  summaryLabel: { fontSize: 13, color: "#64748b", fontWeight: "700" },
  summaryValue: { fontSize: 15, color: "#111827", fontWeight: "800" },
  primary: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3156a3",
    paddingHorizontal: 18,
    marginTop: 16,
    borderRadius: 17,
  },
  primaryText: { color: "white", fontSize: 16, fontWeight: "800" },
  secondary: { minHeight: 48, borderWidth: 1, borderColor: "#3156a3", borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, marginTop: 10 },
  secondaryText: { color: "#3156a3", fontSize: 13, fontWeight: "900" },
  disabled: { backgroundColor: "#aebbd4" },
  sectionTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: "#111827",
    marginTop: 28,
    marginBottom: 8,
  },
  row: {
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 17,
    marginBottom: 9,
  },
  rowTitle: { fontSize: 15, fontWeight: "800", color: "#1e293b" },
  rowSub: { fontSize: 12, color: "#64748b", marginTop: 5 },
  rowValue: { fontSize: 15, fontWeight: "800", color: "#111827" },
  empty: {
    backgroundColor: "white",
    padding: 24,
    textAlign: "center",
    color: "#64748b",
  },
  label: { fontSize: 13, fontWeight: "700", color: "#334155", marginBottom: 7 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
  choice: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "white",
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 14,
  },
  choiceActive: { borderColor: "#3156a3", backgroundColor: "#eaf0fc" },
  choiceText: { fontSize: 13, fontWeight: "700", color: "#475569" },
  choiceTextActive: { color: "#24498f" },
  field: { marginBottom: 16 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "white",
    paddingHorizontal: 14,
    fontSize: 16,
    color: "#0f172a",
    borderRadius: 15,
  },
  textarea: { minHeight: 90, textAlignVertical: "top", paddingTop: 13 },
  twoCol: { flexDirection: "row", gap: 10 },
  total: {
    padding: 17,
    backgroundColor: "#eaf0fc",
    borderLeftWidth: 4,
    borderLeftColor: "#3156a3",
    marginBottom: 18,
  },
  totalLabel: { fontSize: 11, color: "#526684", fontWeight: "800" },
  totalValue: {
    fontSize: 25,
    color: "#111827",
    fontWeight: "800",
    marginTop: 5,
  },
  partnerCard: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#dfe6ef", borderRadius: 20, padding: 16, marginBottom: 18 },
  partnerTitle: { color: "#172033", fontSize: 16, fontWeight: "900", marginBottom: 14 },
  card: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#dfe4ea",
    padding: 17,
    marginBottom: 10,
    borderRadius: 20,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  money: { fontSize: 17, fontWeight: "800", color: "#111827", marginTop: 13 },
  status: { fontSize: 12, fontWeight: "800", color: "#15803d", marginTop: 5 },
  statusDue: { color: "#b45309" },
  paymentBox: { backgroundColor: "#f4f7fc", borderRadius: 16, padding: 14, marginTop: 14 },
  paymentActions: { flexDirection: "row", gap: 9, alignItems: "center" },
  primarySmall: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: "#3156a3", alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  cancelSmall: { minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  cancelText: { color: "#64748b", fontWeight: "800" },
  accountRole: {
    fontSize: 12,
    fontWeight: "800",
    color: "#3156a3",
    marginTop: 14,
    textTransform: "uppercase",
  },
  settingsRow: {
    minHeight: 76,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dfe4ea",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  settingsCopy: { flex: 1 },
  logout: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  logoutText: { color: "#b91c1c", fontWeight: "800" },
  tabs: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 10,
    minHeight: 70,
    flexDirection: "row",
    backgroundColor: "#151b2b",
    borderRadius: 24,
    padding: 6,
    shadowColor: "#0b1220",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  tabsTablet: { position: "relative", left: 0, right: 0, bottom: 0, minHeight: 56, justifyContent: "center", borderRadius: 0, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#dfe4ea", elevation: 0, shadowOpacity: 0 },
  tabTablet: { flex: undefined, width: 155, borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabTabletActive: { borderBottomColor: "#3156a3", backgroundColor: "#f5f8ff" },
  tab: { flex: 1, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 10, fontWeight: "800", color: "#aab5c8" },
  tabActive: { color: "#f2b657" },
  search: { minHeight: 50, borderWidth: 1, borderColor: "#cbd5e1", backgroundColor: "white", paddingHorizontal: 14, fontSize: 15, color: "#111827", marginBottom: 10 },
  resultCount: { color: "#64748b", fontSize: 12, fontWeight: "700", marginBottom: 12 },
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14 },
  pageButton: { borderWidth: 1, borderColor: "#3156a3", paddingHorizontal: 14, paddingVertical: 10 },
  pageButtonText: { color: "#3156a3", fontWeight: "800", fontSize: 12 },
  pageLabel: { color: "#475569", fontWeight: "700", fontSize: 12 },
});
