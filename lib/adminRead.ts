/* Vercel 어드민 과거조회 헬퍼 — 공유 Upstash Redis에서 시간별/채팅로그를 읽는다.
   인증: 소켓서버(Railway)가 발급한 세션 토큰을 같은 Redis에서 검증 → ADMIN_SECRET 불필요.
   ※ 키 문자열은 server/lib/keys.js 와 반드시 동일해야 함. */

import { getRedis } from "@/lib/redis";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isValidDate = (d: string) => DATE_RE.test(d);

const hoursKey = (date: string) => `mt:hours:${date}`;
const chatLogKey = (date: string) => `mt:chatlog:${date}`;
const sessionKey = (token: string) => `mt:admin:session:${token}`;

export type Bucket = { visits: number; newVisitors: number; chat: number; flush: number; money: number };
const empty = (): Bucket => ({ visits: 0, newVisitors: 0, chat: 0, flush: 0, money: 0 });

function bearer(req: Request): string {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

/** 어드민 세션 토큰 검증(공유 Redis). */
export async function isAdminToken(req: Request): Promise<boolean> {
  const token = bearer(req);
  if (!token) return false;
  const r = getRedis();
  if (!r) return false;
  return (await r.exists(sessionKey(token))) === 1;
}

/** 해당 날짜의 24시간 버킷 배열 */
export async function readHours(date: string): Promise<Bucket[]> {
  const r = getRedis();
  const arr = Array.from({ length: 24 }, empty);
  if (!r) return arr;
  const raw = ((await r.hgetall(hoursKey(date))) || {}) as Record<string, Partial<Bucket>>;
  for (const [k, v] of Object.entries(raw)) {
    const i = Number(k);
    if (i >= 0 && i < 24 && v) arr[i] = { ...empty(), ...v };
  }
  return arr;
}

export type ChatRow = { ts: number; hour: number; vid: string; nick: string; text: string };
/** 해당 날짜의 채팅로그(시간순) */
export async function readChatLog(date: string): Promise<ChatRow[]> {
  const r = getRedis();
  if (!r) return [];
  const rows = (await r.lrange(chatLogKey(date), 0, -1)) || [];
  return (rows as unknown[]).filter(Boolean) as ChatRow[];
}
