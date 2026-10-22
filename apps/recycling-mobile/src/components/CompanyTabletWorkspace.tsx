import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { mobileRequest } from "../lib/mobile-api";
import { DeviceSecuritySettings } from "./DeviceSecuritySettings";
import { RoleBottomNavigation } from "./RoleBottomNavigation";
import { SectionNavigation } from "./SectionNavigation";
import { SyncStatus } from "./SyncStatus";

type User = {
  fullName: string;
  email: string;
  roles: string[];
  permissions?: string[];
};
type Tab = "dashboard" | "operations" | "account";
type OperationSection = "processing" | "stock" | "expenses" | "finance" | "close";
type RecordMap = Record<string, unknown>;

function records(value: unknown): RecordMap[] {
  if (Array.isArray(value)) return value as RecordMap[];
  if (!value || typeof value !== "object") return [];
  const object = value as RecordMap;
  for (const key of [
    "data",
    "items",
    "rows",
    "trips",
    "customers",
    "vehicles",
    "lots",
  ]) {
    if (Array.isArray(object[key])) return object[key] as RecordMap[];
  }
  if (object.data && typeof object.data === "object")
    return records(object.data);
  return [];
}

function objectData(value: unknown): RecordMap | null {
  if (!value || typeof value !== "object") return null;
  const object = value as RecordMap;
  return object.data &&
    typeof object.data === "object" &&
    !Array.isArray(object.data)
    ? (object.data as RecordMap)
    : object;
}

