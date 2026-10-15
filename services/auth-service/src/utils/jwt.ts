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

export function verifyRefreshToken(token:string){
  return jwt.verify(token,env.jwtRefreshSecret) as{userId:string};
}
