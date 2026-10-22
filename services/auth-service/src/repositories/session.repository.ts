import { dbPool } from "../config/database";

// Server-side sign-in sessions (migration 096). Every function tolerates the table not existing yet, so the service
// keeps working during a rolling deployment where code ships before the migration.

const missingTable = (error: unknown) => (error as { code?: string }).code === "42P01";

export type SessionMeta = { userAgent?: string | null; ipAddress?: string | null };

/** Returns the new session id, or null when migration 096 has not been applied. */
export async function createSession(userId: string, meta: SessionMeta = {}): Promise<string | null> {
  try {
    const result = await dbPool.query(
      "INSERT INTO user_sessions(user_id,user_agent,ip_address) VALUES($1,$2,$3) RETURNING id",
      [userId, meta.userAgent?.slice(0, 300) ?? null, meta.ipAddress?.slice(0, 64) ?? null]);
    return result.rows[0].id;
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

/** True when the session exists for this user and has not been ended. Tokens without a session id are accepted. */
export async function sessionIsActive(sessionId: string | undefined, userId: string): Promise<boolean> {
  if (!sessionId) return true;
  try {
    const result = await dbPool.query("SELECT 1 FROM user_sessions WHERE id=$1::uuid AND user_id=$2::uuid AND revoked_at IS NULL", [sessionId, userId]);
    return Boolean(result.rowCount);
  } catch (error) {
    if (missingTable(error)) return true;
    if ((error as { code?: string }).code === "22P02") return false;
    throw error;
  }
}

export async function touchSession(sessionId: string) {
  await dbPool.query("UPDATE user_sessions SET last_used_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND revoked_at IS NULL", [sessionId]).catch(error => {
    if (!missingTable(error)) throw error;
  });
}

export async function revokeSession(sessionId: string, userId: string, reason: "signed_out" | "administrator" = "signed_out") {
  try {
    const result = await dbPool.query(
      "UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP,revoked_reason=$3 WHERE id=$1::uuid AND user_id=$2::uuid AND revoked_at IS NULL",
      [sessionId, userId, reason]);
    return result.rowCount ?? 0;
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}

/** Ends every open session of the user, optionally keeping one (the session that made the change). */
export async function revokeUserSessions(userId: string, reason: "signed_out_everywhere" | "password_changed" | "administrator", keepSessionId?: string) {
  try {
    const result = await dbPool.query(
      `UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP,revoked_reason=$2
       WHERE user_id=$1::uuid AND revoked_at IS NULL AND ($3::uuid IS NULL OR id<>$3::uuid)`,
      [userId, reason, keepSessionId ?? null]);
    await dbPool.query("SELECT prune_user_sessions()").catch(() => undefined);
    return result.rowCount ?? 0;
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}
