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
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        const token = sessionStorage.getItem("accessToken");

        if (!token) {
          window.location.href = "/login";
          return;
        }

        const [meResponse, organizationsResponse, summaryResponse] = await Promise.all([
          apiRequest<MeResponse>("/api/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
          }),
          apiRequest<OrganizationsResponse>("/api/organizations"),
          apiRequest<SummaryResponse>("/api/waste/command-center/summary"),
        ]);

        setUser(meResponse.data);
        setOrganizations(organizationsResponse.data);
        setSummary(summaryResponse.data);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to load dashboard"
        );
      }
    }

    loadDashboard();
  }, []);

  const recentOrganizations = organizations.slice(0, 6);
  const roles = user?.roles.map((role) => role.name) || [];
  const isCityController = roles.some((role) => ["kcca_admin", "system_admin"].includes(role));
  const metrics = [
    ["Jobs today", summary.jobs_today],
    ["Completed", summary.completed_jobs],
    ["Missed", summary.missed_jobs],
    ["Completion", `${summary.service_completion_percentage}%`],
    ["Active routes", summary.active_routes],
    ["Available trucks", summary.available_trucks],
    ["Active drivers", summary.active_drivers],
    ["Zones covered", summary.zones_covered],
    ["Open issues", summary.pending_citizen_issues],
    ["Customers", summary.total_customers],
    ["Driver alerts", summary.open_driver_problems],
    ...(isCityController ? [["Unassigned zones", summary.unassigned_zones]] : []),
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <PageHeader eyebrow="Today in Kampala" title={`Good to see you, ${user ? user.user.fullName : "loading"}.`} description="Live service delivery, capacity, coverage and exceptions for your authorized operating area."/>
        {error&&<Feedback tone="error">{error}</Feedback>}

        <section className="grid gap-10 py-8 xl:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="flex items-end justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-2xl font-black text-slate-950">
                  Current operating picture
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  Live service delivery, capacity, coverage, and exceptions.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-px overflow-hidden border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map(([label, value]) => (
                <div key={label} className="bg-white p-5">
                  <p className="text-sm font-bold text-slate-500">{label}</p>
                  <p className="mt-3 text-4xl font-black text-slate-950">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <div className="flex items-center justify-between"><h2 className="text-2xl font-black text-slate-950">Route progress</h2><Link href="/dashboard/driver-mobile" className="text-sm font-black text-emerald-700">Open control view</Link></div>
              <div className="mt-5 divide-y border-y border-slate-200">{summary.active_route_progress.length ? summary.active_route_progress.map((route)=>{
                const percent = route.stop_count ? Math.round(route.completed_stop_count / route.stop_count * 100) : 0;
                return <div key={route.id} className="py-4"><div className="flex justify-between gap-4"><div><p className="font-black text-slate-900">{route.name}</p><p className="mt-1 text-sm text-slate-500">{route.driver_name || "Driver not assigned"} · {route.completed_stop_count}/{route.stop_count} stops</p></div><span className="text-sm font-black text-emerald-700">{percent}%</span></div><div className="mt-3 h-2 bg-slate-200"><div className="h-full bg-emerald-600" style={{width:`${percent}%`}} /></div></div>;
              }) : <EmptyState title="No routes need monitoring" description="Active route progress will appear here after dispatch."/>}</div>
            </div>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <h2 className="text-2xl font-black text-slate-950">
                Unresolved citizen issues
              </h2>

              <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
                {summary.recent_unresolved_issues.length ? (
                  summary.recent_unresolved_issues.map((issue) => (
                    <div key={issue.id} className="flex items-start justify-between gap-5 py-4">
                      <div>
                        <p className="font-bold text-slate-800">{issue.title}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {issue.address || "Location not supplied"}
                          {issue.assigned_organization_name
                            ? ` · ${issue.assigned_organization_name}`
                            : " · Unassigned"}
                        </p>
                      </div>
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">
                        {issue.status.replaceAll("_", " ")}
                      </span>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No unresolved issues" description="New citizen reports will appear here when action is needed."/>
                )}
              </div>
            </div>
          </div>

          <aside className="border-l border-slate-200 pl-8">
            {isCityController && <>
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-2xl font-black text-slate-950">
                  Recent partners
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  Latest organizations added.
                </p>
              </div>

              <Link
                href="/dashboard/organizations"
                className="text-sm font-black text-emerald-700 hover:text-emerald-900"
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
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
