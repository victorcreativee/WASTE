"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Feedback, PageHeader } from "@/components/ui/System";
import { apiRequest } from "@/lib/api";
import type { CostKind, RecyclingSettings, SettingOption } from "@/lib/recycling-settings";

type Material = { id: string; name: string; category: string; active: boolean };
type Edit = { id: string; transaction_type: string; before_state: Record<string, any>; after_state: Record<string, any>; edited_by_name: string; edited_at: string };
type Workspace = { settings: RecyclingSettings; materials: Material[]; lots: Array<{ material_type: string; available_kg: number | string }>; transactionEdits: Edit[] };

const field = "mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm font-normal";
const sections = [
  ["materials", "Materials"],
  ["expenses", "Expense categories"],
  ["costs", "Cost names"],
  ["quality", "Quality grades"],
  ["losses", "Loss reasons"],
  ["rules", "Payment rules"],
  ["history", "Change history"],
] as const;
type Section = (typeof sections)[number][0];
const costKinds: Array<[CostKind, string]> = [["purchase", "Purchases"], ["sorting", "Sorting"], ["sale", "Sales"]];
const settingNames: Record<string, string> = { expenseCategories: "Expense categories", qualityGrades: "Quality grades", lossReasons: "Loss reasons", costFields: "Cost names", rules: "Payment rules" };

