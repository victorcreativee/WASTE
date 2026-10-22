import { createHmac, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export function signAccessToken(payload: object) {
  return jwt.sign(payload, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn,
  });
}

/**
 * Short keyed fingerprint of the user's current password hash. Embedding it in refresh
 * tokens means any password change or administrative reset invalidates older sessions,
 * without storing sessions server-side. Reveals nothing about the password.
 */
export function credentialFingerprint(passwordHash: string) {
  return createHmac("sha256", env.jwtRefreshSecret).update(passwordHash).digest("base64url").slice(0, 22);
}

export function signRefreshToken(payload: { userId: string; sid?: string }, passwordHash?: string) {
  return jwt.sign(passwordHash ? { ...payload, pwv: credentialFingerprint(passwordHash) } : payload, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  });
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, env.jwtRefreshSecret) as { userId: string; pwv?: string; sid?: string };
}

/** Tokens issued before this release carry no fingerprint and stay valid until they expire. */
export function refreshTokenMatchesCredential(claims: { pwv?: string }, passwordHash: string) {
  if (!claims.pwv) return true;
  const expected = Buffer.from(credentialFingerprint(passwordHash));
  const actual = Buffer.from(claims.pwv);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
