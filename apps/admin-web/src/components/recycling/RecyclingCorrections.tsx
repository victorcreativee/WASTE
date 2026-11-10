"use client";
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, openAuthenticatedFile } from "@/lib/api";
import { Modal } from "@/components/ui/System";

const money = (n: number) => `UGX ${Number(n).toLocaleString()}`;
const kg = (n: number) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`;
const NEW_MATERIAL = "__new__";
const input = "mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm font-normal";
const label = "block text-sm font-semibold text-slate-700";

type Kind = "count" | "move" | "cash" | "cancel";
type Entry = { id: string; reference: string | null; date: string; description: string | null; amount_ugx: number; status?: string; transaction_type?: string; direction?: string; category?: string };
type Cancellable = { expenses: Entry[]; float: Entry[]; cash: Entry[] };
type PhysicalDifference = { material: string; recordedKg: number; physicalKg: number; differenceKg: number };

export type CorrectionEdit = {
  id: string;
  transaction_type: string;
  transaction_id: string;
  before_state: Record<string, any>;
  after_state: Record<string, any>;
  edited_by_name: string;
  edited_at: string;
};
export const isCorrection = (edit: { transaction_type: string }) => ["physical_stock_count", "material_transfer", "material_transfer_reversal", "cash_correction", "entry_cancelled"].includes(edit.transaction_type);

/** The company administrator's corrections: move material between names, take money off a cash balance, or cancel a wrong entry. */
export function CorrectionsPanel({ stock, materials, today, officeCashUgx, floatBalanceUgx, onDone }: {
  stock: Array<{ material: string; availableKg: number }>;
  materials: string[];
  today: string;
  officeCashUgx: number;
  floatBalanceUgx: number;
  onDone: (message: string) => void;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entries, setEntries] = useState<Cancellable | null>(null);
  const [entryType, setEntryType] = useState<"expense" | "float" | "cash">("expense");
  const [entryId, setEntryId] = useState("");
  const [account, setAccount] = useState<"office" | "float">("office");
  const [countedCash, setCountedCash] = useState("");
  const [physical, setPhysical] = useState<Record<string, string>>({});
  const close = () => { setKind(null); setError(""); setFrom(""); setTo(""); setEntryId(""); setCountedCash(""); setAccount("office"); setPhysical({}); };
  const balance = account === "office" ? officeCashUgx : floatBalanceUgx;
  const difference = Number(countedCash) - balance;
  const fromStock = stock.find(s => s.material === from)?.availableKg ?? 0;

  useEffect(() => {
    if (kind !== "cancel") return;
    setEntries(null);
    apiRequest<{ data: Cancellable }>("/api/waste/recycling/corrections/cancellable").then(r => setEntries(r.data)).catch(e => setError(e instanceof Error ? e.message : "Entries could not be loaded"));
  }, [kind]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget), text = (key: string) => String(form.get(key) ?? "").trim();
    const [path, body] = kind === "count"
      ? ["stock-counts", { countDate: text("date"), reason: text("reason"), counts: stock.filter(s => s.availableKg > 0).map(s => ({ material: s.material, physicalKg: Number(physical[s.material]) })) }]
      : kind === "move"
      ? ["material-transfers", { fromMaterial: from, toMaterial: to === NEW_MATERIAL ? text("newMaterial") : to, allowNewMaterial: to === NEW_MATERIAL, quantityKg: Number(text("quantityKg")), transferDate: text("date"), reason: text("reason") }]
      : kind === "cash"
        ? ["cash", { account, direction: difference > 0 ? "add" : "reduce", amountUgx: Math.abs(difference), correctionDate: text("date"), reason: text("reason") }]
        : ["cancel", { entryType, id: entryId, reason: text("reason") }];
    if (kind === "cash" && (!countedCash || !Number.isFinite(Number(countedCash)) || difference === 0)) { setError(difference === 0 ? "The physical count already matches the recorded balance." : "Enter the cash physically counted."); return; }
    if (kind === "count" && !window.confirm("Approve this physical count? Stock will be changed immediately, shortages will be recorded as waste/loss, and the approval will remain in correction history.")) return;
    if (kind === "cash" && !window.confirm(`Approve the ${account === "office" ? "office cash" : "manager float"} adjustment from ${money(balance)} to ${money(Number(countedCash))}?`)) return;
    if (kind === "cancel" && !window.confirm("Cancel this entry? It will stop counting in cash and reports. A copy stays in the corrections history.")) return;
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ message: string }>(`/api/waste/recycling/corrections/${path}`, { method: "POST", body: JSON.stringify(body) });
      close();
      onDone(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : "The correction could not be saved"); } finally { setBusy(false); }
  }

  const list = entries ? (entryType === "expense" ? entries.expenses : entryType === "float" ? entries.float : entries.cash) : [];
  const describe = (e: Entry) => [e.date, e.reference, entryType === "float" ? e.transaction_type : entryType === "cash" ? (e.direction === "in" ? "cash in" : "cash out") : e.status, e.description, money(e.amount_ugx)].filter(Boolean).join(" · ");
  const choices: Array<[Kind, string, string]> = [
    ["count", "Count physical stock", "Count every material and approve waste or surplus once"],
    ["move", "Move material", "Weight recorded under the wrong material"],
    ["cash", "Count cash", "Reconcile office cash or manager float to the physical count"],
    ["cancel", "Cancel an entry", "An expense, float entry or cash movement is wrong"],
  ];

  async function downloadBackup() {
    setBackupBusy(true); setError("");
    try { await openAuthenticatedFile("/api/waste/recycling/corrections/backup", { download: `recycling-company-backup-${today}.json` }); }
    catch (e) { setError(e instanceof Error ? e.message : "The backup could not be downloaded"); }
    finally { setBackupBusy(false); }
  }

  function open(kindToOpen: Kind) {
    setError("");
    if (kindToOpen === "count") setPhysical(Object.fromEntries(stock.filter(s => s.availableKg > 0).map(s => [s.material, String(s.availableKg)])));
    if (kindToOpen === "cash") setCountedCash(String(account === "office" ? officeCashUgx : floatBalanceUgx));
    setKind(kindToOpen);
  }

  return <section className="border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><h3 className="font-semibold">Corrections &amp; backup</h3><p className="mt-1 text-sm text-slate-600">Count what is physically present, correct a wrong entry, or save a private company backup. Every approved correction is audited.</p></div>
      <button type="button" disabled={backupBusy} onClick={downloadBackup} className="shrink-0 border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">{backupBusy ? "Preparing backup…" : "Download company backup"}</button>
    </div>
    <p className="mt-2 text-xs text-slate-500">The backup contains this company’s operational records only. Passwords and access tokens are never included.</p>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {choices.map(([id, title, hint]) => <button key={id} type="button" onClick={() => open(id)} className="border border-slate-300 bg-white p-3 text-left hover:border-[var(--color-action)] hover:bg-blue-50">
        <span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs text-slate-600">{hint}</span>
      </button>)}
    </div>
    <p className="mt-3 text-xs text-slate-500">To fix the amount on a purchase or sale, open it and choose Edit. The before and after values are kept here.</p>

    <Modal open={kind !== null} onClose={close} title={choices.find(c => c[0] === kind)?.[1] ?? ""} description={kind === "count" ? "Enter the weight physically present for every material. Approval records shortages as waste/loss and adds verified surplus, per material, in one audited count." : kind === "move" ? "The weight comes off the first material, oldest stock first, and is added to the second. It keeps its original cost, so profit does not change." : kind === "cash" ? "Enter the amount physically counted. The system calculates the correction and does not change profit." : "The entry stops counting in cash and reports. Entries that belong to a purchase, sale, sorting, loan or investor are corrected on that record."}>
      <form onSubmit={submit} className="space-y-4">
        {kind === "count" && <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Count date<input required name="date" type="date" defaultValue={today} min={today} max={today} className={input} /></label>
            <div className="bg-blue-50 p-3 text-sm text-slate-700"><strong>{stock.filter(s => s.availableKg > 0).length} materials</strong><br />Recorded total {kg(stock.reduce((sum, line) => sum + line.availableKg, 0))}</div>
          </div>
          <div className="max-h-[45vh] overflow-y-auto border border-slate-200">
            <div className="sticky top-0 grid grid-cols-[1fr_7rem_8rem] gap-2 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600"><span>Material</span><span className="text-right">Recorded</span><span>Physical kg</span></div>
            {stock.filter(s => s.availableKg > 0).map(line => {
              const counted = Number(physical[line.material]); const delta = Number.isFinite(counted) ? counted - line.availableKg : 0;
              return <label key={line.material} className="grid grid-cols-[1fr_7rem_8rem] items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm"><span className="font-medium">{line.material}{delta !== 0 && <small className={`block font-semibold ${delta < 0 ? "text-red-700" : "text-emerald-700"}`}>{delta < 0 ? `${kg(Math.abs(delta))} waste/loss` : `${kg(delta)} surplus`}</small>}</span><span className="text-right text-slate-600">{kg(line.availableKg)}</span><input aria-label={`${line.material} physical kilograms`} required type="number" min="0" step="0.01" value={physical[line.material] ?? ""} onChange={e => setPhysical(current => ({ ...current, [line.material]: e.target.value }))} className="w-full border border-slate-300 px-2 py-2" /></label>;
            })}
          </div>
          {!stock.some(s => s.availableKg > 0) && <p className="bg-amber-50 p-3 text-sm text-amber-900">There is no available stock to count.</p>}
        </>}
        {kind === "move" && <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Move from<select required value={from} onChange={e => setFrom(e.target.value)} className={input}><option value="">Choose material</option>{stock.filter(s => s.availableKg > 0).map(s => <option key={s.material} value={s.material}>{s.material} ({kg(s.availableKg)} in stock)</option>)}</select></label>
            <label className={label}>Move to<select required value={to} onChange={e => setTo(e.target.value)} className={input}><option value="">Choose material</option>{materials.filter(m => m !== from).map(m => <option key={m} value={m}>{m} ({kg(stock.find(s => s.material === m)?.availableKg ?? 0)} in stock)</option>)}<option value={NEW_MATERIAL}>Other / add new material</option></select></label>
          </div>
          {to === NEW_MATERIAL && <label className={label}>New material name<input required name="newMaterial" minLength={2} maxLength={80} className={input} /></label>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Weight (kg)<input required name="quantityKg" type="number" min="0.001" step="0.001" max={fromStock || undefined} className={input} /><span className="mt-1 block text-xs font-normal text-slate-500">{from ? `${kg(fromStock)} of ${from} in stock` : "Choose a material first"}</span></label>
            <label className={label}>Date<input required name="date" type="date" defaultValue={today} max={today} className={input} /></label>
          </div>
        </>}
        {kind === "cash" && <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Account<select value={account} onChange={e => { const value = e.target.value as "office" | "float"; setAccount(value); setCountedCash(String(value === "office" ? officeCashUgx : floatBalanceUgx)); }} className={input}><option value="office">Office cash ({money(officeCashUgx)})</option><option value="float">Manager float ({money(floatBalanceUgx)})</option></select></label>
            <label className={label}>Date<input required name="date" type="date" defaultValue={today} max={today} className={input} /></label>
          </div>
          <label className={label}>Cash physically counted (UGX)<input required type="number" min="0" step="1" value={countedCash} onChange={e => setCountedCash(e.target.value)} className={input} /></label>
          <div className="grid grid-cols-3 divide-x divide-slate-200 bg-slate-50 p-3 text-sm"><div><span className="block text-xs text-slate-500">Recorded</span><strong>{money(balance)}</strong></div><div className="px-3"><span className="block text-xs text-slate-500">Physical</span><strong>{money(Number(countedCash) || 0)}</strong></div><div className="pl-3"><span className="block text-xs text-slate-500">Correction</span><strong className={difference < 0 ? "text-red-700" : difference > 0 ? "text-emerald-700" : ""}>{difference === 0 ? "No difference" : `${difference > 0 ? "+" : "−"}${money(Math.abs(difference))}`}</strong></div></div>
        </>}
        {kind === "cancel" && <>
          <div className="flex flex-wrap gap-2">{([["expense", "Expense"], ["float", "Float entry"], ["cash", "Cash movement"]] as const).map(([id, text]) => <button key={id} type="button" onClick={() => { setEntryType(id); setEntryId(""); }} className={`border px-3 py-1.5 text-sm font-semibold ${entryType === id ? "border-[var(--color-action)] bg-[var(--color-action)] text-white" : "border-slate-300 bg-white"}`}>{text}</button>)}</div>
          <label className={label}>Entry<select required value={entryId} onChange={e => setEntryId(e.target.value)} className={input} disabled={!entries}><option value="">{entries ? (list.length ? "Choose the wrong entry" : "Nothing here can be cancelled") : "Loading entries…"}</option>{list.map(e => <option key={e.id} value={e.id}>{describe(e)}</option>)}</select></label>
        </>}
        <label className={label}>Reason<textarea required name="reason" minLength={5} maxLength={300} rows={2} placeholder="What was wrong and how it was found" className={input} /></label>
        {error && <p role="alert" className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={close} className="border border-slate-300 px-4 py-2 text-sm font-semibold">Close</button>
          <button disabled={busy || (kind === "count" && !stock.some(s => s.availableKg > 0))} className={`px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${kind === "cancel" ? "bg-red-700" : "bg-[var(--color-action)]"}`}>{busy ? "Saving…" : kind === "count" ? "Approve physical count" : kind === "move" ? "Move material" : kind === "cash" ? "Approve cash adjustment" : "Cancel entry"}</button>
        </div>
      </form>
    </Modal>
  </section>;
}

/** One administrator correction in the history, with Undo for a material move. */
export function CorrectionRecord({ edit, canUndo, onDone }: { edit: CorrectionEdit; canUndo: boolean; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const b = edit.before_state, a = edit.after_state;
  const [title, lines] = edit.transaction_type === "physical_stock_count"
    ? ["Physical stock count approved", [["Materials counted", String(a.counts?.length ?? 0)], ["Materials adjusted", String(a.differences?.length ?? 0)], ["Waste / loss", kg(a.shortageKg ?? 0)], ["Verified surplus", kg(a.surplusKg ?? 0)], ["Date", a.countDate]]]
    : edit.transaction_type === "material_transfer"
    ? [`Material moved: ${b.material} → ${a.material}`, [["Weight", kg(a.quantityKg)], ["Date", a.transferDate]]]
    : edit.transaction_type === "material_transfer_reversal"
      ? [`Material move undone: ${b.material} → ${a.material}`, [["Weight returned", kg(a.quantityKg)]]]
      : edit.transaction_type === "cash_correction"
        ? [`${a.account === "float" ? "Manager float" : "Office cash"} reconciled`, [[a.direction === "add" ? "Added" : "Taken off", money(a.amountUgx)], ["Balance", `${money(b.balanceUgx)} → ${money(a.balanceUgx)}`], ["Reference", a.reference]]]
        : [`Entry cancelled: ${b.label}`, [["Amount", money(b.amountUgx)]]];
  const reason = a.reason ?? b.reason;
  async function undo() {
    const why = window.prompt("Why is this material move being undone?");
    if (!why || why.trim().length < 5) return;
    setBusy(true);
    try { onDone((await apiRequest<{ message: string }>(`/api/waste/recycling/corrections/material-transfers/${edit.transaction_id}/reverse`, { method: "POST", body: JSON.stringify({ reason: why.trim() }) })).message); }
    catch (e) { window.alert(e instanceof Error ? e.message : "The move could not be undone"); } finally { setBusy(false); }
  }
  return <article className="border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-col justify-between gap-2 border-b border-slate-200 pb-3 sm:flex-row sm:items-start">
      <div><p className="font-semibold">{title}</p><p className="mt-1 text-xs text-slate-500">Administrator correction</p></div>
      <div className="text-sm text-slate-600 sm:text-right"><p>{edit.edited_by_name}</p><p className="text-xs">{new Date(edit.edited_at).toLocaleString()}</p></div>
    </div>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">{(lines as string[][]).map(([k, v]) => <div key={k} className="bg-slate-50 p-3"><dt className="text-xs text-slate-500">{k}</dt><dd className="mt-1 font-semibold">{v}</dd></div>)}</dl>
    {edit.transaction_type === "physical_stock_count" && Array.isArray(a.differences) && a.differences.length > 0 && <div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-100 text-xs text-slate-600"><tr><th className="px-3 py-2">Material</th><th className="px-3 py-2 text-right">Recorded</th><th className="px-3 py-2 text-right">Physical</th><th className="px-3 py-2 text-right">Difference</th></tr></thead><tbody>{(a.differences as PhysicalDifference[]).map((line) => <tr key={line.material} className="border-b border-slate-100"><td className="px-3 py-2 font-medium">{line.material}</td><td className="px-3 py-2 text-right">{kg(line.recordedKg)}</td><td className="px-3 py-2 text-right">{kg(line.physicalKg)}</td><td className={`px-3 py-2 text-right font-semibold ${line.differenceKg < 0 ? "text-red-700" : "text-emerald-700"}`}>{line.differenceKg > 0 ? "+" : ""}{kg(line.differenceKg)}</td></tr>)}</tbody></table></div>}
    {reason && <p className="mt-3 text-sm text-slate-700"><span className="font-semibold">Reason:</span> {reason}</p>}
    {canUndo && edit.transaction_type === "material_transfer" && <button type="button" disabled={busy} onClick={undo} className="mt-3 border border-slate-300 px-3 py-1.5 text-sm font-semibold disabled:opacity-60">{busy ? "Undoing…" : "Undo this move"}</button>}
  </article>;
}
