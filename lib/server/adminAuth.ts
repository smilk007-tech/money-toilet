/* ===================================================================
   어드민 인증 — 서버 비밀(ADMIN_SECRET) 기반.
   · 비번은 절대 클라에서 비교하지 않는다(서버 라우트에서만).
   · timingSafeEqual은 길이 다르면 throw → 양쪽 SHA-256 해시(고정 32B)로 비교.
   · 통과 시 랜덤 토큰을 Redis에 저장하고 HttpOnly 쿠키로 발급, 매 요청 재검증.
   =================================================================== */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getRedis } from "@/lib/redis";
import { ak, TTL, LOGIN_MAX_FAILS } from "@/lib/server/keys";

export const ADMIN_COOKIE = "mt_admin";

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/* ---------- 로그인 무차별 대입 차단 (IP당 N회 실패 → 잠금) ---------- */
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
// 원시 IP는 저장하지 않는다 — ADMIN_SECRET을 솔트로 한 해시만 키로 사용(15분 후 소멸).
function ipHash(req: Request): string {
  const salt = process.env.ADMIN_SECRET ?? "";
  return createHash("sha256")
    .update(clientIp(req) + salt, "utf8")
    .digest("hex")
    .slice(0, 24);
}

/** 잠금 상태면 true. (실패 카운트가 한도 이상) */
export async function isLoginLocked(req: Request): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  const n = await r.get<number>(ak.loginFail(ipHash(req)));
  return (n ?? 0) >= LOGIN_MAX_FAILS;
}

export async function recordLoginFail(req: Request): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const key = ak.loginFail(ipHash(req));
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, TTL.loginLock); // 첫 실패부터 15분 창
}

export async function clearLoginFail(req: Request): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.del(ak.loginFail(ipHash(req)));
}

/** 입력 비번이 ADMIN_SECRET과 일치하는지(상수시간). 미설정 시 항상 거부. */
export function passwordMatches(input: string): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  try {
    return timingSafeEqual(sha256(input), sha256(secret));
  } catch {
    return false;
  }
}

export async function createSession(): Promise<string | null> {
  const r = getRedis();
  if (!r) return null;
  const token = randomBytes(24).toString("hex");
  await r.set(ak.session(token), 1, { ex: TTL.adminSession });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  const r = getRedis();
  if (!r || !token) return;
  await r.del(ak.session(token));
}

function readCookie(req: Request, name: string): string {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

/** 요청의 어드민 쿠키 토큰이 Redis에서 유효한지 검증. */
export async function isAdmin(req: Request): Promise<boolean> {
  const token = readCookie(req, ADMIN_COOKIE);
  if (!token) return false;
  const r = getRedis();
  if (!r) return false;
  return (await r.exists(ak.session(token))) === 1;
}

export function getAdminToken(req: Request): string {
  return readCookie(req, ADMIN_COOKIE);
}
