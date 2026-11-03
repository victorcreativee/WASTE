import { requireActiveOrganization } from "./organization-access.service";
import bcrypt from "bcrypt";
import { LoginInput, RegisterInput } from "../validators/auth.validator";
import {
  createOrganizationApplicant,
  createUser,
  findUserByEmail,
  updateLastLogin,
  updatePasswordHash,
} from "../repositories/auth.repository";
import type { OrganizationApplicantRegisterInput } from "../validators/auth.validator";
import { refreshTokenMatchesCredential, signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { SessionMeta, createSession, revokeSession, revokeUserSessions, sessionIsActive, touchSession } from "../repositories/session.repository";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

/** Session id claim, present when migration 096 is applied. */
const sidClaim = (sid: string | null) => (sid ? { sid } : {});
import { randomBytes } from "node:crypto";
import {
  assignRoleToUser,
  findRoleByName,
  getUserRoles,
  getUserPermissions,
} from "../repositories/role.repository";
import { findUserById } from "../repositories/auth.repository";
import { issueEmailVerification } from "./email-verification.service";

function sanitizeUser(user: {
  id: string;
  organization_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  status: string;
  created_at: Date;
  email_verified_at: Date | null;
  email_verification_required: boolean;
}) {
  return {
    id: user.id,
    organizationId: user.organization_id,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    status: user.status,
    createdAt: user.created_at,
    emailVerified: !user.email_verification_required || Boolean(user.email_verified_at),
    emailVerificationRequired: user.email_verification_required,
  };
}

export function assertEmailVerified(user: {email_verified_at: Date | null; email_verification_required: boolean}) {
  if (user.email_verification_required && !user.email_verified_at) {
    throw Object.assign(new Error("Verify your email before signing in. Request a new verification email if the link expired."), { statusCode: 403, code: "EMAIL_VERIFICATION_REQUIRED" });
  }
}

export async function registerUser(input: RegisterInput, meta: SessionMeta = {}) {
  const existingUser = await findUserByEmail(input.email);

  if (existingUser) {
    const error = new Error("Email is already registered");
    (error as any).statusCode = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(input.password, 12);

  // Public self-registration never links an account to an organization; tenant
  // membership is granted only by organization administrators.
  const user = await createUser({
    organizationId: undefined,
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    passwordHash,
  });
  const defaultRole = await findRoleByName("citizen");

  if (defaultRole) {
    await assignRoleToUser(user.id, defaultRole.id);
  }
  const verification = await issueEmailVerification(user.id);

  return {
    user: sanitizeUser(user),
    verificationRequired: true,
    verificationEmailSent: verification.sent,
  };
}

export async function registerOrganizationApplicant(input:OrganizationApplicantRegisterInput,_meta:SessionMeta={}){
  const passwordHash=await bcrypt.hash(input.password,12);
  const user=await createOrganizationApplicant(input,passwordHash);
  const verification=await issueEmailVerification(user.id);
  return {user:sanitizeUser(user),roles:[{name:"organization_applicant"}],permissions:[],verificationRequired:true,verificationEmailSent:verification.sent};
}

let timingHash: Promise<string> | null = null;
/** Hash compared when the email is unknown, so response time does not reveal which emails exist. */
function timingEqualizerHash() {
  timingHash ??= bcrypt.hash(randomBytes(16).toString("hex"), 12);
  return timingHash;
}

export async function loginUser(input: LoginInput, meta: SessionMeta = {}) {
  const user = await findUserByEmail(input.email);
  const passwordMatches = await bcrypt.compare(
    input.password,
    user?.password_hash ?? (await timingEqualizerHash())
  );

  // Account status is only revealed after the correct password, to avoid account enumeration.
  if (!user || !passwordMatches) {
    const error = new Error("Invalid email or password");
    (error as any).statusCode = 401;
    throw error;
  }

  if (user.status !== "active") {
    const error = new Error("User account is not active");
    (error as any).statusCode = 403;
    throw error;
  }
  assertEmailVerified(user);

  return startSession(user, meta);
}

type SessionUser = Parameters<typeof sanitizeUser>[0] & { password_hash: string };

/** Opens a session for an account that has already proved who it is (password, household link or one-time code). */
export async function startSession(user: SessionUser, meta: SessionMeta = {}) {
  assertEmailVerified(user);
  const roles = await getUserRoles(user.id);
  await requireActiveOrganization(user.organization_id, roles, user.id);
  await updateLastLogin(user.id);
  const permissions = await getUserPermissions(user.id);

  const sid = await createSession(user.id, meta);
  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    organizationId: user.organization_id,
    roles: roles.map((role) => role.name),
    ...sidClaim(sid),
  });

  const refreshToken = signRefreshToken({ userId: user.id, ...sidClaim(sid) }, user.password_hash);

  return {
    user: sanitizeUser(user),
    roles,
    permissions,
    tokens: {
      accessToken,
      refreshToken,
    },
  };
}
export async function getCurrentUser(userId: string) {
  const user = await findUserById(userId);

  if (!user || user.status !== "active") {
    const error = new Error("User account is unavailable");
    (error as any).statusCode = 404;
    throw error;
  }
  assertEmailVerified(user);

  const roles = await getUserRoles(user.id);
  await requireActiveOrganization(user.organization_id, roles, user.id);
  const permissions = await getUserPermissions(user.id);

  return {
    user: sanitizeUser(user),
    roles,
    permissions,
  };
}
export async function changeUserPassword(userId:string,currentPassword:string,newPassword:string,keepSessionId?:string){const user=await findUserById(userId);if(!user||user.status!=="active")throw Object.assign(new Error("User account is unavailable"),{statusCode:404});if(!(await bcrypt.compare(currentPassword,user.password_hash)))throw Object.assign(new Error("Current password is incorrect"),{statusCode:401});if(await bcrypt.compare(newPassword,user.password_hash))throw Object.assign(new Error("Choose a password different from the current password"),{statusCode:400});await updatePasswordHash(userId,await bcrypt.hash(newPassword,12));await revokeUserSessions(userId,"password_changed",keepSessionId);}

