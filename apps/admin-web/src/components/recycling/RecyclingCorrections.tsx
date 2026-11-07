"use client";
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/api";
import { Modal } from "@/components/ui/System";

const money = (n: number) => `UGX ${Number(n).toLocaleString()}`;
const kg = (n: number) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`;
const NEW_MATERIAL = "__new__";
const input = "mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm font-normal";
const label = "block text-sm font-semibold text-slate-700";

type Kind = "move" | "cash" | "cancel";
type Entry = { id: string; reference: string | null; date: string; description: string | null; amount_ugx: number; status?: string; transaction_type?: string; direction?: string; category?: string };
type Cancellable = { expenses: Entry[]; float: Entry[]; cash: Entry[] };

export type CorrectionEdit = {
  id: string;
  transaction_type: string;
  transaction_id: string;
  before_state: Record<string, any>;
  after_state: Record<string, any>;
  edited_by_name: string;
  edited_at: string;
};
export const isCorrection = (edit: { transaction_type: string }) => ["material_transfer", "material_transfer_reversal", "cash_correction", "entry_cancelled"].includes(edit.transaction_type);

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
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entries, setEntries] = useState<Cancellable | null>(null);
  const [entryType, setEntryType] = useState<"expense" | "float" | "cash">("expense");
  const [entryId, setEntryId] = useState("");
  const [account, setAccount] = useState<"office" | "float">("office");
  const [direction, setDirection] = useState<"add" | "reduce">("reduce");
  const [amount, setAmount] = useState("");
  const close = () => { setKind(null); setError(""); setFrom(""); setTo(""); setEntryId(""); setAmount(""); setDirection("reduce"); setAccount("office"); };
  const balance = account === "office" ? officeCashUgx : floatBalanceUgx;
  const newBalance = balance + (direction === "add" ? 1 : -1) * (Number(amount) || 0);
  const fromStock = stock.find(s => s.material === from)?.availableKg ?? 0;

  useEffect(() => {
    if (kind !== "cancel") return;
    setEntries(null);
    apiRequest<{ data: Cancellable }>("/api/waste/recycling/corrections/cancellable").then(r => setEntries(r.data)).catch(e => setError(e instanceof Error ? e.message : "Entries could not be loaded"));
  }, [kind]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget), text = (key: string) => String(form.get(key) ?? "").trim();
    const [path, body] = kind === "move"
      ? ["material-transfers", { fromMaterial: from, toMaterial: to === NEW_MATERIAL ? text("newMaterial") : to, allowNewMaterial: to === NEW_MATERIAL, quantityKg: Number(text("quantityKg")), transferDate: text("date"), reason: text("reason") }]
      : kind === "cash"
        ? ["cash", { account, direction, amountUgx: Number(amount), correctionDate: text("date"), reason: text("reason") }]
        : ["cancel", { entryType, id: entryId, reason: text("reason") }];
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
    ["move", "Move material", "Weight recorded under the wrong material"],
    ["cash", "Cash reconciliation", "Office cash or float differs from what was counted"],
    ["cancel", "Cancel an entry", "An expense, float entry or cash movement is wrong"],
  ];

  return <section className="border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><h3 className="font-semibold">Make a correction</h3><p className="mt-1 text-sm text-slate-600">Only the company administrator can do this. Every correction needs a reason and is kept below.</p></div>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-3">
      {choices.map(([id, title, hint]) => <button key={id} type="button" onClick={() => setKind(id)} className="border border-slate-300 bg-white p-3 text-left hover:border-[var(--color-action)] hover:bg-blue-50">
        <span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs text-slate-600">{hint}</span>
      </button>)}
    </div>
    <p className="mt-3 text-xs text-slate-500">To fix the amount on a purchase or sale, open it and choose Edit. The before and after values are kept here.</p>

    <Modal open={kind !== null} onClose={close} title={choices.find(c => c[0] === kind)?.[1] ?? ""} description={kind === "move" ? "The weight comes off the first material, oldest stock first, and is added to the second. It keeps its original cost, so profit does not change." : kind === "cash" ? "Bring office cash or the manager float to what was actually counted, up or down. Profit does not change." : "The entry stops counting in cash and reports. Entries that belong to a purchase, sale, sorting, loan or investor are corrected on that record."}>
      <form onSubmit={submit} className="space-y-4">
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
            <label className={label}>Balance<select value={account} onChange={e => setAccount(e.target.value as "office" | "float")} className={input}><option value="office">Office cash ({money(officeCashUgx)})</option><option value="float">Manager float ({money(floatBalanceUgx)})</option></select></label>
            <label className={label}>Date<input required name="date" type="date" defaultValue={today} max={today} className={input} /></label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset><legend className={label}>Change</legend><div className="mt-1 grid grid-cols-2">{([["add", "Add money"], ["reduce", "Reduce money"]] as const).map(([id, text]) => <button key={id} type="button" onClick={() => setDirection(id)} className={`border px-3 py-2 text-sm font-semibold ${direction === id ? "border-[var(--color-action)] bg-[var(--color-action)] text-white" : "border-slate-300 bg-white"}`}>{text}</button>)}</div></fieldset>
            <label className={label}>Amount (UGX)<input required type="number" min="1" step="1" max={direction === "reduce" ? Math.max(balance, 0) : undefined} value={amount} onChange={e => setAmount(e.target.value)} className={input} /></label>
          </div>
          <p className="bg-slate-50 p-3 text-sm">Recorded {money(balance)} → <strong className={newBalance < 0 ? "text-red-700" : ""}>{money(newBalance)}</strong> after this reconciliation</p>
        </>}
        {kind === "cancel" && <>
          <div className="flex flex-wrap gap-2">{([["expense", "Expense"], ["float", "Float entry"], ["cash", "Cash movement"]] as const).map(([id, text]) => <button key={id} type="button" onClick={() => { setEntryType(id); setEntryId(""); }} className={`border px-3 py-1.5 text-sm font-semibold ${entryType === id ? "border-[var(--color-action)] bg-[var(--color-action)] text-white" : "border-slate-300 bg-white"}`}>{text}</button>)}</div>
          <label className={label}>Entry<select required value={entryId} onChange={e => setEntryId(e.target.value)} className={input} disabled={!entries}><option value="">{entries ? (list.length ? "Choose the wrong entry" : "Nothing here can be cancelled") : "Loading entries…"}</option>{list.map(e => <option key={e.id} value={e.id}>{describe(e)}</option>)}</select></label>
        </>}
        <label className={label}>Reason<textarea required name="reason" minLength={5} maxLength={300} rows={2} placeholder="What was wrong and how it was found" className={input} /></label>
        {error && <p role="alert" className="border-l-2 border-red-600 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={close} className="border border-slate-300 px-4 py-2 text-sm font-semibold">Close</button>
          <button disabled={busy} className={`px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${kind === "cancel" ? "bg-red-700" : "bg-[var(--color-action)]"}`}>{busy ? "Saving…" : kind === "move" ? "Move material" : kind === "cash" ? "Save reconciliation" : "Cancel entry"}</button>
        </div>
      </form>
    </Modal>
  </section>;
}

/** One administrator correction in the history, with Undo for a material move. */
export function CorrectionRecord({ edit, canUndo, onDone }: { edit: CorrectionEdit; canUndo: boolean; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const b = edit.before_state, a = edit.after_state;
  const [title, lines] = edit.transaction_type === "material_transfer"
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
    {reason && <p className="mt-3 text-sm text-slate-700"><span className="font-semibold">Reason:</span> {reason}</p>}
    {canUndo && edit.transaction_type === "material_transfer" && <button type="button" disabled={busy} onClick={undo} className="mt-3 border border-slate-300 px-3 py-1.5 text-sm font-semibold disabled:opacity-60">{busy ? "Undoing…" : "Undo this move"}</button>}
  </article>;
}
