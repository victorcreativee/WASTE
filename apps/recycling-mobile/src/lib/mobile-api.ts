import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import { refreshAccessToken } from "./auth-session";

type Method = "POST" | "PUT" | "PATCH";
type QueueRow = {
  id: string;
  owner_email: string;
  method: Method;
  endpoint: string;
  payload: string;
  attempts: number;
};
type PendingProjectionRow = Pick<
  QueueRow,
  "id" | "method" | "endpoint" | "payload"
>;
export type MobileApiResult<T> = T & {
  queuedOffline?: boolean;
  localId?: string;
};
export type SyncState = {
  online: boolean;
  pending: number;
  conflicts: number;
  syncing: boolean;
  lastSyncedAt?: string;
  lastError?: string;
};
export type MobileOutboxItem = {
  id: string;
  method: string;
  endpoint: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  next_attempt_at: string | null;
};

const dbPromise = SQLite.openDatabaseAsync("kwms-mobile.db");
let ready: Promise<void> | null = null;
let activeSync: Promise<void> | null = null;
let state: SyncState = {
  online: true,
  pending: 0,
  conflicts: 0,
  syncing: false,
};
const listeners = new Set<(value: SyncState) => void>();

function publish(next: Partial<SyncState> = {}) {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}
function uuid() { return Crypto.randomUUID(); }
function networkFailure(error: unknown) {
  return (
    error instanceof TypeError ||
    /network request failed|failed to fetch|internet|offline/i.test(
      error instanceof Error ? error.message : String(error),
    )
  );
}
function offlineFailure(error:unknown){const status=(error as{httpStatus?:number})?.httpStatus;return networkFailure(error)||status===502||status===503||status===504}
function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object"
    ? (value as Record<string, any>)
    : null;
}

