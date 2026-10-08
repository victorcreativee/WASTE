"use client";
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
  origin: "purchase" | "sorting_output";
  purchase_payment_status: "paid" | "credit" | "partially_paid";
  purchase_payment_reference: string | null;
  purchase_paid_on: string | null;
  purchase_due_on: string | null;
  purchase_payment_state: "paid" | "credit" | "partially_paid" | "due_soon" | "overdue";
  paid_ugx: string;
  balance_ugx: string;
  recorded_by_name: string | null;
};
type Sale = {
  id: string;
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
  transaction_type: "given" | "spent";
  amount_ugx: string;
  running_balance_ugx: string;
  notes: string | null;
};
type SortingBatch = {
  id: string;
  processed_on: string;
  input_material_type: string;
  input_kg: string;
  output_material: string;
  output_kg: string;
  rejected_kg: string;
  processing_cost_ugx: string;
};
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
  creditPurchasesUgx: number;
  overduePayablesUgx: number;
  dueSoonPayablesUgx: number;
  revenueUgx: number;
  unpaidSalesUgx: number;
  overdueReceivablesUgx: number;
  dueSoonReceivablesUgx: number;
  saleExpensesUgx: number;
  processingCostUgx: number;
  profitLossUgx: number;
  floatBalanceUgx: number;
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
  receivedTodayKg: number;
  sortedTodayKg: number;
  soldTodayKg: number;
  stockLotsReady: number;
  awaitingSortingKg: number;
  saleableStockKg: number;
  workQueue: Array<{ lotId: string; materialType: string; sourceName: string; receivedOn: string; availableKg: number; quality: string }>;
};
type Data = {
  organization: { name: string; type: string };
  summary: Summary;
  operations: Operations;
  lots: Lot[];
  sales: Sale[];
  floatTransactions: FloatTx[];
  sortingBatches: SortingBatch[];
  stockAdjustments: StockAdjustment[];
  partners: Partner[];
  salePayments: PaymentRecord[];
  purchasePayments: PaymentRecord[];
  materials: MaterialCatalogItem[];
  materialPerformance: MaterialPerformance[];
  expenseBreakdown: ExpenseBreakdown;
  paymentAging: { receivables: AgingBuckets; payables: AgingBuckets };
  buyerExposure: Array<{ buyerName: string; amountUgx: number }>;
  upcomingFollowUps: Array<{ saleId: string; buyerName: string; invoiceNumber: string | null; amountUgx: number; nextFollowUpOn: string; outcome: string }>;
  myActivity?: { purchases?: number; purchasedKg?: number; sales: number; soldKg: number; saleValueUgx?: number; outstandingUgx?: number };
};
type FormKind =
  | ""
  | "purchase"
  | "sorting"
  | "adjustment"
  | "sale"
  | "float"
  | "partner"
  | "payment"
  | "purchasePayment"
  | "saleDue"
  | "purchaseDue"
  | "followUp"
  | "saleHistory"
  | "purchaseHistory"
  | "material";
