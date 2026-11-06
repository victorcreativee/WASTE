import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { discardMobileOutbox, mobileRequest, readCachedResponse } from "../lib/mobile-api";
import { AccountWorkspace } from "./AccountWorkspace";
import { AppHeader, Banner, DateField, QuickActions, ReferenceInput, Segmented, StatStrip, SummaryCard } from "../ui/kit";
import { color, ugx } from "../ui/theme";
import { RecyclingInsightsReport } from "./RecyclingInsightsReport";
import { useBottomNavigationSpace, RoleBottomNavigation } from "./RoleBottomNavigation";
import { SectionNavigation } from "./SectionNavigation";
import { SyncStatus } from "./SyncStatus";
import { formatDay, localDay } from "../lib/dates";
import { MaterialLotPicker } from "./MaterialLotPicker";
import { MaterialStockSummary } from "./MaterialStockSummary";

type User = {
  fullName: string;
  email: string;
  roles: string[];
  permissions?: string[];
};
type Tab = "dashboard" | "operations" | "reports" | "account";
type OperationSection = "processing" | "stock" | "finance" | "close";
type RecordMap = Record<string, unknown>;
type DailyExpenseLine = { id: string; category: string; description: string; vendor: string; amountUgx: string };

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

const num = (value: unknown) => Number(value || 0);
const FLOAT_KIND: Record<string, string> = { given: "Issued by the office", spent: "Spent", returned: "Returned to the office" };
const EXPENSE_CATEGORIES = [["food", "Food"], ["transport", "Transport"], ["daily_wages", "Daily wages"], ["worker_credit", "Worker credit"], ["fuel", "Fuel"], ["maintenance", "Maintenance"], ["equipment", "Equipment"], ["utilities", "Utilities"], ["disposal_fees", "Disposal fees"], ["office", "Office"], ["other", "Other"]] as const;
const newExpenseLine = (): DailyExpenseLine => ({ id: `${Date.now()}-${Math.random()}`, category: "other", description: "", vendor: "", amountUgx: "" });

const DASHBOARD_ENDPOINTS = [
  ["trips", "/api/waste/trips"],
  ["customers", "/api/waste/customers"],
  ["vehicles", "/api/waste/trucks"],
  ["recycling", "/api/waste/recycling"],
  ["expenses", "/api/waste/finance/expenses"],
  ["financePosition", "/api/waste/finance/position"],
] as const;

