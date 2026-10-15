"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiRequest } from "@/lib/api";
import { usePathname } from "next/navigation";
import { WeighbridgeReconciliation } from "@/components/weighbridge/WeighbridgeReconciliation";
import { DesktopSyncCenter } from "@/components/layout/DesktopSyncCenter";

const cityNav:NavItem[] = [
  {group:"Overview",label:"Control room",href:"/dashboard"},
  {group:"Regulation",label:"Permit applications",href:"/dashboard/permits"},
  {group:"City oversight",label:"Licensed operators",href:"/dashboard/organizations"},
  {group:"City oversight",label:"Live operations",href:"/dashboard/waste"},
  {group:"City oversight",label:"Weighbridge operations",href:"/dashboard/weighbridge"},
  {group:"City oversight",label:"Issues",href:"/dashboard/citizen-issues"},
  {group:"City oversight",label:"Coverage map",href:"/dashboard/gis"},
  {group:"City oversight",label:"Collector performance",href:"/dashboard/city-reports"},
  {group:"City oversight",label:"Compliance cases",href:"/dashboard/compliance"},
];
const systemNav:NavItem[]=[{group:"Platform",label:"Platform overview",href:"/dashboard"},{group:"Platform",label:"Company applications",href:"/dashboard/account-applications"},{group:"Platform",label:"Account verification",href:"/dashboard/account-verification"},{group:"Platform",label:"Platform packages",href:"/dashboard/platform-packages"},{group:"Platform",label:"Platform users",href:"/dashboard/platform-users"},{group:"Platform",label:"Weighbridge workers",href:"/dashboard/weighbridge-workers"},{group:"Platform",label:"Organizations",href:"/dashboard/organizations"},{group:"Reference",label:"KCCA permit register",href:"/dashboard/permits"},{group:"Reference",label:"Collector performance",href:"/dashboard/city-reports"}];
type NavItem={label:string;href:string;group?:string;packageFeature?:string};
const companyNav:NavItem[] = [
  {group:"Overview",label:"Organization overview",href:"/dashboard/company"},
  {group:"Service delivery",label:"Today’s operations",href:"/dashboard/waste",packageFeature:"core_operations"},
  {group:"Service delivery",label:"Service areas & routes",href:"/dashboard/service-areas",packageFeature:"service_areas"},
  {group:"Service delivery",label:"Fleet control",href:"/dashboard/fleet",packageFeature:"fleet"},
  {group:"Service delivery",label:"Trips & drivers",href:"/dashboard/driver-mobile",packageFeature:"core_operations"},
  {group:"Service delivery",label:"Daily tonnage",href:"/dashboard/tonnage",packageFeature:"tonnage"},
  {group:"Service delivery",label:"Service issues",href:"/dashboard/citizen-issues",packageFeature:"service_issues"},
  {group:"People & customers",label:"Customer management",href:"/dashboard/customer-service",packageFeature:"customers"},
  {group:"People & customers",label:"Staff management",href:"/dashboard/team",packageFeature:"core_operations"},
  {group:"Commercial",label:"Contracts & service levels",href:"/dashboard/contracts",packageFeature:"contracts"},
  {group:"Commercial",label:"Income & billing",href:"/dashboard/billing",packageFeature:"billing"},
  {group:"Finance",label:"Payroll",href:"/dashboard/payroll",packageFeature:"finance"},
  {group:"Finance",label:"Accounts payable",href:"/dashboard/accounts-payable",packageFeature:"finance"},
  {group:"Supply",label:"Inventory",href:"/dashboard/inventory",packageFeature:"inventory"},
  {group:"Supply",label:"Procurement",href:"/dashboard/procurement",packageFeature:"procurement"},
  {group:"Insights",label:"Reports",href:"/dashboard/reports",packageFeature:"reports"},
  {group:"Insights",label:"KCCA compliance",href:"/dashboard/compliance",packageFeature:"compliance"},
  {group:"Administration",label:"Access & permissions",href:"/dashboard/access",packageFeature:"access"},
  {group:"Administration",label:"Company settings",href:"/dashboard/company-settings"},
];
const supervisorNav:NavItem[] = [
  {group:"Overview",label:"Operations overview",href:"/dashboard"},
  {group:"Operations",label:"Daily operations",href:"/dashboard/waste"},
  {group:"Operations",label:"Service areas",href:"/dashboard/service-areas"},
  {group:"Operations",label:"Fleet control",href:"/dashboard/fleet"},
  {group:"Operations",label:"Trip monitoring",href:"/dashboard/driver-mobile"},
  {group:"Operations",label:"Daily tonnage",href:"/dashboard/tonnage"},
  {group:"Operations",label:"Service issues",href:"/dashboard/citizen-issues"},
  {group:"Customers",label:"Customer management",href:"/dashboard/customer-service"},
  {group:"People",label:"Staff management",href:"/dashboard/team"},
  {group:"Customers",label:"Billing monitor",href:"/dashboard/billing"},
  {group:"Resources",label:"Inventory",href:"/dashboard/inventory"},
  {group:"Insights",label:"Reports",href:"/dashboard/recycling-reports"},
];
const recyclingCompanyNav:NavItem[]=[
  {group:"Overview",label:"Materials & sales",href:"/dashboard/recycling"},
  {group:"People",label:"Staff management",href:"/dashboard/team"},
  {group:"Finance",label:"Finance",href:"/dashboard/billing"},
  {group:"Finance",label:"Payroll",href:"/dashboard/payroll"},
  {group:"Finance",label:"Accounts payable",href:"/dashboard/accounts-payable"},
  {group:"Supply",label:"Inventory",href:"/dashboard/inventory"},
  {group:"Supply",label:"Procurement",href:"/dashboard/procurement"},
  {group:"Insights",label:"Reports",href:"/dashboard/reports"},
  {group:"Insights",label:"KCCA compliance",href:"/dashboard/compliance"},
  {group:"Administration",label:"Access & permissions",href:"/dashboard/access"},
  {group:"Administration",label:"Company settings",href:"/dashboard/company-settings"},
];
const customerNav:NavItem[] = [
  {group:"My service",label:"Service & collections",href:"/dashboard/customer-service"},
  {group:"My service",label:"Billing & payments",href:"/dashboard/billing"},
  {group:"Support",label:"Requests & issues",href:"/dashboard/citizen-issues"},
];
const driverNav:NavItem[] = [{group:"Today",label:"My route & jobs",href:"/dashboard/driver-mobile"}];
const weighbridgeNav:NavItem[] = [{group:"Facility operations",label:"Record vehicle",href:"/dashboard/weighbridge/operations"},{group:"Facility operations",label:"Transaction records",href:"/dashboard/weighbridge"}];
const recyclingCollectorNav:NavItem[] = [
  {group:"Daily work",label:"Materials & local sales",href:"/dashboard/recycling"},
];
const recyclingSalesNav:NavItem[] = [{group:"Daily work",label:"Industrial sales",href:"/dashboard/recycling"}];
const recyclingFieldManagerNav:NavItem[] = [
  {group:"Field operations",label:"Materials & stock",href:"/dashboard/recycling"},
  {group:"Field operations",label:"Team & attendance",href:"/dashboard/team"},
  {group:"Insights",label:"Operational reports",href:"/dashboard/recycling-reports"},
];

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
  const [organizationType,setOrganizationType]=useState("");
  const [packageAccess,setPackageAccess]=useState<{organization_type:string;package_name:string;feature_codes:string[]}|null>(null);
  useEffect(()=>{
    let cancelled=false;
    if(!currentUser?.roles?.some(r=>["company_admin","supervisor","driver","iot_operator","recycling_collector","recycling_sales","recycling_field_manager"].includes(r)))return;
    apiRequest<{data:{permissions:string[]}}>("/api/auth/organization-access/me").then(result=>{
      if(!cancelled)setAccessUser({user:storedUser,permissions:result.data.permissions});
    }).catch(()=>{if(!cancelled)setAccessUser(null);});
    apiRequest<{data:{organization:{type:string}}}>("/api/waste/recycling").then(result=>{if(!cancelled)setOrganizationType(result.data.organization.type)}).catch(()=>{if(!cancelled)setOrganizationType("")});
    apiRequest<{data:{organization_type:string;package_name:string;feature_codes:string[]}}>("/api/waste/regulatory/organization-package").then(result=>{if(!cancelled)setPackageAccess(result.data)}).catch(()=>{if(!cancelled)setPackageAccess(null)});
    return()=>{cancelled=true;};
  },[currentUser,storedUser,pathname]);
  const recyclingWorkspace=organizationType==="recycling_company";
  const primaryNavItems = currentUser?.roles?.includes("weighbridge_operator") ? weighbridgeNav
    : currentUser?.roles?.includes("driver") ? driverNav
    : currentUser?.roles?.includes("citizen") ? customerNav
    : currentUser?.roles?.includes("recycling_collector") ? recyclingCollectorNav
    : currentUser?.roles?.includes("recycling_sales") ? recyclingSalesNav
    : currentUser?.roles?.includes("recycling_field_manager") ? recyclingFieldManagerNav
    : currentUser?.roles?.includes("company_admin") ? (recyclingWorkspace?recyclingCompanyNav:companyNav)
    : currentUser?.roles?.includes("supervisor") ? (recyclingWorkspace?recyclingCompanyNav:supervisorNav)
    : currentUser?.roles?.includes("system_admin") ? systemNav : cityNav;
  const grants=accessUser?.user===storedUser?accessUser.permissions:[];
  const packageFeatures=new Set(packageAccess?.feature_codes||[]);
  const visibleNavItems:NavItem[]=primaryNavItems.filter(item=>
    packageAccess?.organization_type==="waste_collection_company"&&item.packageFeature&&!packageFeatures.has(item.packageFeature)?false:
    item.href==="/dashboard/team"?grants.includes("staff.read"):
    item.href==="/dashboard/access"?grants.includes("access.read"):true);
  if(recyclingWorkspace&&grants.includes("staff.read")&&!visibleNavItems.some(item=>item.href==="/dashboard/team"))visibleNavItems.push({group:"People",label:"Staff management",href:"/dashboard/team"});
  if(grants.includes("access.read")&&!visibleNavItems.some(item=>item.href==="/dashboard/access"))visibleNavItems.push({group:"Administration",label:"Access & permissions",href:"/dashboard/access"});
  const navGroups=visibleNavItems.reduce<Array<{name:string;items:NavItem[]}>>((groups,item)=>{
    const name=item.group||"Workspace",existing=groups.find(group=>group.name===name);
    if(existing)existing.items.push(item);else groups.push({name,items:[item]});
    return groups;
  },[]);
  const activeNavItem=[...visibleNavItems].sort((a,b)=>b.href.length-a.href.length).find(item=>pathname===item.href||pathname.startsWith(`${item.href}/`));
  const productName = currentUser?.roles?.includes("weighbridge_operator") ? "KCCA Weighbridge"
    : currentUser?.roles?.includes("recycling_collector") ? "Material Collection"
    : currentUser?.roles?.includes("recycling_sales") ? "Industrial Sales"
    : currentUser?.roles?.includes("recycling_field_manager") ? "Recycling Field Control"
    : recyclingWorkspace ? "Recycling Operations"
    : currentUser?.roles?.includes("company_admin") ? "Waste Collection Operations"
    : currentUser?.roles?.includes("supervisor") ? "Field Control"
    : currentUser?.roles?.includes("driver") ? "Driver Workspace"
    : currentUser?.roles?.includes("citizen") ? "Customer Services"
    : currentUser?.roles?.includes("system_admin") ? "Platform Administration" : "KCCA Control Centre";
  const workspaceLabel=currentUser?.roles?.some(role=>["kcca_admin","system_admin","weighbridge_operator"].includes(role))
    ? "Kampala city workspace"
    : currentUser?.roles?.includes("citizen") ? "Customer workspace" : "Organization workspace";

  useEffect(() => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      window.location.href = "/login";
    }
  }, []);

  async function handleLogout() {
    try {
      await window.kwmsDesktop?.offlineLogout();
    } catch {
      // Browser session cleanup must still complete if desktop IPC is unavailable.
    }
    sessionStorage.removeItem("accessToken");
    sessionStorage.removeItem("refreshToken");
    sessionStorage.removeItem("currentUser");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("currentUser");
    window.location.replace("/login");
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

        <nav aria-label="Primary navigation" className="mt-8 space-y-1 pb-8 text-sm">
          {navGroups.map(group=>{const groupActive=group.items.some(item=>item.href===activeNavItem?.href);return <details key={`${group.name}-${groupActive}`} open={groupActive||group.items.length===1} className="group border-b border-white/5 py-1">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2 text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500 hover:text-slate-300"><span>{group.name}</span>{group.items.length>1&&<span aria-hidden="true" className="text-sm font-normal transition group-open:rotate-90">›</span>}</summary>
            <div className="space-y-0.5 pb-2">{group.items.map((item) => {
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
          })}</div></details>})}
        </nav>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-5 py-3 md:px-8">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 bg-[#c6842f]" aria-hidden="true" />
              <div><p className="text-sm font-semibold text-slate-800">{activeNavItem?.label||productName}</p><p className="text-xs text-slate-500">{workspaceLabel}</p></div>
            </div>

            <div className="flex items-center gap-3 text-right">
              <DesktopSyncCenter />
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
            {navGroups.map(group=>{const groupActive=group.items.some(item=>item.href===activeNavItem?.href);return <details key={`${group.name}-mobile-${groupActive}`} open={groupActive||group.items.length===1} className="border-b border-slate-200 py-2"><summary className="flex cursor-pointer list-none items-center justify-between py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><span>{group.name}</span>{group.items.length>1&&<span aria-hidden="true">›</span>}</summary><div>{group.items.map((item)=><Link key={item.href} href={item.href} className={`block border-l-2 px-3 py-2.5 text-sm font-medium ${pathname===item.href?"border-[#3156a3] bg-blue-50 text-[#3156a3]":"border-transparent text-slate-600"}`}>{item.label}</Link>)}</div></details>})}
          </nav>
        </details>

        <section className="p-4 md:p-8">{children}{pathname==="/dashboard/weighbridge"&&<WeighbridgeReconciliation roles={currentUser?.roles||[]}/>}</section>
      </main>
    </div>
  );
}
