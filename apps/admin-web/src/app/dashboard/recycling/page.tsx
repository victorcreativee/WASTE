"use client";
import { FactoryBuyerSelect } from "@/components/factory/FactoryBuyerSelect";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import {
  EmptyState,
  Feedback,
  Modal,
  PageHeader,
  Status,
} from "@/components/ui/System";
import { apiRequest } from "@/lib/api";
import { activeOptions, costField, type RecyclingSettings } from "@/lib/recycling-settings";
import { CorrectionRecord, CorrectionsPanel, isCorrection, type CorrectionEdit } from "@/components/recycling/RecyclingCorrections";
import { Pager, usePagination } from "@/components/ui/Pagination";
type Lot = {
  id: string;
  material_type: string;
  source_name: string;
  quantity_kg: string;
  available_kg: string;
  unit_purchase_price_ugx: string;
  material_cost_ugx: string;
  total_cost_ugx: string;
  collected_on: string;
  quality: string;
  status: string;
  origin: "purchase" | "sorting_output" | "transfer";
  purchase_payment_status: "paid" | "credit" | "partially_paid";
  purchase_payment_reference: string | null;
  purchase_paid_on: string | null;
  purchase_due_on: string | null;
  purchase_payment_state: "paid" | "credit" | "partially_paid" | "due_soon" | "overdue";
  supplier_partner_id: string | null;
  worker_wages_ugx: string;
  food_ugx: string;
  transport_ugx: string;
  driver_fee_ugx: string;
  other_expense_ugx: string;
  manager_float_used_ugx: string;
  notes: string | null;
  paid_ugx: string;
  balance_ugx: string;
  recorded_by_name: string | null;
  delivered_by_user_id: string | null;
  delivered_by_name: string | null;
  purchase_group_reference: string | null;
};
type DeliveryStaff = { id: string; full_name: string; roles: string[] };
/** The dropdown choice that opens the new material field. */
const NEW_MATERIAL = "__new__";
const EMPTY_SORT = { input: "", output: "", sortedKg: "", wasteKg: "" };
type PurchaseLine = { id: string; materialType: string; allowNewMaterial: boolean; quantityKg: number; unitPurchasePriceUgx: number; quality: string };
type Sale = {
  id: string;
  delivered_kg: string | null;
  material_type: string;
  buyer_name: string;
  industry: string;
  quantity_kg: string;
  unit_price_ugx: string;
  total_ugx: string;
  expenses_ugx: string;
  net_income_ugx: string;
  sold_on: string;
  sale_channel: "local" | "industrial";
  status: string;
  invoice_number: string | null;
  payment_reference: string | null;
  paid_on: string | null;
  due_on: string | null;
  payment_state: string;
  latest_follow_up_method: string | null;
  latest_follow_up_outcome: string | null;
  latest_follow_up_note: string | null;
  next_follow_up_on: string | null;
  latest_follow_up_at: string | null;
  follow_up_count: number;
  paid_ugx: string;
  balance_ugx: string;
  recorded_by_name: string | null;
  lot_id: string;
  buyer_partner_id: string | null;
  worker_wages_ugx: string;
  food_ugx: string;
  transport_ugx: string;
  other_expense_ugx: string;
  notes: string | null;
};
type Partner = {
  id: string;
  partner_type: "supplier" | "buyer" | "both";
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  active: boolean;
};
type MaterialCatalogItem = {
  id: string;
  name: string;
  category: "plastic" | "paper" | "metal" | "glass" | "organic" | "textile" | "other";
  active: boolean;
};
type FloatTx = {
  id: string;
  transaction_date: string;
  transaction_type: "given" | "spent" | "returned";
  amount_ugx: string;
  running_balance_ugx: string;
  reference: string | null;
  notes: string | null;
  recorded_by_name: string | null;
  created_at: string;
};
type Loan={id:string;lender_name:string;amount_ugx:string;received_on:string;due_on:string|null;reference:string;notes:string|null;repaid_ugx:string;outstanding_ugx:string;last_repaid_on:string|null;recorded_by_name:string|null};
type CashMovement={id:string;movement_date:string;direction:"in"|"out";category:string;amount_ugx:string;reference:string;counterparty:string|null;notes:string;recorded_by_name:string};
type SortingBatch = {
  id: string;
  entry_id: string;
  processed_on: string;
  input_material_type: string;
  input_kg: string;
  output_material: string;
  output_kg: string;
  rejected_kg: string;
  processing_cost_ugx: string;
  worker_wages_ugx:string;utilities_ugx:string;transport_ugx:string;consumables_ugx:string;other_expense_ugx:string;manager_float_used_ugx:string;
};
// A sorting entry from a material total is stored as one row per input lot; it is shown and reversed as one entry.
type SortingEntry = { id: string; processed_on: string; input_material_type: string; output_material: string; input_kg: number; output_kg: number; rejected_kg: number; processing_cost_ugx: number };
function sortingEntries(rows: SortingBatch[]): SortingEntry[] {
  const entries = new Map<string, SortingEntry>();
  for (const row of rows) {
    const entry = entries.get(row.entry_id) ?? { id: row.entry_id, processed_on: row.processed_on, input_material_type: row.input_material_type, output_material: row.output_material, input_kg: 0, output_kg: 0, rejected_kg: 0, processing_cost_ugx: 0 };
    entry.input_kg += Number(row.input_kg); entry.output_kg += Number(row.output_kg); entry.rejected_kg += Number(row.rejected_kg); entry.processing_cost_ugx += Number(row.processing_cost_ugx);
    entries.set(row.entry_id, entry);
  }
  return [...entries.values()];
}
type StockAdjustment = {
  id: string;
  adjustment_date: string;
  adjustment_type: "loss" | "correction_in" | "correction_out";
  quantity_kg: string;
  reason: string;
  notes: string | null;
  material_type: string;
  source_name: string;
};
type PaymentRecord = {
  id: string;
  sale_id?: string;
  lot_id?: string;
  amount_ugx: string;
  paid_on: string;
  reference: string;
};
type Summary = {
  lots: number;
  purchasedKg: number;
  availableKg: number;
  soldKg: number;
  sortedInputKg: number;
  sortedOutputKg: number;
  rejectedKg: number;
  recoveryRate: number;
  stockAddedKg: number;
  stockRemovedKg: number;
  lossKg: number;
  purchaseCostUgx: number;
  inventoryValueUgx: number;
  costOfGoodsSoldUgx: number;
  grossProfitUgx: number;
  creditPurchasesUgx: number;
  overduePayablesUgx: number;
  dueSoonPayablesUgx: number;
  revenueUgx: number;
  unpaidSalesUgx: number;
  overdueReceivablesUgx: number;
  dueSoonReceivablesUgx: number;
  saleExpensesUgx: number;
  processingCostUgx: number;
  tradingProfitUgx: number;
  operatingExpensesUgx: number;
  stockLossUgx: number;
  profitLossUgx: number;
  floatBalanceUgx: number;
  officeCashUgx:number;
  openingBalanceUgx: number;
  loansOutstandingUgx?: number;
  openingBalanceConfigured: boolean;
  cashPositionUgx: number;
  committedFundsUgx: number;
  availableToCommitUgx: number;
};
type MaterialPerformance = {
  materialType: string;
  purchasedKg: number;
  sortedKg: number;
  availableKg: number;
  soldKg: number;
  revenueUgx: number;
};
type ExpenseBreakdown = {
  materialPurchasesUgx: number;
  purchaseWagesUgx: number;
  purchaseFoodUgx: number;
  purchaseTransportUgx: number;
  driverFeesUgx: number;
  purchaseOtherUgx: number;
  processingUgx: number;
  saleWagesUgx: number;
  saleFoodUgx: number;
  saleTransportUgx: number;
  saleOtherUgx: number;
};
type AgingBuckets = { current: number; days1To30: number; days31To60: number; days61Plus: number };
type Operations = {
  operatingDate: string;
  isClosed: boolean;
  currentClosure: DailyClosure | null;
  receivedTodayKg: number;
  sortedTodayKg: number;
  soldTodayKg: number;
  stockLotsReady: number;
  awaitingSortingKg: number;
  saleableStockKg: number;
  workQueue: Array<{ lotId: string; materialType: string; sourceName: string; receivedOn: string; availableKg: number; quality: string }>;
};
type DailyClosure = {
  id: string;
  operating_date: string;
  status: "closed" | "reopened";
  snapshot: Record<string, number>;
  notes: string | null;
  closed_at: string;
  closed_by_name: string;
  reopened_at: string | null;
  reopen_reason: string | null;
  history?: Array<{
    id: string;
    action: "closed" | "reopened";
    reason: string | null;
    createdAt: string;
    actorUserId: string;
    actorName: string;
  }>;
};
type TransactionEdit = {
  id: string;
  transaction_type: "purchase" | "sale" | "sorting_reversal" | "material_transfer" | "material_transfer_reversal" | "cash_correction" | "entry_cancelled" | "settings_change" | "material_rename";
  transaction_id: string;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  edited_by_name: string;
  edited_at: string;
};
type Data = {
  organization: { name: string; type: string };
  settings?: RecyclingSettings;
  summary: Summary;
  operations: Operations;
  dailyClosures: DailyClosure[];
  transactionEdits: TransactionEdit[];
  lots: Lot[];
  sales: Sale[];
  floatTransactions: FloatTx[];
  cashMovements:CashMovement[];
  loans?:Loan[];
  sortingBatches: SortingBatch[];
  stockAdjustments: StockAdjustment[];
  partners: Partner[];
  deliveryStaff: DeliveryStaff[];
  salePayments: PaymentRecord[];
  purchasePayments: PaymentRecord[];
  materials: MaterialCatalogItem[];
  materialPerformance: MaterialPerformance[];
  expenseBreakdown: ExpenseBreakdown;
  paymentAging: { receivables: AgingBuckets; payables: AgingBuckets };
  buyerExposure: Array<{ buyerName: string; amountUgx: number }>;
  upcomingFollowUps: Array<{ saleId: string; buyerName: string; invoiceNumber: string | null; amountUgx: number; nextFollowUpOn: string; outcome: string }>;
  myActivity?: { purchases?: number; purchasedKg?: number; sales: number; soldKg: number; saleValueUgx?: number; outstandingUgx?: number };
  dailyActivity?: Array<{ date: string; purchases: number; purchasedKg: number; sales: number; soldKg: number; saleValueUgx: number; purchaseIds: string[]; saleIds: string[] }>;
};
type FormKind =
  | ""
  | "loan"
  | "purchase"
  | "sorting"
  | "adjustment"
  | "sale"
  | "float"
  | "cash"
  | "partner"
  | "payment"
  | "purchasePayment"
  | "saleDue"
  | "purchaseDue"
  | "followUp"
  | "saleHistory"
  | "purchaseHistory"
  | "partnerLedger"
  | "material"
  | "dailyClose"
  | "dailyReopen";
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; },
  field = "mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal",
  money = (n: string | number) => `UGX ${Number(n).toLocaleString()}`;
const auditLabels: Record<string, string> = {
  material_type: "Material",
  source_name: "Supplier / source",
  buyer_name: "Buyer",
  quantity_kg: "Quantity (kg)",
  unit_purchase_price_ugx: "Purchase price / kg",
  unit_price_ugx: "Sale price / kg",
  collected_on: "Purchase date",
  sold_on: "Sale date",
  quality: "Condition",
  sale_channel: "Sale channel",
  industry: "Buyer category",
  invoice_number: "Invoice number",
  worker_wages_ugx: "Worker wages",
  food_ugx: "Food",
  transport_ugx: "Transport",
  driver_fee_ugx: "Driver fee",
  other_expense_ugx: "Other expenses",
  notes: "Notes",
};
const auditChanges = (edit: TransactionEdit) =>
  Object.keys(auditLabels)
    .filter((key) => String(edit.before_state[key] ?? "") !== String(edit.after_state[key] ?? ""))
    .map((key) => ({ key, label: auditLabels[key], before: edit.before_state[key], after: edit.after_state[key] }));
