import bcrypt from "bcrypt";
import { LoginInput, RegisterInput } from "../validators/auth.validator";
import {
  createUser,
  findUserByEmail,
  updateLastLogin,
} from "../repositories/auth.repository";
import { signAccessToken, signRefreshToken } from "../utils/jwt";
import {
  assignRoleToUser,
  findRoleByName,
  getUserRoles,
  getUserPermissions,
} from "../repositories/role.repository";
import { findUserById } from "../repositories/auth.repository";

function sanitizeUser(user: {
  id: string;
  organization_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  status: string;
  created_at: Date;
}) {
  return {
    id: user.id,
    organizationId: user.organization_id,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    status: user.status,
    createdAt: user.created_at,
  };
}

export async function registerUser(input: RegisterInput) {
  const existingUser = await findUserByEmail(input.email);

  if (existingUser) {
    const error = new Error("Email is already registered");
    (error as any).statusCode = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await createUser({
    organizationId: input.organizationId,
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    passwordHash,
  });
  const defaultRole = await findRoleByName("citizen");

  if (defaultRole) {
    await assignRoleToUser(user.id, defaultRole.id);
  }
  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    organizationId: user.organization_id,
  });

  const refreshToken = signRefreshToken({
    userId: user.id,
  });

  return {
    user: sanitizeUser(user),
    tokens: {
      accessToken,
      refreshToken,
    },
  };
}

export async function loginUser(input: LoginInput) {
  const user = await findUserByEmail(input.email);

  if (!user) {
    const error = new Error("Invalid email or password");
    (error as any).statusCode = 401;
    throw error;
  }

  if (user.status !== "active") {
    const error = new Error("User account is not active");
    (error as any).statusCode = 403;
    throw error;
  }

  const passwordMatches = await bcrypt.compare(
    input.password,
    user.password_hash
  );

  if (!passwordMatches) {
    const error = new Error("Invalid email or password");
    (error as any).statusCode = 401;
    throw error;
  }

  await updateLastLogin(user.id);

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    organizationId: user.organization_id,
  });

  const refreshToken = signRefreshToken({
    userId: user.id,
  });

  return {
    user: sanitizeUser(user),
    tokens: {
      accessToken,
      refreshToken,
    },
  };
}
export async function getCurrentUser(userId: string) {
  const user = await findUserById(userId);

  if (!user) {
    const error = new Error("User not found");
    (error as any).statusCode = 404;
    throw error;
  }

  const roles = await getUserRoles(user.id);
  const permissions = await getUserPermissions(user.id);

  return {
    user: sanitizeUser(user),
    roles,
    permissions,
  };
}
