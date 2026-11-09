import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { dbPool } from "../config/database";
import { revokeUserSessions } from "../repositories/session.repository";
import { appLink, sendAuthEmail } from "./email-verification.service";

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const failure = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/** A link the person asks for themselves is short-lived; one an administrator sends has to survive being passed on. */
export const SELF_SERVICE_MINUTES = 30;
export const ADMIN_SENT_HOURS = 24;

type Target = { id: string; email: string; full_name: string };

/**
 * Creates a one-time reset link for an active account, replacing any open one. Only the token's hash is stored.
 * The link is emailed; when an administrator sent it, it is also returned so it can be handed over another way.
 */
async function issueReset(target: Target, requestedBy: string | null) {
  const token = crypto.randomBytes(32).toString("base64url");
  const lifetime = requestedBy ? `${ADMIN_SENT_HOURS} hours` : `${SELF_SERVICE_MINUTES} minutes`;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`password-reset:${target.id}`]);
    await client.query("DELETE FROM password_reset_tokens WHERE user_id=$1::uuid AND consumed_at IS NULL", [target.id]);
    await client.query(`INSERT INTO password_reset_tokens(user_id,token_hash,requested_by,expires_at) VALUES($1,$2,$3,NOW()+$4::interval)`, [target.id, hash(token), requestedBy, lifetime]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  const link = appLink("/reset-password", token);
  const text = `Hello ${target.full_name},\n\n${requestedBy ? "An administrator sent you a link to set a new Kampala WMS password" : "Someone asked to reset the password for this Kampala WMS account"}:\n${link}\n\nThe link can be used once and expires in ${lifetime}. Setting a new password signs this account out everywhere else.\n\nIf you did not ask for this, ignore this email; your password stays the same.`;
  let emailed = false;
  try { emailed = await sendAuthEmail(target.email, "Reset your Kampala WMS password", text, `password reset link for ${target.email}: ${link}`); }
  catch (error) { console.error("Password reset delivery failed", error instanceof Error ? error.message : "unknown error"); }
  return { link, emailed, expiresIn: lifetime };
}

/** Self-service request. The answer never says whether the email belongs to an account. */
export async function requestPasswordReset(email: string) {
  const user = (await dbPool.query(`SELECT id,email,full_name FROM users WHERE lower(email)=lower($1) AND status='active'`, [email])).rows[0];
  if (user) await issueReset(user, null);
  return { accepted: true };
}

/**
 * An administrator sends a reset link. The platform System Admin can do this for any account; a company
 * administrator only for people in their own organization who are not themselves company administrators.
 */
export async function sendPasswordResetByAdministrator(actorId: string, userId: string) {
  // The actor's roles and company are read fresh, not taken from the sign-in token.
  const actor = (await dbPool.query(`SELECT u.id user_id,u.organization_id,ARRAY(SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id) roles
    FROM users u WHERE u.id=$1::uuid AND u.status='active'`, [actorId])).rows[0] as { user_id: string; organization_id: string | null; roles: string[] } | undefined;
  if (!actor) throw failure("Your account is unavailable", 401);
  const target = (await dbPool.query(`SELECT u.id,u.email,u.full_name,u.status,u.organization_id,
    ARRAY(SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id) roles FROM users u WHERE u.id=$1::uuid`, [userId])).rows[0];
  if (!target) throw failure("Account not found", 404);
  if (!actor.roles.includes("system_admin")) {
    const sameCompany = actor.roles.includes("company_admin") && actor.organization_id && target.organization_id === actor.organization_id;
    if (!sameCompany) throw failure("Account not found", 404);
    if (target.roles.some((role: string) => ["company_admin", "system_admin", "kcca_admin", "citizen"].includes(role))) throw failure("Only the platform administrator can reset this account's password", 403);
  }
  if (target.status !== "active") throw failure("This account is not active. Activate it before resetting its password.", 409);
  const result = await issueReset(target, actor.user_id);
  return { ...result, email: target.email, fullName: target.full_name };
}

/** Uses a reset link: sets the new password, confirms the email (the link proved it), and signs out every session. */
export async function confirmPasswordReset(token: string, password: string) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const record = (await client.query(`SELECT t.id,t.user_id,u.email,u.password_hash FROM password_reset_tokens t JOIN users u ON u.id=t.user_id
      WHERE t.token_hash=$1 AND t.consumed_at IS NULL AND t.expires_at>NOW() AND u.status='active' FOR UPDATE OF t,u`, [hash(token)])).rows[0];
    if (!record) throw failure("This reset link is invalid, already used or expired. Ask for a new one.", 400);
    if (await bcrypt.compare(password, record.password_hash)) throw failure("Choose a password different from your current one", 400);
    await client.query(`UPDATE users SET password_hash=$2,email_verified_at=COALESCE(email_verified_at,NOW()),email_verification_required=false,updated_at=NOW() WHERE id=$1::uuid`, [record.user_id, await bcrypt.hash(password, 12)]);
    await client.query(`UPDATE password_reset_tokens SET consumed_at=NOW() WHERE user_id=$1::uuid AND consumed_at IS NULL`, [record.user_id]);
    await client.query("COMMIT");
    await revokeUserSessions(record.user_id, "password_changed");
    return { email: record.email };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}