function text(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isActive(item: RecordMap) {
  return ["active", "in_progress", "started", "dispatched"].includes(
    String(item.status || "").toLowerCase(),
  );
}

export function CompanyTabletWorkspace({
  token,
  user,
  onLogout,
  initialTab = "dashboard",
  onOpenPurchasing,
  onOpenSales,
}: {
  token: string;
  user: User;
  onLogout: () => Promise<void>;
  initialTab?: "dashboard" | "operations";
  onOpenPurchasing?: () => void;
  onOpenSales?: () => void;
}) {
  const { width } = useWindowDimensions();
  const tablet = width >= 760;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState({
    trips: [] as RecordMap[],
    customers: [] as RecordMap[],
    vehicles: [] as RecordMap[],
    recycling: [] as RecordMap[],
    recyclingSales: [] as RecordMap[],
    recyclingPartners: [] as RecordMap[],
    recyclingSummary: {} as RecordMap,
    floatTransactions: [] as RecordMap[],
    recyclingOperations: {} as RecordMap,
    recyclingMaterials: [] as RecordMap[],
    sortingRecords: [] as RecordMap[],
    stockAdjustments: [] as RecordMap[],
    expenses: [] as RecordMap[],
    expenseSummary: {} as RecordMap,
    financePosition: {} as RecordMap,
  });
  const [recyclingAvailable, setRecyclingAvailable] = useState(false);
  const [floatAmount, setFloatAmount] = useState("");
  const [floatMovementType, setFloatMovementType] = useState<"given" | "returned">("given");
  const [floatReference, setFloatReference] = useState("");
  const [floatNotes, setFloatNotes] = useState("");
  const [savingFloat, setSavingFloat] = useState(false);
  const [sorting, setSorting] = useState({ lotId: "", inputKg: "", outputMaterial: "", outputKg: "", rejectedKg: "0", costUgx: "0", notes: "" });
  const [adjustment, setAdjustment] = useState({ lotId: "", type: "loss", quantityKg: "", reason: "", notes: "" });
  const [closeNotes, setCloseNotes] = useState("");
  const [savingOperation, setSavingOperation] = useState(false);
  const [operationSection, setOperationSection] = useState<OperationSection>("processing");
  const [expense, setExpense] = useState({ category: "other", description: "", vendor: "", amountUgx: "", reference: "" });
  const [savingExpense, setSavingExpense] = useState(false);

  useEffect(() => {
    void SecureStore.getItemAsync(`kwms.profilePhoto.${user.email.toLowerCase()}`)
      .then(setProfilePhoto)
      .catch(() => undefined);
  }, [user.email]);

  async function chooseProfilePhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.75,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    const uri = result.assets[0].uri;
    await SecureStore.setItemAsync(
      `kwms.profilePhoto.${user.email.toLowerCase()}`,
      uri,
    );
    setProfilePhoto(uri);
  }

  const load = useCallback(async () => {
    setError("");
    const endpoints = [
      ["trips", "/api/waste/trips"],
      ["customers", "/api/waste/customers"],
      ["vehicles", "/api/waste/trucks"],
      ["recycling", "/api/waste/recycling"],
      ["expenses", "/api/waste/finance/expenses"],
      ["financePosition", "/api/waste/finance/position"],
    ] as const;
    const results = await Promise.allSettled(
      endpoints.map(([, path]) =>
        mobileRequest<unknown>(path, token, user.email),
      ),
    );
    setData((current) => {
      const next = { ...current };
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const key = endpoints[index][0];
        if (key === "expenses") {
          const finance = objectData(result.value);
          next.expenses = records(finance?.expenses);
          next.expenseSummary = objectData(finance?.summary) || {};
          return;
        }
        if (key === "financePosition") {
          next.financePosition = objectData(result.value) || {};
          return;
        }
        if (key !== "recycling") {
          next[key] = records(result.value);
          return;
        }
        const recycling = objectData(result.value);
        setRecyclingAvailable(true);
        next.recycling = records(recycling?.lots);
        next.recyclingSales = records(recycling?.sales);
        next.recyclingPartners = records(recycling?.partners);
        next.recyclingSummary = objectData(recycling?.summary) || {};
        next.floatTransactions = records(recycling?.floatTransactions);
        next.recyclingOperations = objectData(recycling?.operations) || {};
        next.recyclingMaterials = records(recycling?.materials);
        next.sortingRecords = records(recycling?.sortingRecords);
        next.stockAdjustments = records(recycling?.stockAdjustments);
      });
      return next;
    });
    if (results.every((result) => result.status === "rejected")) {
      setError(
        "No company data is available on this tablet yet. Connect once and refresh to securely cache your workspace.",
      );
    }
  }, [token, user.email]);

  useEffect(() => {
    // Initial encrypted cache hydration is intentionally effect-driven.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().finally(() => setLoading(false));
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function saveFloatTransfer() {
    const amount = Number(floatAmount);
    if (!Number.isInteger(amount) || amount <= 0 || !floatReference.trim() || !floatNotes.trim()) {
      Alert.alert(
        "Complete the field-float record",
        "Enter a positive whole UGX amount, a unique voucher/reference, and the employee or purpose.",
      );
      return;
    }
    try {
      setSavingFloat(true);
      const result = await mobileRequest<{ success?: boolean }>(
        "/api/waste/recycling/manager-float",
        token,
        user.email,
        {
          method: "POST",
          body: JSON.stringify({
            transactionDate: new Date().toISOString().slice(0, 10),
            transactionType: floatMovementType,
            amountUgx: amount,
            reference: floatReference.trim(),
            notes: floatNotes.trim(),
          }),
        },
      );
      setFloatAmount("");
      setFloatReference("");
      setFloatNotes("");
      Alert.alert(
        result.queuedOffline ? "Saved offline" : floatMovementType === "given" ? "Field money transferred" : "Money returned to office",
        result.queuedOffline
          ? "This employee-float record will synchronize automatically when internet returns."
          : "The organization and manager-float ledgers have been updated together.",
      );
      if (!result.queuedOffline) await load();
    } catch (caught) {
      Alert.alert(
        "Could not record field money",
        caught instanceof Error ? caught.message : "Please try again.",
      );
    } finally {
      setSavingFloat(false);
    }
  }

  const operatingDate = String(
    data.recyclingOperations.operatingDate ||
      data.recyclingOperations.operating_date ||
      new Date().toISOString().slice(0, 10),
  );
  const dayClosed = Boolean(
    data.recyclingOperations.isClosed || data.recyclingOperations.is_closed,
  );
  const canManageInventory =
    user.roles.some((role) => ["company_admin", "recycling_field_manager"].includes(role)) ||
    Boolean(user.permissions?.includes("recycling.inventory.manage"));
  const canCloseDay =
    user.roles.some((role) => ["company_admin", "recycling_field_manager"].includes(role)) ||
    Boolean(user.permissions?.includes("recycling.daily_close.manage"));
  const canCreateExpense =
    user.roles.some((role) => ["company_admin", "recycling_field_manager"].includes(role)) ||
    Boolean(user.permissions?.includes("finance.expense.create"));

  async function saveExpense() {
    const amountUgx = Number(expense.amountUgx);
    if (!Number.isInteger(amountUgx) || amountUgx <= 0 || expense.description.trim().length < 3 || !expense.reference.trim()) {
      Alert.alert("Check expense details", "Enter a positive whole UGX amount, a clear description, and a receipt or voucher reference.");
      return;
    }
    try {
      setSavingExpense(true);
      const result = await mobileRequest<RecordMap>("/api/waste/finance/expenses", token, user.email, {
        method: "POST",
        body: JSON.stringify({
          category: expense.category,
          description: expense.description.trim(),
          vendor: expense.vendor.trim() || undefined,
          amountUgx,
          expenseDate: operatingDate,
          reference: expense.reference.trim(),
        }),
      });
      setExpense({ category: "other", description: "", vendor: "", amountUgx: "", reference: "" });
      Alert.alert(result.queuedOffline ? "Expense saved offline" : "Expense submitted", result.queuedOffline ? "It will synchronize into the organization finance ledger when internet returns." : "The expense is now awaiting company approval in the organization finance ledger.");
      if (!result.queuedOffline) await load();
    } catch (caught) {
      Alert.alert("Could not submit expense", caught instanceof Error ? caught.message : "Please try again.");
    } finally {
      setSavingExpense(false);
    }
  }

  async function saveSorting() {
    const inputKg = Number(sorting.inputKg);
    const outputKg = Number(sorting.outputKg);
    const rejectedKg = Number(sorting.rejectedKg || 0);
    const costUgx = Number(sorting.costUgx || 0);
    if (!sorting.lotId || !sorting.outputMaterial.trim() || inputKg <= 0 || outputKg <= 0 || rejectedKg < 0 || outputKg + rejectedKg > inputKg || !Number.isInteger(costUgx) || costUgx < 0) {
      Alert.alert("Check sorting details", "Choose an input lot, enter valid kilograms, and ensure output plus rejected weight does not exceed the input weight.");
      return;
    }
    try {
      setSavingOperation(true);
      const result = await mobileRequest<RecordMap>("/api/waste/recycling/sorting", token, user.email, {
        method: "POST",
        body: JSON.stringify({ inputLotId: sorting.lotId, processedOn: operatingDate, inputKg, outputMaterialType: sorting.outputMaterial.trim(), allowNewMaterial: true, outputKg, rejectedKg, workerWagesUgx: 0, utilitiesUgx: 0, transportUgx: 0, consumablesUgx: 0, otherExpenseUgx: costUgx, managerFloatUsedUgx: 0, notes: sorting.notes.trim() || undefined }),
      });
      setSorting({ lotId: "", inputKg: "", outputMaterial: "", outputKg: "", rejectedKg: "0", costUgx: "0", notes: "" });
      Alert.alert(result.queuedOffline ? "Sorting saved offline" : "Sorting recorded", result.queuedOffline ? "The stock movement will synchronize automatically." : "Input, recovered stock, rejects, and processing cost are updated together.");
      if (!result.queuedOffline) await load();
    } catch (caught) {
      Alert.alert("Could not record sorting", caught instanceof Error ? caught.message : "Please try again.");
    } finally { setSavingOperation(false); }
  }

  async function saveAdjustment() {
    const quantityKg = Number(adjustment.quantityKg);
    if (!adjustment.lotId || quantityKg <= 0 || adjustment.reason.trim().length < 3) {
      Alert.alert("Check adjustment details", "Choose a lot, enter a positive quantity, and explain the reason.");
      return;
    }
    try {
      setSavingOperation(true);
      const result = await mobileRequest<RecordMap>("/api/waste/recycling/stock-adjustments", token, user.email, {
        method: "POST",
        body: JSON.stringify({ lotId: adjustment.lotId, adjustmentDate: operatingDate, adjustmentType: adjustment.type, quantityKg, reason: adjustment.reason.trim(), notes: adjustment.notes.trim() || undefined }),
      });
      setAdjustment({ lotId: "", type: "loss", quantityKg: "", reason: "", notes: "" });
      Alert.alert(result.queuedOffline ? "Adjustment saved offline" : "Stock adjusted", result.queuedOffline ? "It will synchronize automatically when connectivity returns." : "The material ledger now reflects this adjustment.");
      if (!result.queuedOffline) await load();
    } catch (caught) {
      Alert.alert("Could not adjust stock", caught instanceof Error ? caught.message : "Please try again.");
    } finally { setSavingOperation(false); }
  }

  async function closeOperatingDay() {
    Alert.alert("Close daily operations?", `This closes ${operatingDate} for new recycling transactions.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Close day", style: "destructive", onPress: () => void (async () => {
        try {
          setSavingOperation(true);
          const result = await mobileRequest<RecordMap>("/api/waste/recycling/daily-closures", token, user.email, { method: "POST", body: JSON.stringify({ operatingDate, notes: closeNotes.trim() || undefined }) });
          setCloseNotes("");
          Alert.alert(result.queuedOffline ? "Closure queued offline" : "Day closed", result.queuedOffline ? "The closure will be checked and synchronized when internet returns." : "Daily operations are now locked and recorded.");
          if (!result.queuedOffline) await load();
        } catch (caught) { Alert.alert("Could not close the day", caught instanceof Error ? caught.message : "Please try again."); }
        finally { setSavingOperation(false); }
      })() },
    ]);
  }

  const activeTrips = useMemo(() => data.trips.filter(isActive), [data.trips]);
  const roleLabel = user.roles.includes("kcca_admin")
    ? "KCCA control"
    : user.roles.includes("system_admin")
      ? "Platform administration"
      : user.roles.includes("weighbridge_operator")
        ? "Weighbridge operations"
        : user.roles.includes("recycling_field_manager")
          ? "Recycling field manager"
          : user.roles.includes("company_admin")
            ? "Company administrator"
            : "Company operations";
  const availableStockKg = data.recycling.reduce(
    (sum, lot) => sum + Number(lot.available_kg ?? lot.quantity_kg ?? 0),
    0,
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>KAMPALA WASTE MANAGEMENT</Text>
          <Text style={styles.headerTitle}>{roleLabel}</Text>
          <Text style={styles.muted}>
            {user.fullName} · {user.email}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <SyncStatus
            token={token}
            email={user.email}
            onSynced={() => void load()}
          />
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
      >
        {tab === "account" ? (
          <>
            <View style={styles.intro}>
              <Text style={styles.pageTitle}>My account</Text>
              <Text style={styles.subtitle}>Your identity, role and application settings.</Text>
            </View>
            <View style={styles.accountCard}>
              {profilePhoto ? (
                <Image source={{ uri: profilePhoto }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}><Text style={styles.avatarText}>{user.fullName.slice(0, 2).toUpperCase()}</Text></View>
              )}
              <View style={styles.accountCopy}>
                <Text style={styles.accountName}>{user.fullName}</Text>
                <Text style={styles.muted}>{user.email}</Text>
                <Text style={styles.rolePill}>{user.roles.map((role) => role.replaceAll("_", " ")).join(" · ")}</Text>
              </View>
            </View>
            <Pressable style={styles.accountAction} onPress={() => void chooseProfilePhoto()}>
              <Text style={styles.accountActionTitle}>Upload profile picture</Text>
              <Text style={styles.muted}>Choose and crop a photo from this device.</Text>
            </Pressable>
            <DeviceSecuritySettings onLogout={onLogout} />
          </>
        ) : <>
        <SectionNavigation
          title="YOUR WORKSPACE"
          items={[
            { id: "dashboard", label: "Dashboard", active: tab === "dashboard", onPress: () => setTab("dashboard") },
            { id: "operations", label: "Daily operations", active: tab === "operations", onPress: () => setTab("operations") },
          ]}
        />
        <View style={styles.intro}>
          <Text style={styles.pageTitle}>{tab === "dashboard" ? `Good day, ${user.fullName.split(/\s+/)[0]}.` : "Daily operations"}</Text>
          <Text style={styles.rolePill}>{roleLabel}</Text>
          <Text style={styles.subtitle}>
            {tab === "dashboard"
              ? "A clear view of the business information that needs your attention today."
              : "Manage sorting, stock corrections, active work, field money and daily close."}
          </Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? (
          <ActivityIndicator size="large" color="#3156a3" />
        ) : (
          <>
            {tab === "dashboard" ? <>
            <View style={[styles.metrics, tablet && styles.metricsTablet]}>
              {(recyclingAvailable
                ? [
                    ["Purchases", data.recycling.length],
                    ["Sales", data.recyclingSales.length],
                    ["Available stock", `${availableStockKg.toLocaleString()} kg`],
                    ["Trade partners", data.recyclingPartners.length],
                  ]
                : [
                    ["Trips", data.trips.length],
                    ["In progress", activeTrips.length],
                    ["Customers", data.customers.length],
                    ["Vehicles", data.vehicles.length],
                  ]).map(([label, value]) => (
                <View
                  key={String(label)}
                  style={[styles.metric, tablet && styles.metricTablet]}
                >
                  <Text style={styles.metricLabel}>{label}</Text>
                  <Text style={styles.metricValue}>{value}</Text>
                </View>
              ))}
            </View>
            {data.recycling.length > 0 || data.recyclingSales.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recycling operations</Text>
                <Text style={styles.sectionCopy}>
                  Purchases, stock and sales last synchronized for this company.
                </Text>
                {data.recycling.slice(0, 8).map((lot, index) => (
                  <View
                    key={String(lot.id || `lot-${index}`)}
                    style={styles.row}
                  >
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>
                        {text(
                          lot.material_type || lot.materialType,
                          "Material lot",
                        )}
                      </Text>
                      <Text style={styles.muted}>
                        {text(
                          lot.source_name || lot.sourceName,
                          "Supplier not recorded",
                        )}
                      </Text>
                    </View>
                    <Text style={styles.status}>
                      {Number(
                        lot.available_kg ?? lot.quantity_kg ?? 0,
                      ).toLocaleString()}{" "}
                      kg
                    </Text>
                  </View>
                ))}
                {data.recyclingSales.slice(0, 6).map((sale, index) => (
                  <View
                    key={String(sale.id || `sale-${index}`)}
                    style={styles.row}
                  >
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>
                        {text(
                          sale.buyer_name || sale.industry,
                          "Material sale",
                        )}
                      </Text>
                      <Text style={styles.muted}>
                        {text(sale.material_type, "Recycling material")}
                      </Text>
                    </View>
                    <Text style={styles.status}>
                      {Number(sale.quantity_kg ?? 0).toLocaleString()} kg sold
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.quickActions}>
              {onOpenPurchasing ? <Pressable style={styles.quickAction} onPress={onOpenPurchasing}><Text style={styles.quickActionTitle}>Record purchase</Text><Text style={styles.muted}>Add material received from a supplier</Text></Pressable> : null}
              <Pressable style={styles.quickAction} onPress={() => setTab("operations")}><Text style={styles.quickActionTitle}>Open daily operations</Text><Text style={styles.muted}>Sorting, stock, field money and close</Text></Pressable>
              {onOpenSales ? <Pressable style={styles.quickAction} onPress={onOpenSales}><Text style={styles.quickActionTitle}>Record sale</Text><Text style={styles.muted}>Sell available stock to a buyer</Text></Pressable> : null}
            </View>
            </> : null}
            {tab === "operations" ? <>
            <SectionNavigation title="DAILY WORK" items={[
              { id: "processing", label: "Processing", active: operationSection === "processing", onPress: () => setOperationSection("processing") },
              { id: "stock", label: "Stock", active: operationSection === "stock", onPress: () => setOperationSection("stock") },
              ...(canCreateExpense ? [{ id: "expenses", label: "Expenses", active: operationSection === "expenses", onPress: () => setOperationSection("expenses") }] : []),
              ...(user.roles.includes("recycling_field_manager") ? [{ id: "finance", label: "Finance", active: operationSection === "finance", onPress: () => setOperationSection("finance") }] : []),
              ...(canCloseDay ? [{ id: "close", label: "Close day", active: operationSection === "close", onPress: () => setOperationSection("close") }] : []),
            ]} />
            {recyclingAvailable && canManageInventory && (operationSection === "processing" || operationSection === "stock") ? (
              <View style={[styles.operationGrid, tablet && styles.operationGridTablet]}>
                {operationSection === "processing" ? <View style={[styles.section, styles.operationPanel]}>
                  <Text style={styles.sectionTitle}>Sort and grade material</Text>
                  <Text style={styles.sectionCopy}>Convert a purchased lot into recovered stock while recording rejects and processing cost.</Text>
                  <View style={styles.formArea}>
                    <Text style={styles.inputLabel}>Input material lot</Text>
                    <View style={styles.choices}>
                      {data.recycling.filter((lot) => Number(lot.available_kg ?? lot.quantity_kg ?? 0) > 0).map((lot, index) => {
                        const id = String(lot.id || index);
                        return <Pressable key={id} onPress={() => setSorting((value) => ({ ...value, lotId: id }))} style={[styles.choice, sorting.lotId === id && styles.choiceActive]}><Text style={[styles.choiceText, sorting.lotId === id && styles.choiceTextActive]}>{text(lot.material_type || lot.materialType, "Material")} · {Number(lot.available_kg ?? lot.quantity_kg ?? 0).toLocaleString()} kg</Text></Pressable>;
                      })}
                    </View>
                    <View style={[styles.fieldRow, tablet && styles.fieldRowTablet]}>
                      <View style={styles.field}><Text style={styles.inputLabel}>Input kg</Text><TextInput value={sorting.inputKg} onChangeText={(value) => setSorting((current) => ({ ...current, inputKg: value }))} keyboardType="decimal-pad" style={styles.input} /></View>
                      <View style={styles.field}><Text style={styles.inputLabel}>Recovered material</Text><TextInput value={sorting.outputMaterial} onChangeText={(value) => setSorting((current) => ({ ...current, outputMaterial: value }))} placeholder="Example: PET clear" style={styles.input} /></View>
                    </View>
                    <View style={[styles.fieldRow, tablet && styles.fieldRowTablet]}>
                      <View style={styles.field}><Text style={styles.inputLabel}>Output kg</Text><TextInput value={sorting.outputKg} onChangeText={(value) => setSorting((current) => ({ ...current, outputKg: value }))} keyboardType="decimal-pad" style={styles.input} /></View>
                      <View style={styles.field}><Text style={styles.inputLabel}>Rejected kg</Text><TextInput value={sorting.rejectedKg} onChangeText={(value) => setSorting((current) => ({ ...current, rejectedKg: value }))} keyboardType="decimal-pad" style={styles.input} /></View>
                    </View>
                    <Text style={styles.inputLabel}>Processing cost (UGX)</Text><TextInput value={sorting.costUgx} onChangeText={(value) => setSorting((current) => ({ ...current, costUgx: value }))} keyboardType="number-pad" style={styles.input} />
                    <Text style={styles.inputLabel}>Notes (optional)</Text><TextInput value={sorting.notes} onChangeText={(value) => setSorting((current) => ({ ...current, notes: value }))} style={styles.input} />
                    <Pressable disabled={savingOperation || dayClosed} onPress={() => void saveSorting()} style={[styles.primaryButton, (savingOperation || dayClosed) && styles.disabled]}><Text style={styles.primaryButtonText}>{dayClosed ? "Day is closed" : savingOperation ? "Saving…" : "Record sorting"}</Text></Pressable>
                  </View>
                </View> : null}
                {operationSection === "stock" ? <View style={[styles.section, styles.operationPanel]}>
                  <Text style={styles.sectionTitle}>Stock adjustment</Text>
                  <Text style={styles.sectionCopy}>Record verified loss, correction in, or correction out with a clear audit reason.</Text>
                  <View style={styles.formArea}>
                    <Text style={styles.inputLabel}>Material lot</Text>
                    <View style={styles.choices}>{data.recycling.map((lot, index) => { const id = String(lot.id || index); return <Pressable key={id} onPress={() => setAdjustment((value) => ({ ...value, lotId: id }))} style={[styles.choice, adjustment.lotId === id && styles.choiceActive]}><Text style={[styles.choiceText, adjustment.lotId === id && styles.choiceTextActive]}>{text(lot.material_type || lot.materialType, "Material")}</Text></Pressable>; })}</View>
                    <Text style={styles.inputLabel}>Adjustment type</Text>
                    <View style={styles.choices}>{[["loss", "Loss"], ["correction_in", "Correction in"], ["correction_out", "Correction out"]].map(([value, label]) => <Pressable key={value} onPress={() => setAdjustment((current) => ({ ...current, type: value }))} style={[styles.choice, adjustment.type === value && styles.choiceActive]}><Text style={[styles.choiceText, adjustment.type === value && styles.choiceTextActive]}>{label}</Text></Pressable>)}</View>
                    <Text style={styles.inputLabel}>Quantity (kg)</Text><TextInput value={adjustment.quantityKg} onChangeText={(value) => setAdjustment((current) => ({ ...current, quantityKg: value }))} keyboardType="decimal-pad" style={styles.input} />
                    <Text style={styles.inputLabel}>Reason</Text><TextInput value={adjustment.reason} onChangeText={(value) => setAdjustment((current) => ({ ...current, reason: value }))} placeholder="Required audit reason" style={styles.input} />
                    <Text style={styles.inputLabel}>Notes (optional)</Text><TextInput value={adjustment.notes} onChangeText={(value) => setAdjustment((current) => ({ ...current, notes: value }))} style={styles.input} />
                    <Pressable disabled={savingOperation || dayClosed} onPress={() => void saveAdjustment()} style={[styles.primaryButton, (savingOperation || dayClosed) && styles.disabled]}><Text style={styles.primaryButtonText}>{dayClosed ? "Day is closed" : savingOperation ? "Saving…" : "Save adjustment"}</Text></Pressable>
                  </View>
                </View> : null}
              </View>
            ) : null}
            {recyclingAvailable && canCreateExpense && operationSection === "expenses" ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Submit organization expense</Text>
                <Text style={styles.sectionCopy}>Record a real field expense with its receipt or voucher. It enters the organization finance ledger as a draft and must be approved before payment affects cash.</Text>
                <View style={styles.formArea}>
                  <Text style={styles.inputLabel}>Category</Text>
                  <View style={styles.choices}>{[["fuel","Fuel"],["maintenance","Maintenance"],["equipment","Equipment"],["utilities","Utilities"],["disposal_fees","Disposal fees"],["office","Office"],["other","Other"]].map(([value,label]) => <Pressable key={value} onPress={() => setExpense((current) => ({ ...current, category: value }))} style={[styles.choice, expense.category === value && styles.choiceActive]}><Text style={[styles.choiceText, expense.category === value && styles.choiceTextActive]}>{label}</Text></Pressable>)}</View>
                  <Text style={styles.inputLabel}>What was paid for?</Text><TextInput value={expense.description} onChangeText={(value) => setExpense((current) => ({ ...current, description: value }))} placeholder="Example: Baling machine repair" style={styles.input} />
                  <View style={[styles.fieldRow, tablet && styles.fieldRowTablet]}>
                    <View style={styles.field}><Text style={styles.inputLabel}>Amount (UGX)</Text><TextInput value={expense.amountUgx} onChangeText={(value) => setExpense((current) => ({ ...current, amountUgx: value }))} keyboardType="number-pad" placeholder="0" style={styles.input} /></View>
                    <View style={styles.field}><Text style={styles.inputLabel}>Receipt / voucher reference</Text><TextInput value={expense.reference} onChangeText={(value) => setExpense((current) => ({ ...current, reference: value }))} autoCapitalize="characters" placeholder="Example: RCT-001" style={styles.input} /></View>
                  </View>
                  <Text style={styles.inputLabel}>Vendor (optional)</Text><TextInput value={expense.vendor} onChangeText={(value) => setExpense((current) => ({ ...current, vendor: value }))} placeholder="Supplier or service provider" style={styles.input} />
                  <Pressable disabled={savingExpense || dayClosed} onPress={() => void saveExpense()} style={[styles.primaryButton, (savingExpense || dayClosed) && styles.disabled]}><Text style={styles.primaryButtonText}>{dayClosed ? "Day is closed" : savingExpense ? "Submitting…" : "Submit for approval"}</Text></Pressable>
                </View>
                <View style={styles.floatSummary}><Text style={styles.muted}>Awaiting approval</Text><Text style={styles.floatBalance}>{Number(data.expenseSummary.awaiting_approval || 0).toLocaleString()}</Text></View>
                {data.expenses.slice(0, 5).map((item, index) => <View key={String(item.id || index)} style={styles.row}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{text(item.description, "Organization expense")}</Text><Text style={styles.muted}>{text(item.expense_number, "Pending sync")} · {text(item.status, "draft").replaceAll("_", " ")}</Text></View><Text style={styles.status}>UGX {Number(item.amount_ugx || 0).toLocaleString()}</Text></View>)}
              </View>
            ) : null}
            {recyclingAvailable && canCloseDay && operationSection === "close" ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Daily close · {operatingDate}</Text>
                <Text style={styles.sectionCopy}>{dayClosed ? "This operating day is already closed." : "Confirm that purchases, sorting, stock, expenses and sales are complete before closing."}</Text>
                {!dayClosed ? <View style={styles.formArea}><Text style={styles.inputLabel}>Closing note (optional)</Text><TextInput value={closeNotes} onChangeText={setCloseNotes} placeholder="Shift summary or handover note" style={styles.input} /><Pressable disabled={savingOperation} onPress={closeOperatingDay} style={[styles.closeButton, savingOperation && styles.disabled]}><Text style={styles.closeButtonText}>Close daily operations</Text></Pressable></View> : null}
              </View>
            ) : null}
            {user.roles.includes("recycling_field_manager") && operationSection === "finance" ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Organization finance</Text>
                <Text style={styles.sectionCopy}>
                  Review the company&apos;s working cash and move accountable money between the office and manager float. Expense approval and payment remain with the company administrator.
                </Text>
                <View style={[styles.metrics, tablet && styles.metricsTablet]}>
                  {[
                    ["Office cash", data.recyclingSummary.officeCashUgx ?? data.financePosition.cash_position_ugx ?? 0],
                    ["Manager float", data.recyclingSummary.floatBalanceUgx ?? 0],
                    ["Available to commit", data.financePosition.available_to_commit_ugx ?? 0],
                    ["Receivables", data.financePosition.receivables_ugx ?? data.recyclingSummary.unpaidSalesUgx ?? 0],
                  ].map(([label, value]) => <View key={String(label)} style={[styles.metric, tablet && styles.metricTablet]}><Text style={styles.metricLabel}>{String(label)}</Text><Text style={[styles.metricValue, { fontSize: 21 }]}>UGX {Number(value || 0).toLocaleString()}</Text></View>)}
                </View>
                <View style={styles.formArea}>
                  <Text style={styles.inputLabel}>Money movement</Text>
                  <View style={styles.choices}>
                    <Pressable onPress={() => setFloatMovementType("given")} style={[styles.choice, floatMovementType === "given" && styles.choiceActive]}><Text style={[styles.choiceText, floatMovementType === "given" && styles.choiceTextActive]}>Office → manager float</Text></Pressable>
                    <Pressable onPress={() => setFloatMovementType("returned")} style={[styles.choice, floatMovementType === "returned" && styles.choiceActive]}><Text style={[styles.choiceText, floatMovementType === "returned" && styles.choiceTextActive]}>Manager float → office</Text></Pressable>
                  </View>
                  <Text style={styles.inputLabel}>Amount (UGX)</Text>
                  <TextInput
                    value={floatAmount}
                    onChangeText={setFloatAmount}
                    keyboardType="number-pad"
                    placeholder="Example: 200000"
                    style={styles.input}
                  />
                  <Text style={styles.inputLabel}>Voucher or reference</Text>
                  <TextInput
                    value={floatReference}
                    onChangeText={setFloatReference}
                    autoCapitalize="characters"
                    placeholder="Example: FLT-2026-001"
                    style={styles.input}
                  />
                  <Text style={styles.inputLabel}>Purpose or handover details</Text>
                  <TextInput
                    value={floatNotes}
                    onChangeText={setFloatNotes}
                    placeholder={floatMovementType === "given" ? "Example: PET purchasing float" : "Example: Unused float returned"}
                    style={styles.input}
                  />
                  <Pressable
                    disabled={savingFloat}
                    onPress={() => void saveFloatTransfer()}
                    style={[
                      styles.primaryButton,
                      savingFloat && styles.disabled,
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>
                      {savingFloat ? "Saving…" : floatMovementType === "given" ? "Transfer to manager float" : "Return to office cash"}
                    </Text>
                  </Pressable>
                </View>
                {data.floatTransactions.slice(0, 5).map((movement, index) => (
                  <View key={String(movement.id || index)} style={styles.row}>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>
                        {text(movement.notes, "Field movement")}
                      </Text>
                      <Text style={styles.muted}>
                        {text(movement.transaction_date, "Date unavailable")}
                      </Text>
                    </View>
                    <Text style={styles.status}>
                      UGX {Number(movement.amount_ugx || 0).toLocaleString()}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            </> : null}
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Offline safety</Text>
              <Text style={styles.noticeText}>
                Field operations can be saved offline. Payments, permits,
                credentials, access changes and official weighbridge
                verification require the secure online platform.
              </Text>
            </View>
          </>
        )}
        </>}
      </ScrollView>
      <RoleBottomNavigation items={[
        { id: "dashboard", label: "Dashboard", icon: "⌂", active: tab === "dashboard", onPress: () => setTab("dashboard") },
        ...(onOpenPurchasing ? [{ id: "purchase", label: "Purchases", icon: "↓", onPress: onOpenPurchasing }] : []),
        { id: "operations", label: "Operations", icon: "◫", active: tab === "operations", onPress: () => setTab("operations") },
        ...(onOpenSales ? [{ id: "sales", label: "Sales", icon: "↗", onPress: onOpenSales }] : []),
        { id: "account", label: "Account", icon: "●", active: tab === "account", onPress: () => setTab("account") },
      ]} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f7f8f5" },
  header: {
    minHeight: 86,
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#d8dfeb",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  headerCopy: { flex: 1 },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 10,
  },
  eyebrow: {
    color: "#3156a3",
    fontWeight: "800",
    letterSpacing: 2,
    fontSize: 12,
  },
  headerTitle: {
    color: "#121827",
    fontWeight: "800",
    fontSize: 24,
    marginTop: 3,
  },
  page: {
    width: "100%",
    maxWidth: 1280,
    alignSelf: "center",
    padding: 24,
    paddingBottom: 110,
  },
  accountCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d8dfeb",
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginBottom: 16,
    borderRadius: 22,
  },
  avatar: { width: 76, height: 76, borderRadius: 38 },
  avatarFallback: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#151b2b",
  },
  avatarText: { color: "#f0b35a", fontWeight: "900", fontSize: 22 },
  accountCopy: { flex: 1 },
  accountName: { color: "#121827", fontSize: 24, fontWeight: "800" },
  rolePill: {
    color: "#3156a3",
    backgroundColor: "#eaf0fc",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 8,
    textTransform: "capitalize",
    overflow: "hidden",
  },
  accountAction: {
    minHeight: 72,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d8dfeb",
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 18,
  },
  accountActionTitle: { color: "#121827", fontSize: 16, fontWeight: "800" },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 22,
  },
  quickAction: {
    flexGrow: 1,
    flexBasis: 220,
    minHeight: 92,
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#d8dfeb",
    padding: 17,
    justifyContent: "center",
  },
  quickActionTitle: {
    color: "#172033",
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 3,
  },
  signOutButton: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#b42318",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  signOutText: { color: "#b42318", fontWeight: "800" },
  bottomNav: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 10,
    minHeight: 70,
    borderRadius: 24,
    backgroundColor: "#151b2b",
    flexDirection: "row",
    padding: 6,
    shadowColor: "#0b1220",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    gap: 2,
  },
  navItemActive: { backgroundColor: "#fff" },
  navIcon: { color: "#aab5c8", fontSize: 17, fontWeight: "900" },
  navText: { color: "#aab5c8", fontWeight: "800", fontSize: 10 },
  navTextActive: { color: "#1f3f7e" },
  intro: { marginBottom: 20 },
  pageTitle: { color: "#121827", fontSize: 36, fontWeight: "800" },
  subtitle: {
    color: "#62718b",
    fontSize: 17,
    lineHeight: 26,
    marginTop: 8,
    maxWidth: 820,
  },
  muted: { color: "#62718b", fontSize: 14, lineHeight: 20 },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#27364d",
    marginBottom: 28,
  },
  metricsTablet: { flexWrap: "nowrap" },
  metric: {
    width: "50%",
    minHeight: 102,
    padding: 16,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#d8dfeb",
  },
  metricTablet: { flex: 1, width: undefined, borderBottomWidth: 0 },
  metricLabel: {
    color: "#667894",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  metricValue: {
    color: "#121827",
    fontSize: 32,
    fontWeight: "800",
    marginTop: 8,
  },
  sectionTitle: {
    color: "#121827",
    fontSize: 24,
    fontWeight: "800",
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionCopy: {
    color: "#62718b",
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 20,
    paddingTop: 5,
    paddingBottom: 16,
  },
  section: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d8dfeb",
    marginBottom: 20,
    paddingTop: 1,
    borderRadius: 22,
    overflow: "hidden",
  },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: "#e1e6ef",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  rowCopy: { flex: 1 },
  rowTitle: { color: "#121827", fontWeight: "700", fontSize: 16 },
  status: { color: "#216e45", fontWeight: "800", textTransform: "capitalize" },
  empty: {
    borderTopWidth: 1,
    borderTopColor: "#e1e6ef",
    padding: 20,
    marginTop: 16,
  },
  cardTitle: {
    color: "#121827",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  notice: {
    backgroundColor: "#fff7df",
    borderLeftWidth: 3,
    borderLeftColor: "#cf8d22",
    padding: 18,
  },
  noticeTitle: { color: "#734711", fontSize: 16, fontWeight: "800" },
  noticeText: { color: "#734711", fontSize: 14, lineHeight: 21, marginTop: 5 },
  floatSummary: {
    marginHorizontal: 20,
    marginBottom: 14,
    padding: 16,
    backgroundColor: "#eef4ff",
    borderRadius: 16,
  },
  floatBalance: {
    color: "#121827",
    fontSize: 26,
    fontWeight: "800",
    marginTop: 4,
  },
  formArea: { paddingHorizontal: 20, paddingBottom: 20, gap: 8 },
  operationGrid: { gap: 20 },
  operationGridTablet: { flexDirection: "row", alignItems: "flex-start" },
  operationPanel: { flex: 1 },
  fieldRow: { gap: 10 },
  fieldRowTablet: { flexDirection: "row" },
  field: { flex: 1 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  choice: {
    borderWidth: 1,
    borderColor: "#bdc8d8",
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
  },
  choiceActive: { borderColor: "#3156a3", backgroundColor: "#eef4ff" },
  choiceText: { color: "#43536c", fontWeight: "700" },
  choiceTextActive: { color: "#3156a3" },
  inputLabel: { color: "#27364d", fontWeight: "700", marginTop: 6 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#bdc8d8",
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    color: "#121827",
    borderRadius: 14,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3156a3",
    marginTop: 8,
    borderRadius: 14,
  },
  primaryButtonText: { color: "#fff", fontWeight: "800" },
  closeButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#8f2f2f",
    marginTop: 8,
    borderRadius: 14,
  },
  closeButtonText: { color: "#fff", fontWeight: "800" },
  disabled: { opacity: 0.55 },
  error: {
    color: "#a52c2c",
    backgroundColor: "#fff0f0",
    borderLeftWidth: 3,
    borderLeftColor: "#d13f3f",
    padding: 16,
    marginBottom: 20,
    fontWeight: "600",
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#3156a3",
    paddingHorizontal: 16,
    backgroundColor: "#fff",
  },
  secondaryButtonText: { color: "#3156a3", fontWeight: "800" },
  textButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  textButtonText: { color: "#3156a3", fontWeight: "800" },
  messageCard: {
    margin: 24,
    padding: 24,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d8dfeb",
  },
  webview: { flex: 1, backgroundColor: "#fff" },
  webLoading: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#f7f8f5",
  },
});
