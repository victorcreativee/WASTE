"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";
import {EmptyState,Feedback,PageHeader,SectionHeading,Stat,Status} from "@/components/ui/System";

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
        if (roleNames.some((role) => ["company_admin", "supervisor"].includes(role))) {
          const context = await apiRequest<{ data: { type: string } | null }>("/api/waste/organization-context").catch(() => null);
          if (context?.data?.type === "processing_plant") { window.location.replace("/dashboard/factory"); return; }
        }
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
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{([["Trips today",summaryLoaded?summary.jobs_today:"—"],["In progress",summaryLoaded?summary.active_routes:"—"],["Completed",summaryLoaded?summary.completed_jobs:"—"],["Completion rate",summaryLoaded?`${summary.service_completion_percentage}%`:"—"]] as const).map(([label,value])=><Stat key={label} label={label} value={loading?<span className="inline-block h-7 w-14 animate-pulse rounded bg-slate-100"/>:value}/>)}</div>

          {isCityController&&<section>
            <SectionHeading title="Needs attention" description="Exceptions that need action first." />
            {attention.length?<div className="card divide-y divide-slate-100">{attention.map(item=><Link key={item.label} href={item.href} className="group flex items-center justify-between gap-6 px-5 py-4 transition hover:bg-slate-50"><div className="flex items-center gap-4"><span className="min-w-8 text-right text-lg font-semibold tabular-nums text-[var(--color-warning)]">{item.value}</span><span className="text-sm font-medium text-slate-800">{item.label}</span></div><span className="text-sm font-medium text-slate-500 group-hover:text-[var(--color-action)]">{item.action} <span aria-hidden="true">→</span></span></Link>)}</div>:<div className="card border-l-[3px] border-l-[var(--color-success)] px-5 py-4"><div><p className="text-sm font-semibold text-slate-900">All clear</p><p className="text-sm text-slate-500">No missed collections, unassigned areas, driver alerts or unresolved reports.</p></div></div>}
          </section>}

          <div className="grid gap-8 xl:grid-cols-[1.4fr_0.6fr]">
          <section>
            <SectionHeading title="Active trips" description="Live progress from licensed collectors." action={<Link href="/dashboard/waste" className="text-sm font-medium text-[var(--color-action)] hover:underline">Live operations →</Link>}/>
            {summary.active_route_progress.length ? <div className="card divide-y divide-slate-100">{summary.active_route_progress.map((route)=>{
              const percent = route.stop_count ? Math.round(route.completed_stop_count / route.stop_count * 100) : 0;
              return <div key={route.id} className="px-5 py-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{route.name}</p><p className="mt-0.5 text-sm text-slate-500">{route.driver_name || "Driver not assigned"} · {route.completed_stop_count}/{route.stop_count} stops</p></div><span className="text-sm font-semibold tabular-nums text-slate-700">{percent}%</span></div><div className="mt-3 h-1 bg-slate-100"><div className="h-full bg-[var(--color-action)] transition-[width] duration-500" style={{width:`${percent}%`}} /></div></div>;
            })}</div> : <EmptyState title="No active trips" description="Trips appear here once a collector dispatches a driver."/>}
          </section>

          <aside className="space-y-8">
            <section>
              <SectionHeading title="City readiness"/>
              <dl className="card divide-y divide-slate-100">{[["Licensed operators",organizationsLoaded?organizations.filter(item=>item.is_active&&["waste_collection_company","recycling_company"].includes(item.type)).length:"—"],["Waste collectors",organizationsLoaded?organizations.filter(item=>item.is_active&&item.type==="waste_collection_company").length:"—"],["Recycling companies",organizationsLoaded?organizations.filter(item=>item.is_active&&item.type==="recycling_company").length:"—"],["Zones covered",summaryLoaded?summary.zones_covered:"—"],["Customers served",summaryLoaded?summary.total_customers:"—"]].map(([label,value])=><div key={label} className="flex items-center justify-between px-5 py-3.5"><dt className="text-sm text-slate-600">{label}</dt><dd className="text-sm font-semibold tabular-nums text-slate-900">{value}</dd></div>)}</dl>
            </section>
            {isCityController && <section>
              <SectionHeading title="Licensed operators" description="Latest organizations added." action={<Link href="/dashboard/organizations" className="text-sm font-medium text-[var(--color-action)] hover:underline">Manage</Link>}/>
              {recentOrganizations.length ? <div className="table-wrap"><table className="text-left"><thead><tr><th>Partner</th><th>Status</th></tr></thead><tbody>{recentOrganizations.map((organization) => (
                <tr key={organization.id}><td><p className="table-primary">{organization.name}</p><p className="table-secondary capitalize">{organization.type.replaceAll("_"," ")}</p></td><td><Status value={organization.is_active?"active":"inactive"}/></td></tr>
              ))}</tbody></table></div> : <EmptyState title="No organizations yet"/>}
            </section>}
          </aside></div>
        </div>
      </div>
    </AppShell>
  );
}
