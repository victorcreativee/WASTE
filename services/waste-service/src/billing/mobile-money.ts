import { randomBytes, randomUUID } from "node:crypto";
import { normalizePhone } from "../services/notification-delivery";

// MTN MoMo (Collection API) and Airtel Money (Collections API) clients. Each company connects its own accounts, so the
// money goes straight to the company; the platform never holds it. A provider's answer to "what happened to this
// request" is the only thing that confirms a payment: callbacks just prompt us to ask.
//
//   MOBILE_MONEY_SIMULATOR=on  (not in production) lets companies without a connected account take simulated
//   payments: approved after a few seconds, or declined when the phone number ends in 0. For demos and tests.

export type Provider = "mtn_momo" | "airtel_money";
export type Environment = "sandbox" | "production";
export type MtnCredentials = { apiUser: string; apiKey: string; subscriptionKey: string };
export type AirtelCredentials = { clientId: string; clientSecret: string };
export type Account = { provider: Provider; environment: Environment; credentials: MtnCredentials | AirtelCredentials };

export type CollectRequest = { requestId: string; amountUgx: number; phone: string; reference: string; note: string; callbackUrl?: string };
export type ProviderState = "pending" | "successful" | "failed";
export type StatusResult = { state: ProviderState; providerStatus: string; message?: string; amountUgx?: number; externalId?: string };

export interface MobileMoneyClient {
  readonly provider: Provider | "simulator";
  newRequestId(): string;
  collect(request: CollectRequest): Promise<void>;
  status(requestId: string): Promise<StatusResult>;
  testConnection(): Promise<void>;
}

/** A provider refused or could not be reached. `message` is safe to show to the company or household. */
export class ProviderError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

type Http = (url: string, init: RequestInit) => Promise<Response>;
let http: Http = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
/** Tests replace the network. */
export function setHttpForTests(fake: Http | null) { http = fake ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })); }

async function call(url: string, init: RequestInit, label: string) {
  let response: Response;
  try { response = await http(url, init); }
  catch { throw new ProviderError(`${label} could not be reached. Try again shortly.`, true); }
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 300) }; }
  return { status: response.status, body };
}

const tokens = new Map<string, { token: string; expiresAt: number }>();
async function cachedToken(cacheKey: string, fetchToken: () => Promise<{ token: string; expiresIn: number }>) {
  const cached = tokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const fresh = await fetchToken();
  tokens.set(cacheKey, { token: fresh.token, expiresAt: Date.now() + fresh.expiresIn * 1000 });
  return fresh.token;
}
export const clearTokenCache = () => tokens.clear();

/** Uganda numbers as each provider wants them: MTN "2567XXXXXXXX", Airtel "7XXXXXXXX". */
export function ugandaMsisdn(raw: string): string {
  const e164 = normalizePhone(raw);
  if (!e164 || !e164.startsWith("+256")) throw new ProviderError("Enter a Ugandan mobile number, for example 0772 123456");
  return e164.slice(1);
}

/** The network a Ugandan number belongs to by its prefix, or null when unknown. Numbers can be ported, so this only warns. */
export function networkOf(raw: string): Provider | null {
  const e164 = normalizePhone(raw);
  if (!e164?.startsWith("+256")) return null;
  const prefix = e164.slice(4, 6);
  if (["76", "77", "78", "79", "39", "31"].includes(prefix)) return "mtn_momo";
  if (["70", "74", "75", "20"].includes(prefix)) return "airtel_money";
  return null;
}

// ---------- MTN MoMo ----------

const MTN = {
  sandbox: { base: "https://sandbox.momodeveloper.mtn.com", target: "sandbox", currency: "EUR" },
  production: { base: "https://proxy.momoapi.mtn.com", target: "mtnuganda", currency: "UGX" },
};

export class MtnMomoClient implements MobileMoneyClient {
  readonly provider = "mtn_momo" as const;
  constructor(private readonly environment: Environment, private readonly credentials: MtnCredentials) {}
  private get config() { return MTN[this.environment]; }
  newRequestId() { return randomUUID(); }

