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
  useWindowDimensions,
  View,
} from "react-native";
import { MobileUser } from "../lib/auth-session";
import { mobileRequest } from "../lib/mobile-api";
import { AccountWorkspace } from "./AccountWorkspace";
import { RoleBottomNavigation, RoleNavigationItem } from "./RoleBottomNavigation";
import { SectionNavigation } from "./SectionNavigation";
import { SyncStatus } from "./SyncStatus";

type Screen = "today" | "buy" | "history" | "account";
type Material = { id: string; name: string; active: boolean };
type Partner = { id: string; name: string; partner_type: string; active: boolean };
type Lot = {
  id: string;
  origin?: string;
  material_type: string;
  source_name: string;
  quantity_kg: string;
  available_kg: string;
  unit_purchase_price_ugx: string;
  total_cost_ugx?: string;
  collected_on: string;
  quality: string;
  purchase_payment_status: string;
  status: string;
};
type Workspace = {
  organization: { name: string };
  operations: { operatingDate: string; isClosed: boolean };
  materials: Material[];
  partners: Partner[];
  lots: Lot[];
  myActivity?: { purchases?: number; purchasedKg?: number };
};

export function RecyclingPurchaseWorkspace({
  token,
  user,
  onLogout,
  onOpenOperations,
  onOpenSales,
}: {
  token: string;
  user: MobileUser;
  onLogout: () => Promise<void>;
  onOpenOperations?: (target?: "dashboard" | "operations") => void;
  onOpenSales?: () => void;
}) {
  const { width } = useWindowDimensions();
  const tablet = width >= 760;
  const [screen, setScreen] = useState<Screen>("today");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [material, setMaterial] = useState("");
  const [customMaterial, setCustomMaterial] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [source, setSource] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [transport, setTransport] = useState("0");
  const [floatUsed, setFloatUsed] = useState("0");
  const [quality, setQuality] = useState("mixed");
  const [payment, setPayment] = useState("paid");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const result = await mobileRequest<{ data: Workspace }>(
        "/api/waste/recycling",
        token,
        user.email,
      );
      setWorkspace(result.data);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load the purchasing workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, [token, user.email]);

  useEffect(() => {
    // Initial workspace hydration is intentionally effect-driven.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const purchases = useMemo(
    () =>
      (workspace?.lots || []).filter(
        (lot) => lot.origin === "purchase" || !lot.origin,
      ),
    [workspace],
  );
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return purchases;
    return purchases.filter((lot) =>
      [lot.material_type, lot.source_name, lot.quality, lot.purchase_payment_status]
        .some((entry) => String(entry || "").toLowerCase().includes(value)),
    );
  }, [purchases, query]);
  const today = workspace?.operations.operatingDate || new Date().toISOString().slice(0, 10);
  const todayLots = purchases.filter((lot) => String(lot.collected_on).slice(0, 10) === today);
  const todayKg = todayLots.reduce((sum, lot) => sum + Number(lot.quantity_kg || 0), 0);
  const total = Number(quantity || 0) * Number(price || 0) + Number(transport || 0);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function savePurchase() {
    const materialType = customMaterial.trim() || material;
    const supplier = workspace?.partners.find((item) => item.id === supplierId);
    if (!materialType || (!supplierId && source.trim().length < 2) || Number(quantity) <= 0 || Number(price) < 0) {
      setError("Choose a material and supplier, then enter a valid weight and purchase price.");
      return;
    }
    try {
      setSaving(true);
      setError("");
      const result = await mobileRequest<{ queuedOffline?: boolean; localId?: string }>(
        "/api/waste/recycling/lots",
        token,
        user.email,
        {
          method: "POST",
          body: JSON.stringify({
            materialType,
            allowNewMaterial: Boolean(customMaterial.trim()),
            supplierPartnerId: supplierId || undefined,
            sourceName: supplier?.name || source.trim(),
            quantityKg: Number(quantity),
            unitPurchasePriceUgx: Number(price),
            collectedOn: today,
            quality,
            purchasePaymentStatus: payment,
            purchasePaymentReference: reference.trim() || undefined,
            workerWagesUgx: 0,
            foodUgx: 0,
            transportUgx: Number(transport || 0),
            driverFeeUgx: 0,
            otherExpenseUgx: 0,
            managerFloatUsedUgx: Number(floatUsed || 0),
            notes: notes.trim() || undefined,
          }),
        },
      );
      if (result.queuedOffline) {
        const local: Lot = {
          id: result.localId || `local-${Date.now()}`,
          material_type: materialType,
          source_name: supplier?.name || source.trim(),
          quantity_kg: String(Number(quantity)),
          available_kg: String(Number(quantity)),
          unit_purchase_price_ugx: String(Number(price)),
          total_cost_ugx: String(total),
          collected_on: today,
          quality,
          purchase_payment_status: payment,
          status: "pending_sync",
        };
        setWorkspace((current) => current ? {
          ...current,
          lots: [local, ...current.lots],
          myActivity: {
            ...current.myActivity,
            purchases: (current.myActivity?.purchases || 0) + 1,
            purchasedKg: (current.myActivity?.purchasedKg || 0) + Number(quantity),
          },
        } : current);
      } else {
        await load();
      }
      setMaterial("");
      setCustomMaterial("");
      setSupplierId("");
      setSource("");
      setQuantity("");
      setPrice("");
      setTransport("0");
      setFloatUsed("0");
      setReference("");
      setNotes("");
      setScreen("today");
      Alert.alert(
        result.queuedOffline ? "Purchase saved offline" : "Purchase recorded",
        result.queuedOffline
          ? "The purchase is secured on this device and will synchronize automatically."
          : "Company stock and purchasing records are now updated.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this purchase.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !workspace) {
    return <View style={s.center}><ActivityIndicator size="large" color="#3156a3" /></View>;
  }

  const managerMode = Boolean(onOpenOperations || onOpenSales);
  const navigation: RoleNavigationItem[] = managerMode
    ? [
        { id: "dashboard", label: "Dashboard", icon: "⌂", onPress: () => onOpenOperations?.("dashboard") },
        { id: "purchases", label: "Purchases", icon: "↓", active: screen !== "account", onPress: () => setScreen("today") },
        { id: "operations", label: "Operations", icon: "◫", onPress: () => onOpenOperations?.("operations") },
        { id: "sales", label: "Sales", icon: "↗", onPress: onOpenSales || (() => undefined) },
        { id: "account", label: "Account", icon: "●", active: screen === "account", onPress: () => setScreen("account") },
      ]
    : [
        { id: "dashboard", label: "Dashboard", icon: "⌂", active: screen === "today", onPress: () => setScreen("today") },
        { id: "buy", label: "New", icon: "+", active: screen === "buy", onPress: () => setScreen("buy") },
        { id: "history", label: "History", icon: "▤", active: screen === "history", onPress: () => setScreen("history") },
        { id: "account", label: "Account", icon: "●", active: screen === "account", onPress: () => setScreen("account") },
      ];

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <View style={[s.header, tablet && s.headerTablet]}>
        <View style={s.brand}><Text style={s.brandText}>KW</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>RECYCLING FIELD OPERATIONS</Text>
          <Text style={s.headerTitle}>{workspace?.organization.name || "Material purchasing"}</Text>
        </View>
        <SyncStatus token={token} email={user.email} onSynced={() => void load()} />
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <ScrollView
        contentContainerStyle={[s.page, tablet && s.pageTablet]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {screen !== "account" ? (
          <SectionNavigation
            title="PURCHASING"
            items={[
              { id: "overview", label: "Overview", active: screen === "today", onPress: () => setScreen("today") },
              { id: "new", label: "New purchase", active: screen === "buy", onPress: () => setScreen("buy") },
              { id: "history", label: "History", active: screen === "history", onPress: () => setScreen("history") },
            ]}
          />
        ) : null}
        {screen === "today" ? <>
          <Text style={s.greeting}>Good day, {user.fullName.split(/\s+/)[0]}.</Text>
          <Text style={s.roleLabel}>{user.roles.map((role) => role.replaceAll("_", " ")).join(" · ")}</Text>
          <Text style={s.subtitle}>Record every kilogram purchased and keep company stock current, even without internet.</Text>
          {workspace?.operations.isClosed ? <Text style={s.warning}>Today has been closed by management. New transactions are locked.</Text> : null}
          <View style={[s.metrics, tablet && s.metricsTablet]}>
            <Metric label="Purchases today" value={workspace?.myActivity?.purchases ?? todayLots.length} />
            <Metric label="Kg received" value={`${Number(workspace?.myActivity?.purchasedKg ?? todayKg).toLocaleString()} kg`} accent />
            <Metric label="Waiting to sync" value={purchases.filter((lot) => lot.status === "pending_sync").length} />
          </View>
          <Pressable disabled={workspace?.operations.isClosed} onPress={() => setScreen("buy")} style={[s.primary, workspace?.operations.isClosed && s.disabled]}><Text style={s.primaryText}>+ New material purchase</Text></Pressable>
          <Text style={s.sectionTitle}>Today’s activity</Text>
          {todayLots.slice(0, 8).map((lot) => <PurchaseCard key={lot.id} lot={lot} />)}
          {!todayLots.length ? <Empty title="No purchases today" text="Tap New material purchase to record the first collection." /> : null}
        </> : null}

        {screen === "buy" ? <>
          <Text style={s.greeting}>New purchase</Text>
          <Text style={s.subtitle}>Use the same approved material, supplier, weight and finance rules as the central platform.</Text>
          <Text style={s.label}>Material type *</Text>
          <View style={s.chips}>{workspace?.materials.filter((item) => item.active).map((item) => <Choice key={item.id} label={item.name} active={material === item.name && !customMaterial} onPress={() => { setMaterial(item.name); setCustomMaterial(""); }} />)}</View>
          <Field label="Another material name" value={customMaterial} onChange={setCustomMaterial} placeholder="Only if it is not listed above" />
          <Text style={s.label}>Saved supplier</Text>
          <View style={s.chips}>{workspace?.partners.filter((item) => item.active && ["supplier", "both"].includes(item.partner_type)).map((item) => <Choice key={item.id} label={item.name} active={supplierId === item.id} onPress={() => { setSupplierId(item.id); setSource(item.name); }} />)}</View>
          {!supplierId ? <Field label="Supplier / collection point *" value={source} onChange={setSource} /> : null}
          <View style={tablet ? s.columns : undefined}>
            <View style={s.column}><Field label="Weight (kg) *" value={quantity} onChange={setQuantity} numeric /></View>
            <View style={s.column}><Field label="Price per kg (UGX) *" value={price} onChange={setPrice} numeric /></View>
          </View>
          <Text style={s.label}>Quality</Text>
          <View style={s.chips}>{["sorted", "clean", "mixed", "contaminated"].map((value) => <Choice key={value} label={value} active={quality === value} onPress={() => setQuality(value)} />)}</View>
          <Text style={s.label}>Payment</Text>
          <View style={s.chips}><Choice label="Paid" active={payment === "paid"} onPress={() => setPayment("paid")} /><Choice label="Credit" active={payment === "credit"} onPress={() => setPayment("credit")} /></View>
          <View style={tablet ? s.columns : undefined}>
            <View style={s.column}><Field label="Transport (UGX)" value={transport} onChange={setTransport} numeric /></View>
            <View style={s.column}><Field label="Manager float used (UGX)" value={floatUsed} onChange={setFloatUsed} numeric /></View>
          </View>
          <Field label="Payment reference" value={reference} onChange={setReference} placeholder="Receipt, mobile money or voucher" />
          <Field label="Notes" value={notes} onChange={setNotes} multiline />
          <View style={s.total}><Text style={s.totalLabel}>TOTAL PURCHASE COST</Text><Text style={s.totalValue}>UGX {total.toLocaleString()}</Text></View>
          <Pressable disabled={saving || workspace?.operations.isClosed} onPress={() => void savePurchase()} style={[s.primary, (saving || workspace?.operations.isClosed) && s.disabled]}><Text style={s.primaryText}>{saving ? "Saving…" : "Save purchase"}</Text></Pressable>
        </> : null}

        {screen === "history" ? <>
          <Text style={s.greeting}>Purchase history</Text>
          <Text style={s.subtitle}>Server records and unsynchronized device records appear together.</Text>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search material, supplier, quality or payment" placeholderTextColor="#8793a6" style={s.search} />
          {filtered.map((lot) => <PurchaseCard key={lot.id} lot={lot} />)}
          {!filtered.length ? <Empty title="No matching purchases" text="Change the search or record a new purchase." /> : null}
        </> : null}

        {screen === "account" ? <AccountWorkspace user={user} organizationName={workspace?.organization.name} onLogout={onLogout} /> : null}
      </ScrollView>
      <RoleBottomNavigation items={navigation} />
    </SafeAreaView>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return <View style={[s.metric, accent && s.metricAccent]}><Text style={[s.metricLabel, accent && s.metricAccentText]}>{label}</Text><Text style={[s.metricValue, accent && s.metricAccentText]}>{value}</Text></View>;
}
function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[s.choice, active && s.choiceActive]}><Text style={[s.choiceText, active && s.choiceTextActive]}>{label}</Text></Pressable>;
}
function Field({ label, value, onChange, placeholder, numeric = false, multiline = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; numeric?: boolean; multiline?: boolean }) {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#8793a6" keyboardType={numeric ? "decimal-pad" : "default"} multiline={multiline} style={[s.input, multiline && s.textarea]} /></View>;
}
function PurchaseCard({ lot }: { lot: Lot }) {
  return <View style={s.card}><View style={{ flex: 1 }}><Text style={s.cardTitle}>{lot.material_type}</Text><Text style={s.cardCopy}>{lot.source_name} · {lot.quality}</Text><Text style={s.cardCopy}>{new Date(lot.collected_on).toLocaleDateString("en-GB")} · {lot.purchase_payment_status}</Text></View><View style={{ alignItems: "flex-end" }}><Text style={s.cardValue}>{Number(lot.quantity_kg).toLocaleString()} kg</Text><Text style={[s.badge, lot.status === "pending_sync" && s.badgePending]}>{lot.status === "pending_sync" ? "Waiting to sync" : lot.status?.replaceAll("_", " ") || "recorded"}</Text></View></View>;
}
function Empty({ title, text }: { title: string; text: string }) { return <View style={s.empty}><Text style={s.cardTitle}>{title}</Text><Text style={s.cardCopy}>{text}</Text></View>; }

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f3f5f8" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f3f5f8" },
  header: { minHeight: 76, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: "#e4e8ef" },
  headerTablet: { paddingHorizontal: 30 },
  brand: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#162038", alignItems: "center", justifyContent: "center" },
  brandText: { color: "#f0b35a", fontWeight: "900" },
  eyebrow: { color: "#3156a3", fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  headerTitle: { color: "#111827", fontSize: 17, fontWeight: "900", marginTop: 3 },
  page: { width: "100%", padding: 18, paddingBottom: 110 },
  pageTablet: { maxWidth: 1040, alignSelf: "center", padding: 28 },
  greeting: { color: "#101727", fontSize: 30, lineHeight: 36, fontWeight: "900" },
  roleLabel: { alignSelf: "flex-start", color: "#3156a3", backgroundColor: "#eaf0fc", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, marginTop: 9, fontSize: 11, fontWeight: "900", textTransform: "capitalize", overflow: "hidden" },
  subtitle: { color: "#68758a", fontSize: 14, lineHeight: 21, marginTop: 7, marginBottom: 20, maxWidth: 720 },
  error: { color: "#9b2c2c", backgroundColor: "#fff0f0", borderLeftWidth: 4, borderLeftColor: "#d14343", padding: 13, marginHorizontal: 18, marginTop: 10, fontWeight: "700" },
  warning: { color: "#8a4b08", backgroundColor: "#fff8e6", borderLeftWidth: 4, borderLeftColor: "#d99a2b", borderRadius: 12, padding: 13, marginBottom: 16, fontWeight: "700" },
  metrics: { gap: 10, marginBottom: 16 },
  metricsTablet: { flexDirection: "row" },
  metric: { flex: 1, minHeight: 106, borderRadius: 22, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e1e6ee", padding: 16, justifyContent: "space-between" },
  metricAccent: { backgroundColor: "#3156a3", borderColor: "#3156a3" },
  metricLabel: { color: "#718096", fontSize: 11, fontWeight: "800" },
  metricValue: { color: "#111827", fontSize: 28, fontWeight: "900", marginTop: 12 },
  metricAccentText: { color: "#fff" },
  primary: { minHeight: 56, borderRadius: 18, backgroundColor: "#3156a3", alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginVertical: 8 },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  sectionTitle: { color: "#111827", fontSize: 20, fontWeight: "900", marginTop: 22, marginBottom: 10 },
  card: { backgroundColor: "#fff", borderRadius: 20, borderWidth: 1, borderColor: "#e1e6ee", padding: 16, marginBottom: 10, flexDirection: "row", gap: 12, shadowColor: "#172033", shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 1 },
  cardTitle: { color: "#172033", fontSize: 15, fontWeight: "900" },
  cardCopy: { color: "#718096", fontSize: 12, lineHeight: 18, marginTop: 4 },
  cardValue: { color: "#172033", fontSize: 16, fontWeight: "900" },
  badge: { color: "#16804b", backgroundColor: "#eaf8f0", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginTop: 7, fontSize: 10, fontWeight: "800", textTransform: "capitalize", overflow: "hidden" },
  badgePending: { color: "#8a4b08", backgroundColor: "#fff5d9" },
  empty: { backgroundColor: "#fff", borderRadius: 20, borderWidth: 1, borderColor: "#e1e6ee", padding: 24, alignItems: "center" },
  label: { color: "#29364c", fontSize: 12, fontWeight: "800", marginBottom: 7 },
  field: { flex: 1, marginBottom: 14 },
  input: { minHeight: 54, borderRadius: 16, borderWidth: 1, borderColor: "#d7dee8", backgroundColor: "#fff", paddingHorizontal: 15, fontSize: 15, color: "#111827" },
  textarea: { minHeight: 92, paddingTop: 14, textAlignVertical: "top" },
  columns: { flexDirection: "row", gap: 12 },
  column: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  choice: { minHeight: 42, borderRadius: 14, borderWidth: 1, borderColor: "#d7dee8", backgroundColor: "#fff", paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  choiceActive: { borderColor: "#3156a3", backgroundColor: "#eaf0fc" },
  choiceText: { color: "#5d6b80", fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  choiceTextActive: { color: "#25498d" },
  total: { borderRadius: 20, backgroundColor: "#eaf0fc", padding: 17, marginVertical: 8 },
  totalLabel: { color: "#526684", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  totalValue: { color: "#111827", fontSize: 25, fontWeight: "900", marginTop: 6 },
  search: { minHeight: 54, borderRadius: 17, borderWidth: 1, borderColor: "#d7dee8", backgroundColor: "#fff", paddingHorizontal: 15, marginBottom: 14, fontSize: 15, color: "#111827" },
  bottomNav: { position: "absolute", left: 12, right: 12, bottom: 10, minHeight: 70, flexDirection: "row", borderRadius: 24, backgroundColor: "#151b2b", padding: 6, shadowColor: "#0b1220", shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  bottomNavTablet: { left: "20%", right: "20%", bottom: 16 },
  navItem: { flex: 1, borderRadius: 18, alignItems: "center", justifyContent: "center", gap: 2 },
  navActive: { backgroundColor: "#fff" },
  navIcon: { color: "#aab5c8", fontSize: 17, fontWeight: "900" },
  navText: { color: "#aab5c8", fontSize: 10, fontWeight: "800" },
  navTextActive: { color: "#1f3f7e" },
});
