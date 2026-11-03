import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Companies' mobile money credentials are stored encrypted (AES-256-GCM) and only decrypted to call the provider.
//
//   PAYMENT_CREDENTIALS_KEY = base64 of 32 random bytes. Required in production. Losing it means every company must
//   enter its credentials again; changing it without re-entering them breaks mobile money payments.
//
// Without it (development and tests) a fixed, publicly known development key is used.

const DEV_KEY = Buffer.alloc(32, 9);

function key(): Buffer {
  const configured = process.env.PAYMENT_CREDENTIALS_KEY?.trim();
  if (!configured) return DEV_KEY;
  const bytes = Buffer.from(configured, "base64");
  if (bytes.length !== 32) throw new Error("PAYMENT_CREDENTIALS_KEY must be the base64 of exactly 32 bytes");
  return bytes;
}

export function encryptCredentials(value: object, secret: Buffer = key()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptCredentials<T>(stored: string, secret: Buffer = key()): T {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Stored credentials are not in a known format");
  const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")) as T;
}

/** Shows enough of a credential to recognise it: "…4f2a". */
export const hint = (value: string) => `…${value.trim().slice(-4)}`;
