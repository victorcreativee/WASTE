import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MobileUser } from "../lib/auth-session";
import { mobileRequest, readCachedResponse } from "../lib/mobile-api";
import { AccountWorkspace } from "./AccountWorkspace";
import { DailyReport } from "./DailyReport";
import { useBottomNavigationSpace, RoleBottomNavigation, RoleNavigationItem } from "./RoleBottomNavigation";
import { SyncStatus } from "./SyncStatus";
import { AppHeader, Banner, Button, Card, Chips, DateField, EmptyState, Field, Icon, Input, ListRow, MoneyInput, QuickActions, ReferenceInput, SectionHeader, Segmented, SummaryCard, page } from "../ui/kit";
import { color, type, ugx } from "../ui/theme";
import { formatDay, localDay } from "../lib/dates";

type Screen = "today" | "buy" | "history" | "report" | "account";
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
  paid_ugx?: string;
  balance_ugx?: string;
  status: string;
};

const lotCost = (lot: Lot) => Number(lot.total_cost_ugx ?? Number(lot.quantity_kg) * Number(lot.unit_purchase_price_ugx));
const owed = (lot: Lot) => ["credit", "partially_paid"].includes(lot.purchase_payment_status);
const lotBalance = (lot: Lot) => Number(lot.balance_ugx ?? (owed(lot) ? lotCost(lot) : 0));
type Workspace = {
  organization: { name: string };
  operations: { operatingDate: string; isClosed: boolean };
  materials: Material[];
  partners: Partner[];
  lots: Lot[];
  myActivity?: { purchases?: number; purchasedKg?: number };
  /** The member's recycling permission codes; older servers do not send this. */
  permissions?: string[];
  dailyClosures?: { operating_date: string; status: string }[];
  summary?: { floatBalanceUgx?: number };
};

