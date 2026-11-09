"use client";
import { useState } from "react";
import { apiRequest } from "@/lib/api";
import { Modal } from "@/components/ui/System";

type Result = { link: string; emailed: boolean; expiresIn: string; email: string; fullName: string };

/** Sends a one-time password reset link for another account and shows it, so it can be handed over if the email does not arrive. */
export function ResetLinkButton({ userId, name, disabled, className }: { userId: string; name: string; disabled?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState<Result | null>(null), [error, setError] = useState(""), [copied, setCopied] = useState(false);
  async function send() {
    if (!window.confirm(`Send a password reset link to ${name}? Their current password keeps working until they use the link.`)) return;
    setBusy(true); setError(""); setCopied(false);
    try { setResult((await apiRequest<{ data: Result }>(`/api/auth/users/${userId}/password-reset`, { method: "POST", body: "{}" })).data); }
    catch (e) { setError(e instanceof Error ? e.message : "The reset link could not be created"); }
    finally { setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(result!.link); setCopied(true); } catch { setCopied(false); } }
  return <>
    <button type="button" disabled={disabled || busy} onClick={() => void send()} className={className ?? "border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"}>{busy ? "Sending…" : "Reset password"}</button>
    {error && <span role="alert" className="ml-2 text-xs text-red-700">{error}</span>}
    <Modal open={Boolean(result)} onClose={() => setResult(null)} title={`Password reset for ${result?.fullName ?? name}`} description={result?.emailed ? `The link was emailed to ${result.email}.` : "The email could not be sent. Give this link to the person directly."}>
      {result && <div className="space-y-4">
        <label className="block text-sm font-semibold text-slate-700">Reset link<textarea readOnly rows={3} value={result.link} onFocus={e => e.currentTarget.select()} className="mt-1 w-full border border-slate-300 bg-slate-50 p-3 font-mono text-xs" /></label>
        <p className="text-sm text-slate-600">It works once and expires in {result.expiresIn}. Share it only with {result.fullName}: whoever opens it can set the password.</p>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => void copy()} className="border border-slate-300 px-4 py-2 text-sm font-semibold">{copied ? "Copied" : "Copy link"}</button><button type="button" onClick={() => setResult(null)} className="bg-[var(--color-action)] px-4 py-2 text-sm font-semibold text-white">Done</button></div>
      </div>}
    </Modal>
  </>;
}
