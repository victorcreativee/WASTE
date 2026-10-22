"use client";
import { useEffect, useState } from "react";
import { Modal, Status } from "@/components/ui/System";

type DesktopState = Awaited<ReturnType<NonNullable<Window["kwmsDesktop"]>["getState"]>>;

export function DesktopSyncCenter() {
  const [state, setState] = useState<DesktopState | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const bridge = window.kwmsDesktop;
    if (!bridge) return;
    let active = true;
    bridge.getState().then(value => active && setState(value)).catch(() => undefined);
    const unsubscribe = bridge.onState(value => active && setState(value));
    const timer=window.setInterval(()=>bridge.getState().then(value=>active&&setState(value)).catch(()=>undefined),5000);
    return () => { active = false; window.clearInterval(timer);unsubscribe(); };
  }, []);
  if (!state) return null;
  const bridge = window.kwmsDesktop!;
  const activity = state.pendingCount + state.failedCount;
  async function run(action: () => Promise<DesktopState>, fallback: string) {
    try { setError(""); setState(await action()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : fallback); }
  }
  async function discard(id: string) {
    if (!window.confirm("Remove this offline action? Unsynchronized work will be lost.")) return;
    await run(() => bridge.discard(id), "Could not remove action");
  }
  return <>
    <button onClick={() => setOpen(true)} className={`hidden h-8 min-h-0 items-center rounded-[var(--ui-radius)] border px-3 text-xs font-medium sm:inline-flex ${state.online ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
      <span className={`mr-2 inline-block h-2 w-2 rounded-full ${state.online ? "bg-green-500" : "bg-amber-500"}`} />
      {connectionLabel(state)}{activity ? ` · ${activity}` : ""}{state.updateStatus === "ready" ? " · Update ready" : ""}
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title="Desktop Sync Centre" description="Synchronize offline work and keep this installed Kampala WMS application current.">
      {error && <p role="alert" className="mb-4 border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="grid gap-px overflow-hidden rounded-[var(--ui-radius-lg)] border bg-slate-200 sm:grid-cols-3"><Metric label="Connection" value={connectionLabel(state)}/><Metric label="Waiting" value={String(state.pendingCount)}/><Metric label="Needs attention" value={String(state.failedCount)}/></div>
      {!state.secureStorageAvailable && <p className="mt-4 border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-800">Encrypted operating-system storage is unavailable. Offline work is disabled on this device.</p>}
      <div className="mt-5 flex items-center justify-between gap-4"><div><p className="text-sm font-semibold">Server</p><p className="text-xs text-slate-500">{state.serverUrl}</p>{state.lastCheckedAt && <p className="text-xs text-slate-500">Last synced / checked {new Date(state.lastCheckedAt).toLocaleString("en-GB")}</p>}</div><button disabled={!state.online || state.syncing || activity === 0} onClick={() => void run(() => bridge.syncNow(sessionStorage.getItem("accessToken") || ""), "Could not synchronize")} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{state.syncing ? "Synchronizing…" : "Sync now"}</button></div>
      <UpdatePanel state={state} run={run} install={() => bridge.installUpdate()} />
      <section className="mt-6"><h3 className="font-semibold">Offline activity</h3><div className="mt-2 max-h-80 divide-y overflow-y-auto border-y">
        {state.queue.length ? state.queue.map(item => <div key={item.id} className="flex items-start justify-between gap-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{label(item.endpoint)}</p><p className="text-xs text-slate-500">{item.method} · {new Date(item.createdAt).toLocaleString("en-GB")} · {item.attempts} attempt{item.attempts === 1 ? "" : "s"}</p>{item.lastError && <p className="mt-1 text-xs text-red-700">{item.lastError}</p>}</div><div className="shrink-0 text-right"><Status value={item.status}/><div className="mt-2 flex gap-2">{item.status === "failed" && <button onClick={() => void run(() => bridge.retry(item.id), "Could not retry action")} className="text-xs font-semibold text-[var(--color-action)]">Retry</button>}{item.status !== "syncing" && item.status !== "synced" && <button onClick={() => void discard(item.id)} className="text-xs font-semibold text-red-700">Remove</button>}</div></div></div>) : <p className="py-8 text-center text-sm text-slate-500">This computer has no queued work.</p>}
      </div></section>
      <p className="mt-5 text-xs leading-5 text-slate-500">Installing an update preserves the encrypted SQLite database and unsynchronized operations. Payments, contracts, permits, access changes, payroll and official weighbridge verification require a live connection.</p>
    </Modal>
  </>;
}

function UpdatePanel({ state, run, install }: { state: DesktopState; run: (action: () => Promise<DesktopState>, fallback: string) => Promise<void>; install: () => Promise<boolean> }) {
  const bridge = window.kwmsDesktop!;
  return <section className="mt-6 border-y py-4"><div className="flex items-center justify-between gap-4"><div><h3 className="font-semibold">Desktop application update</h3><p className="mt-1 text-xs text-slate-500">Installed version {state.appVersion} · {updateLabel(state)}</p>{state.updateError && <p className="mt-1 text-xs text-red-700">{state.updateError}</p>}</div>{state.updateStatus === "available" ? <button onClick={() => void run(() => bridge.downloadUpdate(), "Could not download update")} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white">Download update</button> : state.updateStatus === "ready" ? <button onClick={() => void install()} className="bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">Restart and install</button> : <button disabled={!state.online || ["checking", "downloading"].includes(state.updateStatus)} onClick={() => void run(() => bridge.checkForUpdates(), "Could not check for updates")} className="border border-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-[var(--color-action)] disabled:opacity-40">{state.updateStatus === "checking" ? "Checking…" : state.updateStatus === "downloading" ? `Downloading ${state.updateProgress || 0}%` : "Check updates"}</button>}</div></section>;
}

function updateLabel(state: DesktopState) { if (state.updateStatus === "available") return `version ${state.availableVersion || "new"} is available`; if (state.updateStatus === "ready") return `version ${state.availableVersion || "new"} is ready to install`; if (state.updateStatus === "downloading") return `downloading ${state.updateProgress || 0}%`; if (state.updateStatus === "checking") return "checking for updates"; if (state.updateStatus === "error") return "last update check failed"; if (state.updateStatus === "current") return "up to date"; return "automatic checks enabled"; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>; }
function label(endpoint: string) { return endpoint.split("?")[0].replace(/^\/api\/waste\//, "").replaceAll("/", " › ").replaceAll("-", " "); }
function connectionLabel(state:DesktopState){if(state.syncing)return"Syncing";if(state.failedCount>0)return"Sync failed";return state.online?"Online":"Offline"}
