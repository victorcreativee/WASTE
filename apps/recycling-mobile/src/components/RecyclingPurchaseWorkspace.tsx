import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { MobileUser } from "../lib/auth-session";
import { mobileRequest } from "../lib/mobile-api";
import { AccountWorkspace } from "./AccountWorkspace";
import { RoleBottomNavigation, RoleNavigationItem } from "./RoleBottomNavigation";
import { SyncStatus } from "./SyncStatus";
import { AppHeader, Banner, Button, Card, Chips, EmptyState, Field, Input, ListRow, MoneyInput, QuickActions, ReferenceInput, SectionHeader, Segmented, SummaryCard, page } from "../ui/kit";
import { color, type, ugx } from "../ui/theme";

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
  const todaySpent = todayLots.reduce((sum, lot) => sum + Number(lot.total_cost_ugx ?? Number(lot.quantity_kg) * Number(lot.unit_purchase_price_ugx)), 0);
  const waiting = purchases.filter((lot) => lot.status === "pending_sync").length;

  return (
    <SafeAreaView style={page.safe}>
      <StatusBar style="dark" />
      <AppHeader name={user.fullName} organization={workspace?.organization.name || "Material purchasing"}
        right={<SyncStatus token={token} email={user.email} onSynced={() => void load()} />} />
      <ScrollView
        contentContainerStyle={[page.content, tablet && page.contentTablet]}
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
          {closed ? <Banner tone="warning" title="Day closed" text="Management has closed today. New purchases are locked until tomorrow." /> : null}
          <SummaryCard label="Bought today" value={`${Number(workspace?.myActivity?.purchasedKg ?? todayKg).toLocaleString("en-GB")} kg`}
            caption={new Date(`${today}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
            stats={[
              { label: "Purchases", value: workspace?.myActivity?.purchases ?? todayLots.length },
              { label: "Paid out", value: ugx(todaySpent).replace("UGX ", "") },
              { label: "To sync", value: waiting },
            ]} />
          <QuickActions items={[
            { icon: "add-circle-outline", label: "New purchase", onPress: () => setScreen("buy"), disabled: closed },
            { icon: "time-outline", label: "History", onPress: () => setScreen("history"), tone: "neutral" },
            { icon: "person-outline", label: "My account", onPress: () => setScreen("account"), tone: "neutral" },
          ]} />
          <SectionHeader title="Today’s purchases" action={purchases.length ? { label: "See all", onPress: () => setScreen("history") } : undefined} />
          {todayLots.slice(0, 8).map((lot) => <PurchaseRow key={lot.id} lot={lot} />)}
          {!todayLots.length ? <EmptyState icon="scale-outline" title="No purchases yet today" text="Each kilogram you buy appears here, even without internet."
            action={closed ? undefined : { label: "Record a purchase", onPress: () => setScreen("buy") }} /> : null}
        </> : null}

        {screen === "buy" ? <>
          <View>
            <Text style={page.title}>New purchase</Text>
            <Text style={[type.small, { marginTop: 4 }]}>Saved on this phone first and sent when there is internet.</Text>
          </View>
          {closed ? <Banner tone="warning" text="Today is closed. Purchases cannot be recorded until management reopens the day." /> : null}

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
          </Card>

          <Card>
            <Text style={type.heading}>Weight and price</Text>
            <View style={page.columns}>
              <Field label="Weight (kg)" style={page.column}><Input value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="0" /></Field>
              <Field label="Price per kg" style={page.column}><MoneyInput value={price} onChangeText={setPrice} /></Field>
            </View>
            <Field label="Quality">
              <Chips value={quality} onChange={setQuality} options={["sorted", "clean", "mixed", "contaminated"].map((value) => ({ value, label: value }))} />
            </Field>
          </Card>

          <Card>
            <Text style={type.heading}>Payment</Text>
            <Segmented value={payment} onChange={setPayment} options={[{ value: "paid", label: "Paid now" }, { value: "credit", label: "On credit" }]} />
            {payment === "paid" ? <Field label="Payment reference"
              hint="The number on the receipt or mobile-money message for this payment. No number? Tap New and write it on the voucher you give the supplier.">
              <ReferenceInput value={reference} onChangeText={setReference} prefix="PUR" placeholder="e.g. MoMo ID or receipt no." />
            </Field> : <Banner tone="neutral" text="The supplier will be paid later. The purchase is listed as owed until a payment is recorded." />}
            <View style={page.columns}>
              <Field label="Transport (UGX)" style={page.column}><MoneyInput value={transport === "0" ? "" : transport} onChangeText={(value) => setTransport(value || "0")} /></Field>
              <Field label="From manager float" style={page.column}><MoneyInput value={floatUsed === "0" ? "" : floatUsed} onChangeText={(value) => setFloatUsed(value || "0")} /></Field>
            </View>
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
            <Button title={saving ? "Saving…" : "Save purchase"} icon="checkmark-circle-outline" loading={saving} disabled={closed} onPress={() => void savePurchase()} />
          </Card>
        </> : null}

        {screen === "history" ? <>
          <View>
            <Text style={page.title}>Purchase history</Text>
            <Text style={[type.small, { marginTop: 4 }]}>Records on this phone that are waiting to sync are included.</Text>
          </View>
          <Input value={query} onChangeText={setQuery} placeholder="Search material, supplier or payment" />
          {filtered.map((lot) => <PurchaseRow key={lot.id} lot={lot} />)}
          {!filtered.length ? <EmptyState icon="search-outline" title="No matching purchases" text="Try another word, or record a new purchase." /> : null}
        </> : null}

        {screen === "account" ? <AccountWorkspace user={user} organizationName={workspace?.organization.name} onLogout={onLogout} /> : null}
      </ScrollView>
      <RoleBottomNavigation items={navigation} />
    </SafeAreaView>
  );
}

function PurchaseRow({ lot }: { lot: Lot }) {
  const pending = lot.status === "pending_sync";
  const cost = Number(lot.total_cost_ugx ?? Number(lot.quantity_kg) * Number(lot.unit_purchase_price_ugx));
  return <ListRow icon="cube-outline" iconTone={pending ? "warning" : "action"} title={lot.material_type}
    subtitle={`${lot.source_name} · ${lot.quality} · ${new Date(lot.collected_on).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
    value={`${Number(lot.quantity_kg).toLocaleString("en-GB")} kg`} detail={cost ? ugx(cost) : undefined}
    badge={pending ? { label: "Waiting to sync", tone: "warning" } : lot.purchase_payment_status === "credit" ? { label: "Owed", tone: "warning" } : { label: "Paid", tone: "success" }} />;
}
