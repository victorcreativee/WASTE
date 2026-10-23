"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SIGNUP_PLAN_KEY, WASTE_FEATURES } from "@/lib/plan-features";

// Public plans and prices. Choosing a plan remembers it, and the plan step of signing up starts with it selected.

type Plan = {
  id: string; code: string; name: string; description: string | null; organization_type: string;
  monthly_fee_ugx: number; annual_fee_ugx: number; max_vehicles: number | null; max_users: number | null; trial_days: number; feature_codes: string[];
};
type Audience = "waste_collection_company" | "recycling_company";

const ugx = (value: number) => `UGX ${Math.round(value).toLocaleString("en-GB")}`;
const featureName = new Map<string, string>(WASTE_FEATURES.map(([code, name]) => [code, name]));

export default function PricingPage() {
  const [audience, setAudience] = useState<Audience>("waste_collection_company");
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/api/waste/public/plans?type=${audience}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Plans are not available right now.")))
      .then((payload: { data: Plan[] }) => { if (!cancelled) { setPlans(payload.data); setError(""); } })
      .catch((cause: Error) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [audience]);

  function choose(plan: Plan) {
    try { localStorage.setItem(SIGNUP_PLAN_KEY, plan.code); } catch { /* the plan can still be chosen while signing up */ }
  }

  const allFeatures = audience === "waste_collection_company" ? WASTE_FEATURES.map(([code]) => code) : [];

  return (
    <main className="min-h-screen bg-[var(--background)] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-6 px-5 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo-mark-blue.svg" alt="" width={32} height={32} unoptimized className="h-8 w-8 rounded-[var(--ui-radius)]" />
            <span className="font-semibold">Kampala WMS</span>
          </Link>
          <div className="flex items-center gap-3 text-sm font-semibold">
            <Link href="/login" className="px-3 py-2 text-slate-700 hover:text-slate-950">Sign in</Link>
            <Link href="/register/organization" className="bg-[var(--color-action)] px-4 py-2 text-white hover:bg-[var(--color-action-hover)]">Register</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 pb-6 pt-14 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--color-action)]">Plans and prices</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Run your waste business on one platform. Start with a free trial.</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">Every plan starts with a free trial. Households are never counted against your plan: register as many customers as you serve.</p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <div role="tablist" aria-label="Type of company" className="inline-flex border border-slate-300 bg-white p-1">
            {([["waste_collection_company", "Waste collection companies"], ["recycling_company", "Recycling companies"]] as const).map(([value, label]) => (
              <button key={value} role="tab" aria-selected={audience === value} onClick={() => { setAudience(value); setPlans(null); }}
                className={`px-4 py-2 text-sm font-semibold ${audience === value ? "bg-[var(--color-action)] text-white" : "text-slate-700 hover:bg-slate-50"}`}>{label}</button>
            ))}
          </div>
          <div role="tablist" aria-label="Billing" className="inline-flex border border-slate-300 bg-white p-1">
            {([["monthly", "Monthly"], ["annual", "Yearly"]] as const).map(([value, label]) => (
              <button key={value} role="tab" aria-selected={cycle === value} onClick={() => setCycle(value)}
                className={`px-4 py-2 text-sm font-semibold ${cycle === value ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"}`}>{label}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-16 lg:px-8">
        {error ? <p role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}
        {!plans && !error ? <p className="py-12 text-sm text-slate-500">Loading plans…</p> : null}
        {plans ? (
          <div className={`grid gap-5 ${plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
            {plans.map((plan, index) => {
              const free = plan.monthly_fee_ugx === 0 && plan.annual_fee_ugx === 0;
              const price = cycle === "annual" ? plan.annual_fee_ugx : plan.monthly_fee_ugx;
              const saving = plan.monthly_fee_ugx * 12 - plan.annual_fee_ugx;
              const featured = plans.length > 1 && index === plans.length - 1;
              return (
                <article key={plan.id} className={`flex flex-col border bg-white p-6 ${featured ? "border-[var(--color-action)] shadow-[0_0_0_1px_var(--color-action)]" : "border-slate-300"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-xl font-semibold">{plan.name}</h2>
                    {featured ? <span className="bg-[var(--color-action-soft)] px-2 py-1 text-xs font-semibold text-[var(--color-action)]">Everything included</span> : null}
                  </div>
                  {plan.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{plan.description}</p> : null}
                  <p className="mt-6">
                    <span className="text-3xl font-semibold tracking-tight">{free ? "Free" : ugx(price)}</span>
                    {free ? null : <span className="text-sm text-slate-500"> / {cycle === "annual" ? "year" : "month"}</span>}
                  </p>
                  <p className="mt-1 min-h-5 text-xs text-slate-500">
                    {free ? "No charge" : cycle === "annual" && saving > 0 ? `Saves ${ugx(saving)} compared with paying monthly` : plan.trial_days ? `${plan.trial_days}-day free trial` : ""}
                  </p>
                  <ul className="mt-5 space-y-2 border-t border-slate-200 pt-5 text-sm">
                    <li className="flex justify-between gap-3"><span className="text-slate-600">Vehicles</span><span className="font-semibold">{plan.max_vehicles ?? "Unlimited"}</span></li>
                    <li className="flex justify-between gap-3"><span className="text-slate-600">Staff accounts</span><span className="font-semibold">{plan.max_users ?? "Unlimited"}</span></li>
                    {audience === "waste_collection_company" ? <li className="flex justify-between gap-3"><span className="text-slate-600">Households</span><span className="font-semibold">Unlimited</span></li> : null}
                    <li className="flex justify-between gap-3"><span className="text-slate-600">Free trial</span><span className="font-semibold">{plan.trial_days ? `${plan.trial_days} days` : "None"}</span></li>
                  </ul>
                  {allFeatures.length ? (
                    <ul className="mt-5 space-y-2 text-sm">
                      {allFeatures.map((code) => {
                        const included = plan.feature_codes.includes(code);
                        return (
                          <li key={code} className={`flex items-start gap-2 ${included ? "text-slate-800" : "text-slate-400"}`}>
                            <span aria-hidden="true" className={included ? "text-[var(--color-action)]" : ""}>{included ? "✓" : "–"}</span>
                            <span><span className="sr-only">{included ? "Included: " : "Not included: "}</span>{featureName.get(code)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  <div className="mt-auto pt-6">
                    <Link href="/register/organization" onClick={() => choose(plan)}
                      className={`block px-4 py-3 text-center text-sm font-semibold ${featured ? "bg-[var(--color-action)] text-white hover:bg-[var(--color-action-hover)]" : "border border-[var(--color-action)] text-[var(--color-action)] hover:bg-[var(--color-action-soft)]"}`}>
                      {free ? "Get started" : plan.trial_days ? `Start ${plan.trial_days}-day free trial` : "Choose this plan"}
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
        <div className="mt-10 grid gap-6 border-t border-slate-300 pt-8 text-sm leading-6 text-slate-600 md:grid-cols-3">
          <p><span className="font-semibold text-slate-900">How the trial works.</span> Register your company, complete the KCCA steps for your type of business, and your trial starts when your account is opened. No payment is needed to start.</p>
          <p><span className="font-semibold text-slate-900">When the trial ends.</span> You get reminders a week, three days and a day before. The first invoice follows; pay by mobile money or bank transfer from your Subscription page.</p>
          <p><span className="font-semibold text-slate-900">Changing plans.</span> Move up or down at any time from the Subscription page. Your records stay with you whichever plan you are on.</p>
        </div>
      </section>
    </main>
  );
}
