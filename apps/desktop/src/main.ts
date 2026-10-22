import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  shell,
  utilityProcess,
} from "electron";
import { autoUpdater } from "electron-updater";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LocalDatabase } from "./local-database";
import type {
  DesktopState,
  LocalAuthInput,
  OfflineSession,
  QueueInput,
  SnapshotInput,
} from "./types";

const serverUrl = (
  process.env.KWMS_SERVER_URL || "https://kampalawms.com"
).replace(/\/$/, "");
const localWebUrl = "http://127.0.0.1:3987",
  serverOrigin = new URL(serverUrl).origin,
  trustedOrigins = new Set([localWebUrl, serverOrigin]);
const localLoginUrl = `${localWebUrl}/login`;
let window: BrowserWindow | null = null,
  online = false,
  lastCheckedAt: string | null = null,
  syncing = false,
  monitor: NodeJS.Timeout | null = null,
  accessToken = "";
let updateMonitor: NodeJS.Timeout | null = null,
  updateStatus:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "current"
    | "error" = "idle",
  availableVersion: string | null = null,
  updateError: string | null = null,
  updateProgress: number | null = null;
let showingOffline = false;
let localWebProcess: Electron.UtilityProcess | null = null;
const localDatabase = new LocalDatabase();
const offlineFile = path.join(app.getAppPath(), "assets", "offline.html"),
  offlineUrl = pathToFileURL(offlineFile).toString();
