import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_ACCESS_SECRET = "a".repeat(48);
process.env.JWT_REFRESH_SECRET = "b".repeat(48);

import {assertEmailVerified} from "../src/services/auth.service";

test("existing and verified accounts remain eligible for sessions",()=>{
 assert.doesNotThrow(()=>assertEmailVerified({email_verification_required:false,email_verified_at:null}));
 assert.doesNotThrow(()=>assertEmailVerified({email_verification_required:true,email_verified_at:new Date()}));
});

test("a new unverified account cannot initialize an online or offline session",()=>{
 assert.throws(
  ()=>assertEmailVerified({email_verification_required:true,email_verified_at:null}),
  (error:unknown)=>error instanceof Error&&error.message.includes("Verify your email")&&(error as Error&{statusCode?:number}).statusCode===403,
 );
});