  private async token() {
    const { apiUser, apiKey, subscriptionKey } = this.credentials;
    return cachedToken(`mtn:${this.environment}:${apiUser}`, async () => {
      const { status, body } = await call(`${this.config.base}/collection/token/`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${apiUser}:${apiKey}`).toString("base64")}`, "Ocp-Apim-Subscription-Key": subscriptionKey },
      }, "MTN MoMo");
      if (status === 401 || status === 403) throw new ProviderError("MTN MoMo rejected the API user, API key or subscription key");
      if (status !== 200 || !body?.access_token) throw new ProviderError(`MTN MoMo did not issue an access token (${status})`, status >= 500);
      return { token: body.access_token as string, expiresIn: Number(body.expires_in) || 3600 };
    });
  }

  private async headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${await this.token()}`, "X-Target-Environment": this.config.target, "Ocp-Apim-Subscription-Key": this.credentials.subscriptionKey, ...extra };
  }

  async collect(request: CollectRequest) {
    const { status, body } = await call(`${this.config.base}/collection/v1_0/requesttopay`, {
      method: "POST",
      headers: await this.headers({ "X-Reference-Id": request.requestId, "Content-Type": "application/json", ...(request.callbackUrl ? { "X-Callback-Url": request.callbackUrl } : {}) }),
      body: JSON.stringify({
        amount: String(request.amountUgx), currency: this.config.currency, externalId: request.reference,
        payer: { partyIdType: "MSISDN", partyId: ugandaMsisdn(request.phone) },
        payerMessage: request.note.slice(0, 160), payeeNote: request.reference.slice(0, 160),
      }),
    }, "MTN MoMo");
    if (status === 202) return;
    if (status === 409) throw new ProviderError("MTN MoMo already has this payment request");
    const reason = body?.message || body?.code || `status ${status}`;
    throw new ProviderError(`MTN MoMo declined the payment request: ${reason}`, status >= 500);
  }

  async status(requestId: string): Promise<StatusResult> {
    const { status, body } = await call(`${this.config.base}/collection/v1_0/requesttopay/${encodeURIComponent(requestId)}`, { method: "GET", headers: await this.headers() }, "MTN MoMo");
    if (status === 404) return { state: "pending", providerStatus: "NOT_FOUND", message: "MTN MoMo does not know this request yet" };
    if (status !== 200) throw new ProviderError(`MTN MoMo status check failed (${status})`, true);
    const providerStatus = String(body?.status || "UNKNOWN").toUpperCase();
    const reason = typeof body?.reason === "string" ? body.reason : body?.reason?.message || body?.reason?.code;
    return {
      state: providerStatus === "SUCCESSFUL" ? "successful" : providerStatus === "FAILED" || providerStatus === "REJECTED" || providerStatus === "TIMEOUT" ? "failed" : "pending",
      providerStatus, message: reason, externalId: body?.financialTransactionId || undefined,
      amountUgx: body?.amount !== undefined && this.config.currency === "UGX" ? Number(body.amount) : undefined,
    };
  }

  async testConnection() { tokens.delete(`mtn:${this.environment}:${this.credentials.apiUser}`); await this.token(); }
}

// ---------- Airtel Money ----------

const AIRTEL = { sandbox: "https://openapiuat.airtel.africa", production: "https://openapi.airtel.africa" };
const AIRTEL_SUCCESS = new Set(["TS"]), AIRTEL_FAILED = new Set(["TF", "TE", "TR"]);

export class AirtelMoneyClient implements MobileMoneyClient {
  readonly provider = "airtel_money" as const;
  constructor(private readonly environment: Environment, private readonly credentials: AirtelCredentials) {}
  private get base() { return AIRTEL[this.environment]; }
  newRequestId() { return randomBytes(10).toString("hex").toUpperCase(); }

  private async token() {
    const { clientId, clientSecret } = this.credentials;
    return cachedToken(`airtel:${this.environment}:${clientId}`, async () => {
      const { status, body } = await call(`${this.base}/auth/oauth2/token`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "*/*" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
      }, "Airtel Money");
      if (status === 400 || status === 401 || status === 403) throw new ProviderError("Airtel Money rejected the client ID or client secret");
      if (status !== 200 || !body?.access_token) throw new ProviderError(`Airtel Money did not issue an access token (${status})`, status >= 500);
      return { token: body.access_token as string, expiresIn: Number(body.expires_in) || 180 };
    });
  }

  private async headers() {
    return { Authorization: `Bearer ${await this.token()}`, "X-Country": "UG", "X-Currency": "UGX", "Content-Type": "application/json", Accept: "*/*" };
  }

  async collect(request: CollectRequest) {
    const msisdn = ugandaMsisdn(request.phone).slice(3);
    const { status, body } = await call(`${this.base}/merchant/v1/payments/`, {
      method: "POST", headers: await this.headers(),
      body: JSON.stringify({
        reference: request.note.slice(0, 64),
        subscriber: { country: "UG", currency: "UGX", msisdn },
        transaction: { amount: request.amountUgx, country: "UG", currency: "UGX", id: request.requestId },
      }),
    }, "Airtel Money");
    if (status === 200 && body?.status?.success !== false) return;
    const reason = body?.status?.message || body?.error_description || `status ${status}`;
    throw new ProviderError(`Airtel Money declined the payment request: ${reason}`, status >= 500);
  }

  async status(requestId: string): Promise<StatusResult> {
    const { status, body } = await call(`${this.base}/standard/v1/payments/${encodeURIComponent(requestId)}`, { method: "GET", headers: await this.headers() }, "Airtel Money");
    if (status !== 200) throw new ProviderError(`Airtel Money status check failed (${status})`, true);
    const transaction = body?.data?.transaction ?? {};
    const providerStatus = String(transaction.status || "UNKNOWN").toUpperCase();
    return {
      state: AIRTEL_SUCCESS.has(providerStatus) ? "successful" : AIRTEL_FAILED.has(providerStatus) ? "failed" : "pending",
      providerStatus, message: transaction.message || body?.status?.message, externalId: transaction.airtel_money_id || undefined,
    };
  }

  async testConnection() { tokens.delete(`airtel:${this.environment}:${this.credentials.clientId}`); await this.token(); }
}

// ---------- Simulator ----------

/** Request ids carry when they started and whether they will be declined, so the simulator needs no storage. */
export class SimulatedClient implements MobileMoneyClient {
  readonly provider = "simulator" as const;
  newRequestId() { return `SIM${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString("hex").toUpperCase()}`; }
  async collect(request: CollectRequest) {
    ugandaMsisdn(request.phone);
    if (/0$/.test(request.phone.replace(/\D/g, ""))) throw new ProviderError("The simulated payer declined (numbers ending in 0 always decline)");
  }
  async status(requestId: string): Promise<StatusResult> {
    const started = parseInt(requestId.slice(3, -8), 36);
    if (!Number.isFinite(started) || Date.now() - started < 4000) return { state: "pending", providerStatus: "PENDING" };
    return { state: "successful", providerStatus: "SUCCESSFUL", externalId: `SIMTX${requestId.slice(-8)}` };
  }
  async testConnection() {}
}

export const simulatorEnabled = () => process.env.MOBILE_MONEY_SIMULATOR === "on" && process.env.NODE_ENV !== "production";

export function clientFor(account: Account): MobileMoneyClient {
  return account.provider === "mtn_momo"
    ? new MtnMomoClient(account.environment, account.credentials as MtnCredentials)
    : new AirtelMoneyClient(account.environment, account.credentials as AirtelCredentials);
}

/** When to ask the provider next: often at first (payers approve within a minute or two), then less often. */
export function nextCheckDelaySeconds(attempts: number): number | null {
  const schedule = [10, 10, 15, 20, 30, 30, 60, 60, 120, 300, 600, 1800, 3600];
  return attempts < schedule.length ? schedule[attempts] : null;
}
