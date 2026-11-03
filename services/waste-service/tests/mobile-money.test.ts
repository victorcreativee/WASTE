import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { afterEach } from "node:test";
import { decryptCredentials, encryptCredentials, hint } from "../src/billing/credentials";
import { AirtelMoneyClient, MtnMomoClient, ProviderError, SimulatedClient, clearTokenCache, networkOf, nextCheckDelaySeconds, setHttpForTests, ugandaMsisdn } from "../src/billing/mobile-money";
import { airtelAccountSchema, mtnAccountSchema, reconciliationQuerySchema } from "../src/validators/mobile-money.validator";
import { createServicePlanSchema } from "../src/validators/billing.validator";
import { tariffRateSchema } from "../src/validators/tariff.validator";

type Call = { url: string; init: RequestInit };
function fakeNetwork(answer: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  setHttpForTests(async (url, init) => {
    calls.push({ url, init });
    const { status, body } = answer({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  });
  return calls;
}
const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];
afterEach(() => { setHttpForTests(null); clearTokenCache(); });

const mtn = new MtnMomoClient("production", { apiUser: "6f1c2a6e-0b3e-4d7a-9a5c-1f2e3d4c5b6a", apiKey: "key-123456", subscriptionKey: "sub-123456" });

test("MTN: gets a token once, then asks the payer with the UGX amount and Uganda MSISDN", async () => {
  const calls = fakeNetwork(({ url }) => url.endsWith("/collection/token/") ? { status: 200, body: { access_token: "T1", expires_in: 3600 } } : { status: 202 });
  await mtn.collect({ requestId: "11111111-2222-4333-8444-555555555555", amountUgx: 30000, phone: "0772 123456", reference: "INV-2026-000001", note: "Nabugabo bill", callbackUrl: "https://api.example.com/cb" });
  await mtn.collect({ requestId: "11111111-2222-4333-8444-555555555556", amountUgx: 30000, phone: "0772123456", reference: "INV-2026-000001", note: "Nabugabo bill" });
  assert.equal(calls.filter(c => c.url.endsWith("/collection/token/")).length, 1, "the token is reused");
  const pay = calls[1];
  assert.equal(pay.url, "https://proxy.momoapi.mtn.com/collection/v1_0/requesttopay");
  assert.equal(header(pay, "X-Target-Environment"), "mtnuganda");
  assert.equal(header(pay, "X-Reference-Id"), "11111111-2222-4333-8444-555555555555");
  assert.equal(header(pay, "X-Callback-Url"), "https://api.example.com/cb");
  assert.equal(header(pay, "Authorization"), "Bearer T1");
  const body = JSON.parse(String(pay.init.body));
  assert.deepEqual([body.amount, body.currency, body.payer.partyId], ["30000", "UGX", "256772123456"]);
  assert.equal(header(calls[2], "X-Callback-Url"), undefined);
});

test("MTN: status answers map to confirmed, failed and waiting", async () => {
  let answer: unknown = { status: "SUCCESSFUL", amount: "30000", financialTransactionId: "987654" };
  fakeNetwork(({ url }) => url.endsWith("/token/") ? { status: 200, body: { access_token: "T", expires_in: 3600 } } : { status: 200, body: answer });
  assert.deepEqual(await mtn.status("x"), { state: "successful", providerStatus: "SUCCESSFUL", message: undefined, externalId: "987654", amountUgx: 30000 });
  answer = { status: "FAILED", reason: "APPROVAL_REJECTED" };
  assert.equal((await mtn.status("x")).state, "failed");
  assert.equal((await mtn.status("x")).message, "APPROVAL_REJECTED");
  answer = { status: "PENDING" };
  assert.equal((await mtn.status("x")).state, "pending");
});

test("MTN: bad credentials and refusals become readable errors", async () => {
  fakeNetwork(() => ({ status: 401, body: { message: "Access denied" } }));
  await assert.rejects(mtn.testConnection(), /rejected the API user/);
  clearTokenCache();
  fakeNetwork(({ url }) => url.endsWith("/token/") ? { status: 200, body: { access_token: "T", expires_in: 3600 } } : { status: 400, body: { code: "PAYER_NOT_FOUND", message: "Payer not found" } });
  await assert.rejects(mtn.collect({ requestId: "r", amountUgx: 1000, phone: "0772123456", reference: "INV", note: "n" }), (e: unknown) => e instanceof ProviderError && /Payer not found/.test(e.message));
});

test("MTN sandbox uses its own host, target and test currency", async () => {
  const calls = fakeNetwork(({ url }) => url.endsWith("/token/") ? { status: 200, body: { access_token: "T", expires_in: 3600 } } : { status: 202 });
  await new MtnMomoClient("sandbox", { apiUser: "6f1c2a6e-0b3e-4d7a-9a5c-1f2e3d4c5b6b", apiKey: "k", subscriptionKey: "s" })
    .collect({ requestId: "r", amountUgx: 500, phone: "0772123456", reference: "INV", note: "n" });
  assert.ok(calls[1].url.startsWith("https://sandbox.momodeveloper.mtn.com/"));
  assert.equal(header(calls[1], "X-Target-Environment"), "sandbox");
  assert.equal(JSON.parse(String(calls[1].init.body)).currency, "EUR");
});

const airtel = new AirtelMoneyClient("production", { clientId: "client-123", clientSecret: "secret-123" });

test("Airtel: sends the 9-digit number in UGX and reads TS/TF/TIP statuses", async () => {
  let status = "TS";
  const calls = fakeNetwork(({ url }) => url.endsWith("/auth/oauth2/token") ? { status: 200, body: { access_token: "A1", expires_in: "180" } }
    : url.includes("/merchant/v1/payments/") ? { status: 200, body: { data: { transaction: { id: "R1", status: "Success." } }, status: { success: true } } }
    : { status: 200, body: { data: { transaction: { id: "R1", status, airtel_money_id: "MP2610.1234", message: "done" } }, status: { success: true } } });
  await airtel.collect({ requestId: "R1", amountUgx: 30000, phone: "+256 750 123456", reference: "INV", note: "Bill" });
  const body = JSON.parse(String(calls[1].init.body));
  assert.deepEqual([body.subscriber.msisdn, body.transaction.amount, body.transaction.id, header(calls[1], "X-Country"), header(calls[1], "X-Currency")], ["750123456", 30000, "R1", "UG", "UGX"]);
  assert.deepEqual(await airtel.status("R1"), { state: "successful", providerStatus: "TS", message: "done", externalId: "MP2610.1234" });
  status = "TF"; assert.equal((await airtel.status("R1")).state, "failed");
  status = "TIP"; assert.equal((await airtel.status("R1")).state, "pending");
  status = "TA"; assert.equal((await airtel.status("R1")).state, "pending", "ambiguous answers keep waiting");
});

test("Airtel: a request the provider reports as unsuccessful is an error", async () => {
  fakeNetwork(({ url }) => url.endsWith("/token") ? { status: 200, body: { access_token: "A", expires_in: 180 } } : { status: 200, body: { status: { success: false, message: "Invalid MSISDN" } } });
  await assert.rejects(airtel.collect({ requestId: "R", amountUgx: 1, phone: "0750123456", reference: "I", note: "n" }), /Invalid MSISDN/);
});

test("an unreachable provider is a retryable error", async () => {
  setHttpForTests(async () => { throw new Error("ECONNRESET"); });
  await assert.rejects(airtel.testConnection(), (e: unknown) => e instanceof ProviderError && e.retryable);
});

test("Uganda numbers and networks", () => {
  assert.equal(ugandaMsisdn("0772 123 456"), "256772123456");
  assert.equal(ugandaMsisdn("+256-750-123456"), "256750123456");
  assert.throws(() => ugandaMsisdn("+254712345678"), /Ugandan mobile number/);
  assert.equal(networkOf("0772123456"), "mtn_momo");
  assert.equal(networkOf("0750123456"), "airtel_money");
  assert.equal(networkOf("0414123456"), null);
});

test("simulator: declines numbers ending in 0, confirms others after a few seconds", async () => {
  const sim = new SimulatedClient();
  await assert.rejects(sim.collect({ requestId: sim.newRequestId(), amountUgx: 1, phone: "0772123450", reference: "I", note: "n" }), /decline/);
  const id = sim.newRequestId();
  assert.equal((await sim.status(id)).state, "pending");
  const old = `SIM${(Date.now() - 10_000).toString(36).toUpperCase()}ABCDEF12`;
  assert.equal((await sim.status(old)).state, "successful");
});

test("status checks back off and stop after about two and a half hours", () => {
  assert.equal(nextCheckDelaySeconds(0), 10);
  assert.ok((nextCheckDelaySeconds(12) ?? 0) >= 3600);
  assert.equal(nextCheckDelaySeconds(13), null);
});

test("credentials are encrypted, tamper-evident and only readable with the key", () => {
  const key = randomBytes(32), stored = encryptCredentials({ clientId: "abc", clientSecret: "very-secret" }, key);
  assert.ok(!stored.includes("very-secret"));
  assert.deepEqual(decryptCredentials(stored, key), { clientId: "abc", clientSecret: "very-secret" });
  assert.throws(() => decryptCredentials(stored, randomBytes(32)));
  const [v, iv, tag, data] = stored.split(".");
  assert.throws(() => decryptCredentials([v, iv, tag, Buffer.from("x" + Buffer.from(data, "base64").toString("latin1"), "latin1").toString("base64")].join("."), key));
  assert.equal(hint("abcdef123456"), "…3456");
});

test("account forms require each provider's fields", () => {
  assert.ok(mtnAccountSchema.safeParse({ environment: "sandbox", credentials: { apiUser: "6f1c2a6e-0b3e-4d7a-9a5c-1f2e3d4c5b6a", apiKey: "12345678", subscriptionKey: "12345678" } }).success);
  assert.ok(!mtnAccountSchema.safeParse({ environment: "sandbox", credentials: { apiUser: "not-a-uuid", apiKey: "12345678", subscriptionKey: "12345678" } }).success);
  assert.ok(!airtelAccountSchema.safeParse({ environment: "production", credentials: { clientId: "x", clientSecret: "12345678" } }).success);
});

test("packages need a price unless they follow a KCCA band; rates and ranges are checked", () => {
  const base = { name: "Home", billingFrequency: "monthly", collectionsPerPeriod: 4, responseHours: 24 };
  assert.ok(!createServicePlanSchema.safeParse(base).success);
  assert.ok(createServicePlanSchema.safeParse({ ...base, feeUgx: 20000 }).success);
  assert.ok(createServicePlanSchema.safeParse({ ...base, tariffBandId: "77777777-0000-4000-8000-000000000001" }).success);
  assert.ok(!tariffRateSchema.safeParse({ monthlyFeeUgx: -1, effectiveFrom: "2026-11-01" }).success);
  assert.ok(!reconciliationQuerySchema.safeParse({ from: "2026-11-01", to: "2026-10-01" }).success);
  assert.ok(!reconciliationQuerySchema.safeParse({ from: "2024-01-01", to: "2026-10-01" }).success);
});
