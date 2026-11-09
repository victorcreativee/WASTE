"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState(""), [busy, setBusy] = useState(false), [sent, setSent] = useState(""), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { setSent((await apiRequest<{ message: string }>("/api/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email: email.trim().toLowerCase() }) })).message); }
    catch (e) { setError(e instanceof Error ? e.message : "The request could not be sent. Try again."); }
    finally { setBusy(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-12">
    <section className="w-full max-w-lg border-t-2 border-[var(--color-action)] bg-white p-7 shadow-sm sm:p-9">
      <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--color-action)]">Account recovery</p>
      <h1 className="mt-3 text-3xl font-semibold text-slate-950">{sent ? "Check your email" : "Forgot your password?"}</h1>
      {sent ? <>
        <div role="status" className="mt-5 border-l-2 border-emerald-600 bg-emerald-50 p-4 text-sm text-emerald-800">{sent}</div>
        <p className="mt-4 text-sm leading-6 text-slate-600">The link works once and expires in 30 minutes. If nothing arrives, ask your organization administrator or the platform administrator to send you a reset link.</p>
        <div className="mt-7 flex flex-wrap gap-3"><Link href="/login" className="bg-[var(--color-action)] px-5 py-3 text-sm font-semibold text-white">Back to sign in</Link><button type="button" onClick={() => setSent("")} className="border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700">Use another email</button></div>
      </> : <form onSubmit={submit}>
        <p className="mt-4 text-sm leading-6 text-slate-600">Enter the email you sign in with. We will send a link to choose a new password.</p>
        {error && <div role="alert" className="mt-5 border-l-2 border-red-600 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        <label className="mt-6 block"><span className="text-sm font-medium text-slate-700">Email</span><input required type="email" autoComplete="username" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1.5 w-full border border-slate-300 px-3 py-2.5 text-[15px]" placeholder="name@organization.go.ug" /></label>
        <button disabled={busy} className="mt-6 flex min-h-11 w-full items-center justify-center bg-[var(--color-action)] px-6 py-2.5 text-[15px] font-semibold text-white disabled:opacity-60">{busy ? "Sending…" : "Send reset link"}</button>
        <p className="mt-6 text-sm text-slate-500">Remembered it? <Link href="/login" className="font-semibold text-[var(--color-action)] hover:underline">Sign in</Link></p>
      </form>}
    </section>
  </main>;
}
