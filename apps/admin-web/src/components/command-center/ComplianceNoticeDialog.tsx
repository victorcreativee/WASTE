"use client";
import { useState } from "react";
import { Feedback, Modal } from "@/components/ui/System";
import { apiRequest } from "@/lib/api";

export type NoticeDraft = {
  key: string;
  organizationId: string;
  organizationName: string;
  category: "permit" | "service_delivery" | "weighbridge" | "customer_service" | "fleet_safety" | "recycling_operations" | "statutory_returns" | "other";
  severity: "advisory" | "warning" | "critical";
  title: string;
  details: string;
  requiredAction: string;
  dueDate: string;
};

const input = "mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/** Issue a KCCA compliance notice from command-centre evidence. KCCA reviews and edits the draft before sending. */
export function ComplianceNoticeDialog({ draft, onClose, onIssued }: { draft: NoticeDraft | null; onClose: () => void; onIssued: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/waste/compliance/city", {
        method: "POST",
        body: JSON.stringify({
          organizationId: draft.organizationId,
          category: form.get("category"),
          severity: form.get("severity"),
          title: form.get("title"),
          details: form.get("details"),
          requiredAction: form.get("requiredAction"),
          dueDate: form.get("dueDate"),
        }),
      });
      onIssued(`Compliance notice issued to ${draft.organizationName}. It is now in Compliance cases and visible to the company.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The notice could not be issued");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(draft)}
      title="Issue compliance notice"
      description={draft ? `${draft.organizationName} · prepared from current KCCA evidence. Review before issuing.` : ""}
      onClose={() => { if (!busy) { setError(""); onClose(); } }}
    >
      {draft && (
        <form key={draft.key} onSubmit={submit} className="grid gap-4">
          {error && <Feedback tone="error">{error}</Feedback>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">Category
              <select name="category" defaultValue={draft.category} className={input}>
                <option value="service_delivery">Service delivery</option>
                <option value="weighbridge">Weighbridge</option>
                <option value="permit">Permit</option>
                <option value="customer_service">Customer service</option>
                <option value="fleet_safety">Fleet safety</option>
                <option value="recycling_operations">Recycling operations</option>
                <option value="statutory_returns">Monthly returns</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="text-sm font-semibold">Severity
              <select name="severity" defaultValue={draft.severity} className={input}>
                <option value="advisory">Advisory</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </label>
          </div>
          <label className="text-sm font-semibold">Subject
            <input required name="title" minLength={4} maxLength={180} defaultValue={draft.title} className={input} />
          </label>
          <label className="text-sm font-semibold">Verified concern
            <textarea required name="details" minLength={10} maxLength={3000} rows={5} defaultValue={draft.details} className={input} />
          </label>
          <label className="text-sm font-semibold">Required corrective action
            <textarea required name="requiredAction" minLength={5} maxLength={2000} rows={3} defaultValue={draft.requiredAction} className={input} />
          </label>
          <label className="text-sm font-semibold">Correction due date
            <input required name="dueDate" type="date" min={today()} defaultValue={draft.dueDate} className={input} />
          </label>
          <button disabled={busy} className="bg-[var(--color-action)] px-4 py-3 font-semibold text-white disabled:opacity-60">{busy ? "Issuing…" : "Issue notice"}</button>
        </form>
      )}
    </Modal>
  );
}
