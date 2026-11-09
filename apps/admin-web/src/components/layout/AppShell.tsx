"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiRequest } from "@/lib/api";
import { usePathname } from "next/navigation";
import { WeighbridgeReconciliation } from "@/components/weighbridge/WeighbridgeReconciliation";
import { DesktopSyncCenter } from "@/components/layout/DesktopSyncCenter";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { NotificationBell } from "@/components/layout/NotificationBell";

const cityNav:NavItem[] = [
  {group:"Overview",label:"Control room",href:"/dashboard"},
  {group:"Overview",label:"Live command centre",href:"/dashboard/command-center"},
  {group:"Regulation",label:"Permits & renewals",href:"/dashboard/permits"},
  {group:"Regulation",label:"Monthly returns",href:"/dashboard/returns-register"},
  {group:"Regulation",label:"Collection receipts",href:"/dashboard/receipt-audit"},
  {group:"Regulation",label:"Collection tariffs",href:"/dashboard/tariffs"},
  {group:"Regulation",label:"Audit log",href:"/dashboard/audit-log"},
  {group:"Regulation",label:"GPS data protection",href:"/dashboard/gps-privacy"},
  {group:"Regulation",label:"API keys",href:"/dashboard/api-keys"},
  {group:"Regulation",label:"Penalties",href:"/dashboard/penalties"},
  {group:"City oversight",label:"Licensed operators",href:"/dashboard/organizations"},
  {group:"City oversight",label:"Live operations",href:"/dashboard/waste"},
  {group:"City oversight",label:"Weighbridge operations",href:"/dashboard/weighbridge"},
  {group:"City oversight",label:"Disposal verification",href:"/dashboard/disposal-oversight"},
  {group:"City oversight",label:"Constituencies",href:"/dashboard/constituencies"},
  {group:"City oversight",label:"Waste point registry",href:"/dashboard/registry"},
  {group:"City oversight",label:"GPS data completeness",href:"/dashboard/fleet-quality"},
  {group:"City oversight",label:"Landfill and carbon",href:"/dashboard/landfill"},
  {group:"City oversight",label:"GPS track checks",href:"/dashboard/track-checks"},
  {group:"City oversight",label:"Illegal dumping",href:"/dashboard/dumping"},
  {group:"City oversight",label:"Recycling oversight",href:"/dashboard/recycling-oversight"},
  {group:"City oversight",label:"City reports",href:"/dashboard/city-report"},
  {group:"City oversight",label:"Issues",href:"/dashboard/citizen-issues"},
  {group:"City oversight",label:"Coverage map",href:"/dashboard/gis"},
  {group:"City oversight",label:"Collector performance",href:"/dashboard/city-reports"},
  {group:"City oversight",label:"Compliance cases",href:"/dashboard/compliance"},
];
const systemNav:NavItem[]=[{group:"Platform",label:"Platform overview",href:"/dashboard"},{group:"Platform",label:"Company applications",href:"/dashboard/account-applications"},{group:"Platform",label:"Account verification",href:"/dashboard/account-verification"},{group:"Platform",label:"Platform packages",href:"/dashboard/platform-packages"},{group:"Platform",label:"Platform users",href:"/dashboard/platform-users"},{group:"Platform",label:"Weighbridge workers",href:"/dashboard/weighbridge-workers"},{group:"Platform",label:"Organizations",href:"/dashboard/organizations"},{group:"Platform",label:"Subscriptions",href:"/dashboard/subscriptions"},{group:"Reference",label:"Recycling oversight",href:"/dashboard/recycling-oversight"},{group:"Reference",label:"Disposal verification",href:"/dashboard/disposal-oversight"},{group:"Reference",label:"Constituencies",href:"/dashboard/constituencies"},{group:"Reference",label:"Waste point registry",href:"/dashboard/registry"},{group:"Reference",label:"GPS data completeness",href:"/dashboard/fleet-quality"},{group:"Reference",label:"Landfill and carbon",href:"/dashboard/landfill"},{group:"Reference",label:"Collection receipts",href:"/dashboard/receipt-audit"},{group:"Reference",label:"Collection tariffs",href:"/dashboard/tariffs"},{group:"Reference",label:"Audit log",href:"/dashboard/audit-log"},{group:"Reference",label:"GPS data protection",href:"/dashboard/gps-privacy"},{group:"Reference",label:"API keys",href:"/dashboard/api-keys"},{group:"Reference",label:"Illegal dumping",href:"/dashboard/dumping"},{group:"Reference",label:"Penalties",href:"/dashboard/penalties"},{group:"Reference",label:"City reports",href:"/dashboard/city-report"},{group:"Reference",label:"KCCA permit register",href:"/dashboard/permits"},{group:"Reference",label:"Collector performance",href:"/dashboard/city-reports"}];
type NavItem={label:string;href:string;group?:string;section?:string;packageFeature?:string;hidden?:boolean};
const kccaSection:NavItem[]=[
  {group:"Company",section:"KCCA",label:"Overview",href:"/dashboard/regulatory"},
  {group:"Company",section:"KCCA",label:"Permit",href:"/dashboard/permit"},
  {group:"Company",section:"KCCA",label:"Returns",href:"/dashboard/returns"},
  {group:"Company",section:"KCCA",label:"Receipts",href:"/dashboard/receipts"},
  {group:"Company",section:"KCCA",label:"Disposal",href:"/dashboard/disposal"},
  {group:"Company",section:"KCCA",label:"Landfill & carbon",href:"/dashboard/landfill"},
  {group:"Company",section:"KCCA",label:"Compliance",href:"/dashboard/compliance"},
  {group:"Company",section:"KCCA",label:"Cleanups",href:"/dashboard/cleanup-orders"},
  {group:"Company",section:"KCCA",label:"Penalties",href:"/dashboard/penalty-notices"},
];
// Waste collection pages are grouped into sections: the menu shows one link per section and the section's pages
// become tabs at the top of the page, so the menu stays short while every page is still one click away.
const companyNav:NavItem[] = [
  {group:"Work",label:"Overview",href:"/dashboard/company"},
  {group:"Work",section:"Operations",label:"Today",href:"/dashboard/waste",packageFeature:"core_operations"},
  {group:"Work",section:"Operations",label:"Trip details",href:"/dashboard/driver-mobile",packageFeature:"core_operations",hidden:true},
  {group:"Work",section:"Operations",label:"Areas & routes",href:"/dashboard/service-areas",packageFeature:"service_areas"},
  {group:"Work",section:"Operations",label:"Tonnage",href:"/dashboard/tonnage",packageFeature:"tonnage"},
  {group:"Work",section:"Operations",label:"Service issues",href:"/dashboard/citizen-issues",packageFeature:"service_issues"},
  {group:"Work",section:"Fleet",label:"Vehicles",href:"/dashboard/fleet",packageFeature:"fleet"},
  {group:"Work",section:"Fleet",label:"GPS trackers",href:"/dashboard/trackers",packageFeature:"fleet"},
  {group:"Work",section:"Fleet",label:"GPS records",href:"/dashboard/fleet-quality",packageFeature:"fleet"},
  {group:"Work",section:"Fleet",label:"GPS privacy",href:"/dashboard/gps-privacy"},
  {group:"Work",section:"Customers",label:"Customers",href:"/dashboard/customer-service",packageFeature:"customers"},
  {group:"Work",section:"Customers",label:"Waste points",href:"/dashboard/registry"},
  {group:"Work",section:"Customers",label:"Contracts",href:"/dashboard/contracts",packageFeature:"contracts"},
  {group:"Work",section:"Staff",label:"Staff",href:"/dashboard/team",packageFeature:"core_operations"},
  {group:"Work",section:"Staff",label:"Access",href:"/dashboard/access",packageFeature:"access"},
  {group:"Money",section:"Billing",label:"Billing",href:"/dashboard/billing",packageFeature:"billing"},
  {group:"Money",section:"Billing",label:"Arrears",href:"/dashboard/arrears",packageFeature:"billing"},
  {group:"Money",section:"Billing",label:"Mobile money",href:"/dashboard/mobile-money",packageFeature:"billing"},
  {group:"Money",section:"Finance",label:"Payroll",href:"/dashboard/payroll",packageFeature:"finance"},
  {group:"Money",section:"Finance",label:"Payables",href:"/dashboard/accounts-payable",packageFeature:"finance"},
  {group:"Money",section:"Supply",label:"Inventory",href:"/dashboard/inventory",packageFeature:"inventory"},
  {group:"Money",section:"Supply",label:"Procurement",href:"/dashboard/procurement",packageFeature:"procurement"},
  {group:"Money",label:"Reports",href:"/dashboard/reports",packageFeature:"reports"},
  ...kccaSection,
  {group:"Company",section:"Settings",label:"Company",href:"/dashboard/company-settings"},
  {group:"Company",section:"Settings",label:"Subscription",href:"/dashboard/subscription"},
  {group:"Company",section:"Settings",label:"API keys",href:"/dashboard/api-keys"},
  {group:"Company",section:"Settings",label:"Audit log",href:"/dashboard/audit-log"},
];
const supervisorNav:NavItem[] = [
  {group:"Work",label:"Overview",href:"/dashboard"},
  {group:"Work",section:"Operations",label:"Today",href:"/dashboard/waste"},
  {group:"Work",section:"Operations",label:"Trip details",href:"/dashboard/driver-mobile",hidden:true},
  {group:"Work",section:"Operations",label:"Areas & routes",href:"/dashboard/service-areas"},
  {group:"Work",section:"Operations",label:"Tonnage",href:"/dashboard/tonnage"},
  {group:"Work",section:"Operations",label:"Service issues",href:"/dashboard/citizen-issues"},
  {group:"Work",section:"Fleet",label:"Vehicles",href:"/dashboard/fleet"},
  {group:"Work",section:"Fleet",label:"GPS trackers",href:"/dashboard/trackers"},
  {group:"Work",section:"Fleet",label:"GPS records",href:"/dashboard/fleet-quality"},
  {group:"Work",section:"Customers",label:"Customers",href:"/dashboard/customer-service"},
  {group:"Work",section:"Customers",label:"Waste points",href:"/dashboard/registry"},
  {group:"Work",section:"Customers",label:"Billing",href:"/dashboard/billing"},
  {group:"Work",label:"Staff",href:"/dashboard/team"},
  {group:"Work",label:"Inventory",href:"/dashboard/inventory"},
  {group:"Work",label:"Reports",href:"/dashboard/recycling-reports"},
  ...kccaSection.filter(item=>!["/dashboard/compliance","/dashboard/penalty-notices"].includes(item.href)),
];
const recyclingCompanyNav:NavItem[]=[
  {group:"Overview",label:"Materials & sales",href:"/dashboard/recycling"},
  {group:"People",label:"Staff management",href:"/dashboard/team"},
  {group:"Finance",label:"Finance",href:"/dashboard/billing"},
  {group:"Finance",label:"Investors",href:"/dashboard/investors"},
  {group:"Finance",label:"Payroll",href:"/dashboard/payroll"},
  {group:"Finance",label:"Accounts payable",href:"/dashboard/accounts-payable"},
  {group:"Supply",label:"Inventory",href:"/dashboard/inventory"},
  {group:"Supply",label:"Procurement",href:"/dashboard/procurement"},
  {group:"Insights",label:"Reports",href:"/dashboard/recycling-reports"},
  {group:"Insights",label:"Daily records",href:"/dashboard/recycling-daily"},
  {group:"KCCA regulation",label:"Regulatory overview",href:"/dashboard/regulatory"},
  {group:"KCCA regulation",label:"Permit",href:"/dashboard/permit"},
  {group:"KCCA regulation",label:"Compliance cases",href:"/dashboard/compliance"},
  {group:"KCCA regulation",label:"Monthly returns",href:"/dashboard/returns"},
  {group:"KCCA regulation",label:"Penalty notices",href:"/dashboard/penalty-notices"},
  {group:"Administration",label:"Access & permissions",href:"/dashboard/access"},
  {group:"Administration",label:"Subscription",href:"/dashboard/subscription"},
  {group:"Administration",label:"Recycling settings",href:"/dashboard/recycling-settings"},
  {group:"Administration",label:"Company settings",href:"/dashboard/company-settings"},
];
const factoryNav:NavItem[]=[
  {group:"Factory",label:"Factory overview",href:"/dashboard/factory"},
  {group:"Factory",label:"Material intake",href:"/dashboard/factory/intake"},
  {group:"Factory",label:"Processing",href:"/dashboard/factory/processing"},
  {group:"Factory",label:"Product dispatch",href:"/dashboard/factory/dispatch"},
  {group:"People",label:"Staff management",href:"/dashboard/team"},
  {group:"KCCA regulation",label:"Regulatory overview",href:"/dashboard/regulatory"},
  {group:"KCCA regulation",label:"Permit",href:"/dashboard/permit"},
  {group:"KCCA regulation",label:"Compliance cases",href:"/dashboard/compliance"},
  {group:"KCCA regulation",label:"Monthly returns",href:"/dashboard/returns"},
  {group:"KCCA regulation",label:"Penalty notices",href:"/dashboard/penalty-notices"},
  {group:"Administration",label:"Subscription",href:"/dashboard/subscription"},
];
const customerNav:NavItem[] = [
  {group:"My service",label:"Service & collections",href:"/dashboard/customer-service"},
  {group:"My service",label:"Billing & payments",href:"/dashboard/billing"},
  {group:"Support",label:"Requests & issues",href:"/dashboard/citizen-issues"},
];
const driverNav:NavItem[] = [{group:"Today",label:"My route & jobs",href:"/dashboard/driver-mobile"}];
const weighbridgeNav:NavItem[] = [{group:"Facility operations",label:"Record vehicle",href:"/dashboard/weighbridge/operations"},{group:"Facility operations",label:"Transaction records",href:"/dashboard/weighbridge"},{group:"Facility operations",label:"Load composition",href:"/dashboard/landfill"}];
const recyclingCollectorNav:NavItem[] = [
  {group:"Daily work",label:"Materials & local sales",href:"/dashboard/recycling"},
];
const recyclingSalesNav:NavItem[] = [{group:"Daily work",label:"Industrial sales",href:"/dashboard/recycling"}];
const recyclingFieldManagerNav:NavItem[] = [
  {group:"Field operations",label:"Recycling operations",href:"/dashboard/recycling"},
  {group:"Field operations",label:"Team & attendance",href:"/dashboard/team"},
  {group:"Insights",label:"Operational reports",href:"/dashboard/recycling-reports"},
  {group:"Insights",label:"Daily records",href:"/dashboard/recycling-daily"},
];
const companyOwnerNav:NavItem[] = [
  {group:"Company insight",label:"Company overview & reports",href:"/dashboard/recycling-reports"},
  {group:"Company insight",label:"Daily records",href:"/dashboard/recycling-daily"},
  {group:"Company insight",label:"Investor overview",href:"/dashboard/investor"},
];
const companyInvestorNav:NavItem[] = [
  {group:"Investor access",label:"Investor overview",href:"/dashboard/investor"},
];

