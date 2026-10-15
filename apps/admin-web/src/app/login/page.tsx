"use client";

import { useEffect, useState } from "react";
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

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupRequired,setSetupRequired]=useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  useEffect(()=>{
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
  },[]);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      if(window.kwmsDesktop){
        const desktop=window.kwmsDesktop as typeof window.kwmsDesktop&{centralLogin:(email:string,password:string)=>Promise<unknown>};
        try{
          await desktop.centralLogin(email.trim().toLowerCase(),password);
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
      let isRecyclingCompany=false;
      if(isCompany){
        try{const context=await apiRequest<{data:{organization:{type:string}}}>("/api/waste/recycling");isRecyclingCompany=context.data.organization.type==="recycling_company";}catch{}
      }
      const destination = isWeighbridgeWorker
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

  return (
    <main className="grid min-h-screen bg-[#f7f7f5] lg:grid-cols-[minmax(420px,0.9fr)_1.1fr]">
      <section className="hidden bg-[#151b2b] text-white lg:block">
        <div className="flex min-h-screen flex-col justify-between p-12">
          <div>
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center border border-white/20 text-sm font-bold text-[#f0b35a]">
                WMS
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Kampala Smart Waste</h1>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Waste Management System
                </p>
              </div>
            </div>

            <div className="mt-24 max-w-xl">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-[#f0b35a]">
                One connected operation
              </p>

              <h2 className="mt-6 text-5xl font-semibold leading-[1.08] tracking-tight">
                The right workspace for every waste-service role.
              </h2>

              <p className="mt-7 max-w-lg text-base leading-8 text-slate-300">
                One connected platform with focused workspaces for KCCA,
                collection organizations, field teams, and customers.
              </p>
            </div>

            <div className="mt-12 border-y border-white/15">
              {[
                ["01", "KCCA", "Control room"],
                ["02", "Company", "Operations"],
                ["03", "Driver", "Field work"],
                ["04", "Customer", "Services"],
              ].map(([icon, title, subtitle]) => (
                <div key={title} className="grid grid-cols-[36px_1fr] border-b border-white/10 py-3 last:border-0">
                  <div className="text-sm text-[#f0b35a]">{icon}</div>
                  <div><p className="text-sm font-semibold">{title}</p><p className="text-xs text-slate-400">{subtitle}</p></div>
                </div>
              ))}
            </div>
          </div>

          {setupRequired&&<div className="mt-6 border-l-2 border-amber-500 bg-amber-50 px-4 py-4"><p className="text-sm font-semibold text-amber-950">First-time setup is required</p><p className="mt-1 text-xs leading-5 text-amber-800">Create the first System Admin before signing in.</p><Link href="/setup/system-admin" className="mt-3 inline-block text-sm font-semibold text-[#3156a3] underline">Start secure setup</Link></div>}

          <p className="text-sm text-slate-300">
            © 2026 KCCA Smart Waste Platform. All rights reserved.
          </p>
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-6 py-10">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-md border-t-2 border-[#3156a3] bg-white p-8 sm:p-10"
        >
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#3156a3]">
              Secure access
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              Welcome back
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Use your work email and password. Your role opens the correct workspace automatically.
            </p>
          </div>

          {error && (
            <div role="alert" className="mt-6 border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <div className="mt-8 space-y-5">
            <label className="block">
              <span className="text-sm font-bold text-slate-800">
                Email address
              </span>
              <div className="mt-2 flex items-center border border-slate-300 bg-white px-3 focus-within:border-[#3156a3]">
                <input
                  required
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full border-0 bg-transparent px-1 py-3 text-slate-900 outline-none"
                  placeholder="admin@kcca.go.ug"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-800">Password</span>
              <div className="mt-2 flex items-center border border-slate-300 bg-white px-3 focus-within:border-[#3156a3]">
                <input
                  required
                  autoComplete="current-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full border-0 bg-transparent px-1 py-3 text-slate-900 outline-none"
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="min-h-10 px-2 text-sm font-semibold text-[#3156a3] hover:underline"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            <p className="text-sm text-slate-500">In the installed desktop application, your first sign-in requires internet. After verification, the same credentials can securely unlock approved offline work on this device.</p>

            <button
              type="submit"
              disabled={loading}
              className="flex min-h-12 w-full items-center justify-center gap-3 bg-[#3156a3] px-6 py-3 text-base font-semibold text-white transition hover:bg-[#24447f] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>{loading ? "Signing in..." : "Sign in"}</span>
              <span>→</span>
            </button>

            <div className="border-t border-slate-200 pt-4 text-sm text-slate-500">
              Having trouble signing in? Contact your organization administrator or KCCA system support.
              <p className="mt-3">Waste collection company? <Link href="/apply" className="font-semibold text-[#3156a3] underline">Start organization onboarding</Link></p>
              <p className="mt-2">Permit already approved? <Link href="/apply/account" className="font-semibold text-[#3156a3] underline">Apply for a company account</Link></p>
            </div>
          </div>
        </form>
      </section>
    </main>
  );
}