async function projectPendingRecyclingChanges(
  ownerEmail: string,
  path: string,
  cachedPayload: unknown,
) {
  if (path !== "/api/waste/recycling") return cachedPayload;
  const envelope = asRecord(cachedPayload);
  if (!envelope || !asRecord(envelope.data)) return cachedPayload;

  const db = await database();
  const rows = await db.getAllAsync<PendingProjectionRow>(
    "SELECT id,method,endpoint,payload FROM mobile_outbox WHERE owner_email=? AND status IN ('pending','syncing','failed') ORDER BY created_at",
    ownerEmail.toLowerCase(),
  );
  if (!rows.length) return cachedPayload;

  // Keep the cached server snapshot immutable. Pending device work is projected
  // into a clone and disappears automatically once the server refresh succeeds.
  const projected = JSON.parse(JSON.stringify(envelope)) as Record<string, any>;
  const data = asRecord(projected.data) || {};
  data.lots = Array.isArray(data.lots) ? data.lots : [];
  data.sales = Array.isArray(data.sales) ? data.sales : [];
  data.partners = Array.isArray(data.partners) ? data.partners : [];
  data.floatMovements = Array.isArray(data.floatMovements)
    ? data.floatMovements
    : [];

  for (const row of rows) {
    const payload = asRecord(safeJson(row.payload));
    if (!payload) continue;

    const paymentMatch = row.endpoint.match(/^\/api\/waste\/recycling\/sales\/([^/]+)\/paid$/);
    if (row.method === "PATCH" && paymentMatch) {
      const sale = data.sales.find((item: any) => item.id === paymentMatch[1]);
      if (sale && !sale.local_payment_ids?.includes(row.id)) {
        const balanceBefore = Number(sale.balance_ugx || sale.total_ugx || 0);
        const amount = Number(payload.amountUgx || 0);
        sale.balance_ugx = String(Math.max(0, balanceBefore - amount));
        sale.payment_state = amount >= balanceBefore ? "paid" : "partial";
        sale.local_payment_ids = [...(sale.local_payment_ids || []), row.id];
      }
      continue;
    }

    if (row.method !== "POST") continue;

    if (row.endpoint === "/api/waste/recycling/lots") {
      if (data.lots.some((lot: any) => lot.id === row.id)) continue;
      data.lots.unshift({
        id: row.id,
        origin: "purchase",
        status: "pending_sync",
        material_type: payload.materialType || "Material",
        source_name: payload.sourceName || "Offline supplier",
        quantity_kg: String(payload.quantityKg || 0),
        available_quantity_kg: String(payload.quantityKg || 0),
        unit_purchase_price_ugx: String(payload.unitPurchasePriceUgx || 0),
        collected_on:
          payload.collectedOn || new Date().toISOString().slice(0, 10),
        quality: payload.quality || "mixed",
        purchase_payment_status: payload.purchasePaymentStatus || "paid",
        notes: payload.notes || "",
      });
    }

    if (row.endpoint === "/api/waste/recycling/sales") {
      if (data.sales.some((sale: any) => sale.id === row.id)) continue;
      data.sales.unshift({
        id: row.id,
        lot_id: payload.lotId || null,
        material_type: payload.materialType || "Material",
        buyer_name: payload.buyerName || "Offline buyer",
        quantity_kg: String(payload.quantityKg || 0),
        unit_sale_price_ugx: String(payload.unitSalePriceUgx || 0),
        sold_on: payload.soldOn || new Date().toISOString().slice(0, 10),
        payment_status: payload.paymentStatus || "pending",
        notes: payload.notes || "",
        local_sync_status: "pending",
      });
      const soldLot = data.lots.find((lot: any) => lot.id === payload.lotId);
      if (soldLot)
        soldLot.available_quantity_kg = String(
          Math.max(
            0,
            Number(soldLot.available_quantity_kg || soldLot.quantity_kg || 0) -
              Number(payload.quantityKg || 0),
          ),
        );
    }

    if (row.endpoint === "/api/waste/recycling/manager-float") {
      if (data.floatMovements.some((movement: any) => movement.id === row.id))
        continue;
      data.floatMovements.unshift({
        id: row.id,
        employee_user_id: payload.employeeUserId || null,
        transaction_type: payload.transactionType || "given",
        amount_ugx: String(payload.amountUgx || 0),
        transaction_date:
          payload.transactionDate || new Date().toISOString().slice(0, 10),
        reference: payload.reference || null,
        notes: payload.notes || "",
        local_sync_status: "pending",
      });
    }

    if (row.endpoint === "/api/waste/recycling/partners") {
      if (data.partners.some((partner: any) => partner.id === row.id)) continue;
      data.partners.unshift({
        id: row.id,
        partner_type: payload.partnerType || "buyer",
        name: payload.name || "Offline trade partner",
        contact_person: payload.contactPerson || null,
        phone: payload.phone || null,
        email: payload.email || null,
        address: payload.address || null,
        tax_number: payload.taxNumber || null,
        active: true,
        local_sync_status: "pending",
      });
    }

    if (row.endpoint === "/api/waste/recycling/daily-closures") {
      data.operations = asRecord(data.operations) || {};
      data.operations.isClosed = payload.action === "close";
    }
  }
  projected.data = data;
  return projected;
}

async function projectPendingExpenseChanges(ownerEmail: string, path: string, cachedPayload: unknown) {
  if (path !== "/api/waste/finance/expenses") return cachedPayload;
  const envelope = asRecord(cachedPayload);
  const finance = asRecord(envelope?.data);
  if (!envelope || !finance) return cachedPayload;
  const db = await database();
  const rows = await db.getAllAsync<PendingProjectionRow>(
    "SELECT id,method,endpoint,payload FROM mobile_outbox WHERE owner_email=? AND endpoint='/api/waste/finance/expenses' AND status IN ('pending','syncing','failed') ORDER BY created_at",
    ownerEmail.toLowerCase(),
  );
  if (!rows.length) return cachedPayload;
  const projected = JSON.parse(JSON.stringify(envelope)) as Record<string, any>;
  const data = asRecord(projected.data) || {};
  data.expenses = Array.isArray(data.expenses) ? data.expenses : [];
  for (const row of rows) {
    if (row.method !== "POST" || data.expenses.some((item: any) => item.id === row.id)) continue;
    const payload = asRecord(safeJson(row.payload));
    if (!payload) continue;
    data.expenses.unshift({ id: row.id, expense_number: "Pending sync", category: payload.category, description: payload.description, vendor: payload.vendor || null, amount_ugx: String(payload.amountUgx || 0), expense_date: payload.expenseDate, reference: payload.reference, status: "pending_sync", local_sync_status: "pending" });
  }
  projected.data = data;
  return projected;
}

