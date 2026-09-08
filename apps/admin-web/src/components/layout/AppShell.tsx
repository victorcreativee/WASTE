"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiRequest } from "@/lib/api";
import { usePathname } from "next/navigation";

const cityNav:NavItem[] = [
  {group:"Overview",label:"Control room",href:"/dashboard"},
  {group:"Regulation",label:"Permit applications",href:"/dashboard/permits"},
  {group:"City oversight",label:"Organizations",href:"/dashboard/organizations"},
  {group:"City oversight",label:"City operations",href:"/dashboard/waste"},
  {group:"City oversight",label:"Route control",href:"/dashboard/driver-mobile"},
  {group:"City oversight",label:"Service issues",href:"/dashboard/citizen-issues"},
  {group:"Coverage",label:"GIS coverage",href:"/dashboard/gis"},
];
const systemNav:NavItem[]=[{group:"Platform",label:"Platform overview",href:"/dashboard"},{group:"Platform",label:"Account verification",href:"/dashboard/account-verification"},{group:"Platform",label:"Platform packages",href:"/dashboard/platform-packages"},{group:"Platform",label:"Platform users",href:"/dashboard/platform-users"},{group:"Platform",label:"Organizations",href:"/dashboard/organizations"},{group:"Reference",label:"KCCA permit register",href:"/dashboard/permits"}];
type NavItem={label:string;href:string;group?:string};
const companyNav:NavItem[] = [
  {group:"Overview",label:"Organization overview",href:"/dashboard/company"},
  {group:"Operations",label:"Daily operations",href:"/dashboard/waste"},
  {group:"Operations",label:"Fleet control",href:"/dashboard/fleet"},
  {group:"Operations",label:"Drivers & routes",href:"/dashboard/driver-mobile"},
  {group:"Operations",label:"Service issues",href:"/dashboard/citizen-issues"},
  {group:"Operations",label:"Operational map",href:"/dashboard/gis"},
  {group:"People & customers",label:"Staff management",href:"/dashboard/team"},
  {group:"People & customers",label:"Customer management",href:"/dashboard/customer-service"},
  {group:"Commercial",label:"Contracts & service levels",href:"/dashboard/contracts"},
  {group:"Commercial",label:"Income & billing",href:"/dashboard/billing"},
  {group:"Finance",label:"Payroll",href:"/dashboard/payroll"},
  {group:"Finance",label:"Accounts payable",href:"/dashboard/accounts-payable"},
  {group:"Supply",label:"Inventory",href:"/dashboard/inventory"},
  {group:"Supply",label:"Procurement",href:"/dashboard/procurement"},
  {group:"Insights",label:"Reports",href:"/dashboard/reports"},
  {group:"Administration",label:"Access & permissions",href:"/dashboard/access"},
  {group:"Administration",label:"Company settings",href:"/dashboard/company-settings"},
];
const supervisorNav:NavItem[] = [
  {group:"Overview",label:"Operations overview",href:"/dashboard"},
  {group:"Operations",label:"Daily operations",href:"/dashboard/waste"},
  {group:"Operations",label:"Fleet control",href:"/dashboard/fleet"},
  {group:"Operations",label:"Drivers & routes",href:"/dashboard/driver-mobile"},
  {group:"Operations",label:"Service issues",href:"/dashboard/citizen-issues"},
  {group:"Operations",label:"Operational map",href:"/dashboard/gis"},
  {group:"Customers",label:"Customer management",href:"/dashboard/customer-service"},
  {group:"Customers",label:"Billing monitor",href:"/dashboard/billing"},
  {group:"Resources",label:"Inventory",href:"/dashboard/inventory"},
  {group:"Insights",label:"Reports",href:"/dashboard/reports"},
];
const customerNav:NavItem[] = [
  {group:"My service",label:"Service & collections",href:"/dashboard/customer-service"},
  {group:"My service",label:"Billing & payments",href:"/dashboard/billing"},
  {group:"Support",label:"Requests & issues",href:"/dashboard/citizen-issues"},
];
const driverNav:NavItem[] = [{group:"Today",label:"My route & jobs",href:"/dashboard/driver-mobile"}];

type CurrentUser = {
  fullName: string;
  email: string;
  organizationId?: string | null;
  roles?: string[];
};

function storedUserSnapshot() {
  return sessionStorage.getItem("currentUser") || "";
}

