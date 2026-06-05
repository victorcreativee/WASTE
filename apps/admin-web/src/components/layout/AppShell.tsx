"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "City Overview", href: "/dashboard" },
  { label: "Organizations", href: "/dashboard/organizations" },
  { label: "Waste Operations", href: "/dashboard/waste" },
  { label: "GIS Map", href: "#" },
];

type CurrentUser = {
  fullName: string;
  email: string;
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    const storedUser = localStorage.getItem("currentUser");

    if (!token) {
      window.location.href = "/login";
      return;
    }

    if (storedUser) {
      setCurrentUser(JSON.parse(storedUser));
    }
  }, []);

  function handleLogout() {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("currentUser");
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-[#f6f8f7] text-slate-900">
      <aside className="fixed left-0 top-0 hidden h-screen w-72 border-r border-slate-200 bg-white px-6 py-7 lg:block">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-700">
            Kampala
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight">
            Smart Waste
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            City operations workspace
          </p>
        </div>

        <nav className="mt-10 space-y-1 text-sm font-bold">
          {navItems.map((item) => {
            const isActive =
              item.href !== "#" &&
              (pathname === item.href || pathname.startsWith(`${item.href}/`));

            return (
              <Link
                key={item.label}
                href={item.href}
                className={[
                  "block border-l-4 px-4 py-3 transition",
                  isActive
                    ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
                  item.href === "#" ? "cursor-not-allowed opacity-50" : "",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="lg:pl-72">
        <header className="border-b border-slate-200 bg-white px-8 py-5">
          <div className="flex items-center justify-between gap-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">
                KCCA Command Center
              </p>
              <h2 className="mt-1 text-xl font-black">
                Urban Waste Intelligence
              </h2>
            </div>

            <div className="flex items-center gap-4 text-right">
              <div>
                <p className="text-sm font-black text-slate-900">
                  {currentUser?.fullName || "KCCA Admin"}
                </p>
                <p className="text-xs font-semibold text-slate-500">
                  {currentUser?.email || "Signed in"}
                </p>
              </div>

              <button
                onClick={handleLogout}
                className="border-l border-slate-200 pl-4 text-sm font-black text-emerald-700 hover:text-emerald-900"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <section className="p-8">{children}</section>
      </main>
    </div>
  );
}
