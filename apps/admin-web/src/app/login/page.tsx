"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/api";

type LoginResponse = {
  success: boolean;
  message: string;
  data: {
    user: {
      id: string;
      fullName: string;
      email: string;
      organizationId: string | null;
    };
    roles: { name: string }[];
    tokens: {
      accessToken: string;
      refreshToken: string;
    };
  };
};

/** The signed-in user's organization type, used to open the right workspace. Empty when it cannot be read. */
async function organizationTypeOfSession(){
  try{return (await apiRequest<{data:{type:string}|null}>("/api/waste/organization-context")).data?.type||""}catch{return ""}
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupRequired,setSetupRequired]=useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberAccount,setRememberAccount]=useState(true);
  const [devicePin,setDevicePin]=useState("");
  const [savedAccount,setSavedAccount]=useState<{saved:boolean;email:string;fullName?:string;biometricAvailable:boolean;pinConfigured:boolean}|null>(null);
  const [installedApp,setInstalledApp]=useState(false);
  const [devicePinSupported,setDevicePinSupported]=useState(false);
  const signedOut=useSyncExternalStore(()=>()=>undefined,()=>new URLSearchParams(window.location.search).has("signedOut"),()=>false);
  useEffect(()=>{
    setInstalledApp(Boolean(window.kwmsDesktop));
    apiRequest<{data:{setupRequired:boolean}}>("/api/auth/system-bootstrap/status").then(r=>setSetupRequired(r.data.setupRequired)).catch(()=>undefined);
    const desktop=window.kwmsDesktop as (typeof window.kwmsDesktop&{resumeSavedAuth?:()=>Promise<{session:{user:LoginResponse["data"]["user"];roles:string[]};online:boolean;tokens?:LoginResponse["data"]["tokens"]}|null>});
    void desktop?.resumeSavedAuth?.().then(saved=>{
      if(!saved?.online||!saved.tokens)return;
      sessionStorage.setItem("accessToken",saved.tokens.accessToken);
      sessionStorage.setItem("refreshToken",saved.tokens.refreshToken);
      sessionStorage.setItem("currentUser",JSON.stringify({...saved.session.user,roles:saved.session.roles}));
      const roles=saved.session.roles;
      window.location.href=roles.includes("weighbridge_operator")?"/dashboard/weighbridge/operations":roles.some(role=>["recycling_collector","recycling_sales","recycling_field_manager"].includes(role))?"/dashboard/recycling":roles.includes("driver")?"/dashboard/driver-mobile":roles.includes("citizen")?"/dashboard/citizen-issues":roles.includes("organization_applicant")?"/onboarding":roles.includes("company_admin")?"/dashboard/company":"/dashboard";
    }).catch(()=>undefined);
    const savedBridge=window.kwmsDesktop as typeof window.kwmsDesktop&{getSavedAccount?:()=>Promise<{saved:boolean;email:string;fullName?:string;biometricAvailable:boolean;pinConfigured:boolean}>};
    setDevicePinSupported(Boolean(savedBridge?.getSavedAccount));
    void savedBridge?.getSavedAccount?.().then(account=>{setSavedAccount(account);if(account.email)setEmail(account.email)}).catch(()=>undefined);
  },[]);

  function openRoleWorkspace(session:{user:LoginResponse["data"]["user"];roles:string[]}){
    sessionStorage.setItem("accessToken","offline-local-session");
    sessionStorage.removeItem("refreshToken");
    sessionStorage.setItem("currentUser",JSON.stringify({...session.user,roles:session.roles,offline:true}));
    window.location.href=session.roles.includes("driver")?"/dashboard/driver-mobile":session.roles.some(role=>["recycling_collector","recycling_sales","recycling_field_manager"].includes(role))?"/dashboard/recycling":session.roles.includes("company_admin")?"/dashboard/company":"/dashboard";
  }

  async function unlockSaved(biometric:boolean){
    const bridge=window.kwmsDesktop as typeof window.kwmsDesktop&{unlockSavedAccount?:(input:{pin?:string;biometric?:boolean})=>Promise<{user:LoginResponse["data"]["user"];roles:string[]}>};
    if(!bridge?.unlockSavedAccount)return;
    setError("");setLoading(true);
    try{openRoleWorkspace(await bridge.unlockSavedAccount({pin:biometric?undefined:devicePin,biometric}))}catch(error){setError(error instanceof Error?error.message:"Could not unlock this account")}finally{setLoading(false)}
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      if(window.kwmsDesktop){
        const desktop=window.kwmsDesktop as typeof window.kwmsDesktop&{centralLogin:(email:string,password:string,options?:{rememberAccount:boolean;devicePin?:string})=>Promise<unknown>};
        try{
          if(rememberAccount&&devicePinSupported&&!/^\d{4,8}$/.test(devicePin))throw new Error("Create a 4 to 8 digit device PIN for offline access");
          const result=await desktop.centralLogin(email.trim().toLowerCase(),password,{rememberAccount,devicePin:rememberAccount?devicePin:undefined}) as {
            session?:{user:LoginResponse["data"]["user"];roles:string[]};
            user?:LoginResponse["data"]["user"];
            roles?:string[];
            tokens?:LoginResponse["data"]["tokens"];
          }|undefined;
          // Electron performs its own redirect. The Android/iOS bridge returns
          // the authenticated session so this same page can open the exact
          // role workspace without introducing a second mobile dashboard.
          const mobileUser=result?.session?.user||result?.user;
          const mobileRoles=result?.session?.roles||result?.roles||[];
          if(mobileUser&&result?.tokens){
            sessionStorage.setItem("accessToken",result.tokens.accessToken);
            sessionStorage.setItem("refreshToken",result.tokens.refreshToken);
            sessionStorage.setItem("currentUser",JSON.stringify({...mobileUser,roles:mobileRoles}));
            const mobileOrgType=mobileRoles.some(role=>["company_admin","supervisor"].includes(role))?await organizationTypeOfSession():"";
            const isRecyclingCompany=mobileOrgType==="recycling_company"&&mobileRoles.includes("company_admin");
            if(mobileOrgType==="processing_plant"){window.location.href="/dashboard/factory";return;}
            window.location.href=mobileRoles.includes("weighbridge_operator")?"/dashboard/weighbridge/operations":mobileRoles.some(role=>["recycling_collector","recycling_sales","recycling_field_manager"].includes(role))||isRecyclingCompany?"/dashboard/recycling":mobileRoles.includes("driver")?"/dashboard/driver-mobile":mobileRoles.includes("citizen")?"/dashboard/citizen-issues":mobileRoles.includes("organization_applicant")?"/onboarding":mobileRoles.includes("company_admin")?"/dashboard/company":"/dashboard";
          }
          return;
        }catch(desktopError){
          const message=desktopError instanceof Error?desktopError.message:String(desktopError||"");
          if(!/fetch|network|timeout|timed out|offline|unavailable|connect/i.test(message))throw desktopError;
          const session=await desktop.offlineLogin(email.trim().toLowerCase(),password);
          sessionStorage.setItem("accessToken","offline-local-session");
          sessionStorage.removeItem("refreshToken");
          sessionStorage.setItem("currentUser",JSON.stringify({...session.user,roles:session.roles,offline:true}));
          window.location.href=session.roles.includes("driver")?"/dashboard/driver-mobile":session.roles.some(role=>["recycling_collector","recycling_sales","recycling_field_manager"].includes(role))?"/dashboard/recycling":session.roles.includes("company_admin")?"/dashboard/company":"/dashboard";
          return;
        }
      }
      const response = await apiRequest<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      sessionStorage.setItem("accessToken", response.data.tokens.accessToken);
      sessionStorage.setItem("refreshToken", response.data.tokens.refreshToken);
      sessionStorage.setItem(
        "currentUser",
        JSON.stringify({
          id: response.data.user.id,
          fullName: response.data.user.fullName,
          email: response.data.user.email,
          organizationId: response.data.user.organizationId,
          roles: response.data.roles.map((role) => role.name),
        })
      );
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      localStorage.removeItem("currentUser");
      const isDriver = response.data.roles.some((role) => role.name === "driver");
      const isCitizen = response.data.roles.some((role) => role.name === "citizen");
      const isCompany = response.data.roles.some((role) => role.name === "company_admin");
      const isApplicant = response.data.roles.some((role) => role.name === "organization_applicant");
      const isWeighbridgeWorker = response.data.roles.some((role) => role.name === "weighbridge_operator");
      const isRecyclingCollector = response.data.roles.some((role) => role.name === "recycling_collector");
      const isRecyclingWorker = response.data.roles.some((role) => role.name === "recycling_sales");
      const isSupervisor = response.data.roles.some((role) => role.name === "supervisor");
      const organizationType = isCompany || isSupervisor ? await organizationTypeOfSession() : "";
      const isRecyclingCompany = isCompany && organizationType === "recycling_company";
      const destination = organizationType === "processing_plant"
        ? "/dashboard/factory"
        : isWeighbridgeWorker
        ? "/dashboard/weighbridge/operations"
        : isRecyclingCollector || isRecyclingWorker
        ? "/dashboard/recycling"
        : isDriver
        ? "/dashboard/driver-mobile"
        : isCitizen
        ? "/dashboard/citizen-issues"
        : isApplicant
        ? "/onboarding"
        : isCompany
        ? isRecyclingCompany?"/dashboard/recycling":"/dashboard/company"
        : "/dashboard";
      window.location.href=destination;
    } catch (error) {
      const message=error instanceof Error?error.message:"Login failed";
      if(window.kwmsDesktop&&message.includes("temporarily unavailable")){
        try{
          const session=await window.kwmsDesktop.offlineLogin(email,password);
          sessionStorage.setItem("accessToken","offline-local-session");
          sessionStorage.removeItem("refreshToken");
          sessionStorage.setItem("currentUser",JSON.stringify({...session.user,roles:session.roles,offline:true}));
          window.location.href=session.roles.includes("driver")?"/dashboard/driver-mobile":session.roles.some(role=>["recycling_collector","recycling_sales","recycling_field_manager"].includes(role))?"/dashboard/recycling":"/dashboard";
          return;
        }catch(offlineError){setError(offlineError instanceof Error?offlineError.message:"Offline sign-in failed");}
      }else setError(message);
    } finally {
      setLoading(false);
    }
  }

  const inputClass="w-full rounded-[var(--ui-radius)] border border-[var(--color-border-strong)] bg-white px-3.5 py-2.5 text-[15px] text-slate-900 shadow-[var(--ui-shadow-xs)]";

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1fr_minmax(520px,0.95fr)]">
      <section className="flex min-h-screen flex-col px-6 py-8 sm:px-10">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-[var(--ui-radius)] bg-[var(--color-action)] text-white"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 19H4.8a1.8 1.8 0 0 1-1.6-2.7L7 9.8"/><path d="M11 19h8.2a1.8 1.8 0 0 0 1.6-2.7l-1.2-2.1"/><path d="m14 16-3 3 3 3"/><path d="M8.3 13.6 7 9.8l-3.8 1.3"/><path d="m9.3 5.4 1.1-1.9a1.8 1.8 0 0 1 3.2 0l3.9 6.7"/><path d="m13.4 9.4 3.9 1.1 1.1-3.9"/></svg></span>
          <div><p className="text-sm font-semibold leading-5 text-slate-900">Kampala Smart Waste</p><p className="text-xs leading-4 text-slate-500">Waste Management System</p></div>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <form onSubmit={handleLogin} className="w-full max-w-[400px]">
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-950">Sign in</h1>
            <p className="mt-2 text-[15px] leading-6 text-slate-500">Use your work email. We&rsquo;ll open the right workspace for your role.</p>

            {setupRequired&&<div className="mt-6 rounded-[var(--ui-radius)] border border-amber-200 bg-amber-50 px-4 py-3"><p className="text-sm font-semibold text-amber-900">First-time setup required</p><p className="mt-0.5 text-sm text-amber-800">Create the first System Admin before anyone signs in.</p><Link href="/setup/system-admin" className="mt-2 inline-block text-sm font-semibold text-amber-900 underline">Start secure setup</Link></div>}

            {signedOut&&!error&&<div role="status" className="feedback feedback-success mt-6"><div>You have signed out.</div></div>}
            {error && <div role="alert" className="feedback feedback-error mt-6"><div>{error}</div></div>}

            <div className="mt-8 space-y-5">
              {savedAccount?.saved&&<div className="rounded-[var(--ui-radius)] border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3"><span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-600 ring-1 ring-slate-200">{(savedAccount.fullName||savedAccount.email).slice(0,1).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{savedAccount.fullName||savedAccount.email}</p><p className="text-xs text-slate-500">Saved on this device · works offline</p></div></div>
                <label className="mt-4 block"><span className="text-sm font-medium text-slate-700">Device PIN</span><input inputMode="numeric" pattern="[0-9]*" maxLength={8} value={devicePin} onChange={event=>setDevicePin(event.target.value.replace(/\D/g,""))} className={`mt-1.5 ${inputClass} tracking-[.3em]`} placeholder="••••" /></label>
                <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={()=>void unlockSaved(false)} className="bg-[var(--color-action)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-action-hover)]">Unlock offline</button>{savedAccount.biometricAvailable&&<button type="button" onClick={()=>void unlockSaved(true)} className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Use device authentication</button>}</div>
                <p className="mt-4 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200"/>or sign in with password<span className="h-px flex-1 bg-slate-200"/></p>
              </div>}

              <label className="block">
                <span className="text-sm font-medium text-slate-700">Email</span>
                <input id="kwms-email" name="email" required type="email" autoComplete="username" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} className={`mt-1.5 ${inputClass}`} placeholder="name@organization.go.ug" />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">Password</span>
                <div className="relative mt-1.5">
                  <input id="kwms-password" name="password" required autoComplete="current-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} className={`${inputClass} pr-16`} placeholder="Enter your password" />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-pressed={showPassword} className="absolute right-1.5 top-1/2 min-h-0 -translate-y-1/2 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800">{showPassword ? "Hide" : "Show"}</button>
                </div>
              </label>

              {installedApp&&<div className="rounded-[var(--ui-radius)] border border-slate-200 p-4"><label className="flex items-start gap-3"><input type="checkbox" checked={rememberAccount} onChange={event=>setRememberAccount(event.target.checked)} className="mt-0.5 h-4 w-4"/><span><span className="block text-sm font-medium text-slate-800">Remember this device</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">Saves protected authorization for offline unlock &mdash; never your password.</span></span></label>{rememberAccount&&devicePinSupported&&<label className="mt-4 block"><span className="text-sm font-medium text-slate-700">Create a device PIN</span><input inputMode="numeric" pattern="[0-9]*" maxLength={8} value={devicePin} onChange={event=>setDevicePin(event.target.value.replace(/\D/g,""))} className={`mt-1.5 ${inputClass} tracking-[.3em]`} placeholder="4–8 digits"/><span className="mt-1.5 block text-xs text-slate-500">Only unlocks this installed app when you&rsquo;re offline.</span></label>}</div>}

              <button type="submit" disabled={loading} className="flex min-h-11 w-full items-center justify-center gap-2 bg-[var(--color-action)] px-6 py-2.5 text-[15px] font-semibold text-white shadow-[var(--ui-shadow-xs)] transition hover:bg-[var(--color-action-hover)] disabled:opacity-60">
                {loading&&<span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent"/>}
                {loading ? "Signing in…" : "Sign in"}
              </button>

              {installedApp&&<p className="text-xs leading-5 text-slate-500">Your first sign-in on this device needs internet. After that you can unlock with your PIN or biometrics.</p>}
            </div>

            <div className="mt-10 space-y-2 border-t border-slate-100 pt-6 text-sm text-slate-500">
              <p>Waste collection company? <Link href="/apply" className="font-semibold text-[var(--color-action)] hover:underline">Start onboarding</Link></p>
              <p>Permit already approved? <Link href="/apply/account" className="font-semibold text-[var(--color-action)] hover:underline">Request a company account</Link></p>
              <p className="pt-2 text-xs text-slate-400">Trouble signing in? Contact your organization administrator or KCCA support.</p>
            </div>
          </form>
        </div>

        <p className="text-xs text-slate-400">© 2026 KCCA Smart Waste Platform</p>
      </section>

      <section aria-hidden="true" className="relative hidden overflow-hidden bg-[var(--color-ink)] lg:block">
        <div className="relative flex h-full flex-col justify-end p-14 text-white">
          <p className="text-sm font-medium text-[var(--color-accent-bright)]">One connected operation</p>
          <h2 className="mt-4 max-w-md text-[40px] font-semibold leading-[1.1] tracking-tight">Waste operations for Kampala, in one system.</h2>
          <p className="mt-5 max-w-md text-[15px] leading-7 text-slate-300">Focused workspaces for KCCA, collection companies, field teams and residents &mdash; all on one platform.</p>
          <dl className="mt-12 grid max-w-lg grid-cols-2 gap-px overflow-hidden rounded-[var(--ui-radius)] border border-white/10 bg-white/10">
            {[["KCCA","City oversight"],["Collectors","Fleet & billing"],["Field teams","Routes & trips"],["Residents","Service & payments"]].map(([title,subtitle])=><div key={title} className="bg-[var(--color-ink)] p-4"><dt className="text-sm font-semibold">{title}</dt><dd className="mt-0.5 text-xs text-slate-400">{subtitle}</dd></div>)}
          </dl>
        </div>
      </section>
    </main>
  );
}
