import { createHash, randomBytes } from "node:crypto";

// Open API keys (migration 116). A key reads `kwms_<8-character id>_<40-character secret>`; the id is stored as it is,
// the whole key only as a SHA-256 hash, so a key cannot be shown again after it is issued.

export const API_SCOPES = ["operators:read", "tonnage:read", "certificates:read", "carbon:read", "receipts:read"] as const;
export type ApiScope = typeof API_SCOPES[number];
/** Household receipts are personal data, so a partner key cannot read them. */
export const PARTNER_SCOPES: ApiScope[] = ["operators:read", "tonnage:read", "certificates:read", "carbon:read"];

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const KEY_PATTERN = /^kwms_([a-z0-9]{8})_([A-Za-z0-9]{40})$/;

function randomText(length: number, alphabet: string) {
  let text = "";
  while (text.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // Rejection sampling keeps every character equally likely.
      if (byte < 256 - (256 % alphabet.length) && text.length < length) text += alphabet[byte % alphabet.length];
    }
  }
  return text;
}

export const hashApiKey = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

export function generateApiKey() {
  const prefix = randomText(8, "abcdefghijklmnopqrstuvwxyz0123456789");
  const key = `kwms_${prefix}_${randomText(40, ALPHABET)}`;
  return { key, prefix, hash: hashApiKey(key) };
}

/** The key's id and hash, or null when the text is not shaped like a key (no database lookup is made for those). */
export function parseApiKey(text: string | undefined) {
  const match = KEY_PATTERN.exec(text?.trim() ?? "");
  return match ? { prefix: match[1], hash: hashApiKey(match[0]) } : null;
}

// GPS tracker keys (migration 121) read `kwt_<8-character id>_<32-character secret>`. The whole key is entered as the
// tracker's device identifier, so trackers that speak the OsmAnd protocol need no other setting.
const TRACKER_KEY_PATTERN = /^kwt_([a-z0-9]{8})_([A-Za-z0-9]{32})$/;

export function generateTrackerKey() {
  const prefix = randomText(8, "abcdefghijklmnopqrstuvwxyz0123456789");
  const key = `kwt_${prefix}_${randomText(32, ALPHABET)}`;
  return { key, prefix, hash: hashApiKey(key) };
}

export function parseTrackerKey(text: string | undefined) {
  const match = TRACKER_KEY_PATTERN.exec(text?.trim() ?? "");
  return match ? { prefix: match[1], hash: hashApiKey(match[0]) } : null;
}

/** Fixed one-minute windows per key (or per address for failed attempts). Kept in memory: one waste-service runs. */
export class MinuteLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private now: () => number = Date.now) {}
  take(id: string, limit: number) {
    const now = this.now(), start = now - (now % 60_000);
    if (this.windows.size > 20_000) for (const [key, w] of this.windows) if (w.start < start) this.windows.delete(key);
    const window = this.windows.get(id);
    const current = window && window.start === start ? window : { start, count: 0 };
    current.count++;
    this.windows.set(id, current);
    return { allowed: current.count <= limit, remaining: Math.max(0, limit - current.count), resetSeconds: Math.ceil((start + 60_000 - now) / 1000) };
  }
}
