"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";

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

export default function DashboardPage() {
  const [user, setUser] = useState<MeResponse["data"] | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        const token = localStorage.getItem("accessToken");

        if (!token) {
          window.location.href = "/login";
          return;
        }

        const [meResponse, organizationsResponse] = await Promise.all([
          apiRequest<MeResponse>("/api/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
          }),
          apiRequest<OrganizationsResponse>("/api/organizations"),
        ]);

        setUser(meResponse.data);
        setOrganizations(organizationsResponse.data);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to load dashboard"
        );
      }
    }

    loadDashboard();
  }, []);

  const activeOrganizations = organizations.filter((item) => item.is_active);
  const recentOrganizations = organizations.slice(0, 6);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <section className="border-b border-slate-200 pb-8">
          <p className="text-sm font-black uppercase tracking-[0.25em] text-emerald-700">
            Today in Kampala
          </p>

          <div className="mt-4 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <h1 className="max-w-4xl text-4xl font-black tracking-tight text-slate-950">
                Good to see you, {user ? user.user.fullName : "loading"}.
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
                This is the working area for city waste operations. We are still
                building the foundation, so the page focuses only on what is
                currently real: authentication, organizations, and system
                readiness.
              </p>
            </div>

            {/* <div className="min-w-56 border-l border-slate-300 pl-5">
              <p className="text-sm font-bold text-slate-500">Signed in as</p>
              <p className="mt-1 font-black text-slate-950">
                {user?.user.email || "Loading..."}
              </p>
            </div> */}
          </div>

          {error && (
            <div className="mt-6 border-l-4 border-red-600 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}
        </section>

        <section className="grid gap-10 py-8 xl:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="flex items-end justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-2xl font-black text-slate-950">
                  Current operating picture
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  A simple view of what exists in the platform today.
                </p>
              </div>
            </div>

            <div className="divide-y divide-slate-200">
              <div className="grid grid-cols-[1fr_auto] gap-6 py-6">
                <div>
                  <h3 className="font-black text-slate-950">
                    Organizations registered
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    KCCA, waste companies, recycling partners, and other city
                    stakeholders connected to the ecosystem.
                  </p>
                </div>
                <p className="text-5xl font-black text-slate-950">
                  {organizations.length}
                </p>
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-6 py-6">
                <div>
                  <h3 className="font-black text-slate-950">
                    Active organizations
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Partners currently marked active and ready for future
                    operational modules.
                  </p>
                </div>
                <p className="text-5xl font-black text-emerald-700">
                  {activeOrganizations.length}
                </p>
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-6 py-6">
                <div>
                  <h3 className="font-black text-slate-950">
                    Waste operations
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Collection zones, trucks, drivers, and pickup schedules will
                    be connected in the next operational phase.
                  </p>
                </div>
                <p className="text-sm font-black uppercase tracking-[0.18em] text-slate-400">
                  Pending
                </p>
              </div>
            </div>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <h2 className="text-2xl font-black text-slate-950">
                Next work queue
              </h2>

              <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
                {[
                  "Protect frontend pages and add logout",
                  "Improve organizations page table and filtering",
                  "Start waste operations database design",
                  "Create collection zones module",
                ].map((task, index) => (
                  <div key={task} className="flex items-center gap-5 py-4">
                    <span className="text-sm font-black text-emerald-700">
                      0{index + 1}
                    </span>
                    <p className="font-bold text-slate-800">{task}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <aside className="border-l border-slate-200 pl-8">
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

            <div className="divide-y divide-slate-200">
              {recentOrganizations.length ? (
                recentOrganizations.map((organization) => (
                  <div key={organization.id} className="py-5">
                    <div className="flex items-start justify-between gap-5">
                      <div>
                        <p className="font-black text-slate-950">
                          {organization.name}
                        </p>
                        <p className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                          {organization.type.replaceAll("_", " ")}
                        </p>
                      </div>

                      <span className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                        {organization.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="py-5 text-sm text-slate-500">
                  No organizations added yet.
                </p>
              )}
            </div>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <h2 className="text-2xl font-black text-slate-950">
                System readiness
              </h2>

              <div className="mt-5 space-y-4">
                {[
                  ["API Gateway", "Online"],
                  ["Auth Service", "Online"],
                  ["Organization Service", "Online"],
                  ["PostgreSQL + PostGIS", "Online"],
                  ["Redis", "Online"],
                ].map(([name, status]) => (
                  <div key={name} className="flex items-center justify-between">
                    <p className="font-bold text-slate-700">{name}</p>
                    <p className="text-sm font-black text-emerald-700">
                      {status}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
