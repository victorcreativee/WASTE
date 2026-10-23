"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Collector, CUSTOMER_TYPES, HouseholdSession, inKampala, matchLabel, publicGet, publicPost, storeHouseholdSession } from "@/lib/household-session";

// Customer sign-up: who you are, where you are, then the collection companies that serve that place. The account works
// straight away; the chosen company accepts the request from its dashboard.

type Division = { id: string; name: string; areas: { id: string; name: string }[] };
type CustomerType = (typeof CUSTOMER_TYPES)[number][0];

const ugx = (value: number | string) => `UGX ${Math.round(Number(value || 0)).toLocaleString("en-GB")}`;
const field = "mt-1 block w-full rounded-[var(--ui-radius)] border border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-[var(--color-action)] focus:ring-2 focus:ring-[var(--color-action-ring)]";
const primary = "w-full rounded-[var(--ui-radius)] bg-[var(--color-action)] px-4 py-3 text-base font-semibold text-white hover:bg-[var(--color-action-hover)] disabled:opacity-60";

export default function JoinPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [customerType, setCustomerType] = useState<CustomerType>("residential");
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [address, setAddress] = useState("");
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [collectors, setCollectors] = useState<Collector[] | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    publicGet<Division[]>("/api/waste/public/areas").then(setDivisions).catch(() => setError("Areas could not be loaded. Check your connection and reload the page."));
  }, []);

  const division = divisions.find((item) => item.id === divisionId);
  const area = division?.areas.find((item) => item.id === areaId);

  function locate() {
    if (!navigator.geolocation) { setError("This phone's browser cannot share its location. Choose your area instead."); return; }
    setLocating(true); setError("");
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setLocating(false);
        if (!inKampala(result.coords.latitude, result.coords.longitude)) { setError("Your phone's location is outside Kampala. Share it when you are at the place to be collected from, or just use your division and area."); return; }
        setPosition({ latitude: result.coords.latitude, longitude: result.coords.longitude });
      },
      () => { setLocating(false); setError("Location was not shared. That's fine: your division and area are enough."); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function findCompanies() {
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ divisionId, customerType });
      if (areaId) query.set("areaId", areaId);
      if (position) { query.set("latitude", String(position.latitude)); query.set("longitude", String(position.longitude)); }
      const found = await publicGet<Collector[]>(`/api/waste/public/collectors?${query}`);
      setCollectors(found);
      setCompanyId(found.length === 1 ? found[0].id : "");
      setStep(3);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Companies could not be loaded."); }
    finally { setBusy(false); }
  }

  async function createAccount(chosen = companyId) {
    setBusy(true); setError("");
    try {
      const session = await publicPost<HouseholdSession>("/api/auth/households/signup", {
        fullName: fullName.trim(), phone, password, customerType, divisionId, areaId: areaId || undefined, address: address.trim(),
        ...(position ?? {}), organizationId: chosen || undefined, note: chosen && note.trim() ? note.trim() : undefined,
      });
      storeHouseholdSession(session);
      router.push("/my");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your account could not be created.");
      // A problem with the phone number or details is fixed on the first step.
      if ((cause as { status?: number }).status === 409 && /number/i.test((cause as Error).message)) setStep(1);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-lg px-4 pb-16 pt-5">
        <header className="mb-5 flex items-center gap-3">
          <Image src="/logo-mark-blue.svg" alt="" width={40} height={40} unoptimized className="h-10 w-10 rounded-[var(--ui-radius)]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">Kampala WMS</p>
            <p className="truncate text-sm text-slate-500">Get your waste collected</p>
          </div>
          <Link href="/my" className="text-sm font-medium text-slate-500 hover:text-slate-800">Sign in</Link>
        </header>

        <ol className="mb-4 grid grid-cols-3 gap-2 text-xs font-medium" aria-label="Steps">
          {["About you", "Where you are", "Your company"].map((label, index) => (
            <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={`border-t-2 pt-2 ${step >= index + 1 ? "border-[var(--color-action)] text-[var(--color-action)]" : "border-slate-200 text-slate-400"}`}>{label}</li>
          ))}
        </ol>

        {error ? <p role="alert" className="mb-4 rounded-[var(--ui-radius)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}

        <section className="rounded-[var(--ui-radius)] border border-slate-200 bg-white p-5 shadow-sm">
          {step === 1 ? (
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setError(""); setStep(2); }}>
              <div>
                <h1 className="text-xl font-semibold">Create your account</h1>
                <p className="mt-1 text-sm leading-6 text-slate-600">For homes, offices and businesses in Kampala. See your collection days, pay by mobile money and report problems.</p>
              </div>
              <label className="block text-sm font-medium">Your name, or your business name
                <input required minLength={2} maxLength={150} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className={field} />
              </label>
              <label className="block text-sm font-medium">Mobile number
                <input required inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0772 123 456" className={field} />
                <span className="mt-1 block text-xs font-normal text-slate-500">You sign in with this number. Your collection company may call you on it.</span>
              </label>
              <fieldset>
                <legend className="text-sm font-medium">Who is the collection for?</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {CUSTOMER_TYPES.map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={customerType === value} onClick={() => setCustomerType(value)}
                      className={`rounded-[var(--ui-radius)] border px-3 py-3 text-left text-sm font-medium ${customerType === value ? "border-[var(--color-action)] bg-[var(--color-action-soft)] text-[var(--color-action)]" : "border-slate-300"}`}>{label}</button>
                  ))}
                </div>
              </fieldset>
              <label className="block text-sm font-medium">Password
                <div className="relative">
                  <input required minLength={6} maxLength={72} type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className={`${field} pr-16`} />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 mt-1 px-3 text-sm font-medium text-slate-500">{showPassword ? "Hide" : "Show"}</button>
                </div>
                <span className="mt-1 block text-xs font-normal text-slate-500">At least 6 characters.</span>
              </label>
              <button className={primary}>Continue</button>
            </form>
          ) : null}

          {step === 2 ? (
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void findCompanies(); }}>
              <div>
                <h1 className="text-xl font-semibold">Where should we collect?</h1>
                <p className="mt-1 text-sm leading-6 text-slate-600">We use this to find the companies that collect where you are.</p>
              </div>
              <label className="block text-sm font-medium">Division
                <select required value={divisionId} onChange={(event) => { setDivisionId(event.target.value); setAreaId(""); }} className={field}>
                  <option value="">Choose your division</option>
                  {divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Area
                <select value={areaId} onChange={(event) => setAreaId(event.target.value)} disabled={!division} className={`${field} disabled:bg-slate-50`}>
                  <option value="">{division ? "My area is not listed" : "Choose a division first"}</option>
                  {division?.areas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Street, building or landmark
                <input required minLength={5} maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Plot 12, opposite Kisenyi mosque" className={field} />
              </label>
              <div className="rounded-[var(--ui-radius)] bg-slate-50 p-3">
                {position ? (
                  <p className="text-sm text-emerald-700">Location shared. Companies will see exactly where to collect.</p>
                ) : (
                  <>
                    <button type="button" disabled={locating} onClick={locate} className="rounded-[var(--ui-radius)] border border-[var(--color-action)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-action)] disabled:opacity-60">{locating ? "Finding you…" : "Use my current location"}</button>
                    <p className="mt-2 text-xs text-slate-500">Optional. Do this while you are at the place to be collected from.</p>
                  </>
                )}
              </div>
              <button disabled={busy} className={primary}>{busy ? "Finding companies…" : "Find collection companies"}</button>
              <button type="button" onClick={() => setStep(1)} className="w-full py-1 text-sm text-slate-600">Back</button>
            </form>
          ) : null}

          {step === 3 && collectors ? (
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void createAccount(); }}>
              <div>
                <h1 className="text-xl font-semibold">{collectors.length ? "Choose your collection company" : "No company here yet"}</h1>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {collectors.length
                    ? "These companies collect in your area, closest match first. The company you choose confirms your request, usually after a call."
                    : `No collection company has registered for ${area?.name || division?.name || "your area"} yet. Create your account now; you can choose a company from your page as soon as one is available.`}
                </p>
              </div>
              {collectors.length ? (
                <div className="space-y-2" role="radiogroup" aria-label="Collection companies">
                  {collectors.map((collector) => (
                    <button key={collector.id} type="button" role="radio" aria-checked={companyId === collector.id} onClick={() => setCompanyId(collector.id)}
                      className={`block w-full rounded-[var(--ui-radius)] border p-4 text-left ${companyId === collector.id ? "border-[var(--color-action)] bg-[var(--color-action-soft)]" : "border-slate-300 hover:bg-slate-50"}`}>
                      <span className="flex items-start justify-between gap-3">
                        <span className="text-base font-semibold">{collector.name}</span>
                        {collector.from_fee_ugx ? <span className="shrink-0 text-sm font-medium text-slate-700">from {ugx(collector.from_fee_ugx)}/month</span> : null}
                      </span>
                      <span className={`mt-1 block text-sm ${collector.match === "division" ? "text-slate-600" : "text-emerald-700"}`}>{matchLabel(collector, area?.name, division?.name)}</span>
                      {collector.phone ? <span className="mt-1 block text-sm text-slate-500">{collector.phone}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {companyId ? (
                <label className="block text-sm font-medium">Message to the company (optional)
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={500} placeholder="How much waste, which days suit you, how to find you" className={field} />
                </label>
              ) : null}
              <button disabled={busy || (collectors.length > 0 && !companyId)} className={primary}>{busy ? "Creating your account…" : companyId ? "Create account and send request" : "Create my account"}</button>
              {collectors.length ? <button type="button" disabled={busy} onClick={() => { setCompanyId(""); void createAccount(""); }} className="w-full py-1 text-sm text-slate-600">Create my account and choose later</button> : null}
              <button type="button" onClick={() => setStep(2)} className="w-full py-1 text-sm text-slate-600">Back</button>
            </form>
          ) : null}
        </section>
        <p className="mt-4 text-center text-sm text-slate-600">Already have an account? <Link href="/my" className="font-semibold text-[var(--color-action)]">Sign in</Link></p>
      </div>
    </main>
  );
}
