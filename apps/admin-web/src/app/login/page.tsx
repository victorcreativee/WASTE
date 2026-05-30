"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api";

type LoginResponse = {
  success: boolean;
  message: string;
  data: {
    user: {
      id: string;
      fullName: string;
      email: string;
    };
    tokens: {
      accessToken: string;
      refreshToken: string;
    };
  };
};

export default function LoginPage() {
  const [email, setEmail] = useState("admin@kcca.go.ug");
  const [password, setPassword] = useState("Password123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await apiRequest<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      localStorage.setItem("accessToken", response.data.tokens.accessToken);
      localStorage.setItem("refreshToken", response.data.tokens.refreshToken);
      localStorage.setItem(
        "currentUser",
        JSON.stringify({
          fullName: response.data.user.fullName,
          email: response.data.user.email,
        })
      );

      window.location.href = "/dashboard";
    } catch (error) {
      setError(error instanceof Error ? error.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-[#f7f9fb] lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-[#03140f] text-white lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(0,145,100,0.35),_transparent_35%),linear-gradient(135deg,_rgba(0,85,61,0.96),_rgba(3,10,30,0.98))]" />
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:64px_64px]" />

        <div className="relative flex min-h-screen flex-col justify-between p-12">
          <div>
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-300/30 bg-white/10 text-2xl">
                ♻
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">KCCA</h1>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
                  Kampala Capital City Authority
                </p>
              </div>
            </div>

            <div className="mt-24 max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.35em] text-emerald-300">
                Smart Waste Management
              </p>

              <h2 className="mt-8 text-6xl font-black leading-[1.05] tracking-tight">
                Cleaner city operations, powered by real-time intelligence
                <span className="text-emerald-400">.</span>
              </h2>

              <div className="mt-8 h-1 w-16 rounded-full bg-emerald-400" />

              <p className="mt-8 max-w-xl text-lg leading-8 text-slate-200">
                A unified platform for KCCA, waste companies, recycling
                partners, citizens, IoT infrastructure, and GIS-based city
                operations.
              </p>
            </div>

            <div className="mt-12 grid max-w-2xl grid-cols-4 gap-4">
              {[
                ["⌖", "Real-time", "Monitoring"],
                ["🚚", "Fleet", "Management"],
                ["♻", "Recycling", "Insights"],
                ["📈", "Data-Driven", "Decisions"],
              ].map(([icon, title, subtitle]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur"
                >
                  <div className="text-2xl text-emerald-300">{icon}</div>
                  <p className="mt-3 text-sm font-bold">{title}</p>
                  <p className="text-sm text-slate-300">{subtitle}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-sm text-slate-300">
            © 2026 KCCA Smart Waste Platform. All rights reserved.
          </p>
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-6 py-10">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-2xl shadow-slate-200/70 sm:p-12"
        >
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-3xl text-emerald-800">
            🔐
          </div>

          <div className="mt-8 text-center">
            <p className="text-sm font-black uppercase tracking-[0.25em] text-emerald-700">
              Admin Access
            </p>
            <h2 className="mt-4 text-4xl font-black tracking-tight text-slate-950">
              Welcome back
            </h2>
            <p className="mx-auto mt-3 max-w-sm text-base leading-7 text-slate-500">
              Sign in to access the KCCA Smart Waste Command Center.
            </p>
          </div>

          {error && (
            <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <div className="mt-10 space-y-5">
            <label className="block">
              <span className="text-sm font-bold text-slate-800">
                Email address
              </span>
              <div className="mt-2 flex items-center rounded-2xl border border-slate-200 bg-white px-4 focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-100">
                <span className="text-slate-400">✉</span>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full bg-transparent px-4 py-4 text-slate-900 outline-none placeholder:text-slate-300"
                  placeholder="admin@kcca.go.ug"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-800">Password</span>
              <div className="mt-2 flex items-center rounded-2xl border border-slate-200 bg-white px-4 focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-100">
                <span className="text-slate-400">⌘</span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full bg-transparent px-4 py-4 text-slate-900 outline-none placeholder:text-slate-300"
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="text-sm font-bold text-slate-500 hover:text-emerald-700"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 font-medium text-slate-600">
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
                />
                Remember me
              </label>

              <button
                type="button"
                className="font-bold text-emerald-700 hover:text-emerald-900"
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-700 px-6 py-4 text-base font-black text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>{loading ? "Signing in..." : "Sign in to Dashboard"}</span>
              <span>→</span>
            </button>

            <div className="flex items-center gap-4 py-2 text-sm text-slate-400">
              <div className="h-px flex-1 bg-slate-200" />
              <span>or</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <button
              type="button"
              className="w-full rounded-2xl border border-slate-300 bg-white px-6 py-4 text-base font-bold text-slate-800 transition hover:bg-slate-50"
            >
              Continue with SSO (KCCA)
            </button>

            <div className="rounded-2xl bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
              Secure access to city operations data and systems.
            </div>
          </div>
        </form>
      </section>
    </main>
  );
}