export default function RecyclingSettingsPage() {
  // Read after mounting: the server render has no session, and reading it earlier makes the first render differ.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  useEffect(() => { try { setIsAdmin((JSON.parse(sessionStorage.getItem("currentUser") || "{}").roles || []).includes("company_admin")); } catch { setIsAdmin(false); } }, []);
  const [data, setData] = useState<Workspace | null>(null);
  const [section, setSection] = useState<Section>("materials");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData((await apiRequest<{ data: Workspace }>("/api/waste/recycling")).data); }
    catch (e) { setError(e instanceof Error ? e.message : "Settings could not be loaded"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function call(path: string, method: string, body: unknown) {
    setBusy(true); setError(""); setNotice("");
    try { const r = await apiRequest<{ message: string }>(path, { method, body: JSON.stringify(body) }); setNotice(r.message); await load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "The change could not be saved"); return false; }
    finally { setBusy(false); }
  }
  const save = (change: Partial<RecyclingSettings>) => call("/api/waste/recycling/settings", "PUT", change);

  return <AppShell>
    <PageHeader eyebrow="Administration" title="Recycling settings" description="Lists, names and rules your team uses every day. Changes apply straight away and are kept in the change history." />
    {isAdmin === false && <Feedback tone="info">Only the company administrator can change these settings.</Feedback>}
    {notice && <Feedback tone="success">{notice}</Feedback>}
    {error && <Feedback tone="error">{error}</Feedback>}
    <nav className="mt-4 flex flex-wrap border-b border-slate-200">{sections.map(([id, label]) => <button key={id} type="button" onClick={() => setSection(id)} className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold ${section === id ? "border-[var(--color-action)] text-[var(--color-action)]" : "border-transparent text-slate-600 hover:text-slate-900"}`}>{label}</button>)}</nav>
    {!data || isAdmin === null ? <p className="mt-6 text-sm text-slate-500">Loading settings…</p> : <div className="mt-5">
      {section === "materials" && <Materials data={data} isAdmin={Boolean(isAdmin)} busy={busy} call={call} />}
      {section === "expenses" && <OptionList key={JSON.stringify(data.settings.expenseCategories)} title="Expense categories" hint="Shown when staff record an expense. Built-in categories can be renamed or turned off; your own can also be removed." options={data.settings.expenseCategories} isAdmin={Boolean(isAdmin)} busy={busy} onSave={list => save({ expenseCategories: list })} />}
      {section === "quality" && <OptionList key={JSON.stringify(data.settings.qualityGrades)} title="Quality grades" hint="Offered as the material condition on each purchase." options={data.settings.qualityGrades} isAdmin={Boolean(isAdmin)} busy={busy} onSave={list => save({ qualityGrades: list })} />}
      {section === "losses" && <LossReasons key={data.settings.lossReasons.join("|")} reasons={data.settings.lossReasons} isAdmin={Boolean(isAdmin)} busy={busy} onSave={list => save({ lossReasons: list })} />}
      {section === "costs" && <CostNames key={JSON.stringify(data.settings.costFields)} costFields={data.settings.costFields} isAdmin={Boolean(isAdmin)} busy={busy} onSave={costFields => save({ costFields })} />}
      {section === "rules" && <Rules key={JSON.stringify(data.settings.rules)} rules={data.settings.rules} isAdmin={Boolean(isAdmin)} busy={busy} onSave={rules => save({ rules })} />}
      {section === "history" && <History edits={data.transactionEdits.filter(e => ["settings_change", "material_rename"].includes(e.transaction_type))} />}
    </div>}
  </AppShell>;
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <section className="border border-slate-200 bg-white p-4 sm:p-5"><h2 className="font-semibold">{title}</h2>{hint && <p className="mt-1 text-sm text-slate-600">{hint}</p>}<div className="mt-4">{children}</div></section>;
}
function SaveBar({ isAdmin, busy, dirty, onSave, onReset }: { isAdmin: boolean; busy: boolean; dirty: boolean; onSave: () => void; onReset: () => void }) {
  if (!isAdmin) return null;
  return <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" disabled={!dirty || busy} onClick={onReset} className="border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">Undo changes</button><button type="button" disabled={!dirty || busy} onClick={onSave} className="bg-[var(--color-action)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save changes"}</button></div>;
}

function Materials({ data, isAdmin, busy, call }: { data: Workspace; isAdmin: boolean; busy: boolean; call: (path: string, method: string, body: unknown) => Promise<boolean> }) {
  const [newName, setNewName] = useState(""), [category, setCategory] = useState("plastic");
  const [renaming, setRenaming] = useState<Material | null>(null), [renameTo, setRenameTo] = useState(""), [reason, setReason] = useState("");
  const stock = (name: string) => data.lots.filter(l => l.material_type === name).reduce((n, l) => n + Number(l.available_kg), 0);
  const merging = renaming && data.materials.find(m => m.id !== renaming.id && m.name.toLowerCase() === renameTo.trim().toLowerCase());
  return <Panel title="Materials" hint="Renaming changes the name on all past stock and sorting records, and the old name keeps working when someone types it. Renaming to a name that already exists merges the two.">
    {isAdmin && <form className="mb-4 grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end" onSubmit={async e => { e.preventDefault(); if (await call("/api/waste/recycling/materials", "POST", { name: newName, category })) setNewName(""); }}>
      <label className="text-sm font-semibold">New material<input required minLength={2} maxLength={80} value={newName} onChange={e => setNewName(e.target.value)} className={field} /></label>
      <label className="text-sm font-semibold">Type<select value={category} onChange={e => setCategory(e.target.value)} className={field}>{["plastic", "paper", "metal", "glass", "organic", "textile", "other"].map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></label>
      <button disabled={busy} className="bg-[var(--color-action)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Add material</button>
    </form>}
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-xs text-slate-500"><th className="py-2">Material</th><th>Type</th><th className="text-right">In stock</th><th>Status</th>{isAdmin && <th />}</tr></thead>
      <tbody>{[...data.materials].sort((a, b) => a.name.localeCompare(b.name)).map(m => <tr key={m.id} className="border-b border-slate-100">
        <td className="py-2 font-semibold">{m.name}</td><td className="capitalize">{m.category}</td><td className="text-right tabular-nums">{stock(m.name).toLocaleString()} kg</td>
        <td>{m.active ? "On" : <span className="text-slate-500">Off</span>}</td>
        {isAdmin && <td className="space-x-2 whitespace-nowrap text-right"><button type="button" onClick={() => { setRenaming(m); setRenameTo(m.name); setReason(""); }} className="text-[var(--color-action)] hover:underline">Rename</button><button type="button" disabled={busy} onClick={() => call(`/api/waste/recycling/materials/${m.id}/status`, "PATCH", { active: !m.active })} className="text-slate-700 hover:underline">{m.active ? "Turn off" : "Turn on"}</button></td>}
      </tr>)}</tbody></table></div>
    {renaming && <form className="mt-4 border border-slate-300 bg-slate-50 p-4" onSubmit={async e => { e.preventDefault(); if (await call(`/api/waste/recycling/materials/${renaming.id}/rename`, "POST", { name: renameTo, reason })) setRenaming(null); }}>
      <p className="font-semibold">Rename {renaming.name}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">New name<input required minLength={2} maxLength={80} value={renameTo} onChange={e => setRenameTo(e.target.value)} className={field} /></label><label className="text-sm font-semibold">Reason<input required minLength={5} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} className={field} /></label></div>
      {merging && <p className="mt-3 border-l-2 border-amber-500 bg-amber-50 p-3 text-sm">{merging.name} already exists. Saving merges {renaming.name} into it: all {renaming.name} stock and records become {merging.name}.</p>}
      <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setRenaming(null)} className="border border-slate-300 px-4 py-2 text-sm font-semibold">Close</button><button disabled={busy || renameTo.trim() === renaming.name} className="bg-[var(--color-action)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{merging ? "Merge materials" : "Rename"}</button></div>
    </form>}
  </Panel>;
}

function OptionList({ title, hint, options, isAdmin, busy, onSave }: { title: string; hint: string; options: SettingOption[]; isAdmin: boolean; busy: boolean; onSave: (list: SettingOption[]) => Promise<boolean> }) {
  const [list, setList] = useState(options), [added, setAdded] = useState("");
  const update = (index: number, change: Partial<SettingOption>) => setList(current => current.map((o, i) => i === index ? { ...o, ...change } : o));
  return <Panel title={title} hint={hint}>
    <div className="divide-y divide-slate-100 border-y border-slate-200">{list.map((o, index) => <div key={o.code ?? index} className="flex flex-wrap items-center gap-3 py-2">
      <input value={o.label} disabled={!isAdmin} onChange={e => update(index, { label: e.target.value })} className="min-w-0 flex-1 border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-50" aria-label="Name" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={o.active} disabled={!isAdmin} onChange={e => update(index, { active: e.target.checked })} />On</label>
      {isAdmin && !o.builtIn && <button type="button" onClick={() => setList(current => current.filter((_, i) => i !== index))} className="text-sm text-red-700 hover:underline">Remove</button>}
      {o.builtIn && <span className="text-xs text-slate-500">Built in</span>}
    </div>)}</div>
    {isAdmin && <div className="mt-3 flex gap-2"><input value={added} onChange={e => setAdded(e.target.value)} placeholder="Add a new one" maxLength={60} className="min-w-0 flex-1 border border-slate-300 px-3 py-2 text-sm" /><button type="button" disabled={added.trim().length < 2} onClick={() => { setList(current => [...current, { code: undefined as unknown as string, label: added.trim(), active: true }]); setAdded(""); }} className="border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">Add</button></div>}
    <SaveBar isAdmin={Boolean(isAdmin)} busy={busy} dirty={JSON.stringify(list) !== JSON.stringify(options)} onReset={() => setList(options)} onSave={() => onSave(list.map(({ code, label, active }) => ({ ...(code && { code }), label, active }) as SettingOption))} />
  </Panel>;
}

function LossReasons({ reasons, isAdmin, busy, onSave }: { reasons: string[]; isAdmin: boolean; busy: boolean; onSave: (list: string[]) => Promise<boolean> }) {
  const [list, setList] = useState(reasons), [added, setAdded] = useState("");
  return <Panel title="Loss reasons" hint="Suggested when someone records lost or damaged stock. They can still type a different reason.">
    <div className="divide-y divide-slate-100 border-y border-slate-200">{list.map((r, index) => <div key={index} className="flex items-center gap-3 py-2">
      <input value={r} disabled={!isAdmin} onChange={e => setList(current => current.map((x, i) => i === index ? e.target.value : x))} className="min-w-0 flex-1 border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-50" aria-label="Reason" />
      {isAdmin && <button type="button" onClick={() => setList(current => current.filter((_, i) => i !== index))} className="text-sm text-red-700 hover:underline">Remove</button>}
    </div>)}</div>
    {isAdmin && <div className="mt-3 flex gap-2"><input value={added} onChange={e => setAdded(e.target.value)} placeholder="Add a reason" maxLength={80} className="min-w-0 flex-1 border border-slate-300 px-3 py-2 text-sm" /><button type="button" disabled={added.trim().length < 2} onClick={() => { setList(current => [...current, added.trim()]); setAdded(""); }} className="border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">Add</button></div>}
    <SaveBar isAdmin={Boolean(isAdmin)} busy={busy} dirty={JSON.stringify(list) !== JSON.stringify(reasons)} onReset={() => setList(reasons)} onSave={() => onSave(list.map(r => r.trim()).filter(Boolean))} />
  </Panel>;
}

function CostNames({ costFields, isAdmin, busy, onSave }: { costFields: RecyclingSettings["costFields"]; isAdmin: boolean; busy: boolean; onSave: (value: RecyclingSettings["costFields"]) => Promise<boolean> }) {
  const [value, setValue] = useState(costFields);
  const update = (kind: CostKind, key: string, change: Partial<{ label: string; visible: boolean }>) => setValue(current => ({ ...current, [kind]: { ...current[kind], [key]: { ...current[kind][key], ...change } } }));
  return <Panel title="Cost names" hint="The cost boxes on purchase, sorting and sale forms. Rename a box to match how your team talks, or hide one you never use. Hidden boxes are saved as zero.">
    <div className="grid gap-4 lg:grid-cols-3">{costKinds.map(([kind, title]) => <div key={kind} className="border border-slate-200 p-3"><h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 space-y-2">{Object.entries(value[kind]).map(([key, f]) => <div key={key} className="flex items-center gap-2">
        <input value={f.label} disabled={!isAdmin} maxLength={40} onChange={e => update(kind, key, { label: e.target.value })} className="min-w-0 flex-1 border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50" aria-label="Cost name" />
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={f.visible} disabled={!isAdmin} onChange={e => update(kind, key, { visible: e.target.checked })} />Show</label>
      </div>)}</div></div>)}</div>
    <SaveBar isAdmin={Boolean(isAdmin)} busy={busy} dirty={JSON.stringify(value) !== JSON.stringify(costFields)} onReset={() => setValue(costFields)} onSave={() => onSave(value)} />
  </Panel>;
}

function Rules({ rules, isAdmin, busy, onSave }: { rules: RecyclingSettings["rules"]; isAdmin: boolean; busy: boolean; onSave: (value: RecyclingSettings["rules"]) => Promise<boolean> }) {
  const [value, setValue] = useState(rules);
  const rows: Array<[keyof typeof rules, string, string]> = [
    ["supplierCreditDays", "Supplier credit days", "When material is bought on credit, payment is due this many days after delivery."],
    ["buyerPaymentDays", "Buyer payment days", "When a buyer does not pay at once, payment is due this many days after the sale."],
    ["dueSoonDays", "Warn before due (days)", "Unpaid sales and purchases show as due soon this many days before their due date."],
  ];
  return <Panel title="Payment rules" hint="Applied to new purchases and sales. Due dates already set stay as they are.">
    <div className="grid gap-4 sm:grid-cols-3">{rows.map(([key, title, hint]) => <label key={key} className="text-sm font-semibold">{title}<input type="number" min={0} max={key === "dueSoonDays" ? 90 : 365} disabled={!isAdmin} value={value[key]} onChange={e => setValue(current => ({ ...current, [key]: Number(e.target.value) }))} className={field} /><span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span></label>)}</div>
    <SaveBar isAdmin={Boolean(isAdmin)} busy={busy} dirty={JSON.stringify(value) !== JSON.stringify(rules)} onReset={() => setValue(rules)} onSave={() => onSave(value)} />
  </Panel>;
}

function History({ edits }: { edits: Edit[] }) {
  if (!edits.length) return <Panel title="Change history"><p className="text-sm text-slate-600">No settings have been changed yet.</p></Panel>;
  return <Panel title="Change history" hint="Every settings change and material rename, newest first.">
    <div className="space-y-3">{edits.map(e => <article key={e.id} className="border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{e.transaction_type === "material_rename" ? `${e.after_state.merged ? "Merged" : "Renamed"} ${e.before_state.material} → ${e.after_state.material}` : `Changed ${Object.keys(e.after_state).map(k => settingNames[k] ?? k).join(", ")}`}</p><p className="text-slate-600">{e.edited_by_name} · {new Date(e.edited_at).toLocaleString()}</p></div>
      {e.transaction_type === "material_rename" ? <p className="mt-1 text-slate-600">{e.after_state.lots ?? 0} stock records updated. Reason: {e.after_state.reason}</p> : <ChangeList before={e.before_state} after={e.after_state} />}
    </article>)}</div>
  </Panel>;
}

/** Lists what changed in a settings save in plain words. */
function ChangeList({ before, after }: { before: Record<string, any>; after: Record<string, any> }) {
  const lines: string[] = [];
  for (const key of ["expenseCategories", "qualityGrades"]) if (after[key]) {
    const old = new Map<string, SettingOption>((before[key] ?? []).map((o: SettingOption) => [o.code, o]));
    for (const o of after[key] as SettingOption[]) {
      const was = old.get(o.code);
      if (!was) lines.push(`Added "${o.label}"`);
      else { if (was.label !== o.label) lines.push(`Renamed "${was.label}" to "${o.label}"`); if (was.active !== o.active) lines.push(`Turned ${o.active ? "on" : "off"} "${o.label}"`); }
      old.delete(o.code);
    }
    for (const o of old.values()) lines.push(`Removed "${o.label}"`);
  }
  if (after.lossReasons) lines.push(`Loss reasons: ${(after.lossReasons as string[]).join(", ")}`);
  if (after.rules) for (const [k, v] of Object.entries(after.rules)) if (before.rules?.[k] !== v) lines.push(`${k === "supplierCreditDays" ? "Supplier credit days" : k === "buyerPaymentDays" ? "Buyer payment days" : "Warn before due"}: ${before.rules?.[k]} → ${v}`);
  if (after.costFields) for (const [kind, fields] of Object.entries(after.costFields as Record<string, Record<string, { label: string; visible: boolean }>>)) for (const [k, f] of Object.entries(fields)) {
    const was = before.costFields?.[kind]?.[k];
    if (was && was.label !== f.label) lines.push(`${kind}: "${was.label}" renamed to "${f.label}"`);
    if (was && was.visible !== f.visible) lines.push(`${kind}: "${f.label}" ${f.visible ? "shown" : "hidden"}`);
  }
  return <ul className="mt-2 list-disc space-y-0.5 pl-5 text-slate-700">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>;
}
