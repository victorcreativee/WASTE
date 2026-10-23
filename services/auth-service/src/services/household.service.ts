import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcrypt";
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

// "SMS not configured" answers 409, not 503: the public proxy retries 5xx answers, which would hang the request and
// spend the household's attempts.
/**
 * Sends a one-time sign-in code. The answer never says whether the number is registered; when SMS is not
 * configured the household is told to use the link from its collection company instead.
 */
export async function requestSignInCode(phoneInput: string) {
  const phone = normalizeUgandanPhone(phoneInput);
  if (!phone) throw failure("Enter a Ugandan mobile number, for example 0772 123 456.", 400);
  if (!smsDelivers() && process.env.NODE_ENV === "production")
    throw failure("Sign-in by SMS code is not available yet. Use the link your collection company sent you.", 409);
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
    if (error instanceof SmsUnavailable) throw failure("Sign-in by SMS code is not available yet. Use the link your collection company sent you.", 409);
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

// Kampala's centre stands in for a customer who did not share their position; the company's zone replaces it on approval.
const KAMPALA_CENTRE = { latitude: 0.3476, longitude: 32.5825 };
const MAX_PHONE_MATCHES = 5;
// Compared against when no account matches, so a wrong number takes as long to answer as a wrong password.
const NO_ACCOUNT_HASH = bcrypt.hashSync(randomBytes(16).toString("hex"), 12);

export type HouseholdSignup = {
  fullName: string; phone: string; password: string;
  customerType: "residential" | "commercial" | "office_business" | "industrial";
  divisionId: string; areaId?: string; address: string; latitude?: number; longitude?: number;
  organizationId?: string; note?: string;
};

/**
 * A customer (household, office, shop) creates their own account and, optionally, asks a company that serves their
 * area to collect their waste. The account works at once; the company accepts or declines the request.
 */
export async function signUpHousehold(input: HouseholdSignup, meta: SessionMeta = {}) {
  const phone = normalizeUgandanPhone(input.phone);
  if (!phone) throw failure("Enter a Ugandan mobile number, for example 0772 123 456.", 400);
  if ((await householdsByPhone(phone)).length)
    throw failure("This number already has an account. Sign in instead, or open the link your collection company sent you.", 409);
  const precise = Number.isFinite(input.latitude) && Number.isFinite(input.longitude);
  const point = precise ? { latitude: input.latitude!, longitude: input.longitude! } : KAMPALA_CENTRE;
  const passwordHash = await bcrypt.hash(input.password, 12);
  const client = await dbPool.connect();
  let userId: string;
  try {
    await client.query("BEGIN");
    const place = (await client.query(
      `SELECT d.id FROM kampala_divisions d WHERE d.id = $1::uuid AND d.is_active
          AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM kampala_division_areas a WHERE a.id = $2::uuid AND a.division_id = d.id AND a.is_active))`,
      [input.divisionId, input.areaId ?? null]
    )).rows[0];
    if (!place) throw failure("Choose your division and an area within it.", 400);
    const user = (await client.query(
      `INSERT INTO users (organization_id, full_name, email, phone, password_hash) VALUES (NULL, $1, $2, $3, $4) RETURNING id`,
      [input.fullName, `household-${randomUUID()}@households.kampalawms.invalid`, phone, passwordHash]
    )).rows[0];
    userId = user.id;
    await client.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1::uuid, id FROM roles WHERE name = 'citizen'`, [userId]);
    const customer = (await client.query(
      `INSERT INTO customer_profiles (user_id, customer_type, service_status) VALUES ($1::uuid, $2, 'pending') RETURNING id`,
      [userId, input.customerType]
    )).rows[0];
    const location = (await client.query(
      `INSERT INTO customer_service_locations (customer_id, label, address, location, is_primary, division_id, catalog_area_id, location_precise)
       VALUES ($1::uuid, 'Primary location', $2, ST_SetSRID(ST_Point($3, $4), 4326)::geography, true, $5::uuid, $6::uuid, $7)
       RETURNING id`,
      [customer.id, input.address, point.longitude, point.latitude, input.divisionId, input.areaId ?? null, precise]
    )).rows[0];
    if (input.organizationId) {
      const serves = await client.query(
        `SELECT 1 FROM customer_service_locations l
           CROSS JOIN LATERAL recommended_collectors(l.division_id, l.catalog_area_id, l.location, l.location_precise) rc
          WHERE l.id = $1::uuid AND rc.organization_id = $2::uuid`,
        [location.id, input.organizationId]
      );
      if (!serves.rowCount) throw failure("This company does not serve your area. Choose one of the companies listed for your area.", 409);
      await client.query(
        `INSERT INTO customer_provider_requests (customer_id, service_location_id, requested_organization_id, status, customer_note, requested_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'pending_new_provider', $4, $5::uuid)`,
        [customer.id, location.id, input.organizationId, input.note ?? null, userId]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") throw failure("This number already has an account. Sign in instead.", 409);
    throw error;
  } finally {
    client.release();
  }
  const user = await householdUser(userId);
  if (!user) throw failure("Your account was created. Sign in with your phone number and password.", 409);
  return startSession(user, meta);
}

/** Signs a customer in with their phone number and password. The answer never says which of the two was wrong. */
export async function signInWithPassword(phoneInput: string, password: string, meta: SessionMeta = {}) {
  const wrong = failure("The phone number or password is not correct. If your collection company registered you, open the link it sent you and set a password there.", 401);
  const phone = normalizeUgandanPhone(phoneInput);
  if (!phone || !password) throw wrong;
  const matches = (await householdsByPhone(phone)).slice(0, MAX_PHONE_MATCHES);
  if (!matches.length) { await bcrypt.compare(password, NO_ACCOUNT_HASH); throw wrong; }
  for (const match of matches) {
    const user = await householdUser(match.id);
    if (user && await bcrypt.compare(password, user.password_hash)) return startSession(user, meta);
  }
  throw wrong;
}

/**
 * Sets the password of a signed-in household (for example one its company registered, who signed in with a link) so it
 * can also sign in with phone and password. Sessions are tied to the password, so a fresh one is returned.
 */
export async function setHouseholdPassword(userId: string, password: string, meta: SessionMeta = {}) {
  if (!await householdUser(userId)) throw failure("Only household accounts can set a password here.", 403);
  if (!(await findUserById(userId))?.phone) throw failure("Ask your collection company to add your phone number first; you sign in with it.", 409);
  await dbPool.query(`UPDATE users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`, [userId, await bcrypt.hash(password, 12)]);
  const user = await householdUser(userId);
  return startSession(user!, meta);
}
