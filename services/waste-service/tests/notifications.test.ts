import test from "node:test";
import assert from "node:assert/strict";
import { MAX_ATTEMPTS, formatMessage, isSkip, normalizePhone, retryDelayMinutes, send } from "../src/services/notification-delivery";

test("phone numbers normalise to E.164 with Uganda as the default country", () => {
  assert.equal(normalizePhone("0772346765"), "+256772346765");
  assert.equal(normalizePhone("+256 774 455 113"), "+256774455113");
  assert.equal(normalizePhone("256774455113"), "+256774455113");
  assert.equal(normalizePhone("00256774455113"), "+256774455113");
  assert.equal(normalizePhone("772346765"), "+256772346765");
  assert.equal(normalizePhone("+2568709542"), null, "too short for Uganda");
  assert.equal(normalizePhone("not a number"), null);
  assert.equal(normalizePhone("+447700900123"), "+447700900123", "other countries pass through");
});

test("retries wait longer each time and stop after five attempts", () => {
  assert.deepEqual([1, 2, 3, 4].map(retryDelayMinutes), [1, 5, 15, 60]);
  assert.equal(retryDelayMinutes(MAX_ATTEMPTS), null);
});

test("email carries a subject prefix, the body and a link; SMS fits one short message", () => {
  const n = { title: "Permit expires within 7 days", body: "Permit PERMIT-1 expires on 28 Oct 2026.", link: "/dashboard/permit" };
  const email = formatMessage("email", n, "https://wms.example");
  assert.equal(email.subject, "[KCCA WMS] Permit expires within 7 days");
  assert.match(email.text, /Open: https:\/\/wms\.example\/dashboard\/permit/);
  const sms = formatMessage("sms", { ...n, body: "x".repeat(500) }, "https://wms.example");
  assert.ok(sms.text.length <= 320, `SMS length ${sms.text.length}`);
  assert.ok(sms.text.endsWith("https://wms.example/dashboard/permit"));
});

test("switched-off channels and unusable numbers are skipped, not retried", async () => {
  process.env.NOTIFY_EMAIL_PROVIDER = "off";
  await assert.rejects(send({ channel: "email", to: "a@example.test", subject: "s", text: "t" }), error => isSkip(error));
  process.env.NOTIFY_SMS_PROVIDER = "log";
  await assert.rejects(send({ channel: "sms", to: "12", subject: "s", text: "t" }), error => isSkip(error));
  delete process.env.NOTIFY_EMAIL_PROVIDER;
  delete process.env.NOTIFY_SMS_PROVIDER;
});

test("Africa's Talking receives the normalised number and its response decides success", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; body: string; apiKey: string }> = [];
  Object.assign(process.env, { NOTIFY_SMS_PROVIDER: "africastalking", AT_USERNAME: "sandbox", AT_API_KEY: "key-1", AT_BASE_URL: "https://api.sandbox.africastalking.com" });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init.body), apiKey: (init.headers as Record<string, string>).apiKey });
    const accepted = calls.length === 1;
    return new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ status: accepted ? "Success" : "InvalidPhoneNumber", messageId: "ATXid_1" }] } }), { status: 201 });
  }) as typeof fetch;
  try {
    const result = await send({ channel: "sms", to: "0772346765", subject: "s", text: "Hello" });
    assert.deepEqual(result, { provider: "africastalking", messageId: "ATXid_1" });
    assert.equal(calls[0].url, "https://api.sandbox.africastalking.com/version1/messaging");
    assert.equal(calls[0].apiKey, "key-1");
    assert.match(calls[0].body, /to=%2B256772346765/);
    await assert.rejects(send({ channel: "sms", to: "0772346765", subject: "s", text: "Hello" }), /did not accept the message \(InvalidPhoneNumber\)/);
  } finally {
    globalThis.fetch = original;
    for (const key of ["NOTIFY_SMS_PROVIDER", "AT_USERNAME", "AT_API_KEY", "AT_BASE_URL"]) delete process.env[key];
  }
});
