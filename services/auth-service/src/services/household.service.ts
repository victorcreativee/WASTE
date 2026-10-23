import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { dbPool } from "../config/database";
import { findUserById } from "../repositories/auth.repository";
import { SessionMeta } from "../repositories/session.repository";
import { normalizeUgandanPhone, sendSms, smsDelivers, SmsUnavailable } from "../utils/sms";
import { startSession } from "./auth.service";

const CODE_TTL_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const failure = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/** The household account behind a link or phone number: an active citizen with a customer profile. */
async function householdUser(userId: string) {
  const user = await findUserById(userId);
  if (!user || user.status !== "active") return null;
  const isHousehold = await dbPool.query(
    `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1::uuid AND r.name = 'citizen'
        AND EXISTS (SELECT 1 FROM customer_profiles cp WHERE cp.user_id = $1::uuid)`,
    [userId]
  );
  return isHousehold.rowCount ? user : null;
}

/** Signs a household in from the private link its collection company shared. */
export async function signInWithLink(token: string, meta: SessionMeta = {}) {
  const link = (await dbPool.query(
    `UPDATE household_access_links SET last_used_at = CURRENT_TIMESTAMP
      WHERE token_hash = $1 AND revoked_at IS NULL RETURNING user_id`,
    [sha256(token)]
  )).rows[0];
  const user = link ? await householdUser(link.user_id) : null;
  if (!user) throw failure("This link no longer works. Ask your collection company for a new one.", 401);
  return startSession(user, meta);
}

/** Households whose phone matches, compared by the last nine digits so any common way of typing it works. */
async function householdsByPhone(phone: string) {
  return (await dbPool.query(
    `SELECT u.id FROM users u
      JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.name = 'citizen'
      JOIN customer_profiles cp ON cp.user_id = u.id
     WHERE u.status = 'active' AND u.phone IS NOT NULL
       AND RIGHT(regexp_replace(u.phone, '\\D', '', 'g'), 9) = RIGHT($1, 9)`,
    [phone]
  )).rows as { id: string }[];
}

/**
 * Sends a one-time sign-in code. The answer never says whether the number is registered; when SMS is not
 * configured the household is told to use the link from its collection company instead.
 */
export async function requestSignInCode(phoneInput: string) {
  const phone = normalizeUgandanPhone(phoneInput);
  if (!phone) throw failure("Enter a Ugandan mobile number, for example 0772 123 456.", 400);
  if (!smsDelivers() && process.env.NODE_ENV === "production")
    throw failure("Sign-in by SMS code is not available yet. Use the link your collection company sent you.", 503);
  const matches = await householdsByPhone(phone);
  // Shared numbers cannot tell households apart; those households use their personal links.
  if (matches.length !== 1) return { sent: true };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await dbPool.query(
    `INSERT INTO household_login_codes(user_id, code_hash, expires_at)
     VALUES ($1::uuid, $2, CURRENT_TIMESTAMP + make_interval(mins => $3))`,
    [matches[0].id, sha256(`${matches[0].id}:${code}`), CODE_TTL_MINUTES]
  );
  try {
    await sendSms(phone, `${code} is your Kampala WMS sign-in code. It expires in ${CODE_TTL_MINUTES} minutes. Do not share it.`);
  } catch (error) {
    if (error instanceof SmsUnavailable) throw failure("Sign-in by SMS code is not available yet. Use the link your collection company sent you.", 503);
    throw error;
  }
  return { sent: true };
}

/** Checks a one-time code. Each code works once, expires after ten minutes and allows five tries. */
export async function signInWithCode(phoneInput: string, code: string, meta: SessionMeta = {}) {
  const phone = normalizeUgandanPhone(phoneInput);
  const wrong = failure("That code is not correct or has expired. Request a new code.", 401);
  if (!phone || !/^\d{6}$/.test(code)) throw wrong;
  const matches = await householdsByPhone(phone);
  if (matches.length !== 1) throw wrong;
  const userId = matches[0].id;
  const latest = (await dbPool.query(
    `SELECT id, code_hash, attempts FROM household_login_codes
      WHERE user_id = $1::uuid AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC LIMIT 1`,
    [userId]
  )).rows[0] as { id: string; code_hash: string; attempts: number } | undefined;
  if (!latest || latest.attempts >= CODE_MAX_ATTEMPTS) throw wrong;
  const expected = Buffer.from(latest.code_hash, "hex"), given = Buffer.from(sha256(`${userId}:${code}`), "hex");
  if (!timingSafeEqual(expected, given)) {
    await dbPool.query(`UPDATE household_login_codes SET attempts = attempts + 1 WHERE id = $1::uuid`, [latest.id]);
    throw wrong;
  }
  const consumed = await dbPool.query(
    `UPDATE household_login_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1::uuid AND consumed_at IS NULL`,
    [latest.id]
  );
  if (!consumed.rowCount) throw wrong;
  const user = await householdUser(userId);
  if (!user) throw wrong;
  return startSession(user, meta);
}

/**
 * Creates a new private link for one of the company's households and retires the old one. Returns the secret once;
 * only its hash is kept, so a lost link is replaced rather than recovered.
 */
export async function createHouseholdLink(organizationId: string, customerId: string, actorId: string) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const customer = (await client.query(
      `SELECT cp.id, cp.user_id, u.full_name, u.phone FROM customer_profiles cp
         JOIN users u ON u.id = cp.user_id
        WHERE cp.id = $1::uuid AND u.status = 'active'
          AND EXISTS (SELECT 1 FROM customer_service_relationships r
                       WHERE r.customer_id = cp.id AND r.organization_id = $2::uuid AND r.status IN ('active','suspended'))
        FOR UPDATE OF cp`,
      [customerId, organizationId]
    )).rows[0];
    if (!customer) throw failure("This household is not served by your company.", 404);
    await client.query(
      `UPDATE household_access_links SET revoked_at = CURRENT_TIMESTAMP WHERE customer_id = $1::uuid AND revoked_at IS NULL`,
      [customerId]
    );
    const token = randomBytes(24).toString("base64url");
    await client.query(
      `INSERT INTO household_access_links(organization_id, customer_id, user_id, token_hash, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid)`,
      [organizationId, customerId, customer.user_id, sha256(token), actorId]
    );
    await client.query(
      `INSERT INTO organization_audit_events(organization_id, actor_id, action, entity_type, entity_id, new_value)
       VALUES ($1::uuid, $2::uuid, 'household_link_created', 'customer', $3::uuid, '{}'::jsonb)`,
      [organizationId, actorId, customerId]
    );
    await client.query("COMMIT");
    return { token, path: `/my?k=${token}`, householdName: customer.full_name, phone: customer.phone as string | null, smsAvailable: smsDelivers() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
