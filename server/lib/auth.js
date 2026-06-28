/* 어드민 인증 — 서버 비밀(ADMIN_SECRET) + Bearer 토큰(크로스오리진이라 쿠키 대신).
   · 비번은 SHA-256 해시 후 timingSafeEqual(상수시간, 길이 불일치 throw 방지).
   · 로그인 5회 실패 시 IP당 15분 잠금(원시 IP 저장 안 함, 해시만). */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getRedis } from "./redis.js";
import { ak, TTL, LOGIN_MAX_FAILS } from "./keys.js";

function sha256(s) {
  return createHash("sha256").update(String(s), "utf8").digest();
}

export function passwordMatches(input) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  try {
    return timingSafeEqual(sha256(input), sha256(secret));
  } catch {
    return false;
  }
}

export async function createSession() {
  const r = getRedis();
  if (!r) return null;
  const token = randomBytes(24).toString("hex");
  await r.set(ak.session(token), 1, { ex: TTL.adminSession });
  return token;
}

export async function destroySession(token) {
  const r = getRedis();
  if (!r || !token) return;
  await r.del(ak.session(token));
}

export async function isValidSession(token) {
  const r = getRedis();
  if (!r || !token) return false;
  return (await r.exists(ak.session(token))) === 1;
}

/* ---------- 로그인 무차별 대입 잠금 ---------- */
function ipHashKey(ip) {
  const salt = process.env.ADMIN_SECRET ?? "";
  return createHash("sha256").update(ip + salt, "utf8").digest("hex").slice(0, 24);
}

export async function isLoginLocked(ip) {
  const r = getRedis();
  if (!r) return false;
  const n = await r.get(ak.loginFail(ipHashKey(ip)));
  return (n ?? 0) >= LOGIN_MAX_FAILS;
}

export async function recordLoginFail(ip) {
  const r = getRedis();
  if (!r) return;
  const key = ak.loginFail(ipHashKey(ip));
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, TTL.loginLock);
}

export async function clearLoginFail(ip) {
  const r = getRedis();
  if (!r) return;
  await r.del(ak.loginFail(ipHashKey(ip)));
}

/** Authorization: Bearer <token> 추출 */
export function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}