async function database() {
  const db = await dbPromise;
  if (!ready)
    ready = (async () => {
      await db.execAsync(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS api_cache(cache_key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mobile_outbox(id TEXT PRIMARY KEY,owner_email TEXT NOT NULL,method TEXT NOT NULL,endpoint TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,next_attempt_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,synced_at TEXT,dedupe_key TEXT);
      CREATE INDEX IF NOT EXISTS mobile_outbox_owner_status ON mobile_outbox(owner_email,status,created_at);
      CREATE INDEX IF NOT EXISTS mobile_outbox_dedupe ON mobile_outbox(owner_email,dedupe_key,status);
      CREATE TABLE IF NOT EXISTS mobile_sync_state(owner_email TEXT PRIMARY KEY,last_synced_at TEXT,last_error TEXT,updated_at TEXT NOT NULL);`);
      const columns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(mobile_outbox)",
      );
      if (!columns.some((column) => column.name === "next_attempt_at"))
        await db.execAsync(
          "ALTER TABLE mobile_outbox ADD COLUMN next_attempt_at TEXT",
        );
      if (!columns.some((column) => column.name === "dedupe_key"))
        await db.execAsync("ALTER TABLE mobile_outbox ADD COLUMN dedupe_key TEXT");
    })();
  await ready;
  return db;
}

async function refreshCounts(ownerEmail?: string) {
  const db = await database();
  const where = ownerEmail ? " WHERE owner_email=?" : "",
    args = ownerEmail ? [ownerEmail.toLowerCase()] : [];
  const rows = await db.getAllAsync<{ status: string; count: number }>(
    `SELECT status,COUNT(*) count FROM mobile_outbox${where} GROUP BY status`,
    args,
  );
  publish({
    pending: rows
      .filter((x) => ["pending", "failed", "syncing"].includes(x.status))
      .reduce((n, x) => n + x.count, 0),
    conflicts: rows
      .filter((x) => x.status === "conflict")
      .reduce((n, x) => n + x.count, 0),
  });
}

export function subscribeSync(listener: (value: SyncState) => void) {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}
export function getMobileSyncState() { return state; }
export async function listMobileOutbox(ownerEmail: string) {
  const db = await database();
  return db.getAllAsync<MobileOutboxItem>(
    "SELECT id,method,endpoint,status,attempts,last_error,created_at,next_attempt_at FROM mobile_outbox WHERE owner_email=? AND status!='synced' ORDER BY created_at DESC LIMIT 100",
    ownerEmail.toLowerCase(),
  );
}
export async function retryMobileOutbox(id: string, ownerEmail: string) {
  const db = await database();
  await db.runAsync(
    "UPDATE mobile_outbox SET status='pending',last_error=NULL,next_attempt_at=NULL,updated_at=? WHERE id=? AND owner_email=?",
    new Date().toISOString(),
    id,
    ownerEmail.toLowerCase(),
  );
  await refreshCounts(ownerEmail);
}
export async function discardMobileOutbox(id: string, ownerEmail: string) {
  const db = await database();
  await db.runAsync(
    "DELETE FROM mobile_outbox WHERE id=? AND owner_email=?",
    id,
    ownerEmail.toLowerCase(),
  );
  await refreshCounts(ownerEmail);
}
export async function initializeMobileStorage(ownerEmail?: string) {
  const db=await database();
  const info = await NetInfo.fetch();
  publish({
    online: Boolean(info.isConnected && info.isInternetReachable !== false),
  });
  await refreshCounts(ownerEmail);
  if(ownerEmail){const saved=await db.getFirstAsync<{last_synced_at:string|null;last_error:string|null}>("SELECT last_synced_at,last_error FROM mobile_sync_state WHERE owner_email=?",ownerEmail.toLowerCase());publish({lastSyncedAt:saved?.last_synced_at||undefined,lastError:saved?.last_error||undefined});}
}

export async function mobileRequest<T>(
  path: string,
  token: string,
  ownerEmail: string,
  init: RequestInit = {},
): Promise<MobileApiResult<T>> {
  const method = String(init.method || "GET").toUpperCase();
  const db = await database();
  const cacheKey = `${ownerEmail.toLowerCase()}:${path}`;
  try {
    const request = (accessToken: string) =>
      fetch(
        `${(process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:3000").replace(/\/$/, "")}${path}`,
        {
          ...init,
          cache: method === "GET" ? "no-store" : init.cache,
          headers: {
            "Content-Type": "application/json",
            ...(method === "GET" ? { "Cache-Control": "no-cache" } : {}),
            Authorization: `Bearer ${accessToken}`,
            ...(init.headers || {}),
          },
        },
      );
    let response = await request(token);
    if (response.status === 401) {
      const renewed = await refreshAccessToken();
      if (renewed) response = await request(renewed.tokens.accessToken);
    }
    const raw = await response.text();
    const body = raw ? safeJson(raw) : {};
    if (!response.ok)
      throw Object.assign(
        new Error(body?.message || `Request failed (${response.status})`),
        { httpStatus: response.status },
      );
    publish({ online: true });
    if (method === "GET")
      await db.runAsync(
        "INSERT INTO api_cache(cache_key,payload,updated_at) VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
        cacheKey,
        JSON.stringify(body),
        new Date().toISOString(),
      );
    return body as MobileApiResult<T>;
  } catch (error) {
    if (method === "GET" && offlineFailure(error)) {
      const cached = await db.getFirstAsync<{ payload: string }>(
        "SELECT payload FROM api_cache WHERE cache_key=?",
        cacheKey,
      );
      if (cached) {
        publish({ online: false });
        const cachedPayload = safeJson(cached.payload);
        const recyclingProjected = await projectPendingRecyclingChanges(ownerEmail, path, cachedPayload);
        return (await projectPendingExpenseChanges(ownerEmail, path, recyclingProjected)) as MobileApiResult<T>;
      }
    }
    if (["POST", "PUT", "PATCH"].includes(method) && offlineFailure(error)) {
      const id=uuid(),now=new Date().toISOString(),payload=String(init.body||"{}");
      const dedupeKey=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,JSON.stringify([ownerEmail.toLowerCase(),method,path,payload]));
      const duplicate=await db.getFirstAsync<{id:string}>("SELECT id FROM mobile_outbox WHERE owner_email=? AND dedupe_key=? AND status IN ('pending','syncing','failed') ORDER BY created_at DESC LIMIT 1",ownerEmail.toLowerCase(),dedupeKey);
      if(duplicate){publish({online:false});await refreshCounts(ownerEmail);return{queuedOffline:true,localId:duplicate.id}as MobileApiResult<T>}
      await db.runAsync(
        "INSERT INTO mobile_outbox(id,owner_email,method,endpoint,payload,created_at,updated_at,dedupe_key) VALUES(?,?,?,?,?,?,?,?)",
        id,
        ownerEmail.toLowerCase(),
        method,
        path,
        payload,
        now,
        now,
        dedupeKey,
      );
      publish({ online: false });
      await refreshCounts(ownerEmail);
      return { queuedOffline: true, localId: id } as MobileApiResult<T>;
    }
    throw error;
  }
}

export async function syncMobileOutbox(token: string, ownerEmail: string) {
  if (activeSync) return activeSync;
  activeSync = performSync(token, ownerEmail).finally(() => {
    activeSync = null;
  });
  return activeSync;
}

async function performSync(token: string, ownerEmail: string) {
  const db = await database();
  publish({ syncing: true });
  try {
    let activeToken = token;
    let disconnected=false;
    const rows = await db.getAllAsync<QueueRow>(
      "SELECT id,owner_email,method,endpoint,payload,attempts FROM mobile_outbox WHERE owner_email=? AND status IN ('pending','failed') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at",
      ownerEmail.toLowerCase(),
      new Date().toISOString(),
    );
    for (const row of rows) {
      await db.runAsync(
        "UPDATE mobile_outbox SET status='syncing',attempts=attempts+1,updated_at=? WHERE id=?",
        new Date().toISOString(),
        row.id,
      );
      try {
        const send = (accessToken: string) =>
          fetch(
            `${(process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:3000").replace(/\/$/, "")}${row.endpoint}`,
            {
              method: row.method,
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
                "Idempotency-Key": row.id,
                "X-KWMS-Offline": "1",
              },
              body: row.payload,
            },
          );
        let response = await send(activeToken);
        if (response.status === 401) {
          const renewed = await refreshAccessToken();
          if (renewed) {
            activeToken = renewed.tokens.accessToken;
            response = await send(activeToken);
          }
        }
        const body = await response.json().catch(() => ({}));
        if (response.status === 409) {
          await db.runAsync(
            "UPDATE mobile_outbox SET status='conflict',last_error=?,updated_at=? WHERE id=?",
            body.message || "This record conflicts with a server update",
            new Date().toISOString(),
            row.id,
          );
          continue;
        }
        if (!response.ok)
          throw Object.assign(
            new Error(body.message || `Server returned ${response.status}`),
            { httpStatus: response.status },
          );
        await db.runAsync(
          "UPDATE mobile_outbox SET status='synced',last_error=NULL,synced_at=?,updated_at=? WHERE id=?",
          new Date().toISOString(),
          new Date().toISOString(),
          row.id,
        );
      } catch (error) {
        const httpStatus = (error as { httpStatus?: number }).httpStatus;
        if (
          httpStatus &&
          httpStatus >= 400 &&
          httpStatus < 500 &&
          ![401, 408, 429].includes(httpStatus)
        ) {
          await db.runAsync(
            "UPDATE mobile_outbox SET status='conflict',last_error=?,next_attempt_at=NULL,updated_at=? WHERE id=?",
            error instanceof Error
              ? error.message
              : "The server rejected this offline change",
            new Date().toISOString(),
            row.id,
          );
          continue;
        }
        const attempts = row.attempts + 1,
          delay = Math.min(
            30 * 60_000,
            Math.max(15_000, 2 ** Math.min(attempts, 10) * 5_000),
          ),
          nextAttempt = new Date(Date.now() + delay).toISOString();
        await db.runAsync(
          "UPDATE mobile_outbox SET status='failed',last_error=?,next_attempt_at=?,updated_at=? WHERE id=?",
          error instanceof Error ? error.message : "Synchronization failed",
          nextAttempt,
          new Date().toISOString(),
          row.id,
        );
        if (networkFailure(error)) {
          publish({ online: false });
          disconnected=true;
          break;
        }
      }
    }
    if(disconnected)throw new Error("Synchronization paused because the internet connection was lost");
    const now = new Date().toISOString();
    await db.runAsync("INSERT INTO mobile_sync_state(owner_email,last_synced_at,last_error,updated_at) VALUES(?,?,NULL,?) ON CONFLICT(owner_email) DO UPDATE SET last_synced_at=excluded.last_synced_at,last_error=NULL,updated_at=excluded.updated_at",ownerEmail.toLowerCase(),now,now);
    publish({ online: true, lastSyncedAt: now, lastError: undefined });
    await refreshCounts(ownerEmail);
  } catch(error) {
    const message=error instanceof Error?error.message:"Synchronization failed",now=new Date().toISOString();
    await db.runAsync("INSERT INTO mobile_sync_state(owner_email,last_synced_at,last_error,updated_at) VALUES(?,NULL,?,?) ON CONFLICT(owner_email) DO UPDATE SET last_error=excluded.last_error,updated_at=excluded.updated_at",ownerEmail.toLowerCase(),message,now);
    publish({lastError:message});
    throw error;
  } finally {
    publish({ syncing: false });
  }
}

export function watchConnectivity(
  token: string,
  ownerEmail: string,
  onSynced?: () => void,
) {
  return NetInfo.addEventListener((info) => {
    const online = Boolean(
      info.isConnected && info.isInternetReachable !== false,
    );
    publish({ online });
    if (online)
      void syncMobileOutbox(token, ownerEmail)
        .then(() => onSynced?.())
        .catch(() => undefined);
  });
}