export async function refreshUserSession(refreshToken:string,meta:SessionMeta={}){
  const invalid=()=>Object.assign(new Error("Refresh token is invalid or expired"),{statusCode:401});
  let payload:{userId:string;pwv?:string;sid?:string};
  try{payload=verifyRefreshToken(refreshToken)}catch{throw invalid()}
  // A password change or administrative reset ends sessions that were opened with the old password.
  const account=await findUserById(payload.userId);
  if(!account)throw invalid();
  if(!refreshTokenMatchesCredential(payload,account.password_hash)){const error=new Error("Your password was changed. Sign in again.");(error as any).statusCode=401;throw error}
  // Signed-out sessions cannot be refreshed. Tokens from before sessions existed join a new session.
  if(payload.sid&&!(await sessionIsActive(payload.sid,payload.userId)))throw Object.assign(new Error("This session has ended. Sign in again."),{statusCode:401});
  const sid=payload.sid||await createSession(payload.userId,meta);
  if(payload.sid)await touchSession(payload.sid);
  const current=await getCurrentUser(payload.userId),roles=current.roles;
  return{...current,tokens:{accessToken:signAccessToken({userId:current.user.id,email:current.user.email,organizationId:current.user.organizationId,roles:roles.map(role=>role.name),...sidClaim(sid)}),refreshToken:signRefreshToken({userId:current.user.id,...sidClaim(sid)},account.password_hash)}};
}

/**
 * Ends the caller's session (or all of them). Identifies the session from the access token when it is still valid,
 * otherwise from the refresh token, so signing out works even after the access token has expired. Always succeeds:
 * signing out an unknown or already-ended session is not an error.
 */
export async function logoutSession(input:{accessToken?:string;refreshToken?:string;everywhere?:boolean}){
  let claims:{userId?:string;sid?:string}|null=null;
  if(input.accessToken){try{claims=jwt.verify(input.accessToken,env.jwtAccessSecret) as {userId?:string;sid?:string}}catch{claims=null}}
  if(!claims?.userId&&input.refreshToken){try{claims=verifyRefreshToken(input.refreshToken)}catch{claims=null}}
  if(!claims?.userId)return{ended:0};
  if(input.everywhere)return{ended:await revokeUserSessions(claims.userId,"signed_out_everywhere")};
  return{ended:claims.sid?await revokeSession(claims.sid,claims.userId):0};
}
