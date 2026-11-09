"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { apiRequest } from "@/lib/api";

const rules = [
  ["At least 12 characters", (p: string) => p.length >= 12 && p.length <= 72],
  ["An uppercase letter", (p: string) => /[A-Z]/.test(p)],
  ["A lowercase letter", (p: string) => /[a-z]/.test(p)],
  ["A number", (p: string) => /\d/.test(p)],
] as const;

// The token is read once from the link and kept, so removing it from the address bar does not lose it.
let linkToken: string | null = null;
const readToken = () => (linkToken ??= new URLSearchParams(window.location.search).get("token") || "");
const noSubscription = () => () => undefined;

export default function ResetPasswordPage() {
  const token = useSyncExternalStore(noSubscription, readToken, () => null);
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState(""), [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false), [done, setDone] = useState(""), [error, setError] = useState("");
  // Removed from the address bar so the token does not stay in history or get shared by accident.
  useEffect(() => { if (token) history.replaceState(null, "", "/reset-password"); }, [token]);
  const valid = rules.every(([, test]) => test(password)) && password === confirmation;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!valid || !token) return; setBusy(true); setError("");
    try {
      setDone((await apiRequest<{ message: string }>("/api/auth/password-reset/confirm", { method: "POST", body: JSON.stringify({ token, password }) })).message);
      try { sessionStorage.removeItem("accessToken"); sessionStorage.removeItem("refreshToken"); sessionStorage.removeItem("currentUser"); } catch { /* storage unavailable */ }
    } catch (e) { setError(e instanceof Error ? e.message : "The password could not be changed."); }
    finally { setBusy(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-12">
    <section className="w-full max-w-lg border-t-2 border-[var(--color-action)] bg-white p-7 shadow-sm sm:p-9">
      <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--color-action)]">Account recovery</p>
      <h1 className="mt-3 text-3xl font-semibold text-slate-950">{done ? "Password changed" : "Choose a new password"}</h1>
      {done ? <>
        <div role="status" className="mt-5 border-l-2 border-emerald-600 bg-emerald-50 p-4 text-sm text-emerald-800">{done}</div>
        <p className="mt-4 text-sm leading-6 text-slate-600">For safety, every device that was signed in with the old password has been signed out.</p>
        <div className="mt-7"><Link href="/login" className="bg-[var(--color-action)] px-5 py-3 text-sm font-semibold text-white">Continue to sign in</Link></div>
      </> : token === "" ? <>
        <p className="mt-4 text-sm leading-6 text-slate-600">This page needs the complete link from your reset email. Ask for a new link if yours is incomplete or expired.</p>
        <div className="mt-7"><Link href="/forgot-password" className="bg-[var(--color-action)] px-5 py-3 text-sm font-semibold text-white">Request a new link</Link></div>
      </> : <form onSubmit={submit}>
        {error && <div role="alert" className="mt-5 border-l-2 border-red-600 bg-red-50 p-4 text-sm text-red-800">{error}{/expired|invalid|used/i.test(error) && <Link href="/forgot-password" className="mt-2 block font-semibold underline">Request a new link</Link>}</div>}
        <label className="mt-6 block"><span className="text-sm font-medium text-slate-700">New password</span><input required type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1.5 w-full border border-slate-300 px-3 py-2.5 text-[15px]" /></label>
        <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2">{rules.map(([text, test]) => <li key={text} className={test(password) ? "text-emerald-700" : "text-slate-500"}>{test(password) ? "✓" : "•"} {text}</li>)}</ul>
        <label className="mt-5 block"><span className="text-sm font-medium text-slate-700">Confirm new password</span><input required type={show ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mt-1.5 w-full border border-slate-300 px-3 py-2.5 text-[15px]" /></label>
        {confirmation && password !== confirmation && <p className="mt-2 text-xs text-red-700">The passwords do not match.</p>}
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />Show passwords</label>
        <button disabled={busy || !valid} className="mt-6 flex min-h-11 w-full items-center justify-center bg-[var(--color-action)] px-6 py-2.5 text-[15px] font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save new password"}</button>
      </form>}
    </section>
  </main>;
}
