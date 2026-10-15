"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";
import {EmptyState,Feedback,PageHeader,Status} from "@/components/ui/System";

type MeResponse = {
  success: boolean;
  data: {
    user: {
      fullName: string;
      email: string;
      status: string;
    };
    roles: { name: string }[];
    permissions: { code: string }[];
  };
};

type Organization = {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  created_at: string;
};

type OrganizationsResponse = {
  success: boolean;
  data: Organization[];
};

type CommandCenterSummary = {
  jobs_today: number;
  completed_jobs: number;
  missed_jobs: number;
  active_routes: number;
  available_trucks: number;
  active_drivers: number;
  zones_covered: number;
  pending_citizen_issues: number;
  total_customers: number;
  open_driver_problems: number;
  unassigned_zones: number;
  service_completion_percentage: number;
  recent_unresolved_issues: {
    id: string;
    title: string;
    status: string;
    address: string | null;
    assigned_organization_name: string | null;
  }[];
  active_route_progress: {
    id: string; name: string; status: string; route_date: string;
    driver_name: string | null; stop_count: number; completed_stop_count: number;
  }[];
};

type SummaryResponse = { success: boolean; data: CommandCenterSummary };

const EMPTY_SUMMARY: CommandCenterSummary = {
  jobs_today: 0,
  completed_jobs: 0,
  missed_jobs: 0,
  active_routes: 0,
  available_trucks: 0,
  active_drivers: 0,
  zones_covered: 0,
  pending_citizen_issues: 0,
  total_customers: 0,
  open_driver_problems: 0,
  unassigned_zones: 0,
  service_completion_percentage: 0,
  recent_unresolved_issues: [],
  active_route_progress: [],
};