type CurrentUser = {
  fullName: string;
  email: string;
  organizationId?: string | null;
  roles?: string[];
};

// Every page renders its own AppShell, so the shell mounts again on each navigation. What the server said about the
// organization is kept here (and in sessionStorage for a reload), so a new page shows the right menu at once instead of
// the default menu until the answers come back. It is refreshed in the background on every page.
type ShellContext = { user: string; organizationType: string; permissions: string[] | null; packageAccess: { organization_type: string; package_name: string; feature_codes: string[] } | null };
const SHELL_KEY = "kwmsShellContext";
let shellContext: ShellContext | null = null;
function readShellContext(user: string): ShellContext | null {
  if (shellContext?.user === user) return shellContext;
  try { const saved = JSON.parse(sessionStorage.getItem(SHELL_KEY) || "null") as ShellContext | null; if (saved?.user === user) return (shellContext = saved); } catch { /* storage unavailable */ }
  return null;
}
function saveShellContext(user: string, change: Partial<ShellContext>) {
  const base = shellContext?.user === user ? shellContext : { user, organizationType: "", permissions: null, packageAccess: null };
  shellContext = { ...base, ...change };
  try { sessionStorage.setItem(SHELL_KEY, JSON.stringify(shellContext)); } catch { /* storage unavailable */ }
}

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
  // The kept answers fill the menu on the first render. During hydration the user is not read yet, so the menu does
  // not depend on them and the server and client renders still match.
  const [cached]=useState(()=>typeof window==="undefined"?null:readShellContext(storedUserSnapshot()));
  const [accessUser,setAccessUser]=useState<{user:string;permissions:string[]}|null>(cached?.permissions?{user:cached.user,permissions:cached.permissions}:null);
  const [organizationType,setOrganizationType]=useState(cached?.organizationType??"");
  const [menuOpen,setMenuOpen]=useState(false);
  const [pendingHref,setPendingHref]=useState<string|null>(null);
  const [packageAccess,setPackageAccess]=useState<ShellContext["packageAccess"]>(cached?.packageAccess??null);
  useEffect(()=>{
    let cancelled=false;
    if(!currentUser?.roles?.some(r=>["company_admin","company_owner","company_investor","supervisor","driver","iot_operator","recycling_collector","recycling_sales","recycling_field_manager"].includes(r)))return;
    const saved=readShellContext(storedUser);
    apiRequest<{data:{permissions:string[]}}>("/api/auth/organization-access/me").then(result=>{
      if(cancelled)return;setAccessUser({user:storedUser,permissions:result.data.permissions});saveShellContext(storedUser,{permissions:result.data.permissions});
    }).catch(()=>{if(!cancelled&&!saved)setAccessUser(null);});
    apiRequest<{data:{type:string}|null}>("/api/waste/organization-context").then(result=>{if(cancelled)return;const type=result.data?.type||"";setOrganizationType(type);saveShellContext(storedUser,{organizationType:type})}).catch(()=>{if(!cancelled&&!saved)setOrganizationType("")});
    apiRequest<{data:{organization_type:string;package_name:string;feature_codes:string[]}}>("/api/waste/regulatory/organization-package").then(result=>{if(cancelled)return;setPackageAccess(result.data);saveShellContext(storedUser,{packageAccess:result.data})}).catch(()=>{if(!cancelled&&!saved)setPackageAccess(null)});
    return()=>{cancelled=true;};
  },[currentUser,storedUser,pathname]);
  const recyclingWorkspace=organizationType==="recycling_company";
  const factoryWorkspace=organizationType==="processing_plant";
  const primaryNavItems = currentUser?.roles?.includes("weighbridge_operator") ? weighbridgeNav
    : currentUser?.roles?.includes("driver") ? driverNav
    : currentUser?.roles?.includes("citizen") ? customerNav
    : currentUser?.roles?.includes("recycling_collector") ? recyclingCollectorNav
    : currentUser?.roles?.includes("recycling_sales") ? recyclingSalesNav
    : currentUser?.roles?.includes("recycling_field_manager") ? recyclingFieldManagerNav
    : currentUser?.roles?.includes("company_owner") ? companyOwnerNav
    : currentUser?.roles?.includes("company_investor") ? companyInvestorNav
    : currentUser?.roles?.includes("company_admin") ? (factoryWorkspace?factoryNav:recyclingWorkspace?recyclingCompanyNav:companyNav)
    : currentUser?.roles?.includes("supervisor") ? (factoryWorkspace?factoryNav.filter(item=>!["/dashboard/team","/dashboard/penalty-notices","/dashboard/subscription"].includes(item.href)):recyclingWorkspace?recyclingCompanyNav.filter(item=>!["/dashboard/penalty-notices","/dashboard/subscription"].includes(item.href)):supervisorNav)
    : currentUser?.roles?.includes("system_admin") ? systemNav : cityNav;
  const grants=accessUser?.user===storedUser?accessUser.permissions:[];
  const packageFeatures=new Set(packageAccess?.feature_codes||[]);
  const visibleNavItems:NavItem[]=primaryNavItems.filter(item=>
    packageAccess?.organization_type==="waste_collection_company"&&item.packageFeature&&!packageFeatures.has(item.packageFeature)?false:
    item.href==="/dashboard/team"?grants.includes("staff.read"):
    item.href==="/dashboard/access"?grants.includes("access.read"):true);
  if(recyclingWorkspace&&grants.includes("staff.read")&&!visibleNavItems.some(item=>item.href==="/dashboard/team"))visibleNavItems.push({group:"People",label:"Staff management",href:"/dashboard/team"});
  if(grants.includes("access.read")&&!visibleNavItems.some(item=>item.href==="/dashboard/access"))visibleNavItems.push({group:"Administration",label:"Access & permissions",href:"/dashboard/access"});
  if(!visibleNavItems.some(item=>item.href==="/dashboard/account"))visibleNavItems.push({group:"Account",label:"My account",href:"/dashboard/account"});
  const navGroups=visibleNavItems.reduce<Array<{name:string;items:NavItem[]}>>((groups,item)=>{
    const name=item.group||"Workspace",existing=groups.find(group=>group.name===name);
    if(existing)existing.items.push(item);else groups.push({name,items:[item]});
    return groups;
  },[]);
  const activeNavItem=[...visibleNavItems].sort((a,b)=>b.href.length-a.href.length).find(item=>pathname===item.href||pathname.startsWith(`${item.href}/`));
  const sectionTabs=activeNavItem?.section?visibleNavItems.filter(item=>item.section===activeNavItem.section&&(!item.hidden||item.href===activeNavItem.href)):[];
  const productName = currentUser?.roles?.includes("weighbridge_operator") ? "KCCA Weighbridge"
    : currentUser?.roles?.includes("recycling_collector") ? "Material Collection"
    : currentUser?.roles?.includes("recycling_sales") ? "Industrial Sales"
    : currentUser?.roles?.includes("recycling_field_manager") ? "Recycling Field Control"
    : currentUser?.roles?.includes("company_investor") ? "Investor Portal"
    : factoryWorkspace ? "Recycling Factory"
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


  const initials=(currentUser?.fullName||currentUser?.email||"U").split(/[\s@.]+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toUpperCase()).join("");

  const navigation=(idSuffix:string)=><nav aria-label="Primary navigation" className="space-y-5 text-sm">
    {navGroups.map(group=><div key={`${group.name}-${idSuffix}`}>
      <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-slate-400">{group.name}</p>
      <div className="space-y-px">{group.items.filter((item,index)=>!item.section||group.items.findIndex(other=>other.section===item.section)===index).map(entry=>{const item=entry.section?{...entry,label:entry.section}:entry,sectionItems=entry.section?group.items.filter(other=>other.section===entry.section):[entry];const isActive=pendingHref?sectionItems.some(other=>other.href===pendingHref):sectionItems.some(other=>other.href===activeNavItem?.href);return <Link key={item.label} href={item.href} aria-current={isActive?"page":undefined} onClick={event=>{setMenuOpen(false);if(item.href!==pathname&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0)setPendingHref(item.href)}} className="nav-link"><span aria-hidden="true" className="nav-dot"/><span className="truncate">{item.label}</span></Link>})}</div>
    </div>)}
  </nav>;

  const brand=<div className="flex items-center gap-3">
    <Image src="/logo-mark-blue.svg" alt="" width={36} height={36} unoptimized className="h-9 w-9 shrink-0 rounded-[var(--ui-radius)]" />
    <div className="min-w-0"><p className="truncate text-sm font-semibold leading-5 text-slate-900">{productName}</p><p className="truncate text-xs leading-4 text-slate-500">Kampala WMS</p></div>
  </div>;

  const accountProps={name:currentUser?.fullName||"Signed-in user",email:currentUser?.email||"",initials,context:`${productName} · ${workspaceLabel}`};
  const userCard=<AccountMenu {...accountProps} variant="sidebar"/>;

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b border-slate-100 px-4">{brand}</div>
        <div className="flex-1 overflow-y-auto px-3 py-4">{navigation("desktop")}</div>
        <div className="shrink-0 border-t border-slate-100 p-1.5">{userCard}</div>
      </aside>

      {menuOpen&&<div className="fixed inset-0 z-[1500] lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
        <div className="anim-fade absolute inset-0 bg-slate-900/40" onClick={()=>setMenuOpen(false)}/>
        <aside className="anim-slide absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col bg-white shadow-[var(--ui-shadow-lg)]">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 px-4">{brand}<button onClick={()=>setMenuOpen(false)} aria-label="Close menu" className="flex h-9 w-9 items-center justify-center text-slate-500 hover:bg-slate-100"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
          <div className="flex-1 overflow-y-auto px-3 py-4">{navigation("mobile")}</div>
          <div className="shrink-0 border-t border-slate-100 p-1.5">{userCard}</div>
        </aside>
      </div>}

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white">
          {pendingHref&&<div role="progressbar" aria-label="Opening page" className="nav-progress" />}
          <div className="flex h-16 items-center justify-between gap-4 px-4 md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button onClick={()=>setMenuOpen(true)} aria-label="Open menu" className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center text-slate-600 hover:bg-slate-100 lg:hidden"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
              <nav aria-label="Breadcrumb" className="min-w-0"><ol className="flex min-w-0 items-center gap-2 text-sm"><li className="hidden truncate text-slate-500 sm:block">{workspaceLabel}</li><li aria-hidden="true" className="hidden text-slate-300 sm:block">/</li>{activeNavItem?.section&&activeNavItem.section!==activeNavItem.label&&<><li className="hidden truncate text-slate-500 sm:block">{activeNavItem.section}</li><li aria-hidden="true" className="hidden text-slate-300 sm:block">/</li></>}<li className="truncate font-semibold text-slate-900">{activeNavItem?.label||productName}</li></ol></nav>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <DesktopSyncCenter />
              <NotificationBell />
              <div className="lg:hidden"><AccountMenu {...accountProps} variant="compact"/></div>
            </div>
          </div>
        </header>

        <section aria-busy={pendingHref?true:undefined} className={`px-4 py-6 transition-opacity duration-150 md:px-8 md:py-8 ${pendingHref?"pointer-events-none opacity-50":""}`}>{sectionTabs.length>1&&<nav aria-label={`${activeNavItem?.section} pages`} className="section-tabs">{sectionTabs.map(item=><Link key={item.href} href={item.href} aria-current={item.href===activeNavItem?.href?"page":undefined} onClick={event=>{if(item.href!==pathname&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0)setPendingHref(item.href)}}>{item.label}</Link>)}</nav>}{children}{pathname==="/dashboard/weighbridge"&&<WeighbridgeReconciliation roles={currentUser?.roles||[]}/>}</section>
      </main>
    </div>
  );
}