const today = () => new Date().toISOString().slice(0, 10),
  field = "mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal",
  money = (n: string | number) => `USh ${Number(n).toLocaleString()}`;
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
    workerMode = collectorMode || salesMode,
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [form, setForm] = useState<FormKind>(""),
    [actionMenu, setActionMenu] = useState(false),
    [selectedSaleId, setSelectedSaleId] = useState(""),
    [selectedPurchaseId, setSelectedPurchaseId] = useState(""),
    [saving, setSaving] = useState(false),
    [tab, setTab] = useState<
      | "insights"
      | "partners"
      | "purchases"
      | "sorting"
      | "stock"
      | "sales"
      | "float"
    >(collectorMode ? "purchases" : salesMode ? "sales" : "insights");
  const selectedSale = data?.sales.find((item) => item.id === selectedSaleId),
    selectedPurchase = data?.lots.find((item) => item.id === selectedPurchaseId),
    selectedSalePayments = data?.salePayments.filter((item) => item.sale_id === selectedSaleId) || [],
    selectedPurchasePayments = data?.purchasePayments.filter((item) => item.lot_id === selectedPurchaseId) || [];
  async function load() {
    try {
      setError("");
      setData((await apiRequest<{ data: Data }>("/api/waste/recycling")).data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load recycling workspace",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function openForm(next: FormKind) {
    setError("");
    setNotice("");
    setActionMenu(false);
    setForm(next);
  }
  const values = (f: FormData, names: readonly string[]) =>
    Object.fromEntries(names.map((name) => [name, Number(f.get(name) || 0)]));
  async function submitPurchase(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      f = new FormData(el);
    try {
      setSaving(true);
      setError("");
      await apiRequest("/api/waste/recycling/lots", {
        method: "POST",
        body: JSON.stringify({
          materialType: f.get("materialType"),
          supplierPartnerId: f.get("supplierPartnerId") || undefined,
          sourceName: f.get("sourceName"),
          quantityKg: Number(f.get("quantityKg")),
          unitPurchasePriceUgx: Number(f.get("unitPurchasePriceUgx")),
          collectedOn: f.get("collectedOn"),
          quality: f.get("quality"),
          purchasePaymentStatus: f.get("purchasePaymentStatus"),
          purchasePaymentReference:
            f.get("purchasePaymentReference") || undefined,
          ...values(f, [
            "workerWagesUgx",
            "foodUgx",
            "transportUgx",
            "driverFeeUgx",
            "otherExpenseUgx",
            "managerFloatUsedUgx",
          ]),
          notes: f.get("notes") || undefined,
        }),
      });
      el.reset();
      setForm("");
      setNotice("Material purchase and costs recorded.");
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
      await apiRequest("/api/waste/recycling/sales", {
        method: "POST",
        body: JSON.stringify({
          lotId: f.get("lotId"),
          buyerPartnerId: f.get("buyerPartnerId") || undefined,
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
      setForm("");
      setNotice("Industrial sale, expenses and stock movement recorded.");
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
          notes: f.get("notes") || undefined,
        }),
      });
      el.reset();
      setForm("");
      setNotice("Manager float updated.");
      await load();
    } catch (x) {
      setError(
        x instanceof Error ? x.message : "Could not update manager float",
      );
    } finally {
      setSaving(false);
    }
  }
  async function submitSorting(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      f = new FormData(el);
    try {
      setSaving(true);
      setError("");
      await apiRequest("/api/waste/recycling/sorting", {
        method: "POST",
        body: JSON.stringify({
          inputLotId: f.get("inputLotId"),
          processedOn: f.get("processedOn"),
          inputKg: Number(f.get("inputKg")),
          outputMaterialType: f.get("outputMaterialType"),
          outputKg: Number(f.get("outputKg")),
          rejectedKg: Number(f.get("rejectedKg") || 0),
          processingCostUgx: Number(f.get("processingCostUgx") || 0),
          notes: f.get("notes") || undefined,
        }),
      });
      el.reset();
      setForm("");
      setTab("sorting");
      setNotice("Sorting recorded and saleable graded stock created.");
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not record sorting");
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
      await apiRequest("/api/waste/recycling/partners", {
        method: "POST",
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
      setTab("partners");
      setNotice("Trade partner saved.");
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
  function exportRecords() {
    if (!data) return;
    const rows = [
      [
        "Record type",
        "Date",
        "Material",
        "Partner",
        "Quantity kg",
        "Amount USh",
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
      ["float", "Cash & float"],
    ] as const).filter(([id]) => !workerMode || (collectorMode ? ["purchases", "sales"].includes(id) : ["partners", "stock", "sales"].includes(id)));
  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Recycling company operations"
          title="EcoTrade workspace"
          description={collectorMode ? "Record material bought each day and any approved sale to a local buyer." : salesMode ? "Manage saleable stock, industrial buyers, dispatches, invoices and payment follow-up." : "Track manager float, purchases, sorting, industrial sales, expenses and profit in one connected workflow."}
          action={
            recycling ? (
              <div className="relative flex gap-2">
                {!workerMode && <button
                  onClick={exportRecords}
                  className="border border-slate-400 px-4 py-2.5 text-sm font-semibold"
                >
                  Export records
                </button>}
                <button
                  onClick={() => setActionMenu((open) => !open)}
                  aria-expanded={actionMenu}
                  className="bg-[#3156a3] px-5 py-2.5 text-sm font-semibold text-white"
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
                        "Record money given or other spending",
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
                    ].filter(([kind]) => !workerMode || (collectorMode ? ["purchase", "sale"].includes(kind) : ["sale", "partner"].includes(kind))).map(([kind, title, description]) => {
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
            {workerMode && <section className="mt-7 border-l-2 border-[#3156a3] bg-blue-50 p-5"><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#3156a3]">Your responsibility</p><h2 className="mt-1 text-xl font-semibold">{collectorMode ? "Daily collection and purchasing" : "Industrial sales and buyer management"}</h2><p className="mt-2 text-sm text-slate-600">{collectorMode ? "Record every material purchase with its real kilograms, material type, supplier, price, and date. You may also record approved sales to local buyers." : "Use saleable stock to record industry sales, maintain buyer records, issue traceable invoice details, and follow up outstanding payments."}</p>{data.myActivity&&<div className="mt-5 grid gap-px bg-blue-200 sm:grid-cols-4">{(collectorMode?[["Purchases today",data.myActivity.purchases||0],["Kg bought today",`${Number(data.myActivity.purchasedKg||0).toLocaleString()} kg`],["Local sales today",data.myActivity.sales],["Kg sold today",`${Number(data.myActivity.soldKg).toLocaleString()} kg`]]:[["Sales today",data.myActivity.sales],["Kg dispatched",`${Number(data.myActivity.soldKg).toLocaleString()} kg`],["Sales value",money(data.myActivity.saleValueUgx||0)],["My outstanding",money(data.myActivity.outstandingUgx||0)]]).map(([label,value])=><div key={label} className="bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}</div>}</section>}
            <section className={`${workerMode ? "hidden" : "mt-7"} border border-slate-200 bg-slate-50 p-5`}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#3156a3]">
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
              </div>
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
                    <p className="text-xs font-semibold text-[#c6842f]">
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
                      className="mt-3 text-sm font-semibold text-[#3156a3] disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      {item.disabled ? "Complete previous step" : item.action} →
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <section className={`${workerMode ? "hidden" : "mt-7"} grid border-y border-slate-300 sm:grid-cols-2 lg:grid-cols-5`}>
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
            {!workerMode && (data.summary.overdueReceivablesUgx > 0 ||
              data.summary.overduePayablesUgx > 0 ||
              data.summary.dueSoonReceivablesUgx > 0 ||
              data.summary.dueSoonPayablesUgx > 0) && (
              <section className="mt-5 grid gap-3 md:grid-cols-2" aria-label="Payment deadlines">
                <button onClick={() => setTab("sales")} className="border-l-2 border-red-600 bg-red-50 p-4 text-left text-sm">
                  <strong>Customer payments:</strong> {money(data.summary.overdueReceivablesUgx)} overdue · {money(data.summary.dueSoonReceivablesUgx)} due within 7 days
                  <span className="mt-1 block font-semibold text-[#3156a3]">Review industrial sales →</span>
                </button>
                <button onClick={() => setTab("purchases")} className="border-l-2 border-[#c6842f] bg-amber-50 p-4 text-left text-sm">
                  <strong>Supplier payments:</strong> {money(data.summary.overduePayablesUgx)} overdue · {money(data.summary.dueSoonPayablesUgx)} due within 7 days
                  <span className="mt-1 block font-semibold text-[#3156a3]">Review credit purchases →</span>
                </button>
              </section>
            )}
            {!workerMode && <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between border-l-2 border-[#c6842f] bg-amber-50 p-4 text-sm">
                <span>
                  <strong>Manager float:</strong>{" "}
                  {money(data.summary.floatBalanceUgx)}
                </span>
                <button
                  onClick={() => setForm("float")}
                  className="font-semibold text-[#3156a3]"
                >
                  Record movement
                </button>
              </div>
              <div className="border-l-2 border-[#3156a3] bg-blue-50 p-4 text-sm">
                <strong>Processing cost:</strong>{" "}
                {money(data.summary.processingCostUgx)} · included in
                profit/loss
              </div>
            </div>}
            <nav className="mt-8 flex gap-6 overflow-x-auto border-b">
              {tabs.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => {
                    setTab(id);
                    setError("");
                    setNotice("");
                  }}
                  className={`whitespace-nowrap pb-3 text-sm font-semibold ${tab === id ? "border-b-2 border-[#3156a3] text-[#3156a3]" : "text-slate-500"}`}
                >
                  {label}
                </button>
              ))}
            </nav>
            {tab === "insights" && (
              <div className="mt-6 space-y-7">
                <section>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#3156a3]">Today&apos;s operations</p>
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
                      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Materials awaiting processing</h3><button onClick={() => openForm("sorting")} disabled={!data.operations.workQueue.length} className="text-sm font-semibold text-[#3156a3] disabled:text-slate-400">Record sorting →</button></div>
                      {data.operations.workQueue.length ? <div className="mt-2 divide-y border-y text-sm">{data.operations.workQueue.map(item => <div key={item.lotId} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="font-semibold">{item.materialType}</p><p className="text-xs text-slate-500">{item.sourceName} · received {new Date(item.receivedOn).toLocaleDateString("en-GB")} · {item.quality}</p></div><p className="font-semibold">{item.availableKg.toLocaleString()} kg available</p></div>)}</div> : <p className="mt-2 border-y py-5 text-sm text-slate-500">No purchased material is waiting. Record the next material purchase when it arrives.</p>}
                    </div>
                    <div className="border border-slate-200 p-4">
                      <h3 className="font-semibold">Stock position</h3>
                      <div className="mt-3 divide-y text-sm"><div className="flex justify-between py-3"><span>Incoming / unsorted</span><strong>{data.operations.awaitingSortingKg.toLocaleString()} kg</strong></div><div className="flex justify-between py-3"><span>Sorted saleable stock</span><strong>{data.operations.saleableStockKg.toLocaleString()} kg</strong></div></div>
                      <button onClick={() => setTab("stock")} className="mt-3 text-sm font-semibold text-[#3156a3]">Open material stock →</button>
                    </div>
                  </div>
                </section>
                {!workerMode && <section>
                  <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-6">
                    <div>
                      <h2 className="text-xl font-semibold">Material catalogue</h2>
                      <p className="mt-1 text-sm text-slate-500">The same controlled material names are used when receiving, sorting, reporting, and selling stock.</p>
                    </div>
                    <button onClick={() => openForm("material")} className="border border-[#3156a3] px-4 py-2.5 text-sm font-semibold text-[#3156a3]">Add material type</button>
                  </div>
                  <div className="mt-4 grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
                    {data.materials.map((material) => (
                      <div key={material.id} className="flex items-center justify-between gap-3 bg-white p-4">
                        <div><p className="font-semibold">{material.name}</p><p className="text-xs capitalize text-slate-500">{material.category} · {material.active ? "Active" : "Inactive"}</p></div>
                        <button disabled={saving} onClick={() => void toggleMaterial(material)} className="text-xs font-semibold text-[#3156a3]">{material.active ? "Deactivate" : "Activate"}</button>
                      </div>
                    ))}
                  </div>
                </section>}
                <section>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#3156a3]">Payment control</p>
                  <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">What must be collected or paid next</h2>
                      <p className="mt-1 text-sm text-slate-500">Balances are grouped by days past their payment deadline.</p>
                    </div>
                    <button onClick={() => setTab("sales")} className="text-sm font-semibold text-[#3156a3]">Open industrial sales →</button>
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
                      {data.upcomingFollowUps.length ? <div className="mt-2 divide-y border-y text-sm">{data.upcomingFollowUps.slice(0,5).map(x=><button key={x.saleId} onClick={()=>setTab("sales")} className="flex w-full items-center justify-between gap-4 py-3 text-left"><span><strong>{x.buyerName}</strong><span className="block text-xs text-slate-500">{x.invoiceNumber||"No invoice number"} · {new Date(x.nextFollowUpOn).toLocaleDateString("en-GB")}</span></span><span className="font-semibold text-[#3156a3]">{money(x.amountUgx)} →</span></button>)}</div>:<p className="mt-2 border-y py-5 text-sm text-slate-500">No payment follow-ups scheduled.</p>}
                    </div>
                  </div>
                </section>
                <section>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#3156a3]">
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
                        <th>Tax number</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.partners.map((partner) => (
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
                          <td>{partner.tax_number || "—"}</td>
                          <td>
                            <Status
                              value={partner.active ? "active" : "inactive"}
                            />
                          </td>
                          <td>
                            <button
                              disabled={saving}
                              onClick={() => void togglePartner(partner)}
                              className="text-sm font-semibold text-[#3156a3]"
                            >
                              {partner.active ? "Deactivate" : "Activate"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No trade partners"
                  description="Save regular material suppliers and industrial buyers so transactions remain consistent and traceable."
                  action={
                    <button
                      onClick={() => setForm("partner")}
                      className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white"
                    >
                      Add first partner
                    </button>
                  }
                />
              ))}
            {tab === "purchases" &&
              (data.lots.filter((x) => x.origin === "purchase").length ? (
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
                      {data.lots
                        .filter((x) => x.origin === "purchase")
                        .map((x) => (
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
                                <button onClick={() => { setSelectedPurchaseId(x.id); setForm("purchaseHistory"); }} className="mt-2 block text-xs font-semibold text-[#3156a3]">View payment history</button>
                              )}
                              {x.purchase_payment_status !== "paid" && !workerMode && (
                                <div className="mt-2 flex flex-wrap gap-3">
                                  <button disabled={saving} onClick={() => { setSelectedPurchaseId(x.id); setForm("purchasePayment"); }} className="text-xs font-semibold text-[#3156a3]">Record payment</button>
                                  <button disabled={saving} onClick={() => { setSelectedPurchaseId(x.id); setForm("purchaseDue"); }} className="text-xs font-semibold text-[#3156a3]">Change due date</button>
                                </div>
                              )}
                            </td>
                            <td>
                              <Status value={x.status} />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
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
                        <th>Input material</th>
                        <th>Input</th>
                        <th>Output grade</th>
                        <th>Saleable</th>
                        <th>Rejected</th>
                        <th>Processing cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sortingBatches.map((x) => (
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No sorting records"
                  description="Convert purchased mixed material into a saleable grade. Each record creates graded stock and removes its input weight from the source lot."
                />
              ))}
            {tab === "stock" && (
              <div className="mt-5 space-y-7">
                <section>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">Available material</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Current stock after purchases, sorting, sales, and approved corrections.
                      </p>
                    </div>
                    <button
                      disabled={!data.lots.length}
                      onClick={() => openForm("adjustment")}
                      className="border border-[#3156a3] px-4 py-2.5 text-sm font-semibold text-[#3156a3] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Adjust stock
                    </button>
                  </div>
                  {data.lots.some((x) => Number(x.available_kg) > 0) ? (
                    <div className="table-wrap mt-4">
                  <table>
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Source</th>
                        <th>Original quantity</th>
                        <th>Available</th>
                        <th>Quality</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.lots
                        .filter((x) => Number(x.available_kg) > 0)
                        .map((x) => (
                          <tr key={x.id}>
                            <td className="table-primary">{x.material_type}</td>
                            <td>
                              {x.origin === "sorting_output"
                                ? "Sorting output"
                                : "Purchased"}
                            </td>
                            <td>{Number(x.quantity_kg).toLocaleString()} kg</td>
                            <td className="font-semibold">
                              {Number(x.available_kg).toLocaleString()} kg
                            </td>
                            <td className="capitalize">{x.quality}</td>
                            <td>
                              <Status value={x.status} />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                    </div>
                  ) : (
                    <EmptyState
                      title="No stock available"
                      description="Material stock appears after the first purchase or sorting output is recorded."
                    />
                  )}
                </section>
                <section>
                  <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-6">
                    <div>
                      <h2 className="text-xl font-semibold">Adjustment history</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        A permanent audit trail for loss, damage, and verified stock-count corrections.
                      </p>
                    </div>
                    <p className="text-sm text-slate-500">
                      Added {data.summary.stockAddedKg.toLocaleString()} kg · Removed {data.summary.stockRemovedKg.toLocaleString()} kg
                    </p>
                  </div>
                  {data.stockAdjustments.length ? (
                    <div className="table-wrap mt-4">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th><th>Material</th><th>Adjustment</th><th>Quantity</th><th>Reason</th><th>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.stockAdjustments.map((x) => (
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
                      </table>
                    </div>
                  ) : (
                    <EmptyState title="No stock adjustments" description="No inventory corrections have been recorded. Normal purchases, sorting, and sales do not appear here." />
                  )}
                </section>
              </div>
            )}
            {tab === "sales" &&
              (data.sales.length ? (
                <div className="table-wrap mt-5">
                  <table>
                    <thead>
                      <tr>
                        <th>Date / material</th>
                        <th>Buyer</th>
                        <th>Recorded by</th>
                        <th>Invoice</th>
                        <th>Quantity</th>
                        <th>Gross sale</th>
                        <th>Sale expenses</th>
                        <th>Net income</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sales.map((x) => (
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
                          <td>{x.recorded_by_name || "System"}</td>
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
                          <td>{Number(x.quantity_kg).toLocaleString()} kg</td>
                          <td>{money(x.total_ugx)}{Number(x.paid_ugx) > 0 && <p className="table-secondary">Paid {money(x.paid_ugx)} · Balance {money(x.balance_ugx)}</p>}</td>
                          <td>{money(x.expenses_ugx)}</td>
                          <td className="font-semibold">
                            {money(x.net_income_ugx)}
                          </td>
                          <td>
                            <div className="flex gap-2">
                              <Status value={x.payment_state} />
                              {x.status !== "paid" && !collectorMode && (
                                <>
                                  <button disabled={saving} onClick={() => { setSelectedSaleId(x.id); setForm("payment"); }} className="text-xs font-semibold text-[#3156a3]">Mark paid</button>
                                  <button disabled={saving} onClick={() => { setSelectedSaleId(x.id); setForm("saleDue"); }} className="text-xs font-semibold text-[#3156a3]">Change due date</button>
                                  <button disabled={saving} onClick={() => { setSelectedSaleId(x.id); setForm("followUp"); }} className="text-xs font-semibold text-[#3156a3]">Record follow-up</button>
                                </>
                              )}
                            </div>
                            {Number(x.paid_ugx) > 0 && <button onClick={() => { setSelectedSaleId(x.id); setForm("saleHistory"); }} className="mt-2 text-xs font-semibold text-[#3156a3]">View payment history</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No industrial sales"
                  description="Record a sale from available graded material stock, including its buyer, price and selling expenses."
                />
              ))}
            {tab === "float" &&
              (data.floatTransactions.length ? (
                <div className="table-wrap mt-5">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Movement</th>
                        <th>Amount</th>
                        <th>Running balance</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.floatTransactions.map((x) => (
                        <tr key={x.id}>
                          <td>
                            {new Date(x.transaction_date).toLocaleDateString(
                              "en-GB",
                            )}
                          </td>
                          <td className="capitalize">{x.transaction_type}</td>
                          <td>{money(x.amount_ugx)}</td>
                          <td className="font-semibold">
                            {money(x.running_balance_ugx)}
                          </td>
                          <td>{x.notes || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No manager float movements"
                  description="Record money given to the manager. Purchase amounts marked as paid from float are deducted automatically."
                />
              ))}
          </>
        )}
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
            <div className="border-l-2 border-[#3156a3] bg-blue-50 p-3 text-xs text-slate-700 sm:col-span-2">Use a specific commercial grade where possible. Existing transaction records will remain unchanged if this material is later deactivated.</div>
            <button disabled={saving} className="bg-[#3156a3] px-4 py-3 text-sm font-semibold text-white sm:col-span-2">{saving ? "Saving…" : "Add material type"}</button>
          </form>
        </Modal>
        <Modal
          open={form === "purchase"}
          title="Record material purchase"
          description="Use a separate purchase for each material bought at a different price."
          onClose={() => setForm("")}
        >
          <form onSubmit={submitPurchase} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Material type
              <select required name="materialType" defaultValue="" className={field}>
                <option value="">Choose material</option>
                {data?.materials.filter((x) => x.active).map((x) => (
                  <option key={x.id} value={x.name}>{x.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Saved supplier (optional)
              <select name="supplierPartnerId" className={field}>
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
              <input required name="sourceName" className={field} />
            </label>
            <label className="text-sm font-semibold">
              Kg bought
              <input
                required
                type="number"
                min=".01"
                step=".01"
                name="quantityKg"
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Price paid per kg (USh)
              <input
                required
                type="number"
                min="0"
                name="unitPurchasePriceUgx"
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Purchase date
              <input
                required
                type="date"
                name="collectedOn"
                defaultValue={today()}
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Material condition
              <select name="quality" defaultValue="mixed" className={field}>
                <option value="mixed">Mixed</option>
                <option value="sorted">Sorted</option>
                <option value="clean">Clean</option>
                <option value="contaminated">Contaminated</option>
              </select>
            </label>
            <label className="text-sm font-semibold">
              Purchase payment
              <select
                name="purchasePaymentStatus"
                defaultValue="paid"
                className={field}
              >
                <option value="paid">Paid</option>
                <option value="credit">Bought on credit</option>
              </select>
            </label>
            <label className="text-sm font-semibold">
              Payment reference (optional)
              <input name="purchasePaymentReference" className={field} />
            </label>
            {expenseFields.map(([name, label]) => (
              <label key={name} className="text-sm font-semibold">
                {label} (USh)
                <input
                  type="number"
                  min="0"
                  name={name}
                  defaultValue="0"
                  className={field}
                />
              </label>
            ))}
            <label className="text-sm font-semibold">
              Driver fee (USh)
              <input
                type="number"
                min="0"
                name="driverFeeUgx"
                defaultValue="0"
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Paid from manager float (USh)
              <input
                type="number"
                min="0"
                name="managerFloatUsedUgx"
                defaultValue="0"
                className={field}
              />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Notes
              <textarea name="notes" rows={2} className={field} />
            </label>
            <button
              disabled={saving}
              className="bg-[#3156a3] px-4 py-3 text-sm font-semibold text-white sm:col-span-2"
            >
              {saving ? "Saving…" : "Save purchase"}
            </button>
          </form>
        </Modal>
        <Modal
          open={form === "sorting"}
          title="Record sorting and grading"
          description="Choose purchased input stock and create one saleable material grade. Record another line when the same mixed lot produces a second grade."
          onClose={() => setForm("")}
        >
          <form onSubmit={submitSorting} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold sm:col-span-2">
              Input material lot
              <select required name="inputLotId" className={field}>
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
            </label>
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
              Input weight (kg)
              <input
                required
                type="number"
                min=".01"
                step=".01"
                name="inputKg"
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Output material grade
              <select
                required
                name="outputMaterialType"
                defaultValue=""
                className={field}
              >
                <option value="">Choose saleable material grade</option>
                {data?.materials.filter((x) => x.active).map((x) => (
                  <option key={x.id} value={x.name}>{x.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Saleable output (kg)
              <input
                required
                type="number"
                min=".01"
                step=".01"
                name="outputKg"
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Rejected / waste (kg)
              <input
                type="number"
                min="0"
                step=".01"
                name="rejectedKg"
                defaultValue="0"
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Processing cost (USh)
              <input
                type="number"
                min="0"
                name="processingCostUgx"
                defaultValue="0"
                className={field}
              />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Notes
              <textarea name="notes" rows={2} className={field} />
            </label>
            <div className="border-l-2 border-[#c6842f] bg-amber-50 p-3 text-xs text-slate-700 sm:col-span-2">
              Saleable output plus rejected weight cannot exceed the input
              weight. Any difference remains recorded as unclassified processing
              loss.
            </div>
            <button
              disabled={saving}
              className="bg-[#3156a3] px-4 py-3 text-sm font-semibold text-white sm:col-span-2"
            >
              {saving ? "Saving…" : "Save sorting output"}
            </button>
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
              <input required minLength={3} name="reason" placeholder="Example: Contaminated during storage" className={field} />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Additional notes (optional)
              <textarea name="notes" rows={3} className={field} />
            </label>
            <div className="border-l-2 border-[#c6842f] bg-amber-50 p-3 text-xs text-slate-700 sm:col-span-2">
              This action changes available stock and creates a permanent audit record. It does not edit the original purchase, sorting, or sale record.
            </div>
            <button disabled={saving} className="bg-[#3156a3] px-4 py-3 text-sm font-semibold text-white sm:col-span-2">
              {saving ? "Saving…" : "Record stock adjustment"}
            </button>
          </form>
        </Modal>
        <Modal
          open={form === "sale"}
          title={collectorMode ? "Record local sale" : "Record industrial sale"}
          description="Stock reduces automatically and the sale remains traceable to the responsible worker."
          onClose={() => setForm("")}
        >
          <form onSubmit={submitSale} className="grid gap-4 sm:grid-cols-2">
            {workerMode ? <input type="hidden" name="saleChannel" value={collectorMode ? "local" : "industrial"} /> : <label className="text-sm font-semibold sm:col-span-2">Sale channel<select name="saleChannel" defaultValue="industrial" className={field}><option value="industrial">Industry buyer</option><option value="local">Local buyer</option></select></label>}
            <label className="text-sm font-semibold sm:col-span-2">
              Material stock
              <select required name="lotId" className={field}>
                <option value="">Choose available material</option>
                {data?.lots
                  .filter((x) => Number(x.available_kg) > 0)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.material_type} ·{" "}
                      {Number(x.available_kg).toLocaleString()} kg
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Saved {collectorMode ? "local" : "industrial"} buyer
              <select name="buyerPartnerId" className={field}>
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
            <label className="text-sm font-semibold">
              New buyer name (if not saved)
              <input name="buyerName" className={field} />
            </label>
            <label className="text-sm font-semibold">
              Buyer category
              <input required name="industry" placeholder={collectorMode ? "Local trader, shop, community buyer" : "Manufacturing or recycling industry"} className={field} />
            </label>
            <label className="text-sm font-semibold">
              Quantity (kg)
              <input
                required
                type="number"
                min=".01"
                step=".01"
                name="quantityKg"
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Price per kg (USh)
              <input
                required
                type="number"
                min="1"
                name="unitPriceUgx"
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Invoice number (optional)
              <input name="invoiceNumber" className={field} />
            </label>
            <label className="text-sm font-semibold">
              Sale date
              <input
                required
                type="date"
                name="soldOn"
                defaultValue={today()}
                className={field}
              />
            </label>
            {expenseFields.map(([name, label]) => (
              <label key={name} className="text-sm font-semibold">
                {label} (USh)
                <input
                  type="number"
                  min="0"
                  name={name}
                  defaultValue="0"
                  className={field}
                />
              </label>
            ))}
            <label className="text-sm font-semibold sm:col-span-2">
              Notes
              <textarea name="notes" rows={2} className={field} />
            </label>
            <button
              disabled={saving}
              className="bg-[#3156a3] px-4 py-3 text-sm font-semibold text-white sm:col-span-2"
            >
              {saving ? "Saving…" : "Save sale"}
            </button>
          </form>
        </Modal>
        <Modal
          open={form === "float"}
          title="Manager float"
          description="Record money given to the manager or a separate reported expense. Purchase float use is deducted automatically."
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
                <option value="given">Money given</option>
                <option value="spent">Other money spent</option>
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Amount (USh)
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
              <textarea name="notes" rows={3} className={field} />
            </label>
            <button
              disabled={saving}
              className="w-full bg-[#3156a3] px-4 py-3 text-sm font-semibold text-white"
            >
              {saving ? "Saving…" : "Save float movement"}
            </button>
          </form>
        </Modal>
        <Modal
          open={form === "partner"}
          title="Add trade partner"
          description="Save a supplier, industrial buyer, or a business that performs both roles."
          onClose={() => setForm("")}
        >
          <form onSubmit={submitPartner} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Partner role
              <select
                name="partnerType"
                defaultValue="supplier"
                className={field}
              >
                <option value="supplier">Material supplier</option>
                <option value="buyer">Industrial buyer</option>
                <option value="both">Supplier and buyer</option>
              </select>
            </label>
            <label className="text-sm font-semibold">
              Business name
              <input required name="name" className={field} />
            </label>
            <label className="text-sm font-semibold">
              Contact person
              <input name="contactPerson" className={field} />
            </label>
            <label className="text-sm font-semibold">
              Phone
              <input
                name="phone"
                inputMode="tel"
                placeholder="+256782390653"
                maxLength={13}
                className={field}
              />
            </label>
            <label className="text-sm font-semibold">
              Email
              <input name="email" type="email" className={field} />
            </label>
            <label className="text-sm font-semibold">
              Tax / TIN number
              <input name="taxNumber" className={field} />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Address
              <textarea name="address" rows={2} className={field} />
            </label>
            <button
              disabled={saving}
              className="bg-[#3156a3] px-4 py-3 text-sm font-semibold text-white sm:col-span-2"
            >
              {saving ? "Saving…" : "Save trade partner"}
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
              Amount paid (USh)
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
              className="w-full bg-[#3156a3] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
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
              Amount received (USh)
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
              className="w-full bg-[#3156a3] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
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
            <button disabled={saving} className="w-full bg-[#3156a3] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">
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
            <button disabled={saving || !selectedSaleId} className="bg-[#3156a3] px-4 py-3 text-sm font-semibold text-white sm:col-span-2 disabled:opacity-40">{saving ? "Saving…" : "Save follow-up"}</button>
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
