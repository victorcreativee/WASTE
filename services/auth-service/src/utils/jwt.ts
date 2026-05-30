import jwt from "jsonwebtoken";
import { env } from "../config/env";

export function signAccessToken(payload: object) {
  return jwt.sign(payload, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn,
  });
}

export function signRefreshToken(payload: object) {
  return jwt.sign(payload, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  });
}
