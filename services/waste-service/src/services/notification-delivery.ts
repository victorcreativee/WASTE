import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { env } from "../config/env";

// Email and SMS delivery for notifications. Providers are chosen by environment so the same code runs in development
// (log), with any HTTP integration (webhook), or in production (SMTP email, Africa's Talking SMS).
//
//   NOTIFY_EMAIL_PROVIDER = log | webhook | smtp | off      (default log)
//   NOTIFY_SMS_PROVIDER   = log | webhook | africastalking | off   (default log)
//   NOTIFY_WEBHOOK_URL, NOTIFY_WEBHOOK_SECRET (HMAC-SHA256 of the body, sent as X-WMS-Signature)
//   SMTP_URL (smtp[s]://user:pass@host:port), NOTIFY_EMAIL_FROM
//   AT_USERNAME, AT_API_KEY, AT_SENDER_ID (optional), AT_BASE_URL (sandbox: https://api.sandbox.africastalking.com)

export type Channel = "email" | "sms";
export type OutgoingMessage = { channel: Channel; to: string; subject: string; text: string };
export type SendResult = { provider: string; messageId?: string };

/** Delivery stops after this many attempts; the waits between attempts grow. */
export const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60];

export function retryDelayMinutes(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
}

/** Normalises phone numbers to E.164, assuming Uganda (+256) for local formats. Returns null when not a usable number. */
export function normalizePhone(raw: string, countryCode = "256"): string | null {
  let digits = String(raw || "").replace(/[\s().-]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (/^0\d{9}$/.test(digits)) digits = `+${countryCode}${digits.slice(1)}`;
  if (/^\d{9}$/.test(digits) && countryCode === "256") digits = `+256${digits}`;
  if (!digits.startsWith("+")) digits = `+${digits}`;
  if (!/^\+[1-9]\d{8,14}$/.test(digits)) return null;
  if (digits.startsWith("+256") && digits.length !== 13) return null;
  return digits;
}

export function formatMessage(channel: Channel, n: { title: string; body: string; link: string | null }, appUrl = env.publicAppUrl): Pick<OutgoingMessage, "subject" | "text"> {
  const url = n.link ? `${appUrl}${n.link}` : appUrl;
  if (channel === "sms") {
    const text = `KCCA WMS: ${n.title}. ${n.body}`;
    const room = 306 - url.length;
    return { subject: n.title, text: `${text.length > room ? `${text.slice(0, room - 1)}…` : text} ${url}` };
  }
  return {
    subject: `[KCCA WMS] ${n.title}`,
    text: `${n.title}\n\n${n.body}\n\nOpen: ${url}\n\nYou receive this because of your role in Kampala WMS. Change which notifications reach you by email or SMS under Notifications in the app.`,
  };
}

class SkipDelivery extends Error {}
export const isSkip = (error: unknown) => error instanceof SkipDelivery;

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

async function sendWebhook(message: OutgoingMessage): Promise<SendResult> {
  if (!process.env.NOTIFY_WEBHOOK_URL) throw new SkipDelivery("NOTIFY_WEBHOOK_URL is not set");
  const body = JSON.stringify(message);
  const signature = process.env.NOTIFY_WEBHOOK_SECRET ? createHmac("sha256", process.env.NOTIFY_WEBHOOK_SECRET).update(body).digest("hex") : "";
  const response = await fetch(process.env.NOTIFY_WEBHOOK_URL, {
    method: "POST", headers: { "Content-Type": "application/json", ...(signature ? { "X-WMS-Signature": signature } : {}) }, body, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Webhook answered ${response.status}`);
  return { provider: "webhook", messageId: response.headers.get("x-message-id") ?? undefined };
}

async function sendSmtp(message: OutgoingMessage): Promise<SendResult> {
  if (!process.env.SMTP_URL) throw new SkipDelivery("SMTP_URL is not set");
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  const info = await transport.sendMail({ from: process.env.NOTIFY_EMAIL_FROM || "Kampala WMS <no-reply@localhost>", to: message.to, subject: message.subject, text: message.text });
  return { provider: "smtp", messageId: info.messageId };
}

async function sendAfricasTalking(message: OutgoingMessage): Promise<SendResult> {
  const { AT_USERNAME, AT_API_KEY } = process.env;
  if (!AT_USERNAME || !AT_API_KEY) throw new SkipDelivery("AT_USERNAME and AT_API_KEY are not set");
  const form = new URLSearchParams({ username: AT_USERNAME, to: message.to, message: message.text });
  if (process.env.AT_SENDER_ID) form.set("from", process.env.AT_SENDER_ID);
  const response = await fetch(`${(process.env.AT_BASE_URL || "https://api.africastalking.com").replace(/\/$/, "")}/version1/messaging`, {
    method: "POST", headers: { apiKey: AT_API_KEY, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Africa's Talking answered ${response.status}`);
  const result = await response.json() as { SMSMessageData?: { Recipients?: Array<{ status: string; messageId?: string; statusCode?: number }> } };
  const recipient = result.SMSMessageData?.Recipients?.[0];
  if (!recipient || !["Success", "Sent", "Queued"].includes(recipient.status)) throw new Error(`Africa's Talking did not accept the message (${recipient?.status ?? "no recipient"})`);
  return { provider: "africastalking", messageId: recipient.messageId };
}

/** Sends one message through the configured provider. Throws a skip error when the channel is switched off or unconfigured. */
export async function send(message: OutgoingMessage): Promise<SendResult> {
  const provider = (message.channel === "email" ? process.env.NOTIFY_EMAIL_PROVIDER : process.env.NOTIFY_SMS_PROVIDER) || "log";
  if (message.channel === "sms") {
    const to = normalizePhone(message.to);
    if (!to) throw new SkipDelivery(`"${message.to}" is not a usable phone number`);
    message = { ...message, to };
  }
  switch (provider) {
    case "off": throw new SkipDelivery(`${message.channel} delivery is switched off`);
    case "log":
      console.log(JSON.stringify({ time: new Date().toISOString(), service: "waste-service", notification: message.channel, to: message.to, subject: message.subject }));
      return { provider: "log" };
    case "webhook": return sendWebhook(message);
    case "smtp": if (message.channel === "email") return sendSmtp(message); break;
    case "africastalking": if (message.channel === "sms") return sendAfricasTalking(message); break;
  }
  throw new SkipDelivery(`Provider "${provider}" cannot send ${message.channel}`);
}