const auditValue = (key: string, value: unknown) => {
  if (value === null || value === undefined || value === "") return "Not recorded";
  return key.endsWith("_ugx") ? money(Number(value)) : String(value);
};
const expenseFields = [
  ["workerWagesUgx", "Worker wages"],
  ["foodUgx", "Food"],
  ["transportUgx", "Transport"],
  ["otherExpenseUgx", "Other expenses"],
] as const;
export default function RecyclingPage() {
  const [roleSnapshot] = useState<string[]>(() => { if (typeof window === "undefined") return []; try { return JSON.parse(sessionStorage.getItem("currentUser") || "{}").roles || []; } catch { return []; } }),
    collectorMode = roleSnapshot.includes("recycling_collector"),
    salesMode = roleSnapshot.includes("recycling_sales"),
    fieldManagerMode = roleSnapshot.includes("recycling_field_manager"),
    companyAdminMode = roleSnapshot.includes("company_admin"),
    limitedWorkerMode = collectorMode || salesMode,
    workerMode = limitedWorkerMode || fieldManagerMode,
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [form, setForm] = useState<FormKind>(""),
    [actionMenu, setActionMenu] = useState(false),
    [selectedSaleId, setSelectedSaleId] = useState(""),
    [selectedPurchaseId, setSelectedPurchaseId] = useState(""),
    [editingSaleId, setEditingSaleId] = useState(""),
    [editingPurchaseId, setEditingPurchaseId] = useState(""),
    [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([]),
    [editingPartnerId, setEditingPartnerId] = useState(""),
    [selectedPartnerId, setSelectedPartnerId] = useState(""),
    [stockQuery, setStockQuery] = useState(""),
    [stockOrigin, setStockOrigin] = useState("all"),
    [stockPage, setStockPage] = useState(1),
    [expandedMaterial, setExpandedMaterial] = useState(""),
    [sortingInputMode, setSortingInputMode] = useState<"material_total" | "lot">("material_total"),
    [reversingEntry, setReversingEntry] = useState<SortingEntry | null>(null),
    [sortDraft, setSortDraft] = useState(EMPTY_SORT),
    [repayingLoan, setRepayingLoan] = useState<Loan | null>(null),
    [salesQuery, setSalesQuery] = useState(""),
    [salesStatus, setSalesStatus] = useState("all"),
    [activityDate, setActivityDate] = useState(""),
    [saving, setSaving] = useState(false),
    [tab, setTab] = useState<
      | "insights"
      | "partners"
      | "purchases"
      | "sorting"
      | "stock"
      | "sales"
      | "float"
      | "history"
    >(collectorMode ? "purchases" : salesMode ? "sales" : fieldManagerMode ? "purchases" : "insights");
  const selectedSale = data?.sales.find((item) => item.id === selectedSaleId),
    selectedPurchase = data?.lots.find((item) => item.id === selectedPurchaseId),
    editingSale = data?.sales.find((item) => item.id === editingSaleId),
    editingPurchase = data?.lots.find((item) => item.id === editingPurchaseId),
    editingPartner = data?.partners.find((item) => item.id === editingPartnerId),
    selectedPartner = data?.partners.find((item) => item.id === selectedPartnerId),
    selectedPartnerPurchases = data?.lots.filter((item) => item.origin === "purchase" && item.supplier_partner_id === selectedPartnerId) || [],
    selectedPartnerSales = data?.sales.filter((item) => item.buyer_partner_id === selectedPartnerId) || [],
    selectedSalePayments = data?.salePayments.filter((item) => item.sale_id === selectedSaleId) || [],
    selectedPurchasePayments = data?.purchasePayments.filter((item) => item.lot_id === selectedPurchaseId) || [];
  async function load() {
    try {
      setError("");
      const next = (await apiRequest<{ data: Data }>("/api/waste/recycling")).data;
      setData(next);
      setActivityDate((current) => current || next.dailyActivity?.find((item) => item.date === next.operations.operatingDate)?.date || next.dailyActivity?.[0]?.date || next.operations.operatingDate);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load recycling workspace",
      );
    }
  }
  useEffect(() => {
    void load();
    const refresh = () => { if (navigator.onLine && document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("kwms-sync-complete", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("kwms-sync-complete", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  function openForm(next: FormKind) {
    setError("");
    setNotice("");
    setActionMenu(false);
    setForm(next);
  }
  const values = (f: FormData, names: readonly string[]) =>
    Object.fromEntries(names.map((name) => [name, Number(f.get(name) || 0)]));
  function purchaseLineFrom(f: FormData): PurchaseLine | null {
    const customMaterial = String(f.get("customMaterialType") || "").trim();
    const materialType = customMaterial || String(f.get("materialType") || "").trim();
    const quantityKg = Number(f.get("quantityKg") || 0);
    const unitPurchasePriceUgx = Number(f.get("unitPurchasePriceUgx") || 0);
    if (!materialType || quantityKg <= 0 || unitPurchasePriceUgx < 0) return null;
    return { id: crypto.randomUUID(), materialType, allowNewMaterial: Boolean(customMaterial), quantityKg, unitPurchasePriceUgx, quality: String(f.get("quality") || "mixed") };
  }
  function addPurchaseLine(formElement: HTMLFormElement | null) {
    if (!formElement) return;
    const line = purchaseLineFrom(new FormData(formElement));
    if (!line) {
      setError("Choose a material and enter its valid weight and price before adding another item.");
      return;
    }
    setPurchaseLines((current) => [...current, line]);
    for (const name of ["materialType", "customMaterialType", "quantityKg", "unitPurchasePriceUgx"]) {
      const control = formElement.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (control) control.value = "";
    }
    const quality = formElement.elements.namedItem("quality") as HTMLSelectElement | null;
    if (quality) quality.value = "mixed";
    setError("");
  }
  const selectedActivity = data?.dailyActivity?.find((item) => item.date === activityDate) ?? { date: activityDate, purchases: 0, purchasedKg: 0, sales: 0, soldKg: 0, saleValueUgx: 0, purchaseIds: [], saleIds: [] };
  const visiblePurchaseLots = data?.lots.filter((item) => item.origin === "purchase" && (!collectorMode || selectedActivity.purchaseIds.includes(item.id))) ?? [];
  const visibleSales = data?.sales.filter((item) => !limitedWorkerMode || selectedActivity.saleIds.includes(item.id)) ?? [];
  const saleMaterials = [...(data?.lots ?? []).reduce((map, item) => {
      const key = item.material_type.trim().toLowerCase(), current = map.get(key) ?? { material: item.material_type, availableKg: 0 };
      current.availableKg += Number(item.available_kg);
      return map.set(key, current);
    }, new Map<string, { material: string; availableKg: number }>()).values()].filter((x) => x.availableKg > 0 || x.material === editingSale?.material_type);
  useEffect(() => { if (form === "sorting") setSortDraft(EMPTY_SORT); }, [form]);
  const stockGroups = [...(data?.lots ?? []).reduce((map, item) => {
      if (Number(item.available_kg) <= 0 || (stockOrigin !== "all" && item.origin !== stockOrigin)) return map;
      const key=item.material_type.trim().toLowerCase(),current=map.get(key)??{material:item.material_type,availableKg:0,originalKg:0,valueUgx:0,lots:[] as Lot[]};
      current.availableKg+=Number(item.available_kg);current.originalKg+=Number(item.quantity_kg);current.valueUgx+=Number(item.available_kg)*Number(item.unit_purchase_price_ugx);current.lots.push(item);map.set(key,current);return map;
    },new Map<string,{material:string;availableKg:number;originalKg:number;valueUgx:number;lots:Lot[]}>()).values()],
    stockOf = (material: string) => stockGroups.find((group) => group.material.toLowerCase() === material.toLowerCase())?.availableKg ?? 0,
    sortedKg = Number(sortDraft.sortedKg) || 0, sortTakenKg = sortedKg + (Number(sortDraft.wasteKg) || 0),
    filteredStock = stockGroups.filter((item) => `${item.material} ${item.lots.map((lot)=>`${lot.source_name} ${lot.quality}`).join(" ")}`.toLowerCase().includes(stockQuery.trim().toLowerCase())),
    stockPageSize = 8,
    stockPageCount = Math.max(1, Math.ceil(filteredStock.length / stockPageSize)),
    safeStockPage = Math.min(stockPage, stockPageCount),
    pagedStock = filteredStock.slice((safeStockPage - 1) * stockPageSize, safeStockPage * stockPageSize),
    filteredSales = visibleSales.filter((item) => {
      const matchesQuery = `${item.material_type} ${item.buyer_name} ${item.invoice_number ?? ""}`.toLowerCase().includes(salesQuery.trim().toLowerCase());
      const matchesStatus = salesStatus === "all" || item.payment_state === salesStatus;
      return matchesQuery && matchesStatus;
    });
  // Every transaction list is paged; the sorting list shows one row per entry.
  const purchasesPage = usePagination(visiblePurchaseLots),
    salesPage = usePagination(filteredSales),
    sortingPage = usePagination(sortingEntries(data?.sortingBatches ?? [])),
    adjustmentsPage = usePagination(data?.stockAdjustments ?? []),
    partnersPage = usePagination(data?.partners ?? []),
    loansPage = usePagination(data?.loans ?? []),
    cashPage = usePagination(data?.cashMovements ?? []),
    floatPage = usePagination(data?.floatTransactions ?? []),
    editsPage = usePagination((data?.transactionEdits ?? []).filter((edit) => !["settings_change", "material_rename"].includes(edit.transaction_type))),
    openLoans = (data?.loans ?? []).filter((loan) => Number(loan.outstanding_ugx) > 0);
  async function submitPurchase(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      f = new FormData(el);
    const currentLine = purchaseLineFrom(f);
    const lines = editingPurchaseId ? (currentLine ? [currentLine] : []) : [...purchaseLines, ...(currentLine ? [currentLine] : [])];
    if (!lines.length) { setError("Add at least one complete material line to this delivery."); return; }
    if (!editingPurchaseId && String(f.get("deliveryReference") || "").trim().length < 2) { setError("Enter a delivery reference so all material lines remain linked."); return; }
    try {
      setSaving(true);
      setError("");
      await apiRequest(editingPurchaseId ? `/api/waste/recycling/lots/${editingPurchaseId}` : "/api/waste/recycling/purchase-batches", {
        method: editingPurchaseId ? "PATCH" : "POST",
        body: JSON.stringify({
          ...(editingPurchaseId ? { materialType: lines[0].materialType, allowNewMaterial: lines[0].allowNewMaterial } : { lines: lines.map(({ id: _id, ...line }) => line) }),
          supplierPartnerId: f.get("supplierPartnerId") || undefined,
          sourceName: f.get("sourceName"),
          ...(editingPurchaseId ? { quantityKg: lines[0].quantityKg, unitPurchasePriceUgx: lines[0].unitPurchasePriceUgx, quality: lines[0].quality } : {}),
          deliveredByUserId: f.get("deliveredByUserId") || undefined,
          deliveryReference: f.get("deliveryReference") || undefined,
          collectedOn: f.get("collectedOn"),
          ...(editingPurchaseId ? {} : {purchasePaymentStatus: f.get("purchasePaymentStatus"),purchasePaymentReference:f.get("purchasePaymentReference") || undefined}),
          ...values(f, [
            "workerWagesUgx",
            "foodUgx",
            "transportUgx",
            "driverFeeUgx",
            "otherExpenseUgx",
            ...(editingPurchaseId ? [] : ["managerFloatUsedUgx"]),
          ]),
          notes: f.get("notes") || undefined,
        }),
      });
      el.reset();
      setPurchaseLines([]);
      setEditingPurchaseId("");
      setForm("");
      setNotice(editingPurchaseId ? "Purchase transaction updated and stock reconciled." : `Delivery recorded as ${lines.length} separate material stock ${lines.length === 1 ? "lot" : "lots"}.`);
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not record purchase");
    } finally {
      setSaving(false);
    }
  }
  async function submitSale(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      f = new FormData(el);
    try {
      setSaving(true);
      setError("");
      await apiRequest(editingSaleId ? `/api/waste/recycling/sales/${editingSaleId}` : "/api/waste/recycling/sales", {
        method: editingSaleId ? "PATCH" : "POST",
        body: JSON.stringify({
          materialType: f.get("materialType"),
          deliveredKg: Number(f.get("deliveredKg")),
          ...(editingSaleId ? {} : { paymentReceived: f.get("paymentReceived") || "later", paymentReference: f.get("paymentReference") || undefined }),
          buyerPartnerId: f.get("buyerPartnerId") || undefined,
          buyerOrganizationId: f.get("buyerOrganizationId") || undefined,
          buyerName: f.get("buyerName") || undefined,
          saleChannel: f.get("saleChannel") || (collectorMode ? "local" : "industrial"),
          industry: f.get("industry"),
          invoiceNumber: f.get("invoiceNumber") || undefined,
          quantityKg: Number(f.get("quantityKg")),
          unitPriceUgx: Number(f.get("unitPriceUgx")),
          soldOn: f.get("soldOn"),
          ...values(f, [
            "workerWagesUgx",
            "foodUgx",
            "transportUgx",
            "otherExpenseUgx",
          ]),
          notes: f.get("notes") || undefined,
        }),
      });
      el.reset();
      setEditingSaleId("");
      setForm("");
      setNotice(editingSaleId ? "Sale transaction updated and stock reconciled." : "Industrial sale, expenses and stock movement recorded.");
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not record sale");
    } finally {
      setSaving(false);
    }
  }
  async function submitFloat(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      f = new FormData(el);
    try {
      setSaving(true);
      setError("");
      await apiRequest("/api/waste/recycling/manager-float", {
        method: "POST",
        body: JSON.stringify({
          transactionDate: f.get("transactionDate"),
          transactionType: f.get("transactionType"),
          amountUgx: Number(f.get("amountUgx")),
          reference: f.get("reference"),
          notes: f.get("notes"),
        }),
      });
      el.reset();
      setForm("");
      setNotice("Manager float movement posted to the accountable ledger.");
      await load();
    } catch (x) {
      setError(
        x instanceof Error ? x.message : "Could not update manager float",
      );
    } finally {
      setSaving(false);
    }
  }
  async function submitLoan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget, f = new FormData(el);
    try {
      setSaving(true);
      setError("");
      const result = await apiRequest<{ message: string }>("/api/waste/recycling/loans", { method: "POST", body: JSON.stringify({ lenderName: f.get("lenderName"), amountUgx: Number(f.get("amountUgx")), receivedOn: f.get("receivedOn"), dueOn: f.get("dueOn") || undefined, reference: f.get("reference"), notes: f.get("notes") || undefined }) });
      el.reset();
      setForm("");
      setNotice(result.message);
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not record the loan");
    } finally {
      setSaving(false);
    }
  }
  async function submitRepayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!repayingLoan) return;
    const f = new FormData(e.currentTarget);
    try {
      setSaving(true);
      setError("");
      const result = await apiRequest<{ message: string }>(`/api/waste/recycling/loans/${repayingLoan.id}/repayments`, { method: "POST", body: JSON.stringify({ amountUgx: Number(f.get("amountUgx")), paidOn: f.get("paidOn"), reference: f.get("reference"), notes: f.get("notes") || undefined }) });
      setRepayingLoan(null);
      setNotice(result.message);
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not record the repayment");
    } finally {
      setSaving(false);
    }
  }
  async function submitCash(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const el=e.currentTarget,f=new FormData(el);try{setSaving(true);setError("");await apiRequest("/api/waste/recycling/cash-movements",{method:"POST",body:JSON.stringify({movementDate:f.get("movementDate"),direction:f.get("direction"),category:f.get("category"),amountUgx:Number(f.get("amountUgx")),reference:f.get("reference"),counterparty:f.get("counterparty")||undefined,notes:f.get("notes")})});el.reset();setForm("");setNotice("Cash movement posted. The audit record is permanent.");await load()}catch(x){setError(x instanceof Error?x.message:"Could not post cash movement")}finally{setSaving(false)}}
  async function submitSorting(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      f = new FormData(el);
    const customMaterial = String(f.get("customOutputMaterialType") || "").trim();
    const outputMaterialType = customMaterial || String(f.get("outputMaterialType") || "").trim();
    if (!outputMaterialType || outputMaterialType === NEW_MATERIAL) {
      setError("Choose the material it was sorted into, or add a new one.");
      return;
    }
    try {
      setSaving(true);
      setError("");
      await apiRequest("/api/waste/recycling/sorting", {
        method: "POST",
        body: JSON.stringify({
          inputMode: sortingInputMode,
          ...(sortingInputMode === "lot" ? { inputLotId: f.get("inputLotId") } : { inputMaterialType: f.get("inputMaterialType") }),
          processedOn: f.get("processedOn"),
          outputMaterialType,
          allowNewMaterial: Boolean(customMaterial),
          outputKg: Number(f.get("outputKg")),
          rejectedKg: Number(f.get("rejectedKg") || 0),
          workerWagesUgx:Number(f.get("workerWagesUgx")||0),
          utilitiesUgx:Number(f.get("utilitiesUgx")||0),
          transportUgx:Number(f.get("transportUgx")||0),
          consumablesUgx:Number(f.get("consumablesUgx")||0),
          otherExpenseUgx:Number(f.get("otherExpenseUgx")||0),
          managerFloatUsedUgx:Number(f.get("managerFloatUsedUgx")||0),
          notes: f.get("notes") || undefined,
        }),
      });
      el.reset();
      setForm("");
      setTab("sorting");
      setNotice("Sorting recorded. The rest of the material stays in stock.");
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not record sorting");
    } finally {
      setSaving(false);
    }
  }
  async function submitReversal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reversingEntry) return;
    try {
      setSaving(true);
      setError("");
      const result = await apiRequest<{ message: string }>(`/api/waste/recycling/sorting/${reversingEntry.id}/reverse`, { method: "POST", body: JSON.stringify({ reason: new FormData(e.currentTarget).get("reason") }) });
      setReversingEntry(null);
      setNotice(result.message);
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not reverse the sorting");
    } finally {
      setSaving(false);
    }
  }
  async function submitAdjustment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      f = new FormData(el);
    try {
      setSaving(true);
      setError("");
      await apiRequest("/api/waste/recycling/stock-adjustments", {
        method: "POST",
        body: JSON.stringify({
          lotId: f.get("lotId"),
          adjustmentDate: f.get("adjustmentDate"),
          adjustmentType: f.get("adjustmentType"),
          quantityKg: Number(f.get("quantityKg")),
          reason: f.get("reason"),
          notes: f.get("notes") || undefined,
        }),
      });
      el.reset();
      setForm("");
      setTab("stock");
      setNotice("Stock adjustment recorded with an audit trail.");
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not adjust stock");
    } finally {
      setSaving(false);
    }
  }
  async function submitPartner(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      f = new FormData(el);
    try {
      setSaving(true);
      setError("");
      await apiRequest(editingPartnerId ? `/api/waste/recycling/partners/${editingPartnerId}` : "/api/waste/recycling/partners", {
        method: editingPartnerId ? "PATCH" : "POST",
        body: JSON.stringify({
          partnerType: f.get("partnerType"),
          name: f.get("name"),
          contactPerson: f.get("contactPerson") || undefined,
          phone: f.get("phone") || undefined,
          email: f.get("email") || undefined,
          address: f.get("address") || undefined,
          taxNumber: f.get("taxNumber") || undefined,
        }),
      });
      el.reset();
      setForm("");
      setEditingPartnerId("");
      setTab("partners");
      setNotice(editingPartnerId ? "Trade partner details updated." : "Trade partner saved.");
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not save trade partner");
    } finally {
      setSaving(false);
    }
  }
  async function submitMaterial(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget, f = new FormData(el);
    try {
      setSaving(true);
      setError("");
      await apiRequest("/api/waste/recycling/materials", {
        method: "POST",
        body: JSON.stringify({ name: f.get("name"), category: f.get("category") }),
      });
      el.reset();
      setForm("");
      setTab("stock");
      setNotice("Material added to your company catalogue.");
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not add material");
    } finally {
      setSaving(false);
    }
  }
  async function toggleMaterial(material: MaterialCatalogItem) {
    try {
      setSaving(true);
      setError("");
      await apiRequest(`/api/waste/recycling/materials/${material.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ active: !material.active }),
      });
      setNotice(`Material ${material.active ? "deactivated" : "activated"}. Existing records were not changed.`);
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not update material");
    } finally {
      setSaving(false);
    }
  }
  async function togglePartner(partner: Partner) {
    try {
      setSaving(true);
      await apiRequest(`/api/waste/recycling/partners/${partner.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ active: !partner.active }),
      });
      setNotice(
        `Trade partner ${partner.active ? "deactivated" : "activated"}.`,
      );
      await load();
    } catch (x) {
      setError(
        x instanceof Error ? x.message : "Could not update trade partner",
      );
    } finally {
      setSaving(false);
    }
  }
  async function submitPayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      f = new FormData(el);
    try {
      setSaving(true);
      setError("");
      await apiRequest(`/api/waste/recycling/sales/${selectedSaleId}/paid`, {
        method: "PATCH",
        body: JSON.stringify({
          paymentReceivedOn: f.get("paymentReceivedOn"),
          paymentReference: f.get("paymentReference"),
          amountUgx: Number(f.get("amountUgx")),
        }),
      });
      el.reset();
      setForm("");
      setSelectedSaleId("");
      setNotice("Sale payment and reference recorded.");
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not update sale");
    } finally {
      setSaving(false);
    }
  }
  async function submitPurchasePayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      f = new FormData(el);
    try {
      setSaving(true);
      setError("");
      await apiRequest(`/api/waste/recycling/lots/${selectedPurchaseId}/paid`, {
        method: "PATCH",
        body: JSON.stringify({
          paymentReceivedOn: f.get("paymentReceivedOn"),
          paymentReference: f.get("paymentReference"),
          amountUgx: Number(f.get("amountUgx")),
        }),
      });
      el.reset();
      setForm("");
      setSelectedPurchaseId("");
      setNotice("Supplier payment and reference recorded.");
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not update purchase");
    } finally {
      setSaving(false);
    }
  }
  async function submitDueDate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      purchase = form === "purchaseDue",
      id = purchase ? selectedPurchaseId : selectedSaleId;
    try {
      setSaving(true);
      setError("");
      await apiRequest(
        `/api/waste/recycling/${purchase ? "lots" : "sales"}/${id}/due-date`,
        { method: "PATCH", body: JSON.stringify({ dueOn: f.get("dueOn") }) },
      );
      setForm("");
      setSelectedPurchaseId("");
      setSelectedSaleId("");
      setNotice(`${purchase ? "Supplier" : "Customer"} payment deadline updated.`);
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not update payment deadline");
    } finally {
      setSaving(false);
    }
  }
  async function submitFollowUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget, f = new FormData(el);
    try {
      setSaving(true);
      setError("");
      await apiRequest(`/api/waste/recycling/sales/${selectedSaleId}/follow-ups`, {
        method: "POST",
        body: JSON.stringify({
          contactMethod: f.get("contactMethod"),
          outcome: f.get("outcome"),
          note: f.get("note"),
          nextFollowUpOn: f.get("nextFollowUpOn") || undefined,
        }),
      });
      el.reset();
      setForm("");
      setSelectedSaleId("");
      setNotice("Payment follow-up recorded.");
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not record payment follow-up");
    } finally {
      setSaving(false);
    }
  }
  async function submitDailyClose(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget, f = new FormData(el);
    try {
      setSaving(true); setError("");
      await apiRequest("/api/waste/recycling/daily-closures", { method: "POST", body: JSON.stringify({
        operatingDate: data?.operations.operatingDate,
        countedOfficeCashUgx: Number(f.get("countedOfficeCashUgx")),
        countedManagerFloatUgx: Number(f.get("countedManagerFloatUgx")),
        allDevicesSynced: f.get("allDevicesSynced") === "on",
        notes: f.get("notes") || undefined,
      }) });
      el.reset(); setForm(""); setNotice("Business day closed. Its operational totals are now fixed."); await load();
    } catch (x) { setError(x instanceof Error ? x.message : "Could not close business day"); }
    finally { setSaving(false); }
  }
  async function submitDailyReopen(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el=e.currentTarget,f=new FormData(el),id=data?.operations.currentClosure?.id;
    if(!id)return;
    try {
      setSaving(true); setError("");
      await apiRequest(`/api/waste/recycling/daily-closures/${id}/reopen`,{method:"PATCH",body:JSON.stringify({reason:f.get("reason")})});
      el.reset();setForm("");setNotice("Business day reopened. Corrections can now be recorded.");await load();
    } catch(x){setError(x instanceof Error?x.message:"Could not reopen business day");}
    finally{setSaving(false);}
  }
  function exportRecords() {
    if (!data) return;
    const rows = [
      [
        "Record type",
        "Date",
        "Material",
        "Partner",
        "Quantity kg",
        "Amount UGX",
        "Status / reference",
      ],
      ...data.lots
        .filter((x) => x.origin === "purchase")
        .map((x) => [
          "Purchase",
          x.collected_on,
          x.material_type,
          x.source_name,
          x.quantity_kg,
          x.total_cost_ugx,
          x.purchase_payment_status,
        ]),
      ...data.sortingBatches.map((x) => [
        "Sorting",
        x.processed_on,
        `${x.input_material_type} to ${x.output_material}`,
        "",
        x.output_kg,
        x.processing_cost_ugx,
        `${x.rejected_kg} kg rejected`,
      ]),
      ...data.sales.map((x) => [
        "Sale",
        x.sold_on,
        x.material_type,
        x.buyer_name,
        x.quantity_kg,
        x.total_ugx,
        x.payment_reference || x.status,
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    link.download = `ecotrade-records-${today()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  const recycling = data?.organization.type === "recycling_company",
    tabs = ([
      ["insights", "Business summary"],
      ["partners", "Trade partners"],
      ["purchases", "Purchases"],
      ["sorting", "Sorting & grading"],
      ["stock", "Material stock"],
      ["sales", "Industrial sales"],
      ["float", "Finance & accounting"],
      ["history", "Corrections history"],
    ] as const).filter(([id]) => !workerMode || (fieldManagerMode ? ["insights", "partners", "purchases", "sorting", "stock", "sales", "float", "history"].includes(id) : collectorMode ? ["purchases", "sales"].includes(id) : ["partners", "stock", "sales"].includes(id))),
    tabHelp: Record<(typeof tabs)[number][0], string> = {
      insights: "Today’s priorities, material flow and business performance.",
      partners: "Suppliers and buyers, contacts and outstanding balances.",
      purchases: "Material received, supplier costs and purchase payments.",
      sorting: "Processing batches, recovery, rejected weight and processing cost.",
      stock: "Available quantities, inventory value and verified adjustments.",
      sales: "Dispatches, invoices, customer payments and follow-up.",
      float: "Office cash, field float, obligations and profit.",
      history: "Permanent audit trail of authorized transaction corrections.",
    },
    activeTabLabel = tabs.find(([id]) => id === tab)?.[1] ?? "Workspace";
  return (
    <AppShell>
      <div className="mx-auto max-w-[1500px]">
        <PageHeader
          eyebrow="Recycling company operations"
          title="Recycling operations"
          description={fieldManagerMode ? "Run purchasing, processing, stock, trade partners, sales, field finance and the daily operations team from one connected workspace." : collectorMode ? "Record material bought each day and any approved sale to a local buyer." : salesMode ? "Manage saleable stock, industrial buyers, dispatches, invoices and payment follow-up." : "Track manager float, purchases, sorting, industrial sales, expenses and profit in one connected workflow."}
          action={
            recycling ? (
              <div className="relative flex gap-2">
                {!limitedWorkerMode && <button
                  onClick={exportRecords}
                  className="border border-slate-400 px-4 py-2.5 text-sm font-semibold"
                >
                  Export records
                </button>}
                <button
                  onClick={() => setActionMenu((open) => !open)}
                  aria-expanded={actionMenu}
                  className="bg-[var(--color-action)] px-5 py-2.5 text-sm font-semibold text-white"
                >
                  + New transaction
                </button>
                {actionMenu && (
                  <div className="absolute right-0 top-12 z-30 w-80 border border-slate-200 bg-white p-2 text-left shadow-xl">
                    {[
                      [
                        "purchase",
                        "Record material purchase",
                        "Buy and receive material into stock",
                      ],
                      [
                        "sorting",
                        "Record sorting & grading",
                        "Convert purchased material into saleable grades",
                      ],
                      [
                        "adjustment",
                        "Adjust material stock",
                        "Record loss, damage, or a verified count correction",
                      ],
                      [
                        "sale",
                        "Record industrial sale",
                        "Sell available material to an industry",
                      ],
                      [
                        "float",
                        "Update manager float",
                        "Issue, use or return accountable field cash",
                      ],
                      [
                        "cash",
                        "Post cash movement",
                        "Record referenced business cash in or cash out",
                      ],
                      [
                        "partner",
                        "Add trade partner",
                        "Save a supplier or industrial buyer",
                      ],
                      [
                        "material",
                        "Add material type",
                        "Extend the company material catalogue",
                      ],
                    ].filter(([kind]) => !workerMode || (fieldManagerMode ? ["purchase", "sorting", "adjustment", "sale", "float", "partner", "material"].includes(kind) : collectorMode ? ["purchase", "sale"].includes(kind) : ["sale", "partner"].includes(kind))).map(([kind, title, description]) => {
                      const disabled =
                        kind === "sorting"
                          ? !data?.lots.some(
                              (x) =>
                                x.origin === "purchase" &&
                                Number(x.available_kg) > 0,
                            )
                          : kind === "adjustment"
                            ? !data?.lots.length
                            : kind === "sale"
                            ? !data?.lots.some(
                                (x) => Number(x.available_kg) > 0,
                              )
                            : false;
                      return (
                        <button
                          key={kind}
                          disabled={disabled}
                          onClick={() => openForm(kind as FormKind)}
                          className="block w-full px-3 py-3 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span className="block text-sm font-semibold text-slate-900">
                            {title}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : undefined
          }
        />
        {error && <Feedback tone="error">{error}</Feedback>}
        {notice && <Feedback tone="success">{notice}</Feedback>}
        {data && !recycling && (
          <Feedback tone="warning">
            This workspace is only available to approved recycling companies.
          </Feedback>
        )}
        {data && recycling && (
          <>
            <nav className="sticky top-0 z-20 mt-5 border border-slate-200 bg-white shadow-sm" aria-label="Recycling workspace sections">
              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
                {tabs.map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => {
                      setTab(id);
                      setError("");
                      setNotice("");
                    }}
                    aria-current={tab === id ? "page" : undefined}
                    className={`min-h-12 border-b border-r border-slate-100 px-3 py-2 text-left text-sm font-semibold transition-colors xl:text-center ${tab === id ? "bg-[var(--color-action)] text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{activeTabLabel}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{tabHelp[tab]}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tab === "purchases" && <button onClick={() => openForm("purchase")} className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white">Record purchase</button>}
                  {tab === "sorting" && <button disabled={!data.lots.some((item) => item.origin === "purchase" && Number(item.available_kg) > 0)} onClick={() => openForm("sorting")} className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Record sorting</button>}
                  {tab === "partners" && <button onClick={() => openForm("partner")} className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white">Add trade partner</button>}
                  {tab === "stock" && <button onClick={() => openForm("material")} className="border border-[var(--color-action)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-action)]">Add material type</button>}
                  {tab === "float" && <button onClick={() => openForm("float")} className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white">Record float movement</button>}
                </div>
              </div>
            </nav>
            {workerMode && (limitedWorkerMode || tab === "insights") && <section className="mt-5 border-l-2 border-[var(--color-action)] bg-blue-50 p-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--color-action)]">Your responsibility</p><h2 className="mt-1 text-xl font-semibold">{fieldManagerMode ? "Field operations supervision" : collectorMode ? "Daily collection and purchasing" : "Industrial sales and buyer management"}</h2></div>
                <label className="text-xs font-semibold text-slate-600">Activity date<input type="date" value={activityDate} max={data.operations.operatingDate} onChange={(event) => setActivityDate(event.target.value)} className="mt-1 block border border-blue-200 bg-white px-3 py-2 text-sm text-slate-900" /></label>
              </div>
              <p className="mt-2 text-sm text-slate-600">{fieldManagerMode ? "Run purchasing, processing, stock, sales and field finance from one workspace." : collectorMode ? "Record every material purchase with its real kilograms, material type, supplier, price, and date." : "Manage saleable stock, industrial buyers, dispatches and payment follow-up."}</p>
              <div className="mt-3 grid gap-px bg-blue-200 sm:grid-cols-4">{(fieldManagerMode?[["Purchases",selectedActivity.purchases],["Kg received",`${Number(selectedActivity.purchasedKg).toLocaleString()} kg`],["Available stock",`${Number(data.summary.availableKg).toLocaleString()} kg`],["Selected date",activityDate ? new Date(`${activityDate}T00:00:00`).toLocaleDateString("en-GB") : "—"]]:collectorMode?[["Purchases",selectedActivity.purchases],["Kg bought",`${Number(selectedActivity.purchasedKg).toLocaleString()} kg`],["Local sales",selectedActivity.sales],["Kg sold",`${Number(selectedActivity.soldKg).toLocaleString()} kg`]]:[["Sales",selectedActivity.sales],["Kg dispatched",`${Number(selectedActivity.soldKg).toLocaleString()} kg`],["Sales value",money(selectedActivity.saleValueUgx)],["Selected date",activityDate ? new Date(`${activityDate}T00:00:00`).toLocaleDateString("en-GB") : "—"]]).map(([label,value])=><div key={label} className="bg-white px-3 py-2.5"><p className="text-xs text-slate-500">{label}</p><p className="mt-0.5 font-semibold">{value}</p></div>)}</div>
            </section>}
            {limitedWorkerMode && data.operations.isClosed && <Feedback tone="warning">Today’s business day is closed. You can review records, but new transactions dated today require an operations manager or company administrator to reopen the day.</Feedback>}
            <section className={`${limitedWorkerMode || tab !== "insights" ? "hidden" : "mt-5"} border border-slate-200 bg-slate-50 p-5`}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--color-action)]">
                    Daily workflow
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">
                    Move material from receiving to dispatch
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Follow the physical material flow from left to right. Finance
                    follow-up is managed separately below.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {data.operations.isClosed ? (
                    <>
                      <span className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Day closed ✓</span>
                      {(companyAdminMode || fieldManagerMode) && <button onClick={() => openForm("dailyReopen")} className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[var(--color-action)]">Reopen day</button>}
                    </>
                  ) : (
                    <button onClick={() => openForm("dailyClose")} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white">Close business day</button>
                  )}
                </div>
              </div>
              {data.operations.isClosed && <div className="mt-4 border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-900"><strong className="block">Transactions dated {new Date(`${data.operations.operatingDate}T00:00:00`).toLocaleDateString("en-GB")} are locked.</strong><span className="mt-1 block">Closed by {data.operations.currentClosure?.closed_by_name || "an authorized manager"}{data.operations.currentClosure?.closed_at ? ` at ${new Date(data.operations.currentClosure.closed_at).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})}` : ""}. The recorded summary will not change unless an authorized manager reopens the day.</span></div>}
              <div className="mt-5 grid gap-px bg-slate-200 md:grid-cols-4">
                {[
                  {
                    step: "01",
                    title: "Buy material",
                    detail: `${data.summary.lots} purchase${data.summary.lots === 1 ? "" : "s"} recorded`,
                    action: "Record purchase",
                    form: "purchase" as FormKind,
                    disabled: false,
                  },
                  {
                    step: "02",
                    title: "Sort & grade",
                    detail: `${data.summary.sortedOutputKg.toLocaleString()} kg saleable output`,
                    action: "Record sorting",
                    form: "sorting" as FormKind,
                    disabled: !data.lots.some(
                      (x) =>
                        x.origin === "purchase" && Number(x.available_kg) > 0,
                    ),
                  },
                  {
                    step: "03",
                    title: "Sell to industry",
                    detail: `${data.summary.soldKg.toLocaleString()} kg sold`,
                    action: "Record sale",
                    form: "sale" as FormKind,
                    disabled: !data.lots.some(
                      (x) => Number(x.available_kg) > 0,
                    ),
                  },
                  {
                    step: "04",
                    title: "Dispatch to buyer",
                    detail: `${data.operations.soldTodayKg.toLocaleString()} kg dispatched today`,
                    action: "Review dispatches",
                    tab: "sales" as const,
                    disabled: false,
                  },
                ].map((item) => (
                  <div key={item.step} className="bg-white p-4">
                    <p className="text-xs font-semibold text-[var(--color-accent)]">
                      STEP {item.step}
                    </p>
                    <h3 className="mt-2 font-semibold">{item.title}</h3>
                    <p className="mt-1 min-h-10 text-sm text-slate-500">
                      {item.detail}
                    </p>
                    <button
                      disabled={item.disabled}
                      onClick={() =>
                        "form" in item && item.form
                          ? openForm(item.form)
                          : setTab("sales")
                      }
                      className="mt-3 text-sm font-semibold text-[var(--color-action)] disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      {item.disabled ? "Complete previous step" : item.action} →
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <section className={`${limitedWorkerMode || tab !== "insights" ? "hidden" : "mt-5"} grid border-y border-slate-300 sm:grid-cols-2 lg:grid-cols-5`}>
              {[
                [
                  "Purchased",
                  `${data.summary.purchasedKg.toLocaleString()} kg`,
                ],
                [
                  "Available stock",
                  `${data.summary.availableKg.toLocaleString()} kg`,
                ],
                ["Purchase cost", money(data.summary.purchaseCostUgx)],
                ["Sales income", money(data.summary.revenueUgx)],
                ["Profit / loss", money(data.summary.profitLossUgx)],
              ].map(([a, b]) => (
                <div
                  key={a}
                  className="border-b py-5 pr-4 sm:border-r lg:border-b-0"
                >
                  <p className="text-xs font-semibold text-slate-500">{a}</p>
                  <p
                    className={`mt-1 text-xl font-semibold ${a === "Profit / loss" && data.summary.profitLossUgx < 0 ? "text-red-700" : ""}`}
                  >
                    {b}
                  </p>
                </div>
              ))}
            </section>
            {!limitedWorkerMode && tab === "insights" && (data.summary.overdueReceivablesUgx > 0 ||
              data.summary.overduePayablesUgx > 0 ||
              data.summary.dueSoonReceivablesUgx > 0 ||
              data.summary.dueSoonPayablesUgx > 0) && (
              <section className="mt-5 grid gap-3 md:grid-cols-2" aria-label="Payment deadlines">
                <button onClick={() => setTab("sales")} className="border-l-2 border-red-600 bg-red-50 p-4 text-left text-sm">
                  <strong>Customer payments:</strong> {money(data.summary.overdueReceivablesUgx)} overdue · {money(data.summary.dueSoonReceivablesUgx)} due within 7 days
                  <span className="mt-1 block font-semibold text-[var(--color-action)]">Review industrial sales →</span>
                </button>
                <button onClick={() => setTab("purchases")} className="border-l-2 border-[var(--color-accent)] bg-amber-50 p-4 text-left text-sm">
                  <strong>Supplier payments:</strong> {money(data.summary.overduePayablesUgx)} overdue · {money(data.summary.dueSoonPayablesUgx)} due within 7 days
                  <span className="mt-1 block font-semibold text-[var(--color-action)]">Review credit purchases →</span>
                </button>
              </section>
            )}
            {!limitedWorkerMode && tab === "insights" && <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between border-l-2 border-[var(--color-accent)] bg-amber-50 p-4 text-sm">
                <span>
                  <strong>Manager float:</strong>{" "}
                  {money(data.summary.floatBalanceUgx)}
                </span>
                <button
                  onClick={() => setForm("float")}
                  className="font-semibold text-[var(--color-action)]"
                >
                  Record movement
                </button>
              </div>
              <div className="border-l-2 border-[var(--color-action)] bg-blue-50 p-4 text-sm">
                <strong>Processing cost:</strong>{" "}
                {money(data.summary.processingCostUgx)} · included in
                profit/loss
              </div>
            </div>}
            {tab === "insights" && (
              <div className="mt-6 space-y-7">
                <section>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--color-action)]">Today&apos;s operations</p>
                      <h2 className="mt-1 text-xl font-semibold">Material movement and work queue</h2>
                      <p className="mt-1 text-sm text-slate-500">A daily view of material received, processed, ready, and dispatched.</p>
                    </div>
                    <span className="text-sm font-semibold text-slate-500">{new Date(`${data.operations.operatingDate}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</span>
                  </div>
                  <div className="mt-4 grid border-y border-slate-300 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ["Received today", `${data.operations.receivedTodayKg.toLocaleString()} kg`],
                      ["Sorted today", `${data.operations.sortedTodayKg.toLocaleString()} kg`],
                      ["Dispatched today", `${data.operations.soldTodayKg.toLocaleString()} kg`],
                      ["Stock lots ready", data.operations.stockLotsReady.toLocaleString()],
                    ].map(([label, value]) => <div key={label} className="border-b py-4 pr-4 sm:border-r lg:border-b-0"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}
                  </div>
                  <div className="mt-5 grid gap-6 lg:grid-cols-[1.4fr_.6fr]">
                    <div>
                      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Materials awaiting processing</h3><button onClick={() => openForm("sorting")} disabled={!data.operations.workQueue.length} className="text-sm font-semibold text-[var(--color-action)] disabled:text-slate-400">Record sorting →</button></div>
                      {data.operations.workQueue.length ? <div className="mt-2 divide-y border-y text-sm">{data.operations.workQueue.map(item => <div key={item.lotId} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="font-semibold">{item.materialType}</p><p className="text-xs text-slate-500">{item.sourceName} · received {new Date(item.receivedOn).toLocaleDateString("en-GB")} · {item.quality}</p></div><p className="font-semibold">{item.availableKg.toLocaleString()} kg available</p></div>)}</div> : <p className="mt-2 border-y py-5 text-sm text-slate-500">No purchased material is waiting. Record the next material purchase when it arrives.</p>}
                    </div>
                    <div className="border border-slate-200 p-4">
                      <h3 className="font-semibold">Stock position</h3>
                      <div className="mt-3 divide-y text-sm"><div className="flex justify-between py-3"><span>Incoming / unsorted</span><strong>{data.operations.awaitingSortingKg.toLocaleString()} kg</strong></div><div className="flex justify-between py-3"><span>Sorted saleable stock</span><strong>{data.operations.saleableStockKg.toLocaleString()} kg</strong></div></div>
                      <button onClick={() => setTab("stock")} className="mt-3 text-sm font-semibold text-[var(--color-action)]">Open material stock →</button>
                    </div>
                  </div>
                </section>
                {!limitedWorkerMode && <section>
                  <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-6">
                    <div>
                      <h2 className="text-xl font-semibold">Material catalogue</h2>
                      <p className="mt-1 text-sm text-slate-500">The same controlled material names are used when receiving, sorting, reporting, and selling stock.</p>
                    </div>
                    <button onClick={() => openForm("material")} className="border border-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-[var(--color-action)]">Add material type</button>
                  </div>
                  <div className="mt-4 grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
                    {data.materials.map((material) => (
                      <div key={material.id} className="flex items-center justify-between gap-3 bg-white p-4">
                        <div><p className="font-semibold">{material.name}</p><p className="text-xs capitalize text-slate-500">{material.category} · {material.active ? "Active" : "Inactive"}</p></div>
                        <button disabled={saving} onClick={() => void toggleMaterial(material)} className="text-xs font-semibold text-[var(--color-action)]">{material.active ? "Deactivate" : "Activate"}</button>
                      </div>
                    ))}
                  </div>
                </section>}
                <section>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--color-action)]">Payment control</p>
                  <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">What must be collected or paid next</h2>
                      <p className="mt-1 text-sm text-slate-500">Balances are grouped by days past their payment deadline.</p>
                    </div>
                    <button onClick={() => setTab("sales")} className="text-sm font-semibold text-[var(--color-action)]">Open industrial sales →</button>
                  </div>
                  <div className="mt-4 grid gap-5 lg:grid-cols-2">
                    {([
                      ["Customer receivables", data.paymentAging.receivables, "Collect from industrial buyers"],
                      ["Supplier payables", data.paymentAging.payables, "Pay credit material purchases"],
                    ] as const).map(([title, aging, help]) => (
                      <div key={title} className="border border-slate-200 p-4">
                        <h3 className="font-semibold">{title}</h3>
                        <p className="mt-1 text-xs text-slate-500">{help}</p>
                        <div className="mt-4 grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
                          {[["Current",aging.current],["1–30 days",aging.days1To30],["31–60 days",aging.days31To60],["60+ days",aging.days61Plus]].map(([label,value]) => (
                            <div key={label} className="bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 font-semibold ${label === "60+ days" && Number(value) > 0 ? "text-red-700" : ""}`}>{money(value)}</p></div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    <div>
                      <h3 className="font-semibold">Outstanding by buyer</h3>
                      {data.buyerExposure.length ? <div className="mt-2 divide-y border-y text-sm">{data.buyerExposure.slice(0,5).map(x=><div key={x.buyerName} className="flex justify-between gap-4 py-3"><span>{x.buyerName}</span><strong>{money(x.amountUgx)}</strong></div>)}</div>:<p className="mt-2 border-y py-5 text-sm text-slate-500">No unpaid industrial sales.</p>}
                    </div>
                    <div>
                      <h3 className="font-semibold">Scheduled follow-ups</h3>
                      {data.upcomingFollowUps.length ? <div className="mt-2 divide-y border-y text-sm">{data.upcomingFollowUps.slice(0,5).map(x=><button key={x.saleId} onClick={()=>setTab("sales")} className="flex w-full items-center justify-between gap-4 py-3 text-left"><span><strong>{x.buyerName}</strong><span className="block text-xs text-slate-500">{x.invoiceNumber||"No invoice number"} · {new Date(x.nextFollowUpOn).toLocaleDateString("en-GB")}</span></span><span className="font-semibold text-[var(--color-action)]">{money(x.amountUgx)} →</span></button>)}</div>:<p className="mt-2 border-y py-5 text-sm text-slate-500">No payment follow-ups scheduled.</p>}
                    </div>
                  </div>
                </section>
                <section>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--color-action)]">
                    Material recovery
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">
                    Sorting performance
                  </h2>
                  <div className="mt-3 grid border-y border-slate-300 sm:grid-cols-4">
                    {[
                      [
                        "Input sorted",
                        `${data.summary.sortedInputKg.toLocaleString()} kg`,
                      ],
                      [
                        "Saleable output",
                        `${data.summary.sortedOutputKg.toLocaleString()} kg`,
                      ],
                      [
                        "Rejected",
                        `${data.summary.rejectedKg.toLocaleString()} kg`,
                      ],
                      [
                        "Recovery rate",
                        `${data.summary.recoveryRate.toLocaleString()}%`,
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="border-b py-4 pr-3 sm:border-r"
                      >
                        <p className="text-xs font-semibold text-slate-500">
                          {label}
                        </p>
                        <p className="mt-1 text-lg font-semibold">{value}</p>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="grid gap-6 lg:grid-cols-[1.45fr_.75fr]">
                  <div>
                    <h2 className="text-xl font-semibold">
                      Performance by material
                    </h2>
                    {data.materialPerformance.length ? (
                      <div className="table-wrap mt-3">
                        <table>
                          <thead>
                            <tr>
                              <th>Material</th>
                              <th>Purchased</th>
                              <th>Sorted output</th>
                              <th>Available</th>
                              <th>Sold</th>
                              <th>Revenue</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.materialPerformance.map((item) => (
                              <tr key={item.materialType}>
                                <td className="table-primary">
                                  {item.materialType}
                                </td>
                                <td>{item.purchasedKg.toLocaleString()} kg</td>
                                <td>{item.sortedKg.toLocaleString()} kg</td>
                                <td className="font-semibold">
                                  {item.availableKg.toLocaleString()} kg
                                </td>
                                <td>{item.soldKg.toLocaleString()} kg</td>
                                <td>{money(item.revenueUgx)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState
                        title="No material activity"
                        description="Performance appears after purchases, sorting or sales are recorded."
                      />
                    )}
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold">Cash position</h2>
                    <div className="mt-3 divide-y border-y border-slate-300 text-sm">
                      {[
                        ["Sales revenue", data.summary.revenueUgx],
                        ["Unpaid sales", data.summary.unpaidSalesUgx],
                        ["Credit purchases", data.summary.creditPurchasesUgx],
                        ["Total purchase cost", data.summary.purchaseCostUgx],
                        ["Processing cost", data.summary.processingCostUgx],
                        ["Selling expenses", data.summary.saleExpensesUgx],
                        ["Operating expenses", data.summary.operatingExpensesUgx],
                        ["Stock losses", data.summary.stockLossUgx],
                        ["Manager float", data.summary.floatBalanceUgx],
                        ["Profit / loss", data.summary.profitLossUgx],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="flex items-center justify-between gap-4 py-3"
                        >
                          <span className="text-slate-600">{label}</span>
                          <strong
                            className={
                              label === "Profit / loss" && Number(value) < 0
                                ? "text-red-700"
                                : ""
                            }
                          >
                            {money(value)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
                <section>
                  <h2 className="text-xl font-semibold">Expense breakdown</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Every operating cost recorded across buying, processing and
                    selling.
                  </p>
                  <div className="mt-3 grid border-y border-slate-300 sm:grid-cols-2 lg:grid-cols-4">
                    {Object.entries({
                      "Material purchases":
                        data.expenseBreakdown.materialPurchasesUgx,
                      "Purchase wages": data.expenseBreakdown.purchaseWagesUgx,
                      "Purchase food": data.expenseBreakdown.purchaseFoodUgx,
                      "Purchase transport":
                        data.expenseBreakdown.purchaseTransportUgx,
                      "Driver fees": data.expenseBreakdown.driverFeesUgx,
                      "Purchase other": data.expenseBreakdown.purchaseOtherUgx,
                      "Sorting / processing":
                        data.expenseBreakdown.processingUgx,
                      "Sale wages": data.expenseBreakdown.saleWagesUgx,
                      "Sale food": data.expenseBreakdown.saleFoodUgx,
                      "Sale transport": data.expenseBreakdown.saleTransportUgx,
                      "Sale other": data.expenseBreakdown.saleOtherUgx,
                    }).map(([label, value]) => (
                      <div
                        key={label}
                        className="border-b py-4 pr-3 sm:border-r"
                      >
                        <p className="text-xs text-slate-500">{label}</p>
                        <p className="mt-1 font-semibold">{money(value)}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
            {tab === "partners" &&
              (data.partners.length ? (
                <div className="table-wrap mt-5">
                  <table>
                    <thead>
                      <tr>
                        <th>Partner</th>
                        <th>Role</th>
                        <th>Contact</th>
                        <th>Business activity</th>
                        <th>Outstanding</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partnersPage.paged.map((partner) => (
                        <tr key={partner.id}>
                          <td>
                            <p className="table-primary">{partner.name}</p>
                            <p className="table-secondary">
                              {partner.address || "No address recorded"}
                            </p>
                          </td>
                          <td className="capitalize">{partner.partner_type}</td>
                          <td>
                            <p>{partner.contact_person || "—"}</p>
                            <p className="table-secondary">
                              {[partner.phone, partner.email]
                                .filter(Boolean)
                                .join(" · ") || "No contact recorded"}
                            </p>
                          </td>
                          <td>
                            <p>{data.lots.filter((item) => item.origin === "purchase" && item.supplier_partner_id === partner.id).length} purchases</p>
                            <p className="table-secondary">{data.sales.filter((item) => item.buyer_partner_id === partner.id).length} sales</p>
                          </td>
                          <td>
                            <p>{money(data.lots.filter((item) => item.origin === "purchase" && item.supplier_partner_id === partner.id).reduce((sum, item) => sum + Number(item.balance_ugx), 0))}</p>
                            <p className="table-secondary">payable</p>
                            <p className="mt-1">{money(data.sales.filter((item) => item.buyer_partner_id === partner.id).reduce((sum, item) => sum + Number(item.balance_ugx), 0))}</p>
                            <p className="table-secondary">receivable</p>
                          </td>
                          <td>
                            <Status
                              value={partner.active ? "active" : "inactive"}
                            />
                          </td>
                          <td>
                            <div className="flex flex-wrap gap-3">
                              <button
                                onClick={() => { setSelectedPartnerId(partner.id); setForm("partnerLedger"); }}
                                className="text-sm font-semibold text-[var(--color-action)]"
                              >
                                View ledger
                              </button>
                              <button
                                onClick={() => { setEditingPartnerId(partner.id); setForm("partner"); }}
                                className="text-sm font-semibold text-[var(--color-action)]"
                              >
                                Edit
                              </button>
                              <button
                                disabled={saving}
                                onClick={() => void togglePartner(partner)}
                                className="text-sm font-semibold text-[var(--color-action)]"
                              >
                                {partner.active ? "Deactivate" : "Activate"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table><Pager of={partnersPage}/>
                </div>
              ) : (
                <EmptyState
                  title="No trade partners"
                  description="Save regular material suppliers and industrial buyers so transactions remain consistent and traceable."
                  action={
                    <button
                      onClick={() => setForm("partner")}
                      className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white"
                    >
                      Add first partner
                    </button>
                  }
                />
              ))}
            {tab === "history" && companyAdminMode && (
              <div className="mt-5">
                <CorrectionsPanel
                  stock={Object.values(data.lots.reduce<Record<string, { material: string; availableKg: number }>>((all, lot) => { const item = all[lot.material_type] ?? { material: lot.material_type, availableKg: 0 }; item.availableKg = Math.round((item.availableKg + Number(lot.available_kg)) * 1000) / 1000; all[lot.material_type] = item; return all; }, {})).sort((a, b) => a.material.localeCompare(b.material))}
                  materials={data.materials.filter((m) => m.active !== false).map((m) => m.name).sort((a, b) => a.localeCompare(b))}
                  today={data.operations.operatingDate}
                  officeCashUgx={data.summary.officeCashUgx}
                  floatBalanceUgx={data.summary.floatBalanceUgx}
                  onDone={(message) => { setNotice(message); void load(); }}
                />
              </div>
            )}
            {tab === "history" &&
              ((data.transactionEdits ?? []).length ? (
                <div className="mt-5 space-y-4">
                  <div className="border-l-2 border-[var(--color-action)] bg-blue-50 p-4 text-sm text-slate-700">
                    Every correction is kept here: purchase and sale edits, reversed sorting, material moves, cash corrections and cancelled entries. Original and corrected values remain visible for accountability; closed operating days must be reopened before a correction.
                  </div>
                  {editsPage.paged.map((edit) => {
                    if (isCorrection(edit)) return <CorrectionRecord key={edit.id} edit={edit as CorrectionEdit} canUndo={companyAdminMode && !data.transactionEdits.some((other) => other.transaction_type === "material_transfer_reversal" && other.transaction_id === edit.transaction_id)} onDone={(message) => { setNotice(message); void load(); }} />;
                    const changes = auditChanges(edit);
                    return (
                      <article key={edit.id} className="border border-slate-200 bg-white p-4 sm:p-5">
                        <div className="flex flex-col justify-between gap-2 border-b border-slate-200 pb-3 sm:flex-row sm:items-start">
                          <div>
                            <p className="font-semibold capitalize">{edit.transaction_type} corrected</p>
                            <p className="mt-1 text-xs text-slate-500">Record {edit.transaction_id.slice(0, 8).toUpperCase()}</p>
                          </div>
                          <div className="text-sm text-slate-600 sm:text-right">
                            <p>{edit.edited_by_name}</p>
                            <p className="text-xs">{new Date(edit.edited_at).toLocaleString()}</p>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {changes.map((change) => (
                            <div key={change.key} className="bg-slate-50 p-3 text-sm">
                              <p className="font-semibold">{change.label}</p>
                              <p className="mt-1 text-slate-500 line-through">{auditValue(change.key, change.before)}</p>
                              <p className="mt-1 text-[var(--color-action)]">→ {auditValue(change.key, change.after)}</p>
                            </div>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                  <Pager of={editsPage}/>
                </div>
              ) : (
                <EmptyState
                  title="No transaction corrections"
                  description="When an authorized manager corrects a purchase or sale, the complete change history will appear here."
                />
              ))}
            {tab === "purchases" &&
              (visiblePurchaseLots.length ? (
                <div className="table-wrap mt-5">
                  <table>
                    <thead>
                      <tr>
                        <th>Date / material</th>
                        <th>Supplier</th>
                        <th>Recorded by</th>
                        <th>Quantity</th>
                        <th>Purchase price</th>
                        <th>Total cost</th>
                        <th>Payment</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchasesPage.paged.map((x) => (
                          <tr key={x.id}>
                            <td>
                              <p className="table-primary">
                                {new Date(x.collected_on).toLocaleDateString(
                                  "en-GB",
                                )}
                              </p>
                              <p className="table-secondary">
                                {x.material_type}
                              </p>
                            </td>
                            <td>{x.source_name}</td>
                            <td>{x.recorded_by_name || "System"}</td>
                            <td>{Number(x.quantity_kg).toLocaleString()} kg</td>
                            <td>{money(x.unit_purchase_price_ugx)}/kg</td>
                            <td className="font-semibold">
                              {money(x.total_cost_ugx)}
                              {Number(x.paid_ugx) > 0 && <p className="table-secondary font-normal">Paid {money(x.paid_ugx)} · Balance {money(x.balance_ugx)}</p>}
                            </td>
                            <td>
                              <Status value={x.purchase_payment_state} />
                              {x.purchase_due_on && x.purchase_payment_status !== "paid" && (
                                <p className="table-secondary mt-1">Due {new Date(x.purchase_due_on).toLocaleDateString("en-GB")}</p>
                              )}
                              {x.purchase_payment_reference && (
                                <p className="table-secondary mt-1">
                                  {x.purchase_payment_reference}
                                </p>
                              )}
                              {Number(x.paid_ugx) > 0 && (
                                <button onClick={() => { setSelectedPurchaseId(x.id); setForm("purchaseHistory"); }} className="mt-2 block text-xs font-semibold text-[var(--color-action)]">View payment history</button>
                              )}
                              {x.purchase_payment_status !== "paid" && !limitedWorkerMode && (
                                <div className="mt-2 flex flex-wrap gap-3">
                                  <button disabled={saving} onClick={() => { setSelectedPurchaseId(x.id); setForm("purchasePayment"); }} className="text-xs font-semibold text-[var(--color-action)]">Record payment</button>
                                  <button disabled={saving} onClick={() => { setSelectedPurchaseId(x.id); setForm("purchaseDue"); }} className="text-xs font-semibold text-[var(--color-action)]">Change due date</button>
                                </div>
                              )}
                            </td>
                            <td>
                              <Status value={x.status} />
                              {(fieldManagerMode || companyAdminMode) && <button onClick={() => { setEditingPurchaseId(x.id); setForm("purchase"); }} className="mt-2 block text-xs font-semibold text-[var(--color-action)]">Edit purchase</button>}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table><Pager of={purchasesPage}/>
                </div>
              ) : (
                <EmptyState
                  title="No material purchases"
                  description="Record each material type as a separate purchase with its supplier, weight, price and operating expenses."
                />
              ))}
            {tab === "sorting" &&
              (data.sortingBatches.length ? (
                <div className="table-wrap mt-5">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Sorted from</th>
                        <th>Taken</th>
                        <th>Sorted into</th>
                        <th>Sorted out</th>
                        <th>Waste</th>
                        <th>Processing cost</th>
                        {companyAdminMode && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {sortingPage.paged.map((x) => (
                        <tr key={x.id}>
                          <td>
                            {new Date(x.processed_on).toLocaleDateString(
                              "en-GB",
                            )}
                          </td>
                          <td>{x.input_material_type}</td>
                          <td>{Number(x.input_kg).toLocaleString()} kg</td>
                          <td className="table-primary">{x.output_material}</td>
                          <td className="font-semibold">
                            {Number(x.output_kg).toLocaleString()} kg
                          </td>
                          <td>{Number(x.rejected_kg).toLocaleString()} kg</td>
                          <td>{money(x.processing_cost_ugx)}</td>
                          {companyAdminMode && <td className="text-right"><button onClick={() => setReversingEntry(x)} className="border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">Reverse</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table><Pager of={sortingPage}/>
                </div>
              ) : (
                <EmptyState
                  title="No sorting records"
                  description="Sort a material into a saleable grade. Each record takes the sorted weight and the waste from the material; the rest stays there to sort later."
                />
              ))}
            {tab === "stock" && (
              <div className="mt-5 space-y-4">
                <section className="border border-slate-200 bg-white">
                  <div className="flex flex-col gap-4 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--color-action)]">Inventory control</p>
                      <h2 className="mt-1 text-xl font-semibold">Material stock</h2>
                      <p className="mt-1 text-sm text-slate-500">Live quantities after receiving, processing, sales and corrections.</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input aria-label="Search material stock" value={stockQuery} onChange={(event) => { setStockQuery(event.target.value); setStockPage(1); }} placeholder="Search material, supplier or quality" className="min-w-64 border border-slate-300 px-3 py-2 text-sm" />
                      <select aria-label="Filter material lots by source" value={stockOrigin} onChange={(event) => { setStockOrigin(event.target.value); setStockPage(1); }} className="border border-slate-300 bg-white px-3 py-2 text-sm">
                        <option value="all">All stock</option>
                        <option value="purchase">Purchased</option>
                        <option value="sorting_output">Processed</option>
                      </select>
                      <button disabled={!data.lots.length} onClick={() => openForm("adjustment")} className="bg-[var(--color-action)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Adjust stock</button>
                    </div>
                  </div>
                  <div className="grid gap-px bg-slate-200 sm:grid-cols-3">
                    <div className="bg-slate-50 p-3"><p className="text-xs text-slate-500">Available</p><p className="mt-1 text-lg font-semibold">{data.summary.availableKg.toLocaleString()} kg</p></div>
                    <div className="bg-slate-50 p-3"><p className="text-xs text-slate-500">Inventory value</p><p className="mt-1 text-lg font-semibold">{money(data.summary.inventoryValueUgx)}</p></div>
                    <div className="bg-slate-50 p-3"><p className="text-xs text-slate-500">Active material lots</p><p className="mt-1 text-lg font-semibold">{data.lots.filter((item) => Number(item.available_kg) > 0).length}</p></div>
                  </div>
                  {filteredStock.length ? (
                    <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Material lot</th>
                        <th>Received from</th>
                        <th>Stock remaining</th>
                        <th>Unit cost</th>
                        <th>Quality</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedStock.flatMap((x) => {
                        const remaining = x.originalKg > 0 ? Math.max(0, Math.min(100, (x.availableKg / x.originalKg) * 100)) : 0;
                        const expanded=expandedMaterial===x.material;
                        const rows=[(
                          <tr key={x.material} className="cursor-pointer" onClick={()=>setExpandedMaterial(expanded?"":x.material)}>
                            <td>
                              <p className="table-primary">{x.material}</p>
                              <p className="table-secondary">{x.lots.length} active lot{x.lots.length===1?"":"s"} · Click for movement history</p>
                            </td>
                            <td><p>{new Set(x.lots.map((lot)=>lot.source_name)).size} source{new Set(x.lots.map((lot)=>lot.source_name)).size===1?"":"s"}</p><p className="table-secondary">Purchased and processed stock combined</p></td>
                            <td className="min-w-48">
                              <div className="flex items-baseline justify-between gap-3"><span className="font-semibold">{x.availableKg.toLocaleString()} kg</span><span className="table-secondary">of {x.originalKg.toLocaleString()} kg</span></div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-[var(--color-action)]" style={{ width: `${remaining}%` }} /></div>
                            </td>
                            <td>{money(x.valueUgx)}<p className="table-secondary">estimated remaining value</p></td>
                            <td>{[...new Set(x.lots.map((lot)=>lot.quality))].join(", ")}</td>
                            <td><button type="button" className="font-semibold text-[var(--color-action)]">{expanded?"Hide details":"View details"}</button></td>
                          </tr>
                        )];
                        if(expanded)rows.push(<tr key={`${x.material}-details`}><td colSpan={6} className="!p-0"><div className="bg-slate-50 p-4"><h3 className="font-semibold">{x.material} movement history</h3><p className="mt-1 text-xs text-slate-500">Purchases, processing, sales and stock corrections that created the current balance.</p><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                          {x.lots.map((lot)=><div key={lot.id} className="border border-slate-200 bg-white p-3 text-sm"><div className="flex justify-between gap-3"><p className="font-semibold">{lot.origin==="transfer"?"Moved in (correction)":lot.origin==="sorting_output"?"Processing output":"Purchase received"}</p><span className="font-semibold text-[var(--color-action)]">+{Number(lot.quantity_kg).toLocaleString()} kg</span></div><p className="mt-1 text-xs text-slate-500">{new Date(lot.collected_on).toLocaleDateString("en-GB")} · {lot.source_name}</p><p className="mt-2">Remaining {Number(lot.available_kg).toLocaleString()} kg</p></div>)}
                          {(data?.sortingBatches??[]).filter((row)=>row.input_material_type===x.material).map((row)=><div key={`sort-${row.id}`} className="border border-slate-200 bg-white p-3 text-sm"><div className="flex justify-between gap-3"><p className="font-semibold">Sent to processing</p><span className="font-semibold text-amber-700">−{Number(row.input_kg).toLocaleString()} kg</span></div><p className="mt-1 text-xs text-slate-500">{new Date(row.processed_on).toLocaleDateString("en-GB")} · output {row.output_material}</p></div>)}
                          {(data?.sales??[]).filter((row)=>row.material_type===x.material).map((row)=><div key={`sale-${row.id}`} className="border border-slate-200 bg-white p-3 text-sm"><div className="flex justify-between gap-3"><p className="font-semibold">Sold to {row.buyer_name}</p><span className="font-semibold text-red-700">−{Number(row.quantity_kg).toLocaleString()} kg</span></div><p className="mt-1 text-xs text-slate-500">{new Date(row.sold_on).toLocaleDateString("en-GB")} · {money(row.total_ugx)}</p></div>)}
                          {(data?.stockAdjustments??[]).filter((row)=>row.material_type===x.material).map((row)=><div key={`adjust-${row.id}`} className="border border-slate-200 bg-white p-3 text-sm"><div className="flex justify-between gap-3"><p className="font-semibold">Stock correction</p><span className={`font-semibold ${row.adjustment_type==="correction_in"?"text-green-700":"text-red-700"}`}>{row.adjustment_type==="correction_in"?"+":"−"}{Number(row.quantity_kg).toLocaleString()} kg</span></div><p className="mt-1 text-xs text-slate-500">{new Date(row.adjustment_date).toLocaleDateString("en-GB")} · {row.reason}</p></div>)}
                        </div></div></td></tr>);
                        return rows;
                      })}
                    </tbody>
                  </table>
                      <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                        <p>Showing {(safeStockPage - 1) * stockPageSize + 1}–{Math.min(safeStockPage * stockPageSize, filteredStock.length)} of {filteredStock.length} active lots</p>
                        <div className="flex items-center gap-2">
                          <button className="border border-slate-300 px-3 py-1.5 font-semibold disabled:opacity-40" disabled={safeStockPage <= 1} onClick={() => setStockPage((page) => Math.max(1, page - 1))}>Previous</button>
                          <span>Page {safeStockPage} of {stockPageCount}</span>
                          <button className="border border-slate-300 px-3 py-1.5 font-semibold disabled:opacity-40" disabled={safeStockPage >= stockPageCount} onClick={() => setStockPage((page) => Math.min(stockPageCount, page + 1))}>Next</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState
                      title={stockQuery ? "No matching material" : "No stock available"}
                      description={stockQuery ? "Try another material, source, or quality." : "Material stock appears after the first purchase or sorting output is recorded."}
                    />
                  )}
                </section>
                <section className="border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">Recent stock adjustments</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        A permanent audit trail for loss, damage, and verified stock-count corrections.
                      </p>
                    </div>
                    <p className="text-sm text-slate-500">
                      Added {data.summary.stockAddedKg.toLocaleString()} kg · Removed {data.summary.stockRemovedKg.toLocaleString()} kg
                    </p>
                  </div>
                  {data.stockAdjustments.length ? (
                    <div className="table-wrap mt-3">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th><th>Material</th><th>Adjustment</th><th>Quantity</th><th>Reason</th><th>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adjustmentsPage.paged.map((x) => (
                            <tr key={x.id}>
                              <td>{new Date(x.adjustment_date).toLocaleDateString("en-GB")}</td>
                              <td><p className="table-primary">{x.material_type}</p><p className="table-secondary">{x.source_name}</p></td>
                              <td>{x.adjustment_type === "loss" ? "Loss / damage" : x.adjustment_type === "correction_in" ? "Count corrected up" : "Count corrected down"}</td>
                              <td className={`font-semibold ${x.adjustment_type === "correction_in" ? "text-green-700" : "text-red-700"}`}>
                                {x.adjustment_type === "correction_in" ? "+" : "−"}{Number(x.quantity_kg).toLocaleString()} kg
                              </td>
                              <td>{x.reason}</td><td>{x.notes || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table><Pager of={adjustmentsPage}/>
                    </div>
                  ) : (
                    <EmptyState title="No stock adjustments" description="No inventory corrections have been recorded. Normal purchases, sorting, and sales do not appear here." />
                  )}
                </section>
              </div>
            )}
            {tab === "sales" &&
              (<section className="mt-5 border border-slate-200 bg-white">
                <div className="flex flex-col gap-4 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--color-action)]">Sales control</p><h2 className="mt-1 text-xl font-semibold">Industrial sales</h2><p className="mt-1 text-sm text-slate-500">Dispatch, payment and buyer follow-up in one compact view.</p></div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input aria-label="Search industrial sales" value={salesQuery} onChange={(event) => setSalesQuery(event.target.value)} placeholder="Search buyer, material or invoice" className="min-w-64 border border-slate-300 px-3 py-2 text-sm" />
                    <select aria-label="Filter sales by payment status" value={salesStatus} onChange={(event) => setSalesStatus(event.target.value)} className="border border-slate-300 bg-white px-3 py-2 text-sm"><option value="all">All payments</option><option value="paid">Paid</option><option value="partially_paid">Partially paid</option><option value="credit">Credit</option><option value="due_soon">Due soon</option><option value="overdue">Overdue</option></select>
                    <button disabled={!data.lots.some((item) => Number(item.available_kg) > 0)} onClick={() => openForm("sale")} className="bg-[var(--color-action)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Record sale</button>
                  </div>
                </div>
                <div className="grid gap-px bg-slate-200 sm:grid-cols-4">
                  <div className="bg-slate-50 p-3"><p className="text-xs text-slate-500">Sales revenue</p><p className="mt-1 text-lg font-semibold">{money(data.summary.revenueUgx)}</p></div>
                  <div className="bg-slate-50 p-3"><p className="text-xs text-slate-500">Receivables</p><p className="mt-1 text-lg font-semibold">{money(data.summary.unpaidSalesUgx)}</p></div>
                  <div className="bg-slate-50 p-3"><p className="text-xs text-slate-500">Quantity sold</p><p className="mt-1 text-lg font-semibold">{data.summary.soldKg.toLocaleString()} kg</p></div>
                  <div className="bg-slate-50 p-3"><p className="text-xs text-slate-500">Profit / loss</p><p className={`mt-1 text-lg font-semibold ${data.summary.profitLossUgx < 0 ? "text-red-700" : ""}`}>{money(data.summary.profitLossUgx)}</p></div>
                </div>
              {filteredSales.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date / material</th>
                        <th>Buyer</th>
                        <th>Invoice</th>
                        <th>Quantity</th>
                        <th>Value / balance</th>
                        <th>Payment & actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesPage.paged.map((x) => (
                        <tr key={x.id}>
                          <td>
                            <p className="table-primary">
                              {new Date(x.sold_on).toLocaleDateString("en-GB")}
                            </p>
                            <p className="table-secondary">{x.material_type}</p>
                          </td>
                          <td>
                            <p>{x.buyer_name}</p>
                            <p className="table-secondary capitalize">{x.sale_channel} · {x.industry}</p>
                          </td>
                          <td>
                            <p>{x.invoice_number || "—"}</p>
                            {x.due_on && x.status !== "paid" && <p className="table-secondary">Due {new Date(x.due_on).toLocaleDateString("en-GB")}</p>}
                            {x.latest_follow_up_at && (
                              <p className="table-secondary mt-1" title={x.latest_follow_up_note || undefined}>
                                {x.follow_up_count} follow-up{x.follow_up_count === 1 ? "" : "s"} · {String(x.latest_follow_up_outcome).replaceAll("_", " ")}
                                {x.next_follow_up_on ? ` · next ${new Date(x.next_follow_up_on).toLocaleDateString("en-GB")}` : ""}
                              </p>
                            )}
                            {x.payment_reference && (
                              <p className="table-secondary">
                                {x.payment_reference}
                              </p>
                            )}
                          </td>
                          <td>{Number(x.quantity_kg).toLocaleString()} kg{Number(x.delivered_kg ?? x.quantity_kg) > Number(x.quantity_kg) && <p className="table-secondary">{Number(x.delivered_kg).toLocaleString()} kg delivered · {(Number(x.delivered_kg) - Number(x.quantity_kg)).toLocaleString()} kg refused</p>}</td>
                          <td><p className="font-semibold">{money(x.total_ugx)}</p><p className="table-secondary">Net {money(x.net_income_ugx)} · Expenses {money(x.expenses_ugx)}</p><p className="table-secondary">Paid {money(x.paid_ugx)} · Balance {money(x.balance_ugx)}</p></td>
                          <td>
                            <div className="flex items-center gap-2">
                              <Status value={x.payment_state} />
                              <details className="relative">
                                <summary className="cursor-pointer list-none border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-[var(--color-action)]">Actions</summary>
                                <div className="absolute right-0 z-20 mt-1 w-44 border border-slate-200 bg-white p-1 shadow-lg">
                                  {x.status !== "paid" && !collectorMode && <button disabled={saving} onClick={() => { setSelectedSaleId(x.id); setForm("payment"); }} className="block w-full px-3 py-2 text-left text-xs font-semibold hover:bg-slate-50">Record payment</button>}
                                  {x.status !== "paid" && !collectorMode && <button disabled={saving} onClick={() => { setSelectedSaleId(x.id); setForm("saleDue"); }} className="block w-full px-3 py-2 text-left text-xs font-semibold hover:bg-slate-50">Change due date</button>}
                                  {x.status !== "paid" && !collectorMode && <button disabled={saving} onClick={() => { setSelectedSaleId(x.id); setForm("followUp"); }} className="block w-full px-3 py-2 text-left text-xs font-semibold hover:bg-slate-50">Record follow-up</button>}
                                  {(fieldManagerMode || companyAdminMode) && <button onClick={() => { setEditingSaleId(x.id); setForm("sale"); }} className="block w-full px-3 py-2 text-left text-xs font-semibold hover:bg-slate-50">Edit sale</button>}
                                  {Number(x.paid_ugx) > 0 && <button onClick={() => { setSelectedSaleId(x.id); setForm("saleHistory"); }} className="block w-full px-3 py-2 text-left text-xs font-semibold hover:bg-slate-50">Payment history</button>}
                                </div>
                              </details>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table><Pager of={salesPage}/>
                </div>
              ) : (
                <EmptyState title={salesQuery || salesStatus !== "all" ? "No matching sales" : "No industrial sales"} description={salesQuery || salesStatus !== "all" ? "Clear the search or payment filter to see other sales." : "Record a sale from available graded material stock, including its buyer, price and selling expenses."} />
              )}</section>)}
            {tab === "float" && <div className="mt-6 space-y-7">
              {fieldManagerMode && <section className="border-l-2 border-[var(--color-action)] bg-blue-50 p-5"><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--color-action)]">Field finance</p><h2 className="mt-1 text-xl font-semibold">Employee float control</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Record money issued for field purchasing and expenses, then compare it with employee purchase records and the remaining float. Company banking, payroll, customer billing and full accounting remain restricted.</p><div className="mt-4 grid gap-px bg-blue-200 sm:grid-cols-2"><div className="bg-white p-4"><p className="text-xs text-slate-500">Current field float</p><p className="mt-1 text-xl font-semibold">{money(data.summary.floatBalanceUgx)}</p></div><div className="bg-white p-4"><p className="text-xs text-slate-500">Purchase spending recorded</p><p className="mt-1 text-xl font-semibold">{money(data.summary.purchaseCostUgx)}</p></div></div></section>}
              {!fieldManagerMode && <><section>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--color-action)]">Finance control</p><h2 className="mt-1 text-xl font-semibold">Cash, obligations and profitability</h2><p className="mt-1 max-w-3xl text-sm text-slate-500">Cash answers what can be paid now. Receivables and payables show money still due. Profit uses only the cost of material actually sold; unsold material remains inventory.</p></div>
                  <a href="/dashboard/billing" className="border border-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-[var(--color-action)]">Open full finance controls</a>
                </div>
                {!data.summary.openingBalanceConfigured && <div className="mt-4 border-l-4 border-[var(--color-accent)] bg-amber-50 p-4 text-sm text-amber-950"><strong>Finance setup required.</strong> Set the verified opening balance before recording paid purchases or allocating manager float. <a href="/dashboard/billing" className="font-semibold text-[var(--color-action)] underline">Set opening balance →</a></div>}
                <div className="mt-5 grid gap-px bg-slate-300 sm:grid-cols-2 lg:grid-cols-3">
                  {[["Office cash",data.summary.officeCashUgx,"Cash controlled by the office, excluding float"],["Manager float",data.summary.floatBalanceUgx,"Accountable cash currently held for field operations"],["Total controlled cash",data.summary.cashPositionUgx,"Office cash plus field cash after recorded spending"],["Committed funds",data.summary.committedFundsUgx,"Approved or unpaid obligations reserved from cash"],["Customer receivables",data.summary.unpaidSalesUgx,"Sales recorded but not yet collected"],["Supplier payables",data.summary.creditPurchasesUgx,"Material purchases still owed to suppliers"]].map(([label,value,help])=><div key={String(label)} className="bg-white p-4"><p className="text-xs font-semibold text-slate-500">{label}</p><p className={`mt-1 text-xl font-semibold ${Number(value)<0?"text-red-700":""}`}>{money(Number(value))}</p><p className="mt-2 text-xs leading-5 text-slate-500">{help}</p></div>)}
                </div>
              </section>
              <section className="grid gap-5 lg:grid-cols-2">
                <div className="border border-slate-200 bg-white p-5"><h3 className="font-semibold">Profit and loss</h3><div className="mt-3 divide-y text-sm">{[["Sales revenue",data.summary.revenueUgx],["Cost of material sold",0-data.summary.costOfGoodsSoldUgx],["Gross profit",data.summary.grossProfitUgx],["Selling expenses",0-data.summary.saleExpensesUgx],["Trading profit",data.summary.tradingProfitUgx],["Operating expenses",0-data.summary.operatingExpensesUgx],["Stock losses / outward corrections",0-data.summary.stockLossUgx],["Operating profit / loss",data.summary.profitLossUgx]].map(([label,value])=><div key={String(label)} className="flex justify-between gap-4 py-3"><span>{label}</span><strong className={Number(value)<0?"text-red-700":""}>{money(Number(value))}</strong></div>)}</div></div>
                <div className="border border-slate-200 bg-white p-5"><h3 className="font-semibold">Stock accounting</h3><div className="mt-3 divide-y text-sm"><div className="flex justify-between py-3"><span>Material purchased</span><strong>{money(data.summary.purchaseCostUgx)}</strong></div><div className="flex justify-between py-3"><span>Processing cost recorded</span><strong>{money(data.summary.processingCostUgx)}</strong></div><div className="flex justify-between py-3"><span>Unsold inventory value</span><strong>{money(data.summary.inventoryValueUgx)}</strong></div><div className="flex justify-between py-3"><span>Physical stock</span><strong>{data.summary.availableKg.toLocaleString()} kg</strong></div></div><p className="mt-3 text-xs leading-5 text-slate-500">Buying stock reduces cash but does not become a trading loss immediately. Its cost moves to cost of goods sold only when that material is sold.</p></div>
              </section>
              <section className="border-y border-slate-300 bg-slate-50 p-5"><h3 className="font-semibold">How to record money correctly</h3><div className="mt-4 grid gap-4 text-sm md:grid-cols-4">{[["1. Fund the business","Set the verified opening balance under Finance. Do not use a fake sale to create cash."],["2. Buy material","Choose Paid only when cash actually leaves. Choose Credit when the supplier will be paid later."],["3. Record sales","Record the dispatch first. Mark payment only when the buyer’s money is actually received."],["4. Reconcile daily","Review cash, float, receivables and payables, then close the business day after corrections."]].map(([title,description])=><div key={title}><p className="font-semibold text-[var(--color-action)]">{title}</p><p className="mt-1 leading-6 text-slate-600">{description}</p></div>)}</div></section></>}
              {!fieldManagerMode&&<section>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div><h3 className="font-semibold">Loans</h3><p className="mt-1 text-sm text-slate-500">Money borrowed into office cash and paid back from it, usually from sale income. Loans are not income and repayments are not expenses, so profit is not affected.</p></div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={()=>openForm("loan")} className="border border-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-[var(--color-action)]">Record loan received</button>
                    {openLoans.length>0&&<button onClick={()=>{setError("");setRepayingLoan(openLoans[0])}} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white">Repay a loan</button>}
                  </div>
                </div>
                {data.loans?.length?<div className="table-wrap mt-4"><table><thead><tr><th>Lender</th><th>Received</th><th>Borrowed</th><th>Repaid</th><th>Still owed</th><th>Repay by</th><th/></tr></thead><tbody>{loansPage.paged.map(x=>{const owed=Number(x.outstanding_ugx);return <tr key={x.id}>
                  <td><p className="table-primary">{x.lender_name}</p><p className="table-secondary">{x.reference}{x.notes?` · ${x.notes}`:""}</p></td>
                  <td>{new Date(x.received_on).toLocaleDateString("en-GB")}</td>
                  <td>{money(x.amount_ugx)}</td>
                  <td>{money(x.repaid_ugx)}{x.last_repaid_on&&<p className="table-secondary">Last {new Date(x.last_repaid_on).toLocaleDateString("en-GB")}</p>}</td>
                  <td className={owed>0?"font-semibold":"text-slate-500"}>{owed>0?money(owed):"Repaid"}</td>
                  <td>{x.due_on?<span className={owed>0&&x.due_on.slice(0,10)<today()?"text-[var(--color-danger)]":""}>{new Date(x.due_on).toLocaleDateString("en-GB")}</span>:"—"}</td>
                  <td className="text-right">{owed>0&&<button onClick={()=>setRepayingLoan(x)} className="border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">Repay</button>}</td>
                </tr>})}</tbody></table><Pager of={loansPage}/></div>:<EmptyState title="No loans" description="Record money borrowed for the business, for example to buy material, and pay it back when sales come in."/>}
                {Number(data.summary.loansOutstandingUgx||0)>0&&<p className="mt-2 text-sm text-slate-600">Total still owed: <strong>{money(data.summary.loansOutstandingUgx||0)}</strong></p>}
              </section>}
              {!fieldManagerMode&&<section><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">Business cash movement ledger</h3><p className="mt-1 text-sm text-slate-500">Referenced owner funding, other non-sale income, withdrawals and corrections.</p></div><button onClick={()=>openForm("cash")} className="border border-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-[var(--color-action)]">Post cash movement</button></div>{data.cashMovements.length?<div className="table-wrap mt-4"><table><thead><tr><th>Date</th><th>Direction</th><th>Category</th><th>Reference</th><th>Amount</th><th>Recorded by</th></tr></thead><tbody>{cashPage.paged.map(x=><tr key={x.id}><td>{new Date(x.movement_date).toLocaleDateString("en-GB")}</td><td><Status value={x.direction}/></td><td className="capitalize">{x.category.replaceAll("_"," ")}</td><td>{x.reference}</td><td className={x.direction==="out"?"text-red-700":"text-green-700"}>{x.direction==="out"?"− ":"+ "}{money(x.amount_ugx)}</td><td>{x.recorded_by_name}</td></tr>)}</tbody></table><Pager of={cashPage}/></div>:<EmptyState title="No cash movements" description="Post only cash movements that are not already captured by a sale, purchase or expense."/>}</section>}
              <section><div className="flex items-end justify-between gap-3"><div><h3 className="font-semibold">Manager float ledger</h3><p className="mt-1 text-sm text-slate-500">Money issued to field operations, used by linked work, and returned when unused.</p></div><button onClick={()=>openForm("float")} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white">Record float movement</button></div>
              {data.floatTransactions.length ? (
                <div className="table-wrap mt-4">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Movement</th>
                        <th>Amount</th>
                        <th>Running balance</th>
                        <th>Recorded by</th>
                        <th>Reference / purpose</th>
                      </tr>
                    </thead>
                    <tbody>
                      {floatPage.paged.map((x) => (
                        <tr key={x.id}>
                          <td>
                            {new Date(x.transaction_date).toLocaleDateString(
                              "en-GB",
                            )}
                          </td>
                          <td>{x.transaction_type==="given"?"Issued to manager":x.transaction_type==="returned"?"Returned to office":"Used / spent"}</td>
                          <td>{money(x.amount_ugx)}</td>
                          <td className="font-semibold">
                            {money(x.running_balance_ugx)}
                          </td>
                          <td><span className="block font-medium">{x.recorded_by_name||"System"}</span><span className="text-xs text-slate-500">{x.created_at?new Date(x.created_at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"—"}</span></td>
                          <td><span className="block font-medium">{x.reference||"Automatic"}</span><span className="text-xs text-slate-500">{x.notes || "—"}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table><Pager of={floatPage}/>
                </div>
              ) : (
                <EmptyState
                  title="No manager float movements"
                  description="Record money given to the manager. Purchase amounts marked as paid from float are deducted automatically."
                />
              )}</section></div>}
          </>
        )}
        <Modal
          open={form === "dailyClose"}
          title="Close business day"
          description="Review today’s operational totals, then lock the date against further purchasing, sorting, sales, payments, float and stock changes."
          onClose={() => setForm("")}
        >
          <form onSubmit={submitDailyClose} className="space-y-4">
            <div className="grid gap-px bg-slate-200 sm:grid-cols-3">
              <div className="bg-slate-50 p-3"><p className="text-xs text-slate-500">Material received</p><p className="font-semibold">{Number(data?.operations.receivedTodayKg || 0).toLocaleString()} kg</p></div>
              <div className="bg-slate-50 p-3"><p className="text-xs text-slate-500">Saleable output</p><p className="font-semibold">{Number(data?.operations.sortedTodayKg || 0).toLocaleString()} kg</p></div>
              <div className="bg-slate-50 p-3"><p className="text-xs text-slate-500">Material sold</p><p className="font-semibold">{Number(data?.operations.soldTodayKg || 0).toLocaleString()} kg</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Physical office cash counted (UGX)<input required min={0} step={1} type="number" name="countedOfficeCashUgx" placeholder={String(data?.summary.officeCashUgx ?? 0)} className={field} /><span className="mt-1 block text-xs font-normal text-slate-500">Ledger expects {money(data?.summary.officeCashUgx || 0)}</span></label>
              <label className="block text-sm font-semibold">Physical manager float counted (UGX)<input required min={0} step={1} type="number" name="countedManagerFloatUgx" placeholder={String(data?.summary.floatBalanceUgx ?? 0)} className={field} /><span className="mt-1 block text-xs font-normal text-slate-500">Ledger expects {money(data?.summary.floatBalanceUgx || 0)}</span></label>
            </div>
            <label className="flex items-start gap-3 border border-slate-300 bg-white p-3 text-sm"><input required type="checkbox" name="allDevicesSynced" className="mt-1 size-4" /><span><strong className="block">All field devices are synchronized</strong><span className="mt-1 block text-slate-500">Every phone and tablet has been online and shows no records waiting to sync.</span></span></label>
            <label className="block text-sm font-semibold">Closing note (optional)<textarea name="notes" rows={3} maxLength={500} placeholder="Handover note, variance explanation, or manager comment" className={field} /></label>
            <div className="border-l-2 border-[var(--color-accent)] bg-amber-50 p-3 text-sm text-slate-700">After closing, records dated {data?.operations.operatingDate} cannot be added or changed. A company administrator can reopen the day with a mandatory reason.</div>
            <button disabled={saving} className="w-full bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white">{saving ? "Closing…" : "Confirm and close day"}</button>
          </form>
        </Modal>
        <Modal
          open={form === "dailyReopen"}
          title="Reopen business day"
          description="Use this only to correct an omitted or incorrect operational record. The reason remains attached to the closing record."
          onClose={() => setForm("")}
        >
          <form onSubmit={submitDailyReopen} className="space-y-4">
            {!!data?.operations.currentClosure?.history?.length && <div className="border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-500">Previous control actions</p><div className="mt-2 max-h-40 divide-y overflow-y-auto text-sm">{data.operations.currentClosure.history.map(event=><div key={event.id} className="py-2"><p><strong className="capitalize">{event.action}</strong> by {event.actorName || "authorized user"}</p><p className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString("en-GB")}{event.reason?` · ${event.reason}`:""}</p></div>)}</div></div>}
            <label className="block text-sm font-semibold">Reason for reopening<textarea required minLength={5} maxLength={500} name="reason" rows={4} placeholder="Explain the correction that must be made" className={field} /></label>
            <button disabled={saving} className="w-full bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white">{saving ? "Reopening…" : "Reopen business day"}</button>
          </form>
        </Modal>
        <Modal
          open={form === "material"}
          title="Add material type"
          description="Create one standard name that your team will use in purchasing, sorting, stock, sales, and reports."
          onClose={() => setForm("")}
        >
          <form onSubmit={submitMaterial} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold sm:col-span-2">
              Material name
              <input required minLength={2} maxLength={80} name="name" placeholder="Example: Clear PET flakes" className={field} />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Material category
              <select required name="category" defaultValue="plastic" className={field}>
                <option value="plastic">Plastic</option><option value="paper">Paper</option><option value="metal">Metal</option><option value="glass">Glass</option><option value="organic">Organic</option><option value="textile">Textile</option><option value="other">Other</option>
              </select>
            </label>
            <div className="border-l-2 border-[var(--color-action)] bg-blue-50 p-3 text-xs text-slate-700 sm:col-span-2">Use a specific commercial grade where possible. Existing transaction records will remain unchanged if this material is later deactivated.</div>
            <button disabled={saving} className="bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white sm:col-span-2">{saving ? "Saving…" : "Add material type"}</button>
          </form>
        </Modal>
        <Modal
          open={form === "purchase"}
          title={editingPurchase ? "Edit material purchase" : "Record material purchase"}
          description={editingPurchase ? "Correct this material line. Stock already used or sold and payments already made remain protected." : "Record one supplier or driver delivery, then separate its materials into the correct stock types."}
          onClose={() => {setForm("");setEditingPurchaseId("");setPurchaseLines([]);}}
        >
          <form key={editingPurchase?.id || "new-purchase"} onSubmit={submitPurchase} className="grid gap-4 sm:grid-cols-2">
            {!editingPurchase && purchaseLines.length > 0 && <div className="sm:col-span-2 border border-slate-200 bg-slate-50">
              <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Materials in this delivery</div>
              {purchaseLines.map((line, index) => <div key={line.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-200 px-3 py-2 text-sm last:border-b-0">
                <div><p className="font-semibold">{index + 1}. {line.materialType}</p><p className="text-xs text-slate-500">{line.quantityKg.toLocaleString()} kg · {money(line.unitPurchasePriceUgx)}/kg · {line.quality}</p></div>
                <button type="button" onClick={() => setPurchaseLines((current) => current.filter((item) => item.id !== line.id))} className="text-xs font-semibold text-red-700">Remove</button>
              </div>)}
            </div>}
            <label className="text-sm font-semibold">
              Material type
              <select name="materialType" defaultValue={editingPurchase?.material_type || ""} className={field}>
                <option value="">Choose material</option>
                {data?.materials.filter((x) => x.active).map((x) => (
                  <option key={x.id} value={x.name}>{x.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Material not listed? Enter its name
              <input minLength={2} maxLength={80} name="customMaterialType" placeholder="Example: Copper cable" className={field} />
              <span className="mt-1 block text-xs font-normal text-slate-500">A new name is saved to your company catalogue for future transactions.</span>
            </label>
            <label className="text-sm font-semibold">
              Saved supplier (optional)
              <select name="supplierPartnerId" defaultValue={editingPurchase?.supplier_partner_id || ""} className={field}>
                <option value="">Choose saved supplier</option>
                {data?.partners
                  .filter(
                    (x) =>
                      x.active &&
                      (x.partner_type === "supplier" ||
                        x.partner_type === "both"),
                  )
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Supplier / collection source
              <input required name="sourceName" defaultValue={editingPurchase?.source_name || ""} className={field} />
            </label>
            <label className="text-sm font-semibold">
              Kg bought
              <input
                required
                type="number"
                min=".01"
                step=".01"
                name="quantityKg"
                defaultValue={editingPurchase?.quantity_kg || ""}
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Price paid per kg (UGX)
              <input
                required
                type="number"
                min="0"
                name="unitPurchasePriceUgx"
                defaultValue={editingPurchase?.unit_purchase_price_ugx || ""}
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Purchase date
              <input
                required
                type="date"
                name="collectedOn"
                defaultValue={editingPurchase ? String(editingPurchase.collected_on).slice(0,10) : today()}
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Material condition
              <select name="quality" defaultValue={editingPurchase?.quality || (activeOptions(data?.settings?.qualityGrades).some((o) => o.code === "mixed") ? "mixed" : activeOptions(data?.settings?.qualityGrades)[0]?.code)} className={field}>
                {(data?.settings ? activeOptions(data.settings.qualityGrades, editingPurchase?.quality) : [{ code: "mixed", label: "Mixed" }, { code: "sorted", label: "Sorted" }, { code: "clean", label: "Clean" }, { code: "contaminated", label: "Contaminated" }]).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </label>
            {!editingPurchase && <button type="button" onClick={(event) => addPurchaseLine(event.currentTarget.form)} className="border border-[var(--color-action)] px-4 py-3 text-sm font-semibold text-[var(--color-action)] sm:col-span-2">{purchaseLines.length ? "+ Add another material" : "Add material to this delivery"}</button>}
            <label className="text-sm font-semibold">
              Delivered / received by (optional)
              <select name="deliveredByUserId" defaultValue={editingPurchase?.delivered_by_user_id || ""} className={field}>
                <option value="">Not assigned</option>
                {(data?.deliveryStaff || []).map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}
              </select>
              <span className="mt-1 block text-xs font-normal text-slate-500">Select the driver or field worker. The supplier remains recorded separately.</span>
            </label>
            <label className="text-sm font-semibold">
              Delivery reference
              <input required={!editingPurchase} minLength={2} maxLength={120} name="deliveryReference" defaultValue={editingPurchase?.purchase_group_reference || `DEL-${today().replaceAll("-", "")}`} className={field} />
              <span className="mt-1 block text-xs font-normal text-slate-500">All material lines from this load share this reference.</span>
            </label>
            {!editingPurchase && <label className="text-sm font-semibold">
              Purchase payment
              <select
                name="purchasePaymentStatus"
                defaultValue="paid"
                className={field}
              >
                <option value="paid">Paid</option>
                <option value="credit">Bought on credit</option>
              </select>
            </label>}
            {!editingPurchase && <label className="text-sm font-semibold">
              Payment reference (optional)
              <input name="purchasePaymentReference" className={field} />
            </label>}
            {expenseFields.map(([name, fallback]) => {
              const setting = costField(data?.settings, "purchase", name, fallback), value = editingPurchase ? String(editingPurchase[name === "workerWagesUgx" ? "worker_wages_ugx" : name === "foodUgx" ? "food_ugx" : name === "transportUgx" ? "transport_ugx" : "other_expense_ugx"]) : "0";
              return setting.visible ? (
              <label key={name} className="text-sm font-semibold">
                {setting.label} (UGX)
                <input type="number" min="0" name={name} defaultValue={value} className={field} />
              </label>
              ) : <input key={name} type="hidden" name={name} defaultValue={value} />;
            })}
            {costField(data?.settings, "purchase", "driverFeeUgx", "Driver fee").visible ? <label className="text-sm font-semibold">
              {costField(data?.settings, "purchase", "driverFeeUgx", "Driver fee").label} (UGX)
              <input
                type="number"
                min="0"
                name="driverFeeUgx"
                defaultValue={editingPurchase?.driver_fee_ugx || "0"}
                className={field}
              />
            </label> : <input type="hidden" name="driverFeeUgx" defaultValue={editingPurchase?.driver_fee_ugx || "0"} />}
            {!editingPurchase && <label className="text-sm font-semibold">
              Paid from manager float (UGX)
              <input
                type="number"
                min="0"
                name="managerFloatUsedUgx"
                defaultValue="0"
                className={field}
              />
            </label>}
            <label className="text-sm font-semibold sm:col-span-2">
              Notes
              <textarea name="notes" rows={2} defaultValue={editingPurchase?.notes || ""} className={field} />
            </label>
            <button
              disabled={saving}
              className="bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white sm:col-span-2"
            >
              {saving ? "Saving…" : editingPurchase ? "Update purchase" : "Save delivery"}
            </button>
          </form>
        </Modal>
        <Modal
          open={form === "sorting"}
          title="Record sorting and grading"
          description="Record what was sorted out of a material. Only the sorted weight and the waste leave it; the rest stays in stock to sort another day."
          onClose={() => setForm("")}
        >
          <form onSubmit={submitSorting} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><p className="text-sm font-semibold">Choose how stock is consumed</p><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={()=>setSortingInputMode("material_total")} className={`border px-3 py-3 text-sm font-semibold ${sortingInputMode==="material_total"?"border-[var(--color-action)] bg-blue-50 text-[var(--color-action)]":"border-slate-300"}`}>Use material total</button><button type="button" onClick={()=>setSortingInputMode("lot")} className={`border px-3 py-3 text-sm font-semibold ${sortingInputMode==="lot"?"border-[var(--color-action)] bg-blue-50 text-[var(--color-action)]":"border-slate-300"}`}>Choose one purchase</button></div><p className="mt-2 text-xs text-slate-500">Material total automatically uses the oldest available lots first and preserves every source in the audit trail.</p></div>
            {sortingInputMode==="material_total"?<label className="text-sm font-semibold sm:col-span-2">
              Material total
              <select required name="inputMaterialType" value={sortDraft.input} onChange={(e)=>setSortDraft((d)=>({...d,input:e.target.value}))} className={field}><option value="">Choose material</option>{stockGroups.map((group)=><option key={group.material} value={group.material}>{group.material} · {group.availableKg.toLocaleString()} kg available</option>)}</select>
            </label>:<label className="text-sm font-semibold sm:col-span-2">
              Input material lot
              <select required name="inputLotId" onChange={(e)=>setSortDraft((d)=>({...d,input:data?.lots.find((x)=>x.id===e.target.value)?.material_type??""}))} className={field}>
                <option value="">Choose purchased stock</option>
                {data?.lots
                  .filter(
                    (x) =>
                      x.origin === "purchase" && Number(x.available_kg) > 0,
                  )
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.material_type} ·{" "}
                      {Number(x.available_kg).toLocaleString()} kg available ·{" "}
                      {x.source_name}
                    </option>
                  ))}
              </select>
            </label>}
            <label className="text-sm font-semibold">
              Processing date
              <input
                required
                type="date"
                name="processedOn"
                defaultValue={today()}
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Sorted into
              <select required name="outputMaterialType" value={sortDraft.output} onChange={(e)=>setSortDraft((d)=>({...d,output:e.target.value}))} className={field}>
                <option value="">Choose material</option>
                {data?.materials.filter((x) => x.active).map((x) => (
                  <option key={x.id} value={x.name}>{x.name} · {stockOf(x.name).toLocaleString()} kg in stock</option>
                ))}
                <option value={NEW_MATERIAL}>Other / Add new material</option>
              </select>
            </label>
            {sortDraft.output===NEW_MATERIAL&&<label className="text-sm font-semibold">
              New material name
              <input required minLength={2} maxLength={80} name="customOutputMaterialType" className={field} />
              <span className="mt-1 block text-xs font-normal text-slate-500">Saved to your material list. A name already on the list is matched to it, so no duplicate is made.</span>
            </label>}
            <label className="text-sm font-semibold">
              Sorted out (kg)
              <input
                required
                type="number"
                min=".01"
                step=".01"
                name="outputKg"
                value={sortDraft.sortedKg}
                onChange={(e)=>setSortDraft((d)=>({...d,sortedKg:e.target.value}))}
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Waste thrown away (kg)
              <input
                type="number"
                min="0"
                step=".01"
                name="rejectedKg"
                value={sortDraft.wasteKg}
                onChange={(e)=>setSortDraft((d)=>({...d,wasteKg:e.target.value}))}
                className={field}
              />
            </label>
            {sortDraft.input&&sortDraft.output&&sortedKg>0&&<div className="sm:col-span-2 border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold">Stock after saving</p>
              <p className="mt-1 flex justify-between gap-3"><span>{sortDraft.input}</span><span className="tabular-nums">{stockOf(sortDraft.input).toLocaleString()} → {(stockOf(sortDraft.input)-sortTakenKg).toLocaleString()} kg</span></p>
              {sortDraft.output!==NEW_MATERIAL?<p className="flex justify-between gap-3"><span>{sortDraft.output}</span><span className="tabular-nums">{stockOf(sortDraft.output).toLocaleString()} → {(stockOf(sortDraft.output)+sortedKg).toLocaleString()} kg</span></p>:<p className="flex justify-between gap-3"><span>New material</span><span className="tabular-nums">0 → {sortedKg.toLocaleString()} kg</span></p>}
            </div>}
            <div className="sm:col-span-2 border-y border-slate-200 py-4"><h3 className="font-semibold">Processing cost breakdown</h3><p className="mt-1 text-xs text-slate-500">Enter the real costs. The system totals them and adds them to this material batch.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{[["workerWagesUgx","Worker wages"],["utilitiesUgx","Power / utilities"],["transportUgx","Processing transport"],["consumablesUgx","Bags and consumables"],["otherExpenseUgx","Other processing cost"]].map(([name,fallback])=>{const setting=costField(data?.settings,"sorting",name,fallback);return setting.visible?<label key={name} className="text-sm font-semibold">{setting.label} (UGX)<input type="number" min="0" name={name} defaultValue="0" className={field}/></label>:<input key={name} type="hidden" name={name} defaultValue="0"/>})}<label className="text-sm font-semibold">Paid from manager float (UGX)<input type="number" min="0" name="managerFloatUsedUgx" defaultValue="0" className={field}/><span className="mt-1 block text-xs font-normal text-slate-500">Cannot exceed the total costs or available float.</span></label></div></div>
            <label className="text-sm font-semibold sm:col-span-2">
              Notes
              <textarea name="notes" rows={2} className={field} />
            </label>
            <div className="border-l-2 border-[var(--color-accent)] bg-amber-50 p-3 text-xs text-slate-700 sm:col-span-2">
              The sorted weight and the waste are taken from the material. For
              example, sorting 3,000 kg of sacs from 10,000 kg of mixed leaves
              7,000 kg of mixed in stock.
            </div>
            <button
              disabled={saving}
              className="bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white sm:col-span-2"
            >
              {saving ? "Saving…" : "Save sorting output"}
            </button>
          </form>
        </Modal>
        <Modal
          open={Boolean(reversingEntry)}
          title="Reverse sorting"
          description={reversingEntry ? `${reversingEntry.output_kg.toLocaleString()} kg of ${reversingEntry.output_material} and ${reversingEntry.rejected_kg.toLocaleString()} kg of waste go back into ${reversingEntry.input_material_type} as ${reversingEntry.input_kg.toLocaleString()} kg. The sorted stock is removed.` : ""}
          onClose={() => !saving && setReversingEntry(null)}
        >
          <form key={reversingEntry?.id} onSubmit={submitReversal} className="grid gap-4 text-sm">
            {reversingEntry && reversingEntry.processing_cost_ugx > 0 && <p className="border-l-2 border-[var(--color-accent)] bg-amber-50 p-3 text-xs text-slate-700">The processing cost of {money(reversingEntry.processing_cost_ugx)} is removed too and returns to cash. If that money was really paid, record it again with the corrected sorting.</p>}
            <p className="text-xs text-slate-500">A sorting whose stock has already been sold, sorted again or adjusted cannot be reversed. The reversed record stays in the edit history.</p>
            <label className="font-semibold">Reason<input required minLength={5} maxLength={300} name="reason" placeholder="Example: recorded the whole mixed weight by mistake" className={field} /></label>
            {error && <p className="text-[var(--color-danger)]">{error}</p>}
            <button disabled={saving} className="bg-[var(--color-action)] px-4 py-3 font-semibold text-white disabled:opacity-50">{saving ? "Reversing…" : "Reverse sorting"}</button>
          </form>
        </Modal>
        <Modal
          open={form === "adjustment"}
          title="Adjust material stock"
          description="Use this only for verified loss, damage, contamination, or a physical stock-count correction."
          onClose={() => setForm("")}
        >
          <form onSubmit={submitAdjustment} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold sm:col-span-2">
              Material lot
              <select required name="lotId" className={field}>
                <option value="">Choose material stock</option>
                {data?.lots.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.material_type} · {Number(x.available_kg).toLocaleString()} kg available · {x.source_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Adjustment date
              <input required type="date" name="adjustmentDate" defaultValue={today()} className={field} />
            </label>
            <label className="text-sm font-semibold">
              Adjustment type
              <select required name="adjustmentType" defaultValue="loss" className={field}>
                <option value="loss">Damaged, contaminated, or lost</option>
                <option value="correction_out">Correct physical count down</option>
                <option value="correction_in">Correct physical count up</option>
              </select>
            </label>
            <label className="text-sm font-semibold">
              Quantity (kg)
              <input required type="number" min=".01" step=".01" name="quantityKg" className={field} />
            </label>
            <label className="text-sm font-semibold">
              Reason
              <input required minLength={3} name="reason" list="loss-reasons" placeholder="Choose or type a reason" className={field} />
              <datalist id="loss-reasons">{(data?.settings?.lossReasons ?? []).map((reason) => <option key={reason} value={reason} />)}</datalist>
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Additional notes (optional)
              <textarea name="notes" rows={3} className={field} />
            </label>
            <div className="border-l-2 border-[var(--color-accent)] bg-amber-50 p-3 text-xs text-slate-700 sm:col-span-2">
              This action changes available stock and creates a permanent audit record. It does not edit the original purchase, sorting, or sale record.
            </div>
            <button disabled={saving} className="bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white sm:col-span-2">
              {saving ? "Saving…" : "Record stock adjustment"}
            </button>
          </form>
        </Modal>
        <Modal
          open={form === "sale"}
          title={editingSale ? "Edit sale transaction" : collectorMode ? "Record local sale" : "Record industrial sale"}
          description={editingSale ? "Correct sale details. Available stock is restored and recalculated automatically, while received payments remain protected." : "Stock reduces automatically and the sale remains traceable to the responsible worker."}
          onClose={() => {setForm("");setEditingSaleId("");}}
        >
          <form key={editingSale?.id || "new-sale"} onSubmit={submitSale} className="grid gap-4 sm:grid-cols-2">
            {limitedWorkerMode ? <input type="hidden" name="saleChannel" value={editingSale?.sale_channel || (collectorMode ? "local" : "industrial")} /> : <label className="text-sm font-semibold sm:col-span-2">Sale channel<select name="saleChannel" defaultValue={editingSale?.sale_channel || "industrial"} className={field}><option value="industrial">Industry buyer</option><option value="local">Local buyer</option></select></label>}
            <label className="text-sm font-semibold sm:col-span-2">
              Material
              <select required name="materialType" defaultValue={editingSale?.material_type || ""} className={field}>
                <option value="">Choose material in stock</option>
                {saleMaterials.map((x) => <option key={x.material} value={x.material}>{x.material} · {x.availableKg.toLocaleString()} kg in stock</option>)}
              </select>
              <span className="mt-1 block text-xs font-normal text-slate-500">The weight is taken from the oldest stock of this material first.</span>
            </label>
            <label className="text-sm font-semibold">
              Saved {collectorMode ? "local" : "industrial"} buyer
              <select name="buyerPartnerId" defaultValue={editingSale?.buyer_partner_id || ""} className={field}>
                <option value="">Choose saved buyer</option>
                {data?.partners
                  .filter(
                    (x) =>
                      x.active &&
                      (x.partner_type === "buyer" || x.partner_type === "both"),
                  )
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
            {!collectorMode&&<FactoryBuyerSelect defaultValue={(editingSale as {buyer_organization_id?:string|null}|null|undefined)?.buyer_organization_id} className={field}/>}
            <label className="text-sm font-semibold">
              New buyer name (if not saved)
              <input name="buyerName" defaultValue={editingSale?.buyer_partner_id ? "" : editingSale?.buyer_name || ""} className={field} />
            </label>
            <label className="text-sm font-semibold">
              Buyer category
              <input required name="industry" defaultValue={editingSale?.industry || ""} placeholder={collectorMode ? "Local trader, shop, community buyer" : "Manufacturing or recycling industry"} className={field} />
            </label>
            <label className="text-sm font-semibold">
              Weight delivered (kg)
              <input required type="number" min=".01" step=".01" name="deliveredKg" defaultValue={editingSale?.delivered_kg || editingSale?.quantity_kg || ""} className={field} />
              <span className="mt-1 block text-xs font-normal text-slate-500">Leaves stock</span>
            </label>
            <label className="text-sm font-semibold">
              Weight the buyer paid for (kg)
              <input required type="number" min=".01" step=".01" name="quantityKg" defaultValue={editingSale?.quantity_kg || ""} className={field} />
              <span className="mt-1 block text-xs font-normal text-slate-500">The rest is recorded as waste the buyer refused</span>
            </label>
            <label className="text-sm font-semibold">
              Price per kg (UGX)
              <input
                required
                type="number"
                min="1"
                name="unitPriceUgx"
                defaultValue={editingSale?.unit_price_ugx || ""}
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Invoice number (optional)
              <input name="invoiceNumber" defaultValue={editingSale?.invoice_number || ""} className={field} />
            </label>
            <label className="text-sm font-semibold">
              Sale date
              <input
                required
                type="date"
                name="soldOn"
                defaultValue={editingSale ? String(editingSale.sold_on).slice(0,10) : today()}
                className={field}
              />
            </label>
            {!editingSale && <label className="text-sm font-semibold">
              Payment
              <select name="paymentReceived" defaultValue="now" className={field}>
                <option value="now">Paid now, into office cash (costs come out of it)</option>
                <option value="later">Buyer pays later</option>
              </select>
            </label>}
            {!editingSale && <label className="text-sm font-semibold">
              Payment reference (optional)
              <input name="paymentReference" minLength={2} maxLength={120} placeholder="Receipt or transfer number" className={field} />
            </label>}
            {expenseFields.map(([name, fallback]) => {
              const setting = costField(data?.settings, "sale", name, fallback), value = editingSale ? String(editingSale[name === "workerWagesUgx" ? "worker_wages_ugx" : name === "foodUgx" ? "food_ugx" : name === "transportUgx" ? "transport_ugx" : "other_expense_ugx"]) : "0";
              return setting.visible ? (
              <label key={name} className="text-sm font-semibold">
                {setting.label} (UGX)
                <input type="number" min="0" name={name} defaultValue={value} className={field} />
              </label>
              ) : <input key={name} type="hidden" name={name} defaultValue={value} />;
            })}
            <label className="text-sm font-semibold sm:col-span-2">
              Notes
              <textarea name="notes" rows={2} defaultValue={editingSale?.notes || ""} className={field} />
            </label>
            <button
              disabled={saving}
              className="bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white sm:col-span-2"
            >
              {saving ? "Saving…" : editingSale ? "Update sale" : "Save sale"}
            </button>
          </form>
        </Modal>
        <Modal
          open={form === "float"}
          title="Manager float movement"
          description="Issue accountable cash, record a separate supported expense, or return unused money. Purchase and processing float use is recorded automatically."
          onClose={() => setForm("")}
        >
          <form onSubmit={submitFloat} className="space-y-4">
            <label className="block text-sm font-semibold">
              Date
              <input
                required
                type="date"
                name="transactionDate"
                defaultValue={today()}
                className={field}
              />
            </label>
            <label className="block text-sm font-semibold">
              Movement
              <select
                required
                name="transactionType"
                defaultValue="given"
                className={field}
              >
                <option value="given">Issue money to manager</option>
                <option value="returned">Return unused money to office</option>
                <option value="spent">Other supported field expense</option>
              </select>
            </label>
            <label className="block text-sm font-semibold">Receipt / handover reference<input required minLength={2} maxLength={120} name="reference" placeholder="Example: FLT-2026-001" className={field}/><span className="mt-1 block text-xs font-normal text-slate-500">Use the cash voucher, receipt or signed handover number. References cannot be reused.</span></label>
            <label className="block text-sm font-semibold">
              Amount (UGX)
              <input
                required
                type="number"
                min="1"
                name="amountUgx"
                className={field}
              />
            </label>
            <label className="block text-sm font-semibold">
              Notes
              <textarea required minLength={3} name="notes" rows={3} placeholder="Purpose, recipient or explanation" className={field} />
            </label>
            <button
              disabled={saving}
              className="w-full bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white"
            >
              {saving ? "Saving…" : "Save float movement"}
            </button>
          </form>
        </Modal>
        <Modal open={form==="loan"} title="Record loan received" description="The amount is added to office cash now. Pay it back later from office cash with Repay." onClose={()=>setForm("")}>
          <form onSubmit={submitLoan} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold sm:col-span-2">Lender<input required minLength={2} maxLength={160} name="lenderName" placeholder="Bank, SACCO or person" className={field}/></label>
            <label className="text-sm font-semibold">Amount received (UGX)<input required type="number" min="1" name="amountUgx" className={field}/></label>
            <label className="text-sm font-semibold">Date received<input required type="date" name="receivedOn" defaultValue={today()} max={today()} className={field}/></label>
            <label className="text-sm font-semibold">Repay by (optional)<input type="date" name="dueOn" className={field}/></label>
            <label className="text-sm font-semibold">Reference<input required minLength={2} maxLength={120} name="reference" placeholder="Agreement or transfer number" className={field}/></label>
            <label className="text-sm font-semibold sm:col-span-2">Notes (optional)<textarea name="notes" rows={2} maxLength={500} placeholder="Purpose, interest agreed, or terms" className={field}/></label>
            {error&&<p className="text-sm text-[var(--color-danger)] sm:col-span-2">{error}</p>}
            <button disabled={saving} className="bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{saving?"Saving…":"Record loan"}</button>
          </form>
        </Modal>
        <Modal open={Boolean(repayingLoan)} title="Repay loan from office cash" description={repayingLoan?`${repayingLoan.lender_name} · ${money(repayingLoan.outstanding_ugx)} still owed. The repayment is paid from office cash, which holds ${money(data?.summary.officeCashUgx??0)} now.`:""} onClose={()=>!saving&&setRepayingLoan(null)}>
          <form key={repayingLoan?.id} onSubmit={submitRepayment} className="grid gap-4 sm:grid-cols-2">
            {openLoans.length>1&&<label className="text-sm font-semibold sm:col-span-2">Loan<select value={repayingLoan?.id} onChange={(event)=>setRepayingLoan(openLoans.find((loan)=>loan.id===event.target.value)??null)} className={field}>{openLoans.map((loan)=><option key={loan.id} value={loan.id}>{loan.lender_name} · {loan.reference} · {money(loan.outstanding_ugx)} owed</option>)}</select></label>}
            <label className="text-sm font-semibold">Amount (UGX)<input required type="number" min="1" max={repayingLoan?Number(repayingLoan.outstanding_ugx):undefined} name="amountUgx" defaultValue={repayingLoan?Math.min(Number(repayingLoan.outstanding_ugx),Math.max(Number(data?.summary.officeCashUgx??0),0))||"":""} className={field}/></label>
            <label className="text-sm font-semibold">Date paid<input required type="date" name="paidOn" defaultValue={today()} max={today()} className={field}/></label>
            <label className="text-sm font-semibold sm:col-span-2">Reference<input required minLength={2} maxLength={120} name="reference" placeholder="Receipt or transfer number" className={field}/></label>
            <label className="text-sm font-semibold sm:col-span-2">Notes (optional)<textarea name="notes" rows={2} maxLength={500} className={field}/></label>
            {error&&<p className="text-sm text-[var(--color-danger)] sm:col-span-2">{error}</p>}
            <button disabled={saving} className="bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{saving?"Saving…":"Record repayment"}</button>
          </form>
        </Modal>
        <Modal open={form==="cash"} title="Post business cash movement" description="Use this only for money entering or leaving the business outside normal sales, purchases and expenses. Posted records remain in the audit trail." onClose={()=>setForm("")}>
          <form onSubmit={submitCash} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Date<input required type="date" name="movementDate" defaultValue={today()} className={field}/></label><label className="text-sm font-semibold">Direction<select required name="direction" defaultValue="in" className={field}><option value="in">Cash in</option><option value="out">Cash out</option></select></label><label className="text-sm font-semibold">Category<select required name="category" defaultValue="capital_contribution" className={field}><option value="capital_contribution">Owner capital contribution</option><option value="other_income">Other non-sale income</option><option value="owner_withdrawal">Owner withdrawal</option><option value="correction">Explained correction</option></select></label><label className="text-sm font-semibold">Amount (UGX)<input required type="number" min="1" name="amountUgx" className={field}/></label><label className="text-sm font-semibold">Reference<input required minLength={2} maxLength={120} name="reference" placeholder="Bank slip or voucher number" className={field}/></label><label className="text-sm font-semibold">Source / recipient<input maxLength={160} name="counterparty" placeholder="Owner, bank or other party" className={field}/></label></div><label className="block text-sm font-semibold">Explanation<textarea required minLength={5} maxLength={500} name="notes" rows={3} className={field}/></label><div className="border-l-2 border-amber-500 bg-amber-50 p-3 text-xs text-amber-950">Do not record customer payments here. Record them against the related sale so receivables and profit remain correct.</div><button disabled={saving} className="w-full bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white">{saving?"Posting…":"Post permanent cash movement"}</button></form>
        </Modal>
        <Modal
          open={form === "partner"}
          title={editingPartner ? "Edit trade partner" : "Add trade partner"}
          description={editingPartner ? "Correct supplier or buyer details without changing linked transactions." : "Save a supplier, industrial buyer, or a business that performs both roles."}
          onClose={() => { setForm(""); setEditingPartnerId(""); }}
        >
          <form key={editingPartner?.id || "new-partner"} onSubmit={submitPartner} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Partner role
              <select
                name="partnerType"
                defaultValue={editingPartner?.partner_type || "supplier"}
                className={field}
              >
                <option value="supplier">Material supplier</option>
                <option value="buyer">Industrial buyer</option>
                <option value="both">Supplier and buyer</option>
              </select>
            </label>
            <label className="text-sm font-semibold">
              Business name
              <input required name="name" defaultValue={editingPartner?.name || ""} className={field} />
            </label>
            <label className="text-sm font-semibold">
              Contact person
              <input name="contactPerson" defaultValue={editingPartner?.contact_person || ""} className={field} />
            </label>
            <label className="text-sm font-semibold">
              Phone
              <input
                name="phone"
                defaultValue={editingPartner?.phone || ""}
                inputMode="tel"
                placeholder="+256782390653"
                maxLength={13}
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Email
              <input name="email" defaultValue={editingPartner?.email || ""} type="email" className={field} />
            </label>
            <label className="text-sm font-semibold">
              Tax / TIN number
              <input name="taxNumber" defaultValue={editingPartner?.tax_number || ""} className={field} />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Address
              <textarea name="address" defaultValue={editingPartner?.address || ""} rows={2} className={field} />
            </label>
            <button
              disabled={saving}
              className="bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white sm:col-span-2"
            >
              {saving ? "Saving…" : editingPartner ? "Update trade partner" : "Save trade partner"}
            </button>
          </form>
        </Modal>
        <Modal
          open={form === "purchaseHistory"}
          title="Supplier payment history"
          description={`${selectedPurchase?.source_name || "Purchase"} · ${selectedPurchase ? money(selectedPurchase.total_cost_ugx) : ""}`}
          onClose={() => { setForm(""); setSelectedPurchaseId(""); }}
        >
          <PaymentHistory records={selectedPurchasePayments} total={selectedPurchase?.total_cost_ugx || 0} balance={selectedPurchase?.balance_ugx || 0} empty="No supplier payments have been recorded." />
        </Modal>
        <Modal
          open={form === "partnerLedger"}
          title={`${selectedPartner?.name || "Trade partner"} ledger`}
          description="A single account of linked purchases, sales, payments and balances."
          onClose={() => { setForm(""); setSelectedPartnerId(""); }}
        >
          <div className="space-y-6">
            <div className="grid grid-cols-2 border-y border-slate-300 text-sm sm:grid-cols-4">
              {([
                ["Purchases", selectedPartnerPurchases.reduce((sum, item) => sum + Number(item.total_cost_ugx), 0)],
                ["Supplier balance", selectedPartnerPurchases.reduce((sum, item) => sum + Number(item.balance_ugx), 0)],
                ["Sales", selectedPartnerSales.reduce((sum, item) => sum + Number(item.total_ugx), 0)],
                ["Buyer balance", selectedPartnerSales.reduce((sum, item) => sum + Number(item.balance_ugx), 0)],
              ] as const).map(([label, value]) => (
                <div key={label} className="border-b border-r p-3 last:border-r-0 sm:border-b-0">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-1 font-semibold">{money(value)}</p>
                </div>
              ))}
            </div>
            <section>
              <h3 className="font-semibold">Purchases from this supplier</h3>
              {selectedPartnerPurchases.length ? <div className="mt-2 divide-y border-y border-slate-200">
                {selectedPartnerPurchases.map((item) => <div key={item.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto]">
                  <div><p className="font-semibold">{item.material_type} · {Number(item.quantity_kg).toLocaleString()} kg</p><p className="text-xs text-slate-500">{new Date(item.collected_on).toLocaleDateString("en-GB")} · {item.purchase_payment_state.replaceAll("_", " ")}</p></div>
                  <div className="sm:text-right"><p>{money(item.total_cost_ugx)}</p><p className="text-xs text-slate-500">Balance {money(item.balance_ugx)}</p></div>
                </div>)}
              </div> : <p className="mt-2 text-sm text-slate-500">No linked purchases.</p>}
            </section>
            <section>
              <h3 className="font-semibold">Sales to this buyer</h3>
              {selectedPartnerSales.length ? <div className="mt-2 divide-y border-y border-slate-200">
                {selectedPartnerSales.map((item) => <div key={item.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto]">
                  <div><p className="font-semibold">{item.material_type} · {Number(item.quantity_kg).toLocaleString()} kg</p><p className="text-xs text-slate-500">{new Date(item.sold_on).toLocaleDateString("en-GB")} · {item.payment_state.replaceAll("_", " ")}</p></div>
                  <div className="sm:text-right"><p>{money(item.total_ugx)}</p><p className="text-xs text-slate-500">Balance {money(item.balance_ugx)}</p></div>
                </div>)}
              </div> : <p className="mt-2 text-sm text-slate-500">No linked sales.</p>}
            </section>
          </div>
        </Modal>
        <Modal
          open={form === "saleHistory"}
          title="Customer receipt history"
          description={`${selectedSale?.buyer_name || "Industrial sale"} · ${selectedSale ? money(selectedSale.total_ugx) : ""}`}
          onClose={() => { setForm(""); setSelectedSaleId(""); }}
        >
          <PaymentHistory records={selectedSalePayments} total={selectedSale?.total_ugx || 0} balance={selectedSale?.balance_ugx || 0} empty="No customer receipts have been recorded." />
        </Modal>
        <Modal
          open={form === "purchasePayment"}
          title="Record supplier payment"
          description="Settle a purchase made on credit and capture the traceable payment reference."
          onClose={() => {
            setForm("");
            setSelectedPurchaseId("");
          }}
        >
          <form onSubmit={submitPurchasePayment} className="space-y-4">
            <label className="block text-sm font-semibold">
              Amount paid (UGX)
              <input required type="number" min="1" max={data?.lots.find(x => x.id === selectedPurchaseId)?.balance_ugx} name="amountUgx" defaultValue={data?.lots.find(x => x.id === selectedPurchaseId)?.balance_ugx} className={field} />
              <span className="mt-1 block text-xs font-normal text-slate-500">Remaining balance: {money(data?.lots.find(x => x.id === selectedPurchaseId)?.balance_ugx || 0)}</span>
            </label>
            <label className="block text-sm font-semibold">
              Payment made on
              <input
                required
                type="date"
                name="paymentReceivedOn"
                defaultValue={today()}
                className={field}
              />
            </label>
            <label className="block text-sm font-semibold">
              Payment reference
              <input
                required
                name="paymentReference"
                placeholder="Receipt, bank or mobile-money reference"
                className={field}
              />
            </label>
            <button
              disabled={saving || !selectedPurchaseId}
              className="w-full bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : "Confirm supplier payment"}
            </button>
          </form>
        </Modal>
        <Modal
          open={form === "payment"}
          title="Record sale payment"
          description="Capture when the buyer paid and the bank, mobile-money, receipt, or transfer reference."
          onClose={() => {
            setForm("");
            setSelectedSaleId("");
          }}
        >
          <form onSubmit={submitPayment} className="space-y-4">
            <label className="block text-sm font-semibold">
              Amount received (UGX)
              <input required type="number" min="1" max={data?.sales.find(x => x.id === selectedSaleId)?.balance_ugx} name="amountUgx" defaultValue={data?.sales.find(x => x.id === selectedSaleId)?.balance_ugx} className={field} />
              <span className="mt-1 block text-xs font-normal text-slate-500">Remaining balance: {money(data?.sales.find(x => x.id === selectedSaleId)?.balance_ugx || 0)}</span>
            </label>
            <label className="block text-sm font-semibold">
              Payment received on
              <input
                required
                type="date"
                name="paymentReceivedOn"
                defaultValue={today()}
                className={field}
              />
            </label>
            <label className="block text-sm font-semibold">
              Payment reference
              <input
                required
                name="paymentReference"
                placeholder="Receipt, bank or mobile-money reference"
                className={field}
              />
            </label>
            <button
              disabled={saving || !selectedSaleId}
              className="w-full bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : "Confirm payment"}
            </button>
          </form>
        </Modal>
        <Modal
          open={form === "purchaseDue" || form === "saleDue"}
          title="Change payment deadline"
          description={form === "purchaseDue" ? "Set when this credit purchase must be paid to the supplier." : "Set when the industrial buyer must pay this invoice."}
          onClose={() => { setForm(""); setSelectedPurchaseId(""); setSelectedSaleId(""); }}
        >
          <form onSubmit={submitDueDate} className="space-y-4">
            <label className="block text-sm font-semibold">
              Payment due on
              <input required type="date" name="dueOn" defaultValue={today()} className={field} />
            </label>
            <button disabled={saving} className="w-full bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">
              {saving ? "Saving…" : "Save deadline"}
            </button>
          </form>
        </Modal>
        <Modal
          open={form === "followUp"}
          title="Record payment follow-up"
          description="Keep a clear collection history for this unpaid industrial invoice."
          onClose={() => { setForm(""); setSelectedSaleId(""); }}
        >
          <form onSubmit={submitFollowUp} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">Contact method<select required name="contactMethod" defaultValue="phone" className={field}><option value="phone">Phone call</option><option value="email">Email</option><option value="message">Message</option><option value="visit">Site visit</option></select></label>
            <label className="text-sm font-semibold">Outcome<select required name="outcome" defaultValue="contacted" className={field}><option value="contacted">Contacted</option><option value="promise_to_pay">Promise to pay</option><option value="no_response">No response</option><option value="disputed">Invoice disputed</option><option value="escalated">Escalated</option></select></label>
            <label className="text-sm font-semibold sm:col-span-2">Follow-up note<textarea required minLength={3} maxLength={1000} name="note" rows={4} placeholder="What was agreed or what should happen next?" className={field} /></label>
            <label className="text-sm font-semibold sm:col-span-2">Next follow-up date (optional)<input type="date" name="nextFollowUpOn" min={today()} className={field} /></label>
            <button disabled={saving || !selectedSaleId} className="bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white sm:col-span-2 disabled:opacity-40">{saving ? "Saving…" : "Save follow-up"}</button>
          </form>
        </Modal>
      </div>
    </AppShell>
  );
}

function PaymentHistory({ records, total, balance, empty }: { records: PaymentRecord[]; total: string | number; balance: string | number; empty: string }) {
  if (!records.length) return <EmptyState title="No payment history" description={empty} />;
  return <div>
    <div className="mb-5 grid grid-cols-2 border-y border-slate-300 text-sm">
      <div className="border-r p-4"><p className="text-slate-500">Total</p><p className="mt-1 font-semibold">{money(total)}</p></div>
      <div className="p-4"><p className="text-slate-500">Remaining</p><p className="mt-1 font-semibold">{money(balance)}</p></div>
    </div>
    <div className="divide-y border-y border-slate-200">
      {records.map((payment) => <div key={payment.id} className="grid gap-1 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div><p className="font-semibold">{payment.reference}</p><p className="mt-1 text-xs text-slate-500">{new Date(payment.paid_on).toLocaleDateString("en-GB")}</p></div>
        <p className="font-semibold text-emerald-700">{money(payment.amount_ugx)}</p>
      </div>)}
    </div>
  </div>;
}
