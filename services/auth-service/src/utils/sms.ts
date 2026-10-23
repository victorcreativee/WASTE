// SMS for household sign-in codes. Uses the same settings as the waste service's notifications, so one Africa's
// Talking account serves both:
//   NOTIFY_SMS_PROVIDER = log | africastalking | off   (default log)
//   AT_USERNAME, AT_API_KEY, AT_SENDER_ID (optional), AT_BASE_URL (sandbox: https://api.sandbox.africastalking.com)

export class SmsUnavailable extends Error {}

/** +2567XXXXXXXX for a Ugandan mobile number typed as 07…, 7…, 256… or +256…; null when it is not one. */
export function normalizeUgandanPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const local = digits.startsWith("256") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^7\d{8}$/.test(local) ? `+256${local}` : null;
}

/** Whether a real SMS can be sent. "log" only prints, which is useful in development but delivers nothing. */
export function smsDelivers() {
  return (process.env.NOTIFY_SMS_PROVIDER || "log") === "africastalking" && Boolean(process.env.AT_USERNAME && process.env.AT_API_KEY);
}

export async function sendSms(to: string, text: string) {
  const provider = process.env.NOTIFY_SMS_PROVIDER || "log";
  if (provider === "off") throw new SmsUnavailable("SMS delivery is switched off");
  if (provider === "log") {
    // The message itself is printed only outside production, so sign-in codes never reach production logs.
    const shown = process.env.NODE_ENV === "production" ? "[hidden]" : text;
    console.log(JSON.stringify({ time: new Date().toISOString(), service: "auth-service", sms: to, text: shown }));
    if (process.env.NODE_ENV === "production") throw new SmsUnavailable("SMS delivery is not configured");
    return;
  }
  if (provider !== "africastalking") throw new SmsUnavailable(`SMS provider "${provider}" is not supported`);
  const { AT_USERNAME, AT_API_KEY } = process.env;
  if (!AT_USERNAME || !AT_API_KEY) throw new SmsUnavailable("AT_USERNAME and AT_API_KEY are not set");
  const form = new URLSearchParams({ username: AT_USERNAME, to, message: text });
  if (process.env.AT_SENDER_ID) form.set("from", process.env.AT_SENDER_ID);
  const response = await fetch(`${(process.env.AT_BASE_URL || "https://api.africastalking.com").replace(/\/$/, "")}/version1/messaging`, {
    method: "POST",
    headers: { apiKey: AT_API_KEY, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Africa's Talking answered ${response.status}`);
  const result = await response.json() as { SMSMessageData?: { Recipients?: Array<{ status: string }> } };
  const status = result.SMSMessageData?.Recipients?.[0]?.status;
  if (!status || !["Success", "Sent", "Queued"].includes(status)) throw new Error(`Africa's Talking did not accept the message (${status ?? "no recipient"})`);
}