async function startLocalWeb() {
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, "web", "apps", "admin-web", "server.js")
    : path.resolve(
        app.getAppPath(),
        "../admin-web/.next/standalone/apps/admin-web/server.js",
      );
  localWebProcess = utilityProcess.fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: "3987",
      HOSTNAME: "127.0.0.1",
      KWMS_API_ORIGIN: serverUrl,
    },
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${localWebUrl}/login`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        if (window && showingOffline) {
          showingOffline = false;
          await window.loadURL(localLoginUrl);
        }
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The installed Kampala WMS interface could not start");
}
app.whenReady().then(() => void startLocalWeb());
function state(): DesktopState {
  const records = localDatabase.listQueue();
  return {
    isDesktop: true,
    online,
    serverUrl,
    lastCheckedAt,
    syncing,
    pendingCount: records.filter((x) => x.status === "pending").length,
    failedCount: records.filter(
      (x) => x.status === "failed" || x.status === "conflict",
    ).length,
    syncedCount: records.filter((x) => x.status === "synced").length,
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    queue: records,
    appVersion: app.getVersion(),
    updateStatus,
    availableVersion,
    updateError,
    updateProgress,
  };
}
function publish() {
  window?.webContents.send("desktop:state", state());
}
function configureUpdates() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => {
    updateStatus = "checking";
    updateError = null;
    publish();
  });
  autoUpdater.on("update-available", (info) => {
    updateStatus = "available";
    availableVersion = info.version;
    publish();
  });
  autoUpdater.on("update-not-available", () => {
    updateStatus = "current";
    availableVersion = null;
    updateProgress = null;
    publish();
  });
  autoUpdater.on("download-progress", (progress) => {
    updateStatus = "downloading";
    updateProgress = Math.round(progress.percent);
    publish();
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateStatus = "ready";
    availableVersion = info.version;
    updateProgress = 100;
    publish();
  });
  autoUpdater.on("error", (error) => {
    updateStatus = "error";
    updateError = error.message;
    publish();
  });
}
async function checkForDesktopUpdate() {
  if (!app.isPackaged) {
    updateStatus = "current";
    updateError = null;
    publish();
    return state();
  }
  if (!online)
    throw new Error("Connect to the internet before checking for updates");
  updateStatus = "checking";
  updateError = null;
  publish();
  await autoUpdater.checkForUpdates();
  return state();
}
async function synchronize(token: string) {
  if (syncing) return state();
  syncing = true;
  publish();
  try {
    await localDatabase.sync(token, serverUrl);
    return state();
  } finally {
    syncing = false;
    publish();
  }
}
async function resumeCentralSession() {
  const session = localDatabase.session() || localDatabase.restoreSession();
  if (!session) return null;
  const refreshToken = localDatabase.refreshCredential();
  if (accessToken) {
    if (state().pendingCount || state().failedCount)
      await synchronize(accessToken);
    return {
      session,
      online: true,
      tokens: refreshToken ? { accessToken, refreshToken } : undefined,
    };
  }
  if (!refreshToken) return null;
  try {
    const response = await fetch(`${serverUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(10000),
    });
    const payload = (await response.json()) as {
      data?: {
        user: {
          id: string;
          fullName: string;
          email: string;
          organizationId: string | null;
        };
        roles: { name: string }[];
        tokens: { accessToken: string; refreshToken: string };
      };
    };
    if (!response.ok || !payload.data) {
      if (response.status === 401 || response.status === 403)
        localDatabase.revokeUser(session.user.id);
      publish();
      return null;
    }
    accessToken = payload.data.tokens.accessToken;
    const renewed = localDatabase.updateCentralSession({
      user: payload.data.user,
      roles: payload.data.roles.map((role) => role.name),
      refreshToken: payload.data.tokens.refreshToken,
    });
    if (state().pendingCount || state().failedCount)
      await synchronize(accessToken);
    return { session: renewed, online: true, tokens: payload.data.tokens };
  } catch {
    return null;
  }
}
async function refreshCentralAccess() {
  const session = localDatabase.session() || localDatabase.restoreSession(),
    refreshToken = localDatabase.refreshCredential();
  if (!session || !refreshToken) return false;
  try {
    const response = await fetch(`${serverUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: {
        user: {
          id: string;
          fullName: string;
          email: string;
          organizationId: string | null;
        };
        roles: { name: string }[];
        tokens: { accessToken: string; refreshToken: string };
      };
    };
    if (!response.ok || !payload.data) {
      if (response.status === 401 || response.status === 403)
        localDatabase.revokeUser(session.user.id);
      return false;
    }
    accessToken = payload.data.tokens.accessToken;
    localDatabase.updateCentralSession({
      user: payload.data.user,
      roles: payload.data.roles.map((role) => role.name),
      refreshToken: payload.data.tokens.refreshToken,
    });
    return true;
  } catch {
    return false;
  }
}
type CentralApiInput = {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
};
async function centralApiRequest(input: CentralApiInput) {
  if (!input.path.startsWith("/api/"))
    throw new Error("Invalid platform API path");
  if (!online)
    throw new Error(
      "The platform service is temporarily unavailable. Please try again.",
    );
  const request = () =>
    fetch(`${serverUrl}${input.path}`, {
      method: input.method || "GET",
      headers: {
        ...(input.body ? { "Content-Type": "application/json" } : {}),
        ...(accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : { Organization: "" }),
        ...(input.headers || {}),
      },
      body: input.body || undefined,
      signal: AbortSignal.timeout(30000),
      cache:
        (input.method || "GET").toUpperCase() === "GET"
          ? "no-store"
          : "default",
    });
  let response = await request();
  if (response.status === 401 && (await refreshCentralAccess()))
    response = await request();
  const body = await response.text();
  const headers: Record<string, string> = {};
  const contentType = response.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  return { status: response.status, headers, body };
}
async function showOffline() {
  if (!window || showingOffline) return;
  showingOffline = true;
  await window.loadFile(offlineFile);
}
type CentralLogin = {
  session: OfflineSession;
  tokens: { accessToken: string; refreshToken: string };
};
function destinationFor(roles: string[]) {
  return roles.includes("weighbridge_operator")
    ? "/dashboard/weighbridge/operations"
    : roles.some((role) =>
          [
            "recycling_collector",
            "recycling_sales",
            "recycling_field_manager",
          ].includes(role),
        )
      ? "/dashboard/recycling"
      : roles.includes("driver")
        ? "/dashboard/driver-mobile"
        : roles.includes("citizen")
          ? "/dashboard/citizen-issues"
          : roles.includes("organization_applicant")
            ? "/onboarding"
            : roles.includes("company_admin")
              ? "/dashboard/company"
              : "/dashboard";
}
async function centralData(pathname: string, token: string) {
  const response = await fetch(`${serverUrl}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Could not cache ${pathname}`);
  const payload = (await response.json()) as { data?: unknown };
  localDatabase.cacheApiResponse(pathname, payload);
  return payload.data;
}
async function hydrateOfflineWorkspace(result: CentralLogin) {
  const { session, tokens } = result,
    roles = session.roles,
    organizationId = session.user.organizationId || "platform",
    userId = session.user.id;
  try {
    if (roles.includes("driver")) {
      const routes = (await centralData(
        "/api/waste/driver/routes",
        tokens.accessToken,
      )) as Array<{ id: string }>;
      if (routes?.[0]) {
        const route = await centralData(
          `/api/waste/driver-routes/${routes[0].id}`,
          tokens.accessToken,
        );
        localDatabase.setSnapshot({
          key: "driver-route",
          organizationId,
          userId,
          data: route,
        });
      }
      return;
    }
    if (
      roles.some((role) =>
        [
          "recycling_collector",
          "recycling_sales",
          "recycling_field_manager",
        ].includes(role),
      )
    ) {
      const recycling = await centralData(
        "/api/waste/recycling",
        tokens.accessToken,
      );
      localDatabase.setSnapshot({
        key: "recycling-field",
        organizationId,
        userId,
        data: recycling,
      });
      return;
    }
    if (roles.includes("company_admin") || roles.includes("supervisor")) {
      const today = new Date(),
        from = new Date(today.getFullYear(), today.getMonth(), 1)
          .toISOString()
          .slice(0, 10),
        to = today.toISOString().slice(0, 10);
      const paths = [
        "/api/organizations",
        "/api/waste/command-center/summary",
        "/api/waste/billing/overview",
        "/api/auth/organization-users",
        "/api/waste/recycling",
        "/api/auth/organization-access/me",
        "/api/waste/regulatory/organization-package",
        "/api/waste/service-areas/divisions",
        "/api/waste/service-areas/catalog",
        "/api/waste/zones",
        "/api/waste/service-routes",
        "/api/waste/fleet/overview",
        "/api/waste/fleet/live",
        "/api/waste/trucks",
        "/api/waste/drivers",
        "/api/waste/operations/supervisors",
        "/api/waste/trips",
        "/api/waste/customers",
        "/api/waste/customers/provider-requests",
        "/api/waste/contracts",
        "/api/waste/inventory",
        "/api/waste/procurement",
        "/api/waste/citizen-issues",
        "/api/waste/collection-jobs",
        "/api/waste/driver-job-problems",
        "/api/waste/weighbridge/transactions",
        "/api/waste/billing/plans",
        "/api/waste/finance/expenses",
        "/api/waste/finance/position",
        "/api/waste/finance/payables",
        "/api/auth/organization-payroll",
        `/api/waste/reports/organization?from=${from}&to=${to}`,
      ];
      const cached = await Promise.allSettled(
        paths.map((pathname) => centralData(pathname, tokens.accessToken)),
      );
      const [organizations, summary, billing, staff, recycling] = cached;
      const value = (item: PromiseSettledResult<unknown>, fallback: unknown) =>
        item.status === "fulfilled" ? item.value : fallback;
      localDatabase.setSnapshot({
        key: "company-dashboard",
        organizationId,
        userId,
        data: {
          organization: (value(organizations, []) as unknown[])[0] || null,
          summary: value(summary, {}),
          billing: value(billing, {
            subscriptions: [],
            invoices: [],
            payments: [],
          }),
          staff: value(staff, []),
        },
      });
      if (recycling.status === "fulfilled")
        localDatabase.setSnapshot({
          key: "recycling-field",
          organizationId,
          userId,
          data: recycling.value,
        });
      return;
    }
    if (roles.some((role) => ["kcca_admin", "system_admin"].includes(role))) {
      const [organizations, summary] = await Promise.allSettled([
        centralData("/api/organizations", tokens.accessToken),
        centralData("/api/waste/command-center/summary", tokens.accessToken),
      ]);
      localDatabase.setSnapshot({
        key: "platform-dashboard",
        organizationId,
        userId,
        data: {
          organizations:
            organizations.status === "fulfilled" ? organizations.value : [],
          summary: summary.status === "fulfilled" ? summary.value : {},
        },
      });
    }
  } catch {
    /* Online access must remain available even if an optional offline dataset cannot be refreshed. */
  }
}
async function authenticateCentrally(
  email: string,
  password: string,
): Promise<CentralLogin> {
  const response = await fetch(`${serverUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    data?: {
      user: {
        id: string;
        fullName: string;
        email: string;
        organizationId: string | null;
      };
      roles: { name: string }[];
      tokens: { accessToken: string; refreshToken: string };
    };
  };
  if (!response.ok || !payload.data)
    throw new Error(payload.message || "Online sign-in could not be completed");
  online = true;
  lastCheckedAt = new Date().toISOString();
  const roles = payload.data.roles.map((role) => role.name);
  const session = await localDatabase.provision({
    email: payload.data.user.email,
    password,
    refreshToken: payload.data.tokens.refreshToken,
    user: payload.data.user,
    roles,
  });
  accessToken = payload.data.tokens.accessToken;
  publish();
  return { session, tokens: payload.data.tokens };
}
async function openCentralWorkspace(result: CentralLogin) {
  if (!window) return;
  showingOffline = false;
  const currentUser = { ...result.session.user, roles: result.session.roles };
  await window.loadURL(localLoginUrl);
  await window.webContents.executeJavaScript(
    `sessionStorage.setItem("accessToken",${JSON.stringify(result.tokens.accessToken)});sessionStorage.setItem("refreshToken",${JSON.stringify(result.tokens.refreshToken)});sessionStorage.setItem("currentUser",${JSON.stringify(JSON.stringify(currentUser))});window.location.replace(${JSON.stringify(destinationFor(result.session.roles))});`,
  );
}
async function checkConnection() {
  const wasOnline = online;
  try {
    const response = await fetch(`${serverUrl}/api/health`, {
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    online = response.ok;
  } catch {
    online = false;
  }
  lastCheckedAt = new Date().toISOString();
  publish();
  if (online && !wasOnline) {
    if (accessToken)
      void refreshCentralAccess()
        .then(async (renewed) => {
          if (!renewed) return;
          if (state().pendingCount || state().failedCount)
            await synchronize(accessToken);
          const session = localDatabase.session(),
            refreshToken = localDatabase.refreshCredential();
          if (session && refreshToken)
            await hydrateOfflineWorkspace({
              session,
              tokens: { accessToken, refreshToken },
            });
        })
        .catch(() => undefined);
    else
      void resumeCentralSession()
        .then(async (resumed) => {
          if (resumed?.tokens)
            await hydrateOfflineWorkspace(resumed as CentralLogin);
        })
        .catch(() => undefined);
  }
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#f7f7f5",
    title: "Kampala Waste Management System",
    show: false,
    icon: path.join(app.getAppPath(), "build", "kwms-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });
  window.once("ready-to-show", () => window?.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (trustedOrigins.has(target.origin)) {
        void window?.loadURL(target.toString());
        return { action: "deny" };
      }
      if (target.protocol === "https:")
        void shell.openExternal(target.toString());
    } catch {
      /* Ignore malformed navigation requests. */
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    try {
      if (url === offlineUrl) return;
      const target = new URL(url);
      if (trustedOrigins.has(target.origin)) return;
      event.preventDefault();
      if (target.protocol === "https:")
        void shell.openExternal(target.toString());
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, _description, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) void showOffline();
    },
  );
  try {
    showingOffline = false;
    await window.loadURL(localLoginUrl);
  } catch {
    await showOffline();
  }
}
app.whenReady().then(async () => {
  localDatabase.initialize();
  ipcMain.handle("desktop:get-state", () => state());
  ipcMain.handle("desktop:get-snapshots", () => localDatabase.snapshots());
  ipcMain.handle("desktop:set-snapshot", (_event, input: SnapshotInput) =>
    localDatabase.setSnapshot(input),
  );
  ipcMain.handle("desktop:initialize-auth", (_event, input: LocalAuthInput) =>
    localDatabase.provision(input),
  );
  ipcMain.handle(
    "desktop:central-login",
    async (_event, input: { email: string; password: string }) => {
      const result = await authenticateCentrally(input.email, input.password);
      await hydrateOfflineWorkspace(result);
      setTimeout(() => void openCentralWorkspace(result), 100);
      return result.session;
    },
  );
  ipcMain.handle("desktop:resume-auth", async () => {
    const session = localDatabase.session() || localDatabase.restoreSession();
    if (!session) return null;
    if (!online) return { session, online: false };
    return resumeCentralSession();
  });
  ipcMain.handle(
    "desktop:offline-login",
    (_event, input: { email: string; password: string }) =>
      localDatabase.authenticate(input.email, input.password),
  );
  ipcMain.handle("desktop:offline-logout", () => {
    accessToken = "";
    localDatabase.logout();
    publish();
    return true;
  });
  ipcMain.handle("desktop:revoke-auth", (_event, userId: string) => {
    localDatabase.revokeUser(userId);
    return true;
  });
  ipcMain.handle("desktop:reconnect", async () => {
    await checkConnection();
    return state();
  });
  ipcMain.handle("desktop:queue", async (_event, input: QueueInput) => {
    const record = localDatabase.addQueue(input);
    publish();
    return record;
  });
  ipcMain.handle(
    "desktop:offline-queue",
    async (_event, input: Omit<QueueInput, "organizationId" | "userId">) => {
      const session = localDatabase.session();
      if (!session?.user.organizationId)
        throw new Error("Offline sign-in is required");
      const record = localDatabase.addQueue({
        ...input,
        organizationId: session.user.organizationId,
        userId: session.user.id,
      });
      publish();
      return record;
    },
  );
  ipcMain.handle("desktop:retry", async (_event, id: string) => {
    localDatabase.retry(id);
    publish();
    return state();
  });
  ipcMain.handle("desktop:discard", async (_event, id: string) => {
    localDatabase.discard(id);
    publish();
    return state();
  });
  ipcMain.handle("desktop:sync", async (_event, token: string) => {
    await checkConnection();
    if (!online)
      throw new Error(
        "The server is offline. Queued work remains safely on this computer.",
      );
    if (token && token !== "offline-local-session") accessToken = token;
    const renewed = await refreshCentralAccess();
    if (!renewed)
      throw new Error(
        "Reconnect and sign in online before synchronizing this computer.",
      );
    await synchronize(accessToken);
    const session = localDatabase.session(),
      refreshToken = localDatabase.refreshCredential();
    if (session && refreshToken)
      await hydrateOfflineWorkspace({
        session,
        tokens: { accessToken, refreshToken },
      });
    return state();
  });
  await checkConnection();
  await createWindow();
  const resumed = online ? await resumeCentralSession() : null;
  if (resumed?.tokens) {
    await hydrateOfflineWorkspace(resumed as CentralLogin);
    await openCentralWorkspace(resumed as CentralLogin);
  }
  monitor = setInterval(() => void checkConnection(), 30000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});
app.whenReady().then(() => {
  ipcMain.handle(
    "desktop:cache-api",
    (_event, input: { path: string; data: unknown }) =>
      localDatabase.cacheApiResponse(input.path, input.data),
  );
  ipcMain.handle("desktop:get-cached-api", (_event, pathname: string) =>
    localDatabase.cachedApiResponse(pathname),
  );
  ipcMain.handle("desktop:central-api", (_event, input: CentralApiInput) =>
    centralApiRequest(input),
  );
});
app.whenReady().then(() => {
  configureUpdates();
  ipcMain.handle("desktop:update-check", () => checkForDesktopUpdate());
  ipcMain.handle("desktop:update-download", async () => {
    if (updateStatus !== "available")
      throw new Error("No desktop update is ready to download");
    updateStatus = "downloading";
    updateError = null;
    publish();
    await autoUpdater.downloadUpdate();
    return state();
  });
  ipcMain.handle("desktop:update-install", () => {
    if (updateStatus !== "ready")
      throw new Error("Download the update before installing it");
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });
  setTimeout(() => void checkForDesktopUpdate().catch(() => undefined), 15000);
  updateMonitor = setInterval(
    () => void checkForDesktopUpdate().catch(() => undefined),
    6 * 60 * 60 * 1000,
  );
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (monitor) clearInterval(monitor);
  if (updateMonitor) clearInterval(updateMonitor);
  localWebProcess?.kill();
  localDatabase.close();
});