export function RecyclingPurchaseWorkspace({
  token,
  user,
  onLogout,
  onOpenOperations,
  onOpenSales,
  active = true,
}: {
  token: string;
  user: MobileUser;
  onLogout: () => Promise<void>;
  onOpenOperations?: (target?: "dashboard" | "operations") => void;
  onOpenSales?: () => void;
  active?: boolean;
}) {
  const navSpace = useBottomNavigationSpace();
  const scrollRef = useRef<ScrollView>(null);
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
  const [quality, setQuality] = useState("mixed");
  const [payment, setPayment] = useState("paid");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [costs, setCosts] = useState({ wages: "", food: "", driver: "", other: "" });
  const [showCosts, setShowCosts] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "owed">("all");
  const [payingLotId, setPayingLotId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payReference, setPayReference] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [payDate, setPayDate] = useState(localDay());

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
    return purchases.filter((lot) => (historyFilter === "all" || owed(lot)) &&
      [lot.material_type, lot.source_name, lot.quality, lot.purchase_payment_status]
        .some((entry) => String(entry || "").toLowerCase().includes(value)),
    );
  }, [historyFilter, purchases, query]);
  const today = workspace?.operations.operatingDate || localDay();
  const todayLots = purchases.filter((lot) => localDay(lot.collected_on) === today);
  const todayKg = todayLots.reduce((sum, lot) => sum + Number(lot.quantity_kg || 0), 0);
  const closedDays = [
    ...(workspace?.dailyClosures || []).filter((item) => item.status === "closed").map((item) => localDay(item.operating_date)),
    ...(workspace?.operations.isClosed ? [workspace.operations.operatingDate] : []),
  ];
  // The form follows the business day until someone picks another date.
  const recordDate = purchaseDate || today;
  const materialCost = Number(quantity || 0) * Number(price || 0);
  const extraCosts = Number(transport || 0) + Number(costs.wages || 0) + Number(costs.food || 0) + Number(costs.driver || 0) + Number(costs.other || 0);
  const total = Math.round(materialCost + extraCosts);
  // Paid purchases come out of the manager float on the server; warn early when the saved balance is not enough.
  const paysFromFloat = user.roles.some((role) => ["recycling_field_manager", "recycling_collector", "recycling_sales"].includes(role));
  const floatAvailable = Number(workspace?.summary?.floatBalanceUgx ?? 0);
  const floatShort = paysFromFloat && payment === "paid" && workspace?.summary?.floatBalanceUgx !== undefined && total > floatAvailable;

  async function attachLocation() {
    try {
      setLocating(true);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") return Alert.alert("Location not allowed", "Allow location access to attach where this material was collected.");
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000));
      const point = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null), timeout])
        ?? await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
      if (!point) return Alert.alert("No location yet", "The phone could not find its position. Move to open sky and try again, or save without it.");
      setLocation({ latitude: point.coords.latitude, longitude: point.coords.longitude, accuracy: point.coords.accuracy ?? undefined });
    } finally {
      setLocating(false);
    }
  }

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
    if (recordDate > localDay()) {
      setError("The purchase date cannot be in the future.");
      return;
    }
    if (closedDays.includes(recordDate)) {
      setError(`${formatDay(recordDate)} is closed. Choose another date or ask a manager to reopen it.`);
      return;
    }
    if (floatShort) {
      setError(`The manager float has only ${ugx(floatAvailable)} and this purchase costs ${ugx(total)}. Ask the office to issue more float, or record it on credit.`);
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
            collectedOn: recordDate,
            quality,
            purchasePaymentStatus: payment,
            purchasePaymentReference: reference.trim() || undefined,
            workerWagesUgx: Number(costs.wages || 0),
            foodUgx: Number(costs.food || 0),
            transportUgx: Number(transport || 0),
            driverFeeUgx: Number(costs.driver || 0),
            otherExpenseUgx: Number(costs.other || 0),
            // The server takes field staff's paid purchases from the manager float.
            managerFloatUsedUgx: 0,
            collectionLatitude: location?.latitude,
            collectionLongitude: location?.longitude,
            collectionAccuracyM: location?.accuracy,
            notes: notes.trim() || undefined,
          }),
        },
      );
      if (result.queuedOffline) {
        const local: Lot = {
          id: result.localId || "local-purchase",
          material_type: materialType,
          source_name: supplier?.name || source.trim(),
          quantity_kg: String(Number(quantity)),
          available_kg: String(Number(quantity)),
          unit_purchase_price_ugx: String(Number(price)),
          total_cost_ugx: String(total),
          collected_on: recordDate,
          quality,
          purchase_payment_status: payment,
          status: "pending_sync",
        };
        setWorkspace((current) => current ? {
          ...current,
          lots: [local, ...current.lots],
          summary: paysFromFloat && payment === "paid" && current.summary
            ? { ...current.summary, floatBalanceUgx: Number(current.summary.floatBalanceUgx ?? 0) - total }
            : current.summary,
          // Only field buyers get a personal summary from the server; everyone else's totals come from the lots themselves.
          myActivity: current.myActivity && recordDate === today ? {
            ...current.myActivity,
            purchases: (current.myActivity.purchases || 0) + 1,
            purchasedKg: (current.myActivity.purchasedKg || 0) + Number(quantity),
          } : current.myActivity,
        } : current);
      } else {
        void load();
      }
      setMaterial("");
      setCustomMaterial("");
      setSupplierId("");
      setSource("");
      setQuantity("");
      setPrice("");
      setTransport("0");
      setReference("");
      setNotes("");
      setPurchaseDate("");
      setCosts({ wages: "", food: "", driver: "", other: "" });
      setShowCosts(false);
      setLocation(null);
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
    return <View style={page.center}><ActivityIndicator size="large" color={color.action} /><Text style={type.small}>Loading your purchases…</Text></View>;
  }

  const closed = Boolean(workspace?.operations.isClosed);
  const managerMode = Boolean(onOpenOperations || onOpenSales);
  const navigation: RoleNavigationItem[] = managerMode
    ? [
        { id: "dashboard", label: "Dashboard", icon: "home-outline", onPress: () => onOpenOperations?.("dashboard") },
        { id: "purchases", label: "Purchases", icon: "download-outline", active: screen !== "account", onPress: () => setScreen("today") },
        { id: "operations", label: "Operations", icon: "grid-outline", onPress: () => onOpenOperations?.("operations") },
        { id: "sales", label: "Sales", icon: "trending-up-outline", onPress: onOpenSales || (() => undefined) },
        { id: "account", label: "Account", icon: "person-outline", active: screen === "account", onPress: () => setScreen("account") },
      ]
    : [
        { id: "dashboard", label: "Home", icon: "home-outline", active: screen === "today", onPress: () => setScreen("today") },
        { id: "buy", label: "Buy", icon: "add-circle-outline", active: screen === "buy", onPress: () => setScreen("buy") },
        { id: "history", label: "History", icon: "time-outline", active: screen === "history", onPress: () => setScreen("history") },
        { id: "account", label: "Account", icon: "person-outline", active: screen === "account", onPress: () => setScreen("account") },
      ];
  const todaySpent = todayLots.reduce((sum, lot) => sum + Number(lot.paid_ugx ?? (lot.purchase_payment_status === "paid" ? lotCost(lot) : 0)), 0);
  // The server lists the member's permissions; before that field existed, managers and administrators held this right.
  const canPaySuppliers = workspace?.permissions
    ? workspace.permissions.some((code) => code === "recycling.finance.manage" || code === "recycling.purchase_payment.manage")
    : user.roles.some((role) => ["recycling_field_manager", "company_admin", "supervisor"].includes(role));
  const owedLots = purchases.filter(owed);
  const owedTotal = owedLots.reduce((sum, lot) => sum + lotBalance(lot), 0);
  const payingLot = purchases.find((lot) => lot.id === payingLotId);

  function startPayment(lot: Lot) {
    setPayingLotId(lot.id);
    setPayAmount(String(lotBalance(lot)));
    setPayReference("");
    setPayDate(localDay());
    setError("");
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  async function savePayment() {
    if (!payingLot) return;
    const amount = Number(payAmount);
    const balance = lotBalance(payingLot);
    if (!Number.isInteger(amount) || amount <= 0 || amount > balance) {
      setError(`Enter a whole amount between UGX 1 and ${ugx(balance)}.`);
      return;
    }
    if (payReference.trim().length < 2) {
      setError("Enter the payment reference from the receipt or mobile-money message, or tap New.");
      return;
    }
    try {
      setSavingPayment(true);
      setError("");
      const result = await mobileRequest<{ queuedOffline?: boolean }>(
        `/api/waste/recycling/lots/${payingLot.id}/paid`,
        token,
        user.email,
        { method: "PATCH", body: JSON.stringify({ amountUgx: amount, paymentReceivedOn: payDate, paymentReference: payReference.trim() }) },
      );
      if (result.queuedOffline) {
        setWorkspace((current) => current ? {
          ...current,
          lots: current.lots.map((lot) => lot.id === payingLot.id ? {
            ...lot,
            balance_ugx: String(balance - amount),
            paid_ugx: String(Number(lot.paid_ugx || 0) + amount),
            purchase_payment_status: amount === balance ? "paid" : "partially_paid",
          } : lot),
        } : current);
      } else void load();
      setPayingLotId("");
      Alert.alert(
        result.queuedOffline ? "Payment saved offline" : "Supplier payment recorded",
        result.queuedOffline
          ? "It is secured on this phone and will be sent when there is internet."
          : `${ugx(amount)} paid to ${payingLot.source_name}.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record this payment.");
    } finally {
      setSavingPayment(false);
    }
  }
  const waiting = purchases.filter((lot) => lot.status === "pending_sync").length;

  return (
    <SafeAreaView style={page.safe} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <AppHeader name={user.fullName} organization={workspace?.organization.name || "Material purchasing"}
        right={<SyncStatus token={token} email={user.email} onSynced={() => void load()} />} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[page.content, tablet && page.contentTablet, { paddingBottom: navSpace }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {error ? <Banner tone="danger" text={error} /> : null}
        {managerMode && screen !== "account" ? (
          <Segmented value={screen} onChange={setScreen} options={[
            { value: "today", label: "Overview" }, { value: "buy", label: "New purchase" }, { value: "history", label: "History" },
          ]} />
        ) : null}

        {screen === "today" ? <>
          {closed ? <Banner tone="warning" title="Day closed" text="Management has closed today. Purchases for today are locked until a manager reopens the day; an earlier open day can still be chosen." /> : null}
          <SummaryCard label="Bought today" value={`${Number(workspace?.myActivity?.purchasedKg ?? todayKg).toLocaleString("en-GB")} kg`}
            caption={new Date(`${today}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
            stats={[
              { label: "Purchases", value: workspace?.myActivity?.purchases ?? todayLots.length },
              { label: "Paid out", value: ugx(todaySpent).replace("UGX ", "") },
              { label: "To sync", value: waiting },
            ]} />
          <QuickActions items={[
            { icon: "add-circle-outline", label: "New purchase", onPress: () => setScreen("buy") },
            canPaySuppliers && owedLots.length
              ? { icon: "wallet-outline" as const, label: "Pay supplier", onPress: () => { setHistoryFilter("owed"); setScreen("history"); }, tone: "neutral" as const }
              : { icon: "time-outline" as const, label: "History", onPress: () => setScreen("history"), tone: "neutral" as const },
            { icon: "document-text-outline", label: "Day report", onPress: () => setScreen("report"), tone: "neutral" },
          ]} />
          <SectionHeader title="Today’s purchases" action={purchases.length ? { label: "See all", onPress: () => setScreen("history") } : undefined} />
          {todayLots.slice(0, 8).map((lot) => <PurchaseRow key={lot.id} lot={lot} />)}
          {!todayLots.length ? <EmptyState icon="scale-outline" title="No purchases yet today" text="Each kilogram you buy appears here, even without internet."
            action={{ label: "Record a purchase", onPress: () => setScreen("buy") }} /> : null}
        </> : null}

        {screen === "buy" ? <>
          <View>
            <Text style={page.title}>New purchase</Text>
            <Text style={[type.small, { marginTop: 4 }]}>Saved on this phone first and sent when there is internet.</Text>
          </View>
          <Card>
            <Text style={type.heading}>Purchase date</Text>
            <DateField value={recordDate} onChange={setPurchaseDate} blocked={closedDays} />
            {closedDays.includes(recordDate) ? <Banner tone="warning" text={`${formatDay(recordDate)} is closed. Choose another date or ask a manager to reopen it.`} /> : null}
          </Card>

          <Card>
            <Text style={type.heading}>Material</Text>
            <Chips value={customMaterial ? "" : material} onChange={(value) => { setMaterial(value); setCustomMaterial(""); }}
              options={(workspace?.materials || []).filter((item) => item.active).map((item) => ({ value: item.name, label: item.name }))} />
            <Field label="Not in the list?" hint="Type the material name only if none of the options fit.">
              <Input value={customMaterial} onChangeText={setCustomMaterial} placeholder="Another material" />
            </Field>
          </Card>

          <Card>
            <Text style={type.heading}>Supplier</Text>
            {(workspace?.partners || []).some((item) => item.active && ["supplier", "both"].includes(item.partner_type)) ? (
              <Chips value={supplierId} onChange={(value) => { setSupplierId(value === supplierId ? "" : value); setSource(value === supplierId ? "" : workspace?.partners.find((item) => item.id === value)?.name || ""); }}
                options={(workspace?.partners || []).filter((item) => item.active && ["supplier", "both"].includes(item.partner_type)).map((item) => ({ value: item.id, label: item.name }))} />
            ) : null}
            {!supplierId ? <Field label="Supplier or collection point">
              <Input value={source} onChangeText={setSource} placeholder="e.g. Nakawa market collectors" />
            </Field> : null}
            {location
              ? <ListRow icon="location" iconTone="success" title="Collection location added" subtitle={`${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}${location.accuracy ? ` · ±${Math.round(location.accuracy)} m` : ""}`}
                  onPress={() => setLocation(null)} detail="Tap to remove" />
              : <Button variant="secondary" icon="location-outline" title={locating ? "Finding location…" : "Add collection location (optional)"} loading={locating} onPress={() => void attachLocation()} />}
          </Card>

          <Card>
            <Text style={type.heading}>Weight and price</Text>
            <View style={page.columns}>
              <Field label="Weight (kg)" style={page.column}><Input value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="0" /></Field>
              <Field label="Price per kg" style={page.column}><MoneyInput value={price} onChangeText={setPrice} /></Field>
            </View>
            <Field label="Quality">
              <Chips value={quality} onChange={setQuality} options={["sorted", "clean", "mixed", "contaminated"].map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))} />
            </Field>
          </Card>

          <Card>
            <Text style={type.heading}>Payment</Text>
            <Segmented value={payment} onChange={setPayment} options={[{ value: "paid", label: "Paid now" }, { value: "credit", label: "On credit" }]} />
            {payment === "paid" ? <Field label="Payment reference"
              hint="The number on the receipt or mobile-money message for this payment. No number? Tap New and write it on the voucher you give the supplier.">
              <ReferenceInput value={reference} onChangeText={setReference} prefix="PUR" placeholder="e.g. MoMo ID or receipt no." />
            </Field> : <Banner tone="neutral" text="The supplier will be paid later. The purchase is listed as owed until a payment is recorded." />}
            {payment === "paid" && paysFromFloat ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Icon name="wallet-outline" size={16} tint={floatShort ? color.danger : color.muted} />
                <Text style={[type.small, { flex: 1 }, floatShort && { color: color.danger }]}>
                  {floatShort
                    ? `The manager float has only ${ugx(floatAvailable)}. Ask the office to issue more float, or buy on credit.`
                    : `Paid from the manager float · ${ugx(floatAvailable)} available.`}
                </Text>
              </View>
            ) : null}
          </Card>

          <Card>
            <Text style={type.heading}>Costs of this purchase</Text>
            <Field label="Transport (UGX)"><MoneyInput value={transport === "0" ? "" : transport} onChangeText={(value) => setTransport(value || "0")} /></Field>
            {showCosts ? <>
              <View style={page.columns}>
                <Field label="Worker wages" style={page.column}><MoneyInput value={costs.wages} onChangeText={(wages) => setCosts((current) => ({ ...current, wages }))} /></Field>
                <Field label="Food" style={page.column}><MoneyInput value={costs.food} onChangeText={(food) => setCosts((current) => ({ ...current, food }))} /></Field>
              </View>
              <View style={page.columns}>
                <Field label="Driver fee" style={page.column}><MoneyInput value={costs.driver} onChangeText={(driver) => setCosts((current) => ({ ...current, driver }))} /></Field>
                <Field label="Other costs" style={page.column}><MoneyInput value={costs.other} onChangeText={(other) => setCosts((current) => ({ ...current, other }))} /></Field>
              </View>
            </> : <Button variant="ghost" icon="add-outline" title="Add wages, food, driver or other costs" onPress={() => setShowCosts(true)} />}
            <Field label="Notes (optional)"><Input value={notes} onChangeText={setNotes} multiline placeholder="Anything the office should know" /></Field>
          </Card>

          <Card style={{ backgroundColor: color.actionSoft }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
              <View>
                <Text style={type.small}>Total cost</Text>
                <Text style={[type.display, { color: color.actionInk }]}>{ugx(total)}</Text>
              </View>
              {Number(quantity) > 0 && Number(price) > 0 ? <Text style={type.caption}>{Number(quantity).toLocaleString("en-GB")} kg × {ugx(price)}</Text> : null}
            </View>
            {extraCosts > 0 ? <Text style={type.small}>Material {ugx(materialCost)} + costs {ugx(extraCosts)} · {formatDay(recordDate, false)}</Text>
              : <Text style={type.small}>{formatDay(recordDate)}</Text>}
            <Button title={saving ? "Saving…" : "Save purchase"} icon="checkmark-circle-outline" loading={saving} disabled={closedDays.includes(recordDate)} onPress={() => void savePurchase()} />
          </Card>
        </> : null}

        {screen === "history" ? <>
          <View>
            <Text style={page.title}>Purchase history</Text>
            <Text style={[type.small, { marginTop: 4 }]}>Records on this phone that are waiting to sync are included.</Text>
          </View>
          <Segmented value={historyFilter} onChange={(value) => { setHistoryFilter(value); setPayingLotId(""); }} options={[
            { value: "all", label: "All purchases" }, { value: "owed", label: owedLots.length ? `Owed · ${owedLots.length}` : "Owed" },
          ]} />
          {historyFilter === "owed" && owedLots.length ? <Banner tone="warning" title={`${ugx(owedTotal)} owed to suppliers`}
            text={canPaySuppliers ? "Tap a purchase to record a payment against it." : "Ask a manager to record payments when suppliers are paid."} /> : null}
          {payingLot ? <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={type.heading}>Pay {payingLot.source_name}</Text>
                <Text style={type.small}>{payingLot.material_type} · {Number(payingLot.quantity_kg).toLocaleString("en-GB")} kg · balance {ugx(lotBalance(payingLot))}</Text>
              </View>
            </View>
            <Field label="Amount paid"><MoneyInput value={payAmount} onChangeText={setPayAmount} /></Field>
            <Field label="Date paid"><DateField value={payDate} onChange={setPayDate} min={localDay(payingLot.collected_on)} /></Field>
            {paysFromFloat ? <Text style={type.small}>Paid from the manager float · {ugx(floatAvailable)} available.</Text> : null}
            <Field label="Payment reference" hint="The mobile-money transaction ID or receipt number. No number? Tap New and write it on the voucher the supplier signs.">
              <ReferenceInput value={payReference} onChangeText={setPayReference} prefix="PUR" placeholder="e.g. MoMo ID or receipt no." />
            </Field>
            <Button title={savingPayment ? "Saving…" : "Record payment"} icon="checkmark-circle-outline" loading={savingPayment} onPress={() => void savePayment()} />
            <Button variant="ghost" title="Cancel" onPress={() => setPayingLotId("")} />
          </Card> : null}
          <Input value={query} onChangeText={setQuery} placeholder="Search material, supplier or payment" />
          {filtered.map((lot) => <PurchaseRow key={lot.id} lot={lot}
            onPress={canPaySuppliers && owed(lot) && lot.status !== "pending_sync" ? () => startPayment(lot) : undefined} />)}
          {!filtered.length ? <EmptyState icon="search-outline" title={historyFilter === "owed" ? "Nothing owed" : "No matching purchases"}
            text={historyFilter === "owed" ? "Every supplier has been paid in full." : "Try another word, or record a new purchase."} /> : null}
        </> : null}

        {screen === "report" ? <>
          <View>
            <Text style={page.title}>Day report</Text>
            <Text style={[type.small, { marginTop: 4 }]}>Choose a day to see what was bought, paid and owed, or share it.</Text>
          </View>
          <DailyReport token={token} email={user.email} />
        </> : null}

        {screen === "account" ? <AccountWorkspace user={user} organizationName={workspace?.organization.name} onLogout={onLogout} /> : null}
      </ScrollView>
      <RoleBottomNavigation items={navigation} />
    </SafeAreaView>
  );
}

function PurchaseRow({ lot, onPress }: { lot: Lot; onPress?: () => void }) {
  const pending = lot.status === "pending_sync";
  const cost = lotCost(lot);
  return <ListRow icon="cube-outline" iconTone={pending ? "warning" : "action"} title={lot.material_type}
    subtitle={`${lot.source_name} · ${lot.quality} · ${new Date(lot.collected_on).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
    value={`${Number(lot.quantity_kg).toLocaleString("en-GB")} kg`} detail={cost ? ugx(cost) : undefined}
    badge={pending ? { label: "Waiting to sync", tone: "warning" }
      : lot.purchase_payment_status === "credit" ? { label: "Owed", tone: "warning" }
        : lot.purchase_payment_status === "partially_paid" ? { label: "Part paid", tone: "warning" }
          : { label: "Paid", tone: "success" }}
    onPress={onPress} chevron={Boolean(onPress)} />;
}