export function CompanyTabletWorkspace({
  token,
  user,
  onLogout,
  initialTab = "dashboard",
  onOpenPurchasing,
  onOpenSales,
  active = true,
}: {
  token: string;
  user: User;
  onLogout: () => Promise<void>;
  initialTab?: "dashboard" | "operations";
  active?: boolean;
  onOpenPurchasing?: () => void;
  onOpenSales?: () => void;
}) {
  const navSpace = useBottomNavigationSpace();
  const scrollRef = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const tablet = width >= 760;
  const [tab, setTab] = useState<Tab>(initialTab);
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
    sortingBatches: [] as RecordMap[],
    stockAdjustments: [] as RecordMap[],
    dailyClosures: [] as RecordMap[],
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
  const emptySorting = { inputMode: "material_total" as "material_total"|"lot", lotId: "", materialType: "", outputMaterial: "", outputKg: "", rejectedKg: "0", wages: "", utilities: "", transport: "", consumables: "", other: "", float: "", notes: "" };
  const [sorting, setSorting] = useState(emptySorting);
  const [entryDate, setEntryDate] = useState("");
  const [floatPage, setFloatPage] = useState(1);
  const [adjustment, setAdjustment] = useState({ lotId: "", type: "loss", quantityKg: "", reason: "", notes: "" });
  const [closeNotes, setCloseNotes] = useState("");
  const [countedOfficeCash, setCountedOfficeCash] = useState("");
  const [countedManagerFloat, setCountedManagerFloat] = useState("");
  const [allDevicesSynced, setAllDevicesSynced] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [savingOperation, setSavingOperation] = useState(false);
  const [operationSection, setOperationSection] = useState<OperationSection>("processing");
  const [expenseReference, setExpenseReference] = useState("");
  const [expenseLines, setExpenseLines] = useState<DailyExpenseLine[]>([newExpenseLine()]);
  const [savingExpense, setSavingExpense] = useState(false);

  // Applies one response per DASHBOARD_ENDPOINTS entry; undefined leaves that part of the screen as it was.
  const apply = useCallback((values: unknown[]) => {
    setData((current) => {
      const next = { ...current };
      values.forEach((value, index) => {
        if (value === undefined || value === null) return;
        const key = DASHBOARD_ENDPOINTS[index][0];
        if (key === "expenses") {
          const finance = objectData(value);
          next.expenses = records(finance?.expenses);
          next.expenseSummary = objectData(finance?.summary) || {};
          return;
        }
        if (key === "financePosition") {
          next.financePosition = objectData(value) || {};
          return;
        }
        if (key !== "recycling") {
          next[key] = records(value);
          return;
        }
        const recycling = objectData(value);
        setRecyclingAvailable(true);
        next.recycling = records(recycling?.lots);
        next.recyclingSales = records(recycling?.sales);
        next.recyclingPartners = records(recycling?.partners);
        next.recyclingSummary = objectData(recycling?.summary) || {};
        next.floatTransactions = records(recycling?.floatTransactions);
        next.recyclingOperations = objectData(recycling?.operations) || {};
        next.recyclingMaterials = records(recycling?.materials);
        next.sortingBatches = records(recycling?.sortingBatches);
        next.stockAdjustments = records(recycling?.stockAdjustments);
        next.dailyClosures = records(recycling?.dailyClosures);
      });
      return next;
    });
  }, []);

  // A new screen starts at the top rather than at the previous screen's scroll position.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [tab]);
  // Messages appear at the top of the screen, so bring them into view when a save fails further down.
  useEffect(() => {
    if (error) scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [error]);

  const load = useCallback(async () => {
    setError("");
    const results = await Promise.allSettled(
      DASHBOARD_ENDPOINTS.map(([, path]) =>
        mobileRequest<unknown>(path, token, user.email),
      ),
    );
    apply(results.map((result) => (result.status === "fulfilled" ? result.value : undefined)));
    if (results.every((result) => result.status === "rejected")) {
      setError(
        "No company data is available on this tablet yet. Connect once and refresh to securely cache your workspace.",
      );
    }
  }, [apply, token, user.email]);

  useEffect(() => {
    // Show the saved copy straight away, then replace it with the server's answer.
    let cancelled = false;
    void Promise.all(DASHBOARD_ENDPOINTS.map(([, path]) => readCachedResponse<unknown>(path, user.email))).then((cached) => {
      if (cancelled || cached.every((value) => value === null)) return;
      apply(cached);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apply, load, user.email]);

  // Coming back to this screen refreshes quietly in the background; the last figures stay visible meanwhile.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      // The manager may arrive here from another module asking for a specific page.
      setTab(initialTab);
      void load();
    }
    wasActive.current = active;
  }, [active, initialTab, load]);

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
            transactionDate: entryDay,
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
      if (!result.queuedOffline) void load();
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
      localDay(),
  );
  const dayClosed = Boolean(
    data.recyclingOperations.isClosed || data.recyclingOperations.is_closed,
  );
  const currentClosure = objectData(data.recyclingOperations.currentClosure) || {};
  const closureHistory = records(currentClosure.history);
  const closedDays = [
    ...data.dailyClosures.filter((item) => item.status === "closed").map((item) => localDay(String(item.operating_date || ""))),
    ...(dayClosed ? [operatingDate] : []),
  ];
  // Sorting, stock corrections, expenses and field money share one record date, which follows the business day
  // until someone picks another.
  const entryDay = entryDate || operatingDate;
  const entryClosed = closedDays.includes(entryDay);
  const floatBalance = num(data.recyclingSummary.floatBalanceUgx);
  const officeCash = num(data.recyclingSummary.officeCashUgx);
  // Field managers spend from accountable float. Company administrators post verified, already-spent daily costs.
  const expenseFromFloat = user.roles.includes("recycling_field_manager");
  // The server limits money in and out to people who manage company or field money.
  const canSeeCompanyReport = user.roles.some((role) => ["company_admin", "company_owner", "recycling_field_manager"].includes(role)) || Boolean(user.permissions?.includes("reports.organization.read"));
  const canSeeMoneyFlow = user.roles.some((role) => ["recycling_field_manager", "company_admin"].includes(role));
  const canManageInventory =
    user.roles.some((role) => ["company_admin", "recycling_field_manager"].includes(role)) ||
    Boolean(user.permissions?.includes("recycling.inventory.manage"));
  const canCloseDay =
    user.roles.some((role) => ["company_admin", "recycling_field_manager"].includes(role)) ||
    Boolean(user.permissions?.includes("recycling.daily_close.manage"));
  const canCreateExpense =
    user.roles.some((role) => ["company_admin", "recycling_field_manager"].includes(role)) ||
    Boolean(user.permissions?.includes("finance.expense.create"));
  const floatPageSize = 10;
  const floatTotalPages = Math.max(1, Math.ceil(data.floatTransactions.length / floatPageSize));
  const currentFloatPage = Math.min(floatPage, floatTotalPages);
  const visibleFloatTransactions = data.floatTransactions.slice((currentFloatPage - 1) * floatPageSize, currentFloatPage * floatPageSize);

  async function saveExpense() {
    const lines = expenseLines.map((line) => ({ ...line, amountUgx: Number(line.amountUgx) }));
    const totalUgx = lines.reduce((sum, line) => sum + Number(line.amountUgx || 0), 0);
    if (!expenseReference.trim() || !lines.length || lines.some((line) => !Number.isInteger(line.amountUgx) || line.amountUgx <= 0 || line.description.trim().length < 3)) {
      Alert.alert("Check expense details", "Add a receipt or voucher reference. Every line needs a clear description and a positive whole UGX amount.");
      return;
    }
    try {
      setSavingExpense(true);
      const result = await mobileRequest<RecordMap>("/api/waste/finance/expenses/daily-batch", token, user.email, {
            method: "POST",
            body: JSON.stringify({ expenseDate: entryDay, reference: expenseReference.trim(), fundingSource: expenseFromFloat ? "manager_float" : "office_cash", lines: lines.map((line) => ({ category: line.category, description: line.description.trim(), vendor: line.vendor.trim() || undefined, amountUgx: line.amountUgx })) }),
          });
      setExpenseReference("");
      setExpenseLines([newExpenseLine()]);
      Alert.alert(
        result.queuedOffline ? "Daily expenses saved offline" : "Daily expenses recorded",
        result.queuedOffline ? "The complete expense sheet will sync when internet returns." : expenseFromFloat ? `${ugx(totalUgx)} was taken from the manager float.` : `${expenseLines.length} expense line${expenseLines.length === 1 ? "" : "s"} totalling ${ugx(totalUgx)} were posted to the organization cash ledger.`,
      );
      if (!result.queuedOffline) void load();
    } catch (caught) {
      Alert.alert("Could not submit expense", caught instanceof Error ? caught.message : "Please try again.");
    } finally {
      setSavingExpense(false);
    }
  }

  async function saveSorting() {
    const outputKg = Number(sorting.outputKg);
    const rejectedKg = Number(sorting.rejectedKg || 0);
    const cost = (value: string) => Number(value || 0);
    const processingCost = cost(sorting.wages) + cost(sorting.utilities) + cost(sorting.transport) + cost(sorting.consumables) + cost(sorting.other);
    if (cost(sorting.float) > processingCost) {
      Alert.alert("Check the float", "Money from the manager float cannot be more than the processing cost.");
      return;
    }
    if ((sorting.inputMode === "lot" ? !sorting.lotId : !sorting.materialType) || !sorting.outputMaterial.trim() || outputKg <= 0 || rejectedKg < 0) {
      Alert.alert("Check sorting details", "Choose the material to sort from, the material sorted out and its weight.");
      return;
    }
    try {
      setSavingOperation(true);
      const result = await mobileRequest<RecordMap>("/api/waste/recycling/sorting", token, user.email, {
        method: "POST",
        body: JSON.stringify({ inputMode: sorting.inputMode, ...(sorting.inputMode === "lot" ? { inputLotId: sorting.lotId } : { inputMaterialType: sorting.materialType }), processedOn: entryDay, inputKg: outputKg + rejectedKg, outputMaterialType: sorting.outputMaterial.trim(), allowNewMaterial: true, outputKg, rejectedKg, workerWagesUgx: cost(sorting.wages), utilitiesUgx: cost(sorting.utilities), transportUgx: cost(sorting.transport), consumablesUgx: cost(sorting.consumables), otherExpenseUgx: cost(sorting.other), managerFloatUsedUgx: expenseFromFloat ? processingCost : cost(sorting.float), notes: sorting.notes.trim() || undefined }),
      });
      setSorting(emptySorting);
      Alert.alert(result.queuedOffline ? "Sorting saved offline" : "Sorting recorded", result.queuedOffline ? "The stock movement will synchronize automatically." : "The sorted weight and the waste were taken from the material. The rest stays in stock.");
      if (!result.queuedOffline) void load();
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
        body: JSON.stringify({ lotId: adjustment.lotId, adjustmentDate: entryDay, adjustmentType: adjustment.type, quantityKg, reason: adjustment.reason.trim(), notes: adjustment.notes.trim() || undefined }),
      });
      setAdjustment({ lotId: "", type: "loss", quantityKg: "", reason: "", notes: "" });
      Alert.alert(result.queuedOffline ? "Adjustment saved offline" : "Stock adjusted", result.queuedOffline ? "It will synchronize automatically when connectivity returns." : "The material ledger now reflects this adjustment.");
      if (!result.queuedOffline) void load();
    } catch (caught) {
      Alert.alert("Could not adjust stock", caught instanceof Error ? caught.message : "Please try again.");
    } finally { setSavingOperation(false); }
  }

  async function closeOperatingDay() {
    if (countedOfficeCash === "" || countedManagerFloat === "") return Alert.alert("Count the cash first", "Enter the physical office cash and manager float separately.");
    if (!allDevicesSynced) return Alert.alert("Synchronize every device", "Bring every field phone and tablet online and confirm there are no records waiting to sync.");
    Alert.alert("Close daily operations?", `This closes ${operatingDate} for new recycling transactions.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Close day", style: "destructive", onPress: () => void (async () => {
        try {
          setSavingOperation(true);
          await mobileRequest<RecordMap>("/api/waste/recycling/daily-closures", token, user.email, { method: "POST", body: JSON.stringify({ operatingDate, countedOfficeCashUgx: Number(countedOfficeCash), countedManagerFloatUgx: Number(countedManagerFloat), allDevicesSynced, notes: closeNotes.trim() || undefined }) });
          setCloseNotes("");
          setCountedOfficeCash(""); setCountedManagerFloat(""); setAllDevicesSynced(false);
          Alert.alert("Day closed", "Cash, float and daily operations reconciled. The date is now locked.");
          void load();
        } catch (caught) { Alert.alert("Could not close the day", caught instanceof Error ? caught.message : "Please try again."); }
        finally { setSavingOperation(false); }
      })() },
    ]);
  }

  // Reopening needs the server to check the closure, so it is not queued offline.
  function reopenOperatingDay() {
    const closureId = String(currentClosure.id || "");
    if (!closureId) return Alert.alert("Refresh first", "Pull down to refresh, then try again.");
    if (reopenReason.trim().length < 5) return Alert.alert("Give a reason", "Explain in a few words why the day must be reopened. It is kept with the audit record.");
    Alert.alert("Reopen this day?", `New recycling transactions will be allowed again for ${operatingDate}.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Reopen", onPress: () => void (async () => {
        try {
          setSavingOperation(true);
          const result = await mobileRequest<RecordMap>(`/api/waste/recycling/daily-closures/${closureId}/reopen`, token, user.email, { method: "PATCH", body: JSON.stringify({ reason: reopenReason.trim() }) });
          if (result.queuedOffline) {
            await discardMobileOutbox(String(result.localId), user.email);
            return Alert.alert("Internet needed", "Reopening a day must be confirmed by the server. Try again when connected.");
          }
          setReopenReason("");
          Alert.alert("Day reopened", "Recycling transactions can be recorded again.");
          void load();
        } catch (caught) { Alert.alert("Could not reopen the day", caught instanceof Error ? caught.message : "Please try again."); }
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
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <AppHeader name={user.fullName} organization={roleLabel}
        right={<SyncStatus token={token} email={user.email} onSynced={() => void load()} />} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.page, { paddingBottom: navSpace }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
      >
        {tab === "account" ? (
          <AccountWorkspace user={user} onLogout={onLogout} />
        ) : <>
        <Segmented value={tab} onChange={(value) => setTab(value)}
          options={[{ value: "dashboard", label: "Overview" }, { value: "operations", label: "Operations" }, ...(recyclingAvailable ? [{ value: "reports" as const, label: "Reports" }] : [])]} />
        <View style={styles.intro}>
          <Text style={styles.pageTitle}>{tab === "dashboard" ? "Today" : tab === "reports" ? "Reports" : "Daily operations"}</Text>
          <Text style={styles.subtitle}>
            {tab === "dashboard"
              ? "Money available, stock and what needs your attention."
              : tab === "reports"
                ? "A day's work in detail, or all money that came in and went out over a period."
                : "Manage sorting, stock corrections, active work, field money and daily close."}
          </Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? (
          <ActivityIndicator size="large" color={color.action} />
        ) : (
          <>
            {tab === "dashboard" ? <>
            {recyclingAvailable ? <>
              <SummaryCard label="Manager float · available to spend" value={ugx(floatBalance)}
                caption={floatBalance > 0 ? "Purchases, sale costs and expenses are paid from this." : "Ask the office to issue float before buying or paying costs."}
                stats={[
                  { label: "Office cash", value: ugx(officeCash).replace("UGX ", "") },
                  { label: "Stock on hand", value: `${availableStockKg.toLocaleString("en-GB")} kg` },
                ]} />
              <View style={{ height: 12 }} />
              <StatStrip items={[
                { label: "Owed to suppliers", value: ugx(num(data.recyclingSummary.creditPurchasesUgx)), tone: num(data.recyclingSummary.overduePayablesUgx) > 0 ? "danger" : "warning" },
                { label: "Owed by buyers", value: ugx(num(data.recyclingSummary.unpaidSalesUgx)), tone: num(data.recyclingSummary.overdueReceivablesUgx) > 0 ? "danger" : "action" },
                { label: "Company cash", value: ugx(num(data.recyclingSummary.cashPositionUgx ?? data.financePosition.cash_position_ugx)) },
                { label: "Profit so far", value: ugx(num(data.recyclingSummary.profitLossUgx)), tone: num(data.recyclingSummary.profitLossUgx) < 0 ? "danger" : "success" },
              ]} />
            </> : (
              <SummaryCard label="Trips today" value={String(data.trips.length)}
                stats={[{ label: "In progress", value: activeTrips.length }, { label: "Customers", value: data.customers.length }, { label: "Vehicles", value: data.vehicles.length }]} />
            )}
            <View style={{ height: 16 }} />
            <QuickActions items={[
              ...(onOpenPurchasing ? [{ icon: "download-outline" as const, label: "Record purchase", onPress: onOpenPurchasing }] : []),
              { icon: "grid-outline" as const, label: "Daily operations", onPress: () => setTab("operations"), tone: "neutral" as const },
              ...(onOpenSales ? [{ icon: "trending-up-outline" as const, label: "Record sale", onPress: onOpenSales, tone: "success" as const }] : []),
            ]} />
            <View style={{ height: 20 }} />
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
            </> : null}
            {tab === "reports" ? canSeeCompanyReport
              ? <RecyclingInsightsReport token={token} email={user.email} />
              : <Banner tone="warning" title="Reports unavailable" text="Your account does not have permission to view organization reports." />
            : null}
            {tab === "operations" ? <>
            <SectionNavigation title="Daily work" items={[
              { id: "processing", label: "Processing", active: operationSection === "processing", onPress: () => setOperationSection("processing") },
              { id: "stock", label: "Stock", active: operationSection === "stock", onPress: () => setOperationSection("stock") },
              ...(canCreateExpense || canSeeMoneyFlow ? [{ id: "finance", label: "Finance", active: operationSection === "finance", onPress: () => setOperationSection("finance") }] : []),
              ...(canCloseDay ? [{ id: "close", label: "Close day", active: operationSection === "close", onPress: () => setOperationSection("close") }] : []),
            ]} />
            {recyclingAvailable && canManageInventory && (operationSection === "processing" || operationSection === "stock") ? (
              <View style={[styles.operationGrid, tablet && styles.operationGridTablet]}>
                {operationSection === "processing" ? <View style={[styles.section, styles.operationPanel]}>
                  <Text style={styles.sectionTitle}>Sort and grade material</Text>
                  <Text style={styles.sectionCopy}>Convert a purchased lot into recovered stock while recording rejects and processing cost.</Text>
                  <View style={styles.formArea}>
                    <Text style={styles.inputLabel}>Date of this record</Text>
                    <DateField value={entryDay} onChange={setEntryDate} blocked={closedDays} />
                    <Text style={styles.inputLabel}>Input material lot</Text>
                    <Segmented value={sorting.inputMode} onChange={(inputMode) => setSorting((value) => ({ ...value, inputMode, lotId: "", materialType: "" }))} options={[{ value: "material_total", label: "Material total" }, { value: "lot", label: "One purchase" }]} />
                    <Text style={styles.muted}>{sorting.inputMode === "material_total" ? "Only the sorted weight and the waste are taken, oldest stock first. The rest stays in this material to sort later." : "Use this when processing material from one specific delivery only."}</Text>
                    {sorting.inputMode === "lot" ? <MaterialLotPicker lots={data.recycling} selectedId={sorting.lotId} onSelect={(lotId) => setSorting((value) => ({ ...value, lotId }))} /> : <View style={styles.choices}>{[...new Set(data.recycling.filter((lot)=>Number(lot.available_kg??lot.quantity_kg??0)>0).map((lot)=>text(lot.material_type||lot.materialType,"Material")))].map((materialType)=><Pressable key={materialType} onPress={()=>setSorting((value)=>({...value,materialType}))} style={[styles.choice,sorting.materialType===materialType&&styles.choiceActive]}><Text style={[styles.choiceText,sorting.materialType===materialType&&styles.choiceTextActive]}>{materialType} · {data.recycling.filter((lot)=>text(lot.material_type||lot.materialType,"Material")===materialType).reduce((sum,lot)=>sum+Number(lot.available_kg??lot.quantity_kg??0),0).toLocaleString()} kg</Text></Pressable>)}</View>}
                    <View style={[styles.fieldRow, tablet && styles.fieldRowTablet]}>
                      <View style={styles.field}><Text style={styles.inputLabel}>Recovered material</Text><TextInput accessibilityLabel="Recovered material" value={sorting.outputMaterial} onChangeText={(value) => setSorting((current) => ({ ...current, outputMaterial: value }))} placeholder="Example: PET clear" style={styles.input} /></View>
                    </View>
                    <View style={[styles.fieldRow, tablet && styles.fieldRowTablet]}>
                      <View style={styles.field}><Text style={styles.inputLabel}>Sorted out kg</Text><TextInput accessibilityLabel="Sorted out kg" value={sorting.outputKg} onChangeText={(value) => setSorting((current) => ({ ...current, outputKg: value }))} keyboardType="decimal-pad" style={styles.input} /></View>
                      <View style={styles.field}><Text style={styles.inputLabel}>Waste kg</Text><TextInput accessibilityLabel="Waste kg" value={sorting.rejectedKg} onChangeText={(value) => setSorting((current) => ({ ...current, rejectedKg: value }))} keyboardType="decimal-pad" style={styles.input} /></View>
                    </View>
                    <Text style={styles.inputLabel}>Processing costs (UGX)</Text>
                    {expenseFromFloat ? <Text style={styles.muted}>Paid from the manager float · {ugx(floatBalance)} available.</Text> : null}
                    <View style={[styles.fieldRow, tablet && styles.fieldRowTablet]}>
                      <View style={styles.field}><Text style={styles.inputLabel}>Worker wages</Text><TextInput accessibilityLabel="Worker wages" value={sorting.wages} onChangeText={(value) => setSorting((current) => ({ ...current, wages: value.replace(/[^\d]/g, "") }))} keyboardType="number-pad" placeholder="0" style={styles.input} /></View>
                      <View style={styles.field}><Text style={styles.inputLabel}>Power and water</Text><TextInput accessibilityLabel="Power and water" value={sorting.utilities} onChangeText={(value) => setSorting((current) => ({ ...current, utilities: value.replace(/[^\d]/g, "") }))} keyboardType="number-pad" placeholder="0" style={styles.input} /></View>
                    </View>
                    <View style={[styles.fieldRow, tablet && styles.fieldRowTablet]}>
                      <View style={styles.field}><Text style={styles.inputLabel}>Transport</Text><TextInput accessibilityLabel="Transport" value={sorting.transport} onChangeText={(value) => setSorting((current) => ({ ...current, transport: value.replace(/[^\d]/g, "") }))} keyboardType="number-pad" placeholder="0" style={styles.input} /></View>
                      <View style={styles.field}><Text style={styles.inputLabel}>Bags and supplies</Text><TextInput accessibilityLabel="Bags and supplies" value={sorting.consumables} onChangeText={(value) => setSorting((current) => ({ ...current, consumables: value.replace(/[^\d]/g, "") }))} keyboardType="number-pad" placeholder="0" style={styles.input} /></View>
                    </View>
                    <View style={[styles.fieldRow, tablet && styles.fieldRowTablet]}>
                      <View style={styles.field}><Text style={styles.inputLabel}>Other costs</Text><TextInput accessibilityLabel="Other costs" value={sorting.other} onChangeText={(value) => setSorting((current) => ({ ...current, other: value.replace(/[^\d]/g, "") }))} keyboardType="number-pad" placeholder="0" style={styles.input} /></View>
                      {expenseFromFloat ? null : <View style={styles.field}><Text style={styles.inputLabel}>Paid from manager float</Text><TextInput accessibilityLabel="Paid from manager float" value={sorting.float} onChangeText={(value) => setSorting((current) => ({ ...current, float: value.replace(/[^\d]/g, "") }))} keyboardType="number-pad" placeholder="0" style={styles.input} /></View>}
                    </View>
                    <Text style={styles.inputLabel}>Notes (optional)</Text><TextInput accessibilityLabel="Notes (optional)" value={sorting.notes} onChangeText={(value) => setSorting((current) => ({ ...current, notes: value }))} style={styles.input} />
                    <Pressable disabled={savingOperation || entryClosed} onPress={() => void saveSorting()} style={[styles.primaryButton, (savingOperation || entryClosed) && styles.disabled]}><Text style={styles.primaryButtonText}>{entryClosed ? "This day is closed" : savingOperation ? "Saving…" : "Record sorting"}</Text></Pressable>
                  </View>
                </View> : null}
                {operationSection === "stock" ? <View style={[styles.section, styles.operationPanel]}>
                  <View style={{ padding: 16, paddingBottom: 0 }}><MaterialStockSummary lots={data.recycling} sales={data.recyclingSales} sorting={data.sortingBatches} adjustments={data.stockAdjustments} /></View>
                  <Text style={styles.sectionTitle}>Stock adjustment</Text>
                  <Text style={styles.sectionCopy}>Record verified loss, correction in, or correction out with a clear audit reason.</Text>
                  <View style={styles.formArea}>
                    <Text style={styles.inputLabel}>Date of this record</Text>
                    <DateField value={entryDay} onChange={setEntryDate} blocked={closedDays} />
                    <Text style={styles.inputLabel}>Material lot</Text>
                    <MaterialLotPicker lots={data.recycling} selectedId={adjustment.lotId} onSelect={(lotId) => setAdjustment((value) => ({ ...value, lotId }))} onlyAvailable={adjustment.type !== "correction_in"} />
                    <Text style={styles.inputLabel}>Adjustment type</Text>
                    <View style={styles.choices}>{[["loss", "Loss"], ["correction_in", "Correction in"], ["correction_out", "Correction out"]].map(([value, label]) => <Pressable key={value} onPress={() => setAdjustment((current) => ({ ...current, type: value }))} accessibilityRole="radio" accessibilityState={{ checked: adjustment.type === value }} style={[styles.choice, adjustment.type === value && styles.choiceActive]}><Text style={[styles.choiceText, adjustment.type === value && styles.choiceTextActive]}>{label}</Text></Pressable>)}</View>
                    <Text style={styles.inputLabel}>Quantity (kg)</Text><TextInput accessibilityLabel="Quantity (kg)" value={adjustment.quantityKg} onChangeText={(value) => setAdjustment((current) => ({ ...current, quantityKg: value }))} keyboardType="decimal-pad" style={styles.input} />
                    <Text style={styles.inputLabel}>Reason</Text><TextInput accessibilityLabel="Reason" value={adjustment.reason} onChangeText={(value) => setAdjustment((current) => ({ ...current, reason: value }))} placeholder="Required audit reason" style={styles.input} />
                    <Text style={styles.inputLabel}>Notes (optional)</Text><TextInput accessibilityLabel="Notes (optional)" value={adjustment.notes} onChangeText={(value) => setAdjustment((current) => ({ ...current, notes: value }))} style={styles.input} />
                    <Pressable disabled={savingOperation || entryClosed} onPress={() => void saveAdjustment()} style={[styles.primaryButton, (savingOperation || entryClosed) && styles.disabled]}><Text style={styles.primaryButtonText}>{entryClosed ? "This day is closed" : savingOperation ? "Saving…" : "Save adjustment"}</Text></Pressable>
                  </View>
                </View> : null}
              </View>
            ) : null}
            {recyclingAvailable && canCreateExpense && operationSection === "finance" ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Daily expense sheet</Text>
                <Text style={styles.sectionCopy}>{expenseFromFloat
                  ? `Record all costs paid from the manager float in one sheet. ${ugx(floatBalance)} is available.`
                  : "Record all verified costs for one business day and save them once. Every line is stored separately by type, date and person in the same finance ledger."}</Text>
                <View style={styles.formArea}>
                  <Text style={styles.inputLabel}>Business date</Text>
                  <DateField value={entryDay} onChange={setEntryDate} blocked={closedDays} />
                  <Text style={styles.inputLabel}>Voucher or batch reference</Text>
                  <ReferenceInput value={expenseReference} onChangeText={setExpenseReference} prefix="EXP" placeholder="One reference for this sheet" />
                  {expenseLines.map((line, index) => <View key={line.id} style={styles.expenseLine}>
                    <View style={styles.expenseLineHeader}><Text style={styles.rowTitle}>Expense {index + 1}</Text>{expenseLines.length > 1 ? <Pressable onPress={() => setExpenseLines((current) => current.filter((item) => item.id !== line.id))}><Text style={styles.removeText}>Remove</Text></Pressable> : null}</View>
                    <Text style={styles.inputLabel}>Type</Text>
                    <View style={styles.choices}>{EXPENSE_CATEGORIES.map(([value,label]) => <Pressable key={value} onPress={() => setExpenseLines((current) => current.map((item) => item.id === line.id ? { ...item, category: value } : item))} accessibilityRole="radio" accessibilityState={{ checked: line.category === value }} style={[styles.choice, line.category === value && styles.choiceActive]}><Text style={[styles.choiceText, line.category === value && styles.choiceTextActive]}>{label}</Text></Pressable>)}</View>
                    <Text style={styles.inputLabel}>Description</Text><TextInput value={line.description} onChangeText={(value) => setExpenseLines((current) => current.map((item) => item.id === line.id ? { ...item, description: value } : item))} placeholder="Example: Lunch for sorting team" style={styles.input} />
                    <View style={[styles.fieldRow, tablet && styles.fieldRowTablet]}><View style={styles.field}><Text style={styles.inputLabel}>Amount (UGX)</Text><TextInput value={line.amountUgx} onChangeText={(value) => setExpenseLines((current) => current.map((item) => item.id === line.id ? { ...item, amountUgx: value.replace(/[^\d]/g, "") } : item))} keyboardType="number-pad" placeholder="0" style={styles.input} /></View><View style={styles.field}><Text style={styles.inputLabel}>Person / worker / provider</Text><TextInput value={line.vendor} onChangeText={(value) => setExpenseLines((current) => current.map((item) => item.id === line.id ? { ...item, vendor: value } : item))} placeholder="Who received the money?" style={styles.input} /></View></View>
                  </View>)}
                  <Pressable onPress={() => setExpenseLines((current) => [...current, newExpenseLine()])} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>+ Add another expense</Text></Pressable>
                  <View style={styles.expenseTotal}><Text style={styles.muted}>{expenseLines.length} line{expenseLines.length === 1 ? "" : "s"}</Text><Text style={styles.floatBalance}>{ugx(expenseLines.reduce((sum, line) => sum + Number(line.amountUgx || 0), 0))}</Text></View>
                  <Pressable disabled={savingExpense || entryClosed} onPress={() => void saveExpense()} style={[styles.primaryButton, (savingExpense || entryClosed) && styles.disabled]}><Text style={styles.primaryButtonText}>{entryClosed ? "This day is closed" : savingExpense ? "Saving…" : "Save all as paid"}</Text></Pressable>
                </View>
                <View style={styles.floatSummary}><Text style={styles.muted}>Recorded expenses</Text><Text style={styles.floatBalance}>{data.expenses.length.toLocaleString()}</Text></View>
                {data.expenses.slice(0, 5).map((item, index) => <View key={String(item.id || index)} style={styles.row}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{text(item.description, "Organization expense")}</Text><Text style={styles.muted}>{text(item.expense_number, "Pending sync")} · {text(item.status, "draft").replaceAll("_", " ")}</Text></View><Text style={styles.status}>UGX {Number(item.amount_ugx || 0).toLocaleString()}</Text></View>)}
              </View>
            ) : null}
            {recyclingAvailable && canCloseDay && operationSection === "close" ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Daily close · {operatingDate}</Text>
                <Text style={styles.sectionCopy}>{dayClosed ? "This operating day is already closed." : "Confirm that purchases, sorting, stock, expenses and sales are complete before closing."}</Text>
                {!dayClosed ? <View style={styles.formArea}>
                  <View style={[styles.metrics, tablet && styles.metricsTablet]}>{[["Ledger office cash", data.recyclingSummary.officeCashUgx ?? 0],["Ledger manager float", data.recyclingSummary.floatBalanceUgx ?? 0]].map(([label,value])=><View key={String(label)} style={[styles.metric, tablet && styles.metricTablet]}><Text style={styles.metricLabel}>{String(label)}</Text><Text style={styles.metricValue}>UGX {Number(value).toLocaleString()}</Text></View>)}</View>
                  <Text style={styles.inputLabel}>Physical office cash counted (UGX)</Text><TextInput value={countedOfficeCash} onChangeText={(value)=>setCountedOfficeCash(value.replace(/[^\d]/g,""))} keyboardType="number-pad" placeholder="Count what is actually in the office" style={styles.input} />
                  <Text style={styles.inputLabel}>Physical manager float counted (UGX)</Text><TextInput value={countedManagerFloat} onChangeText={(value)=>setCountedManagerFloat(value.replace(/[^\d]/g,""))} keyboardType="number-pad" placeholder="Count what the manager still holds" style={styles.input} />
                  <Pressable accessibilityRole="checkbox" accessibilityState={{checked:allDevicesSynced}} onPress={()=>setAllDevicesSynced(value=>!value)} style={[styles.choice,allDevicesSynced&&styles.choiceActive]}><Text style={[styles.choiceText,allDevicesSynced&&styles.choiceTextActive]}>{allDevicesSynced?"✓ ":""}All field devices are online and fully synchronized</Text></Pressable>
                  <Text style={styles.inputLabel}>Closing note (optional)</Text><TextInput accessibilityLabel="Closing note (optional)" value={closeNotes} onChangeText={setCloseNotes} placeholder="Shift summary or handover note" style={styles.input} />
                  <Text style={styles.sectionCopy}>Internet is required for closing so the server can verify the latest ledger. Offline purchases and expenses remain available, but closing never waits in the offline queue.</Text>
                  <Pressable disabled={savingOperation} onPress={closeOperatingDay} style={[styles.closeButton, savingOperation && styles.disabled]}><Text style={styles.closeButtonText}>Reconcile and close day</Text></Pressable>
                </View> : (
                  <View style={styles.formArea}>
                    {closureHistory.length ? <View style={styles.auditPanel}><Text style={styles.inputLabel}>Previous control actions</Text>{closureHistory.slice(0,4).map((event,index)=><View key={String(event.id||index)} style={styles.auditRow}><Text style={styles.rowTitle}>{text(event.action,"Action")} · {text(event.actorName,"Authorized user")}</Text><Text style={styles.muted}>{event.createdAt?new Date(String(event.createdAt)).toLocaleString():""}{event.reason?` · ${String(event.reason)}`:""}</Text></View>)}</View> : null}
                    <Text style={styles.inputLabel}>Reason for reopening</Text>
                    <TextInput accessibilityLabel="Reason for reopening" value={reopenReason} onChangeText={setReopenReason} placeholder="e.g. A late supplier delivery must be recorded" style={styles.input} />
                    <Pressable disabled={savingOperation} onPress={reopenOperatingDay} style={[styles.primaryButton, savingOperation && styles.disabled]}><Text style={styles.primaryButtonText}>Reopen this day</Text></Pressable>
                  </View>
                )}
              </View>
            ) : null}
            {canSeeMoneyFlow && operationSection === "finance" ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Organization finance</Text>
                <Text style={styles.sectionCopy}>
                  Review working cash and accountable money. Daily operating expenses above use this same finance ledger; purchase-specific driver fees and costs remain attached to their purchase.
                </Text>
                <View style={[styles.metrics, tablet && styles.metricsTablet]}>
                  {[
                    ["Manager float · to spend", data.recyclingSummary.floatBalanceUgx ?? 0],
                    ["Office cash", data.recyclingSummary.officeCashUgx ?? 0],
                    ["Available to commit", data.recyclingSummary.availableToCommitUgx ?? data.financePosition.available_to_commit_ugx ?? 0],
                    ["Owed by buyers", data.recyclingSummary.unpaidSalesUgx ?? data.financePosition.receivables_ugx ?? 0],
                  ].map(([label, value]) => <View key={String(label)} style={[styles.metric, tablet && styles.metricTablet]}><Text style={styles.metricLabel}>{String(label)}</Text><Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>UGX {Number(value || 0).toLocaleString()}</Text></View>)}
                </View>
                <View style={styles.formArea}>
                  <Text style={styles.inputLabel}>Date of the hand-over</Text>
                  <DateField value={entryDay} onChange={setEntryDate} blocked={closedDays} />
                  <Text style={styles.inputLabel}>Money movement</Text>
                  <View style={styles.choices}>
                    <Pressable onPress={() => setFloatMovementType("given")} accessibilityRole="radio" accessibilityState={{ checked: floatMovementType === "given" }} style={[styles.choice, floatMovementType === "given" && styles.choiceActive]}><Text style={[styles.choiceText, floatMovementType === "given" && styles.choiceTextActive]}>Office → manager float</Text></Pressable>
                    <Pressable onPress={() => setFloatMovementType("returned")} accessibilityRole="radio" accessibilityState={{ checked: floatMovementType === "returned" }} style={[styles.choice, floatMovementType === "returned" && styles.choiceActive]}><Text style={[styles.choiceText, floatMovementType === "returned" && styles.choiceTextActive]}>Manager float → office</Text></Pressable>
                  </View>
                  <Text style={styles.inputLabel}>Amount (UGX)</Text>
                  <TextInput
                    accessibilityLabel="Amount (UGX)"
                    value={floatAmount}
                    onChangeText={setFloatAmount}
                    keyboardType="number-pad"
                    placeholder="Example: 200000"
                    style={styles.input}
                  />
                  <Text style={styles.inputLabel}>Voucher number</Text>
                  <ReferenceInput value={floatReference} onChangeText={setFloatReference} prefix="FLT" placeholder="Number on the cash voucher" />
                  <Text style={styles.muted}>Each hand-over of cash needs its own number. Write it on the voucher both people sign; the platform refuses a number that was already used.</Text>
                  <Text style={styles.inputLabel}>Purpose or handover details</Text>
                  <TextInput
                    accessibilityLabel="Purpose or handover details"
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
                <View style={styles.floatHistoryHead}>
                  <Text style={styles.sectionTitle}>Float history</Text>
                  <Text style={styles.muted}>{data.floatTransactions.length ? `Page ${currentFloatPage} of ${floatTotalPages} · ${data.floatTransactions.length} movements` : "No movements yet"}</Text>
                </View>
                {visibleFloatTransactions.map((movement, index) => {
                  const kind = String(movement.transaction_type || "");
                  const incoming = kind === "given";
                  return (
                    <View key={String(movement.id || index)} style={styles.row}>
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle}>{text(movement.notes, "Field movement")}</Text>
                        <Text style={styles.muted}>
                          {FLOAT_KIND[kind] || kind} · {movement.transaction_date ? formatDay(localDay(String(movement.transaction_date)), false) : "Date unavailable"} · {text(movement.recorded_by_name, "System")}
                          {movement.running_balance_ugx !== undefined ? ` · balance ${ugx(num(movement.running_balance_ugx))}` : ""}
                        </Text>
                      </View>
                      <Text style={[styles.status, { color: incoming ? color.success : color.danger }]}>
                        {incoming ? "+" : "−"} {ugx(num(movement.amount_ugx))}
                      </Text>
                    </View>
                  );
                })}
                {data.floatTransactions.length > floatPageSize ? <View style={styles.floatHistoryHead}>
                  <Pressable accessibilityRole="button" disabled={currentFloatPage <= 1} onPress={() => setFloatPage((page) => Math.max(1, page - 1))} style={[styles.showMore, currentFloatPage <= 1 && styles.disabled]}><Text style={styles.showMoreText}>Previous</Text></Pressable>
                  <Text style={styles.muted}>{currentFloatPage} / {floatTotalPages}</Text>
                  <Pressable accessibilityRole="button" disabled={currentFloatPage >= floatTotalPages} onPress={() => setFloatPage((page) => Math.min(floatTotalPages, page + 1))} style={[styles.showMore, currentFloatPage >= floatTotalPages && styles.disabled]}><Text style={styles.showMoreText}>Next</Text></Pressable>
                </View> : null}
              </View>
            ) : null}
            </> : null}
            <Banner tone="neutral" icon="cloud-offline-outline" title="Working offline" text="Purchases, sales, sorting, stock and expenses can be recorded without internet. Payments approval, permits, access changes and weighbridge records need a connection." />
          </>
        )}
        </>}
      </ScrollView>
      <RoleBottomNavigation items={[
        { id: "dashboard", label: "Dashboard", icon: "home-outline", active: tab === "dashboard", onPress: () => setTab("dashboard") },
        ...(onOpenPurchasing ? [{ id: "purchase", label: "Purchases", icon: "download-outline" as const, onPress: onOpenPurchasing }] : []),
        { id: "operations", label: "Operations", icon: "grid-outline", active: tab === "operations", onPress: () => setTab("operations") },
        ...(onOpenSales ? [{ id: "sales", label: "Sales", icon: "trending-up-outline" as const, onPress: onOpenSales }] : []),
        { id: "account", label: "Account", icon: "person-outline", active: tab === "account", onPress: () => setTab("account") },
      ]} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f4f7f5" },
  header: {
    minHeight: 86,
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e7e3",
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
    color: "#2f7d5a",
    fontWeight: "600",
    letterSpacing: 0.3,
    fontSize: 12,
  },
  headerTitle: {
    color: "#13201a",
    fontWeight: "600",
    fontSize: 24,
    marginTop: 3,
  },
  page: { width: "100%", maxWidth: 1280, alignSelf: "center", padding: 16, paddingTop: 8, paddingBottom: 120 },
  accountCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e7e3",
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginBottom: 16,
    borderRadius: 16,
  },
  avatar: { width: 76, height: 76, borderRadius: 16 },
  avatarFallback: {
    width: 76,
    height: 76,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1b3a2c",
  },
  avatarText: { color: "#f0b35a", fontWeight: "700", fontSize: 22 },
  accountCopy: { flex: 1 },
  accountName: { color: "#13201a", fontSize: 24, fontWeight: "600" },
  rolePill: {
    color: "#2f7d5a",
    backgroundColor: "#e8f3ec",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 8,
    textTransform: "capitalize",
    overflow: "hidden",
  },
  accountAction: {
    minHeight: 72,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e7e3",
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 12,
  },
  accountActionTitle: { color: "#13201a", fontSize: 16, fontWeight: "600" },
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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e0e7e3",
    padding: 17,
    justifyContent: "center",
  },
  quickActionTitle: {
    color: "#13201a",
    fontSize: 15,
    fontWeight: "700",
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
  signOutText: { color: "#b42318", fontWeight: "600" },
  bottomNav: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 10,
    minHeight: 70,
    borderRadius: 16,
    backgroundColor: "#1b3a2c",
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
    borderRadius: 12,
    gap: 2,
  },
  navItemActive: { backgroundColor: "#fff" },
  navIcon: { color: "#aab8b0", fontSize: 17, fontWeight: "700" },
  navText: { color: "#aab8b0", fontWeight: "600", fontSize: 10 },
  navTextActive: { color: "#1d4d37" },
  intro: { marginVertical: 16 },
  pageTitle: { color: "#13201a", fontSize: 26, lineHeight: 32, fontWeight: "700" },
  subtitle: { color: "#64736b", fontSize: 14, lineHeight: 20, marginTop: 4, maxWidth: 820 },
  muted: { color: "#64736b", fontSize: 13, lineHeight: 19 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  metricsTablet: { flexWrap: "nowrap" },
  metric: { flexBasis: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, backgroundColor: "#eef3f0", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  metricTablet: { flexBasis: 0, flex: 1, flexDirection: "column", alignItems: "flex-start", justifyContent: "flex-start", gap: 4 },
  metricLabel: { flexShrink: 1, color: "#64736b", fontSize: 13, fontWeight: "500" },
  metricValue: { color: "#13201a", fontSize: 17, fontWeight: "700" },
  sectionTitle: { color: "#13201a", fontSize: 17, fontWeight: "600", paddingHorizontal: 16, paddingTop: 16 },
  sectionCopy: { color: "#64736b", fontSize: 13, lineHeight: 19, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  section: { backgroundColor: "#fff", marginBottom: 16, borderRadius: 16, overflow: "hidden", shadowColor: "#13201a", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  row: { paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: "#edf1ee", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  rowCopy: { flex: 1 },
  rowTitle: { color: "#13201a", fontWeight: "600", fontSize: 15 },
  status: { color: "#34433b", fontWeight: "600" },
  empty: {
    borderTopWidth: 1,
    borderTopColor: "#dfe6e2",
    padding: 20,
    marginTop: 16,
  },
  cardTitle: {
    color: "#13201a",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 6,
  },
  notice: {
    backgroundColor: "#fff7df",
    borderLeftWidth: 3,
    borderLeftColor: "#cf8d22",
    padding: 18,
  },
  noticeTitle: { color: "#734711", fontSize: 16, fontWeight: "600" },
  noticeText: { color: "#734711", fontSize: 14, lineHeight: 21, marginTop: 5 },
  floatSummary: { marginHorizontal: 16, marginBottom: 12, padding: 16, backgroundColor: "#e8f3ec", borderRadius: 12 },
  floatBalance: {
    color: "#13201a",
    fontSize: 26,
    fontWeight: "600",
    marginTop: 4,
  },
  formArea: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  auditPanel: { borderColor: "#d8dee9", borderWidth: 1, backgroundColor: "#f8fafc", padding: 12, gap: 4 },
  auditRow: { borderTopColor: "#e2e8f0", borderTopWidth: 1, paddingTop: 8, marginTop: 4 },
  operationGrid: { gap: 20 },
  operationGridTablet: { flexDirection: "row", alignItems: "flex-start" },
  operationPanel: { flex: 1 },
  fieldRow: { gap: 10 },
  fieldRowTablet: { flexDirection: "row" },
  field: { flex: 1 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  choice: { minHeight: 38, justifyContent: "center", backgroundColor: "#eef3f0", paddingHorizontal: 14, borderRadius: 999 },
  choiceActive: { backgroundColor: "#e8f3ec" },
  choiceText: { color: "#34433b", fontWeight: "500", fontSize: 13 },
  choiceTextActive: { color: "#1d4d37", fontWeight: "600" },
  inputLabel: { color: "#34433b", fontWeight: "600", fontSize: 13, marginTop: 6 },
  input: { minHeight: 50, borderWidth: 1, borderColor: "#eef3f0", backgroundColor: "#eef3f0", paddingHorizontal: 14, color: "#13201a", fontSize: 15, borderRadius: 12 },
  primaryButton: { minHeight: 52, alignItems: "center", justifyContent: "center", backgroundColor: "#2f7d5a", marginTop: 8, borderRadius: 12 },
  primaryButtonText: { color: "#fff", fontWeight: "600" },
  floatHistoryHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingRight: 16, paddingTop: 12 },
  showMore: { minHeight: 48, alignItems: "center", justifyContent: "center", borderTopWidth: 1, borderTopColor: "#e0e7e3" },
  showMoreText: { color: "#2f7d5a", fontWeight: "600" },
  closeButton: { minHeight: 52, alignItems: "center", justifyContent: "center", backgroundColor: "#b91c1c", marginTop: 8, borderRadius: 12 },
  closeButtonText: { color: "#fff", fontWeight: "600" },
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
    borderColor: "#2f7d5a",
    paddingHorizontal: 16,
    backgroundColor: "#fff",
  },
  secondaryButtonText: { color: "#2f7d5a", fontWeight: "600" },
  expenseLine: { borderWidth: 1, borderColor: "#e0e7e3", borderRadius: 14, padding: 12, gap: 7, marginTop: 8 },
  expenseLineHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  removeText: { color: "#b42318", fontWeight: "600", paddingVertical: 8 },
  expenseTotal: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 8 },
  textButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  textButtonText: { color: "#2f7d5a", fontWeight: "600" },
  messageCard: {
    margin: 24,
    padding: 24,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e7e3",
  },
  webview: { flex: 1, backgroundColor: "#fff" },
  webLoading: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#f4f7f5",
  },
});
