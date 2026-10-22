"use client";
import { useEffect, useState } from "react";
import { Feedback, Modal } from "@/components/ui/System";
import { apiRequest } from "@/lib/api";

type Standard = { issue_category: string; response_hours: number; updated_at: string; updated_by_name: string | null };
type Change = { id: string; issue_category: string; previous_hours: number; new_hours: number; reason: string; created_at: string; changed_by_name: string };
type Overview = { standards: Standard[]; history: Change[] };

const label = (value: string) => value.replaceAll("_", " ");
const input = "mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

/** View (system admin) or change (KCCA) the resident-issue response standards, with the audit history. */
export function ServiceStandardsDialog({ open, canEdit, onClose, onSaved }: { open: boolean; canEdit: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiRequest<{ data: Overview }>("/api/waste/command-center/standards")
      .then((result) => { if (!cancelled) { setOverview(result.data); setError(""); setFormKey((k) => k + 1); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Service standards could not be loaded"); });
    return () => { cancelled = true; };
  }, [open]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!overview) return;
    const form = new FormData(event.currentTarget);
    const standards = overview.standards
      .map((item) => ({ category: item.issue_category, responseHours: Number(form.get(item.issue_category)) }))
      .filter((item, index) => item.responseHours !== overview.standards[index].response_hours);
    if (!standards.length) { setError("Change at least one standard before saving."); return; }
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ message: string; data: Overview }>("/api/waste/command-center/standards", {
        method: "PUT",
        body: JSON.stringify({ standards, reason: form.get("reason") }),
      });
      setOverview(result.data);
      setFormKey((k) => k + 1);
      onSaved(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Service standards could not be saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Resident issue service standards" description="How quickly a licensed collector must resolve each kind of resident issue. The command centre measures every open issue against these." onClose={() => { if (!busy) onClose(); }}>
      {error && <Feedback tone="error">{error}</Feedback>}
      {!overview && !error && <p className="text-sm text-slate-500">Loading standards…</p>}
      {overview && (
        <>
          <form key={formKey} onSubmit={submit} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {overview.standards.map((item) => (
                <label key={item.issue_category} className="text-sm font-semibold capitalize">{label(item.issue_category)}
                  <span className="mt-1 flex items-center gap-2">
                    <input name={item.issue_category} type="number" min={1} max={720} step={1} required disabled={!canEdit} defaultValue={item.response_hours} className={`${input} mt-0 tabular-nums disabled:bg-slate-50`} />
                    <span className="font-normal normal-case text-slate-500">hours</span>
                  </span>
                </label>
              ))}
            </div>
            {canEdit ? (
              <>
                <label className="text-sm font-semibold">Reason for the change
                  <input name="reason" required minLength={5} maxLength={500} placeholder="For example: KCCA council resolution 14/2026" className={input} />
                </label>
                <p className="text-xs text-slate-500">Changes are recorded permanently with your name and reason, and apply from the command centre&apos;s next refresh.</p>
                <button disabled={busy} className="bg-[var(--color-action)] px-4 py-3 font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save standards"}</button>
              </>
            ) : <p className="text-sm text-slate-500">Only KCCA administrators can change service standards.</p>}
          </form>
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-900">Change history</h3>
            {overview.history.length ? (
              <ul className="mt-2 space-y-2">
                {overview.history.map((change) => (
                  <li key={change.id} className="border-l-2 border-slate-300 pl-3 text-xs text-slate-600">
                    <strong className="capitalize">{label(change.issue_category)}</strong>: {change.previous_hours}h → {change.new_hours}h · {change.changed_by_name} · {new Date(change.created_at).toLocaleString("en-GB")}
                    <br />{change.reason}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-xs text-slate-500">No changes yet. These are the platform starting values.</p>}
          </div>
        </>
      )}
    </Modal>
  );
}