export default function DashboardPage() {
  const [user, setUser] = useState<MeResponse["data"] | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        const token = sessionStorage.getItem("accessToken");

        if (!token) {
          window.location.href = "/login";
          return;
        }

        const meResult = await apiRequest<MeResponse>("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        setUser(meResult.data);

        const roleNames = meResult.data.roles.map((role) => role.name);
        const scopedDestination = roleNames.some((role) => ["recycling_collector", "recycling_sales", "recycling_field_manager"].includes(role))
          ? "/dashboard/recycling"
          : roleNames.includes("driver")
            ? "/dashboard/driver-mobile"
            : roleNames.includes("supervisor")
              ? "/dashboard/waste"
              : roleNames.includes("company_admin")
                ? "/dashboard/company"
                : roleNames.includes("weighbridge_operator")
                  ? "/dashboard/weighbridge/operations"
                  : roleNames.includes("citizen")
                    ? "/dashboard/citizen-issues"
                    : roleNames.includes("organization_applicant")
                      ? "/onboarding"
                      : "";

        if (scopedDestination) {
          window.location.replace(scopedDestination);
          return;
        }

        const [organizationsResult, summaryResult] = await Promise.allSettled([
          apiRequest<OrganizationsResponse>("/api/organizations"),
          apiRequest<SummaryResponse>("/api/waste/command-center/summary"),
        ]);

        if (organizationsResult.status === "fulfilled") {
          setOrganizations(organizationsResult.value.data);
          setOrganizationsLoaded(true);
        }

        if (summaryResult.status === "fulfilled") {
          setSummary(summaryResult.value.data);
          setSummaryLoaded(true);
        }

        const desktopUser=JSON.parse(sessionStorage.getItem("currentUser")||"{}");
        if(desktopUser.id){
          const dashboardOrganizations=organizationsResult.status==="fulfilled"?organizationsResult.value.data:[];
          const dashboardSummary=summaryResult.status==="fulfilled"?summaryResult.value.data:EMPTY_SUMMARY;
          void window.kwmsDesktop?.setSnapshot({key:"platform-dashboard",organizationId:desktopUser.organizationId||"platform",userId:desktopUser.id,data:{user:meResult.data,organizations:dashboardOrganizations,summary:dashboardSummary}}).catch(()=>undefined);
        }

        const failedSections = [
          organizationsResult.status === "rejected" ? "organization readiness" : "",
          summaryResult.status === "rejected" ? "today’s operations" : "",
        ].filter(Boolean);

        if (failedSections.length) {
          setError(`Could not refresh ${failedSections.join(" and ")}. Please try again.`);
        }
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to load dashboard"
        );
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  const recentOrganizations = organizations.slice(0, 5);
  const roles = user?.roles.map((role) => role.name) || [];
  const isCityController = roles.some((role) => ["kcca_admin", "system_admin"].includes(role));
  const attention = [
    {label:"Unassigned service areas",value:summary.unassigned_zones,href:"/dashboard/organizations",action:"Review coverage"},
    {label:"Unresolved resident issues",value:summary.pending_citizen_issues,href:"/dashboard/citizen-issues",action:"Open issue queue"},
    {label:"Driver or vehicle alerts",value:summary.open_driver_problems,href:"/dashboard/waste",action:"Review operations"},
    {label:"Missed collections today",value:summary.missed_jobs,href:"/dashboard/waste",action:"Review trips"},
  ].filter(item=>item.value>0);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <PageHeader eyebrow={isCityController?"KCCA command centre":"Today"} title={isCityController?"Kampala waste operations":loading?"Loading your workspace…":`Good to see you, ${user?.user.fullName || "welcome back"}.`} description={isCityController?"See what needs attention, monitor active collections and maintain citywide accountability.":"See today’s work, operational capacity and service exceptions."}/>
        {error&&<Feedback tone="error">{error}</Feedback>}
        <section className="py-8">
          {isCityController&&<section className="mb-10"><div className="flex items-end justify-between border-b border-slate-300 pb-3"><div><h2 className="text-xl font-semibold text-slate-950">What needs attention</h2><p className="mt-1 text-sm text-slate-500">Exceptions are shown here so the control room knows where to act first.</p></div></div>{attention.length?<div className="divide-y divide-slate-200 border-b border-slate-200">{attention.map(item=><div key={item.label} className="flex items-center justify-between gap-6 py-4"><div className="flex items-baseline gap-4"><span className="min-w-8 text-2xl font-semibold text-slate-950">{item.value}</span><span className="text-sm font-medium text-slate-700">{item.label}</span></div><Link href={item.href} className="text-sm font-semibold text-[#3156a3]">{item.action} →</Link></div>)}</div>:<div className="border-b border-slate-200 py-6"><p className="font-semibold text-slate-800">No urgent exceptions</p><p className="mt-1 text-sm text-slate-500">There are no missed collections, unassigned areas, driver alerts or unresolved reports requiring action.</p></div>}</section>}

          <div className="grid gap-10 xl:grid-cols-[1.35fr_0.65fr]">
          <div>
            <div className="flex items-end justify-between border-b border-slate-300 pb-3"><div><h2 className="text-xl font-semibold text-slate-950">Today’s service delivery</h2><p className="mt-1 text-sm text-slate-500">A concise citywide view of work dispatched by licensed collectors.</p></div><Link href="/dashboard/waste" className="text-sm font-semibold text-[#3156a3]">Open live operations →</Link></div>
            <div className="grid grid-cols-2 border-b border-slate-300 md:grid-cols-4">{[["Trips",summaryLoaded?summary.jobs_today:"—"],["In progress",summaryLoaded?summary.active_routes:"—"],["Completed",summaryLoaded?summary.completed_jobs:"—"],["Completion",summaryLoaded?`${summary.service_completion_percentage}%`:"—"]].map(([label,value])=><div key={label} className="border-r border-slate-200 py-5 last:border-r-0"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-3xl font-semibold text-slate-950">{value}</p></div>)}</div>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <div className="flex items-center justify-between"><h2 className="text-xl font-semibold text-slate-950">Active trips</h2></div>
              <div className="mt-5 divide-y border-y border-slate-200">{summary.active_route_progress.length ? summary.active_route_progress.map((route)=>{
                const percent = route.stop_count ? Math.round(route.completed_stop_count / route.stop_count * 100) : 0;
                return <div key={route.id} className="py-4"><div className="flex justify-between gap-4"><div><p className="font-semibold text-slate-900">{route.name}</p><p className="mt-1 text-sm text-slate-500">{route.driver_name || "Driver not assigned"} · {route.completed_stop_count}/{route.stop_count} stops</p></div><span className="text-sm font-semibold text-[#3156a3]">{percent}%</span></div><div className="mt-3 h-1 bg-slate-200"><div className="h-full bg-[#3156a3]" style={{width:`${percent}%`}} /></div></div>;
              }) : <div className="py-6"><p className="font-semibold text-slate-800">No active trips</p><p className="mt-1 text-sm text-slate-500">Trips will appear when a collector dispatches a driver.</p></div>}</div>
            </div>
          </div>

          <aside className="border-l border-slate-200 pl-8">
            <h2 className="border-b border-slate-300 pb-3 text-xl font-semibold text-slate-950">City readiness</h2>
            <dl className="divide-y divide-slate-200 border-b border-slate-200">{[["Licensed operators",organizationsLoaded?organizations.filter(item=>item.is_active&&["waste_collection_company","recycling_company"].includes(item.type)).length:"—"],["Waste collectors",organizationsLoaded?organizations.filter(item=>item.is_active&&item.type==="waste_collection_company").length:"—"],["Recycling companies",organizationsLoaded?organizations.filter(item=>item.is_active&&item.type==="recycling_company").length:"—"],["Zones covered",summaryLoaded?summary.zones_covered:"—"],["Customers served",summaryLoaded?summary.total_customers:"—"]].map(([label,value])=><div key={label} className="flex items-center justify-between py-4"><dt className="text-sm text-slate-600">{label}</dt><dd className="font-semibold text-slate-950">{value}</dd></div>)}</dl>
            {isCityController && <>
            <div className="mt-8 flex items-center justify-between border-b border-slate-300 pb-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">
                  Licensed operators
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  Latest organizations added.
                </p>
              </div>

              <Link
                href="/dashboard/organizations"
                className="text-sm font-semibold text-[#3156a3]"
              >
                Manage
              </Link>
            </div>

            <div className="table-wrap mt-4">
              {recentOrganizations.length ? (
                <table className="text-left"><thead><tr><th>Partner</th><th>Type</th><th>Status</th></tr></thead><tbody>{recentOrganizations.map((organization) => (
                  <tr key={organization.id}><td className="table-primary">{organization.name}</td><td className="capitalize">{organization.type.replaceAll("_"," ")}</td><td><Status value={organization.is_active?"active":"inactive"}/></td></tr>
                ))}</tbody></table>
              ) : (
                <p className="p-5 text-sm text-slate-500">
                  No organizations added yet.
                </p>
              )}
            </div>
            </>}
          </aside></div>
        </section>
      </div>
    </AppShell>
  );
}
