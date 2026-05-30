"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";

type Organization = {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
};

type OrganizationsResponse = {
  success: boolean;
  message: string;
  data: Organization[];
};

const organizationTypes = [
  "all",
  "kcca",
  "waste_collection_company",
  "recycling_company",
  "processing_plant",
  "environment_agency",
  "business",
  "citizen_group",
  "system",
];

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const [form, setForm] = useState({
    name: "",
    type: "waste_collection_company",
    email: "",
    phone: "",
    address: "",
  });

  async function loadOrganizations() {
    try {
      setLoading(true);
      setError("");

      const response = await apiRequest<OrganizationsResponse>(
        "/api/organizations"
      );

      setOrganizations(response.data);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to load organizations"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    try {
      setCreating(true);
      setError("");

      await apiRequest("/api/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          email: form.email || undefined,
          phone: form.phone || undefined,
          address: form.address || undefined,
        }),
      });

      setForm({
        name: "",
        type: "waste_collection_company",
        email: "",
        phone: "",
        address: "",
      });

      await loadOrganizations();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to create organization"
      );
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    loadOrganizations();
  }, []);

  const filteredOrganizations = useMemo(() => {
    return organizations.filter((organization) => {
      const matchesSearch =
        organization.name.toLowerCase().includes(search.toLowerCase()) ||
        organization.type.toLowerCase().includes(search.toLowerCase()) ||
        (organization.email || "").toLowerCase().includes(search.toLowerCase());

      const matchesType =
        typeFilter === "all" || organization.type === typeFilter;

      return matchesSearch && matchesType;
    });
  }, [organizations, search, typeFilter]);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <section className="border-b border-slate-200 pb-7">
          <p className="text-sm font-black uppercase tracking-[0.25em] text-emerald-700">
            City Stakeholders
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950">
            Organizations
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            This area keeps the real institutions and partners behind Kampala’s
            waste ecosystem organized before operations, trucks, zones, and
            citizen reports are connected.
          </p>
        </section>

        {error && (
          <div className="mt-6 border-l-4 border-red-600 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-10 py-8 xl:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="flex flex-col justify-between gap-5 border-b border-slate-200 pb-5 lg:flex-row lg:items-end">
              <div>
                <h2 className="text-2xl font-black text-slate-950">
                  Registered partners
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  {filteredOrganizations.length} shown from{" "}
                  {organizations.length} total organizations.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search organization..."
                  className="border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-700"
                />

                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                  className="border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-700"
                >
                  {organizationTypes.map((type) => (
                    <option key={type} value={type}>
                      {type === "all" ? "All types" : type.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="divide-y divide-slate-200">
              {loading ? (
                <p className="py-8 text-sm text-slate-500">
                  Loading organizations...
                </p>
              ) : filteredOrganizations.length === 0 ? (
                <p className="py-8 text-sm text-slate-500">
                  No organizations match your search.
                </p>
              ) : (
                filteredOrganizations.map((organization) => (
                  <div
                    key={organization.id}
                    className="grid gap-4 py-5 lg:grid-cols-[1fr_220px_120px]"
                  >
                    <div>
                      <p className="text-lg font-black text-slate-950">
                        {organization.name}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        {organization.address || "No address added"}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                        Type
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-800">
                        {organization.type.replaceAll("_", " ")}
                      </p>
                    </div>

                    <div className="text-left lg:text-right">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                        Status
                      </p>
                      <p className="mt-1 text-sm font-black text-emerald-700">
                        {organization.is_active ? "Active" : "Inactive"}
                      </p>
                    </div>

                    <div className="lg:col-span-3">
                      <p className="text-sm text-slate-500">
                        {organization.email || "No email"} ·{" "}
                        {organization.phone || "No phone"}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <aside className="border-l border-slate-200 pl-8">
            <h2 className="text-2xl font-black text-slate-950">
              Add organization
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Add one verified institution or partner at a time. Later, these
              organizations will own users, trucks, zones, reports, and
              recycling records.
            </p>

            <form onSubmit={handleCreate} className="mt-7 space-y-5">
              <label className="block">
                <span className="text-sm font-black text-slate-700">
                  Organization name
                </span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  required
                  className="mt-2 w-full border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  placeholder="Example: Kampala Recycling Partners"
                />
              </label>

              <label className="block">
                <span className="text-sm font-black text-slate-700">Type</span>
                <select
                  value={form.type}
                  onChange={(event) =>
                    setForm({ ...form, type: event.target.value })
                  }
                  className="mt-2 w-full border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-700"
                >
                  {organizationTypes
                    .filter((type) => type !== "all")
                    .map((type) => (
                      <option key={type} value={type}>
                        {type.replaceAll("_", " ")}
                      </option>
                    ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-black text-slate-700">Email</span>
                <input
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                  className="mt-2 w-full border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  placeholder="info@example.ug"
                />
              </label>

              <label className="block">
                <span className="text-sm font-black text-slate-700">Phone</span>
                <input
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                  className="mt-2 w-full border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  placeholder="+256..."
                />
              </label>

              <label className="block">
                <span className="text-sm font-black text-slate-700">
                  Address
                </span>
                <textarea
                  value={form.address}
                  onChange={(event) =>
                    setForm({ ...form, address: event.target.value })
                  }
                  className="mt-2 min-h-24 w-full border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  placeholder="Kampala, Uganda"
                />
              </label>

              <button
                type="submit"
                disabled={creating}
                className="w-full bg-emerald-700 px-5 py-4 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? "Creating organization..." : "Create organization"}
              </button>
            </form>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