function subscribeToStoredUser() {
  return () => undefined;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const storedUser = useSyncExternalStore(
    subscribeToStoredUser,
    storedUserSnapshot,
    () => ""
  );
  const currentUser = useMemo<CurrentUser | null>(() => {
    if (!storedUser) return null;
    try {
      return JSON.parse(storedUser) as CurrentUser;
    } catch {
      return null;
    }
  }, [storedUser]);
  const [accessUser,setAccessUser]=useState<{user:string;permissions:string[]}|null>(null);
  useEffect(()=>{
    let cancelled=false;
    if(!currentUser?.roles?.some(r=>["company_admin","supervisor","driver","iot_operator"].includes(r)))return;
    apiRequest<{data:{permissions:string[]}}>("/api/auth/organization-access/me").then(result=>{
      if(!cancelled)setAccessUser({user:storedUser,permissions:result.data.permissions});
    }).catch(()=>{if(!cancelled)setAccessUser(null);});
    return()=>{cancelled=true;};
  },[currentUser,storedUser,pathname]);
  const primaryNavItems = currentUser?.roles?.includes("driver") ? driverNav
    : currentUser?.roles?.includes("citizen") ? customerNav
    : currentUser?.roles?.includes("company_admin") ? companyNav
    : currentUser?.roles?.includes("supervisor") ? supervisorNav
    : currentUser?.roles?.includes("system_admin") ? systemNav : cityNav;
  const grants=accessUser?.user===storedUser?accessUser.permissions:[];
  const visibleNavItems:NavItem[]=primaryNavItems.filter(item=>
    item.href==="/dashboard/team"?grants.includes("staff.read"):
    item.href==="/dashboard/access"?grants.includes("access.read"):true);
  if(grants.includes("staff.read")&&!visibleNavItems.some(item=>item.href==="/dashboard/team"))visibleNavItems.push({group:"People & customers",label:"Staff management",href:"/dashboard/team"});
  if(grants.includes("access.read")&&!visibleNavItems.some(item=>item.href==="/dashboard/access"))visibleNavItems.push({group:"Administration",label:"Access & permissions",href:"/dashboard/access"});
  const navGroups=visibleNavItems.reduce<Array<{name:string;items:NavItem[]}>>((groups,item)=>{
    const name=item.group||"Workspace",existing=groups.find(group=>group.name===name);
    if(existing)existing.items.push(item);else groups.push({name,items:[item]});
    return groups;
  },[]);
  const activeNavItem=visibleNavItems.find(item=>pathname===item.href||pathname.startsWith(`${item.href}/`));
  const productName = currentUser?.roles?.includes("company_admin") ? "Organization Operations"
    : currentUser?.roles?.includes("supervisor") ? "Field Control"
    : currentUser?.roles?.includes("driver") ? "Driver Workspace"
    : currentUser?.roles?.includes("citizen") ? "Customer Services"
    : currentUser?.roles?.includes("system_admin") ? "Platform Administration" : "KCCA Control Centre";

  useEffect(() => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      window.location.href = "/login";
    }
  }, []);

  function handleLogout() {
    sessionStorage.removeItem("accessToken");
    sessionStorage.removeItem("refreshToken");
    sessionStorage.removeItem("currentUser");
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-[#18202f]">
      <aside className="fixed left-0 top-0 hidden h-screen w-64 overflow-y-auto border-r border-slate-800 bg-[#151b2b] px-5 py-7 text-white lg:block">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#f0b35a]">
            Urban Waste OS
          </p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">{productName}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Kampala deployment</p>
        </div>

        <nav aria-label="Primary navigation" className="mt-9 space-y-6 pb-8 text-sm">
          {navGroups.map(group=><section key={group.name} aria-labelledby={`nav-${group.name.replaceAll(" ","-")}`}>
            <h2 id={`nav-${group.name.replaceAll(" ","-")}`} className="mb-1 px-4 text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500">{group.name}</h2>
            <div className="space-y-0.5">{group.items.map((item) => {
            const isActive =
              item.href !== "#" &&
              (pathname === item.href || pathname.startsWith(`${item.href}/`));

            return (
              <Link
                key={item.label}
                href={item.href}
                className={[
                  "block border-l-2 px-4 py-2 text-[13px] font-medium transition",
                  isActive
                    ? "border-[#f0b35a] bg-white/7 text-white"
                    : "border-transparent text-slate-400 hover:bg-white/5 hover:text-white",
                  item.href === "#" ? "cursor-not-allowed opacity-50" : "",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}</div></section>)}
        </nav>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-5 py-3 md:px-8">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 bg-[#c6842f]" aria-hidden="true" />
              <div><p className="text-sm font-semibold text-slate-800">{activeNavItem?.label||productName}</p><p className="text-xs text-slate-500">{currentUser?.organizationId?"Organization workspace":"Kampala city workspace"}</p></div>
            </div>

            <div className="flex items-center gap-3 text-right">
              <div className="hidden sm:block">
                <p className="text-sm font-semibold text-slate-900">
                  {currentUser?.fullName || "KCCA Admin"}
                </p>
                <p className="text-xs text-slate-500">
                  {currentUser?.email || "Signed in"}
                </p>
              </div>

              <button
                onClick={handleLogout}
                className="min-h-10 border-l border-slate-200 pl-4 text-sm font-semibold text-[#3156a3] hover:underline"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <details className="border-b border-slate-200 bg-white lg:hidden">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-5 text-sm font-semibold text-slate-800">
            <span>{visibleNavItems.find((item)=>pathname===item.href||pathname.startsWith(`${item.href}/`))?.label||"Open modules"}</span>
            <span aria-hidden="true">Menu</span>
          </summary>
          <nav aria-label="Primary navigation" className="border-t border-slate-200 p-4">
            {navGroups.map(group=><section key={group.name} className="mb-4"><h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.name}</h2><div className="grid grid-cols-2">{group.items.map((item)=><Link key={item.href} href={item.href} className={`border-l-2 px-3 py-2 text-sm font-medium ${pathname===item.href?"border-[#3156a3] bg-blue-50 text-[#3156a3]":"border-transparent text-slate-600"}`}>{item.label}</Link>)}</div></section>)}
          </nav>
        </details>

        <section className="p-4 md:p-8">{children}</section>
      </main>
    </div>
  );
}
