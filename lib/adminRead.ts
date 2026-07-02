/* Vercel 어드민 과거조회 헬퍼 — 공유 Upstash Redis에서 시간별/채팅로그를 읽는다.
   인증: 소켓서버(Railway)가 발급한 세션 토큰을 같은 Redis에서 검증 → ADMIN_SECRET 불필요.
   ※ 키 문자열은 server/lib/keys.js 와 반드시 동일해야 함. */

import { getRedis } from "@/lib/redis";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isValidDate = (d: string) => DATE_RE.test(d);

const hoursKey = (date: string) => `mt:hours:${date}`;
const minKey = (date: string) => `mt:min:${date}`;
const chatLogKey = (date: string) => `mt:chatlog:${date}`;
const receiptsKey = (date: string) => `mt:receipts:${date}`;
const sessionKey = (token: string) => `mt:admin:session:${token}`;

// share: 공유하기, donate: 후원하기, brag: 자랑하기 클릭 / dwellSec: 체류시간 집계(Σ 동접×초)
export type Bucket = { visits: number; newVisitors: number; chat: number; flush: number; money: number; share: number; donate: number; brag: number; dwellSec: number };
const empty = (): Bucket => ({ visits: 0, newVisitors: 0, chat: 0, flush: 0, money: 0, share: 0, donate: 0, brag: 0, dwellSec: 0 });
const COUNTER_FIELDS: (keyof Bucket)[] = ["visits", "newVisitors", "chat", "flush", "money", "share", "donate", "brag", "dwellSec"];
const KST = 9 * 3600 * 1000;
export const ALLOWED_TICKS = [1, 3, 5, 10, 15, 30, 60, 120];
const MAX_POINTS = 3000; // 차트/테이블 과다 포인트 방지(초과 시 route에서 거절 → UI가 tick 상향)

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

/** 분단위 버킷 Map<분of하루(0~1439), 버킷+presence> — 없는 분은 읽는 쪽에서 0으로 채운다(sparse). */
type MinuteBucket = Bucket & { presence: number };
export async function readMinutes(date: string): Promise<Map<number, MinuteBucket>> {
  const map = new Map<number, MinuteBucket>();
  const r = getRedis();
  if (!r) return map;
  const raw = ((await r.hgetall(minKey(date))) || {}) as Record<string, Partial<MinuteBucket>>;
  for (const [k, v] of Object.entries(raw)) {
    const i = Number(k);
    if (i >= 0 && i < 1440 && v) map.set(i, { ...empty(), presence: 0, ...v });
  }
  return map;
}

export type SeriesPoint = Bucket & { presence: number; ts: number; label: string };
// KST 날짜(YYYY-MM-DD)의 자정에 해당하는 UTC epoch(ms)
function kstMidnightUtc(date: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, 0, 0, 0) - KST;
}
function kstDate(atUtc: number): string {
  const d = new Date(atUtc + KST);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = kstMidnightUtc(start);
  const last = kstMidnightUtc(end);
  for (let i = 0; cur <= last && i < 400; i++) { out.push(kstDate(cur)); cur += 86400_000; }
  return out;
}
/** 조회기간[start,end] KST일자를 분단위로 읽어 tick(분)으로 합산 + 빈 슬롯 0채움.
    카운터는 합, presence는 그 구간 피크(max). points 초과 시 count만 담아 반환(route가 거절). */
export async function readSeries(start: string, end: string, tickMin: number): Promise<{ ok: boolean; count: number; tick: number; points: SeriesPoint[] }> {
  const tick = ALLOWED_TICKS.includes(tickMin) ? tickMin : 15;
  const dates = datesInRange(start, end);
  const perDay = Math.ceil(1440 / tick);
  const count = dates.length * perDay;
  if (count > MAX_POINTS) return { ok: false, count, tick, points: [] };
  const multiDay = dates.length > 1;
  const points: SeriesPoint[] = [];
  for (const date of dates) {
    const map = await readMinutes(date);
    const base = kstMidnightUtc(date);
    for (let startM = 0; startM < 1440; startM += tick) {
      const p: SeriesPoint = { ...empty(), presence: 0, ts: base + startM * 60000, label: "" };
      for (let m = startM; m < startM + tick && m < 1440; m++) {
        const b = map.get(m);
        if (!b) continue;
        for (const f of COUNTER_FIELDS) p[f] += b[f] || 0;
        if ((b.presence || 0) > p.presence) p.presence = b.presence || 0;
      }
      const hh = String(Math.floor(startM / 60)).padStart(2, "0");
      const mm = String(startM % 60).padStart(2, "0");
      p.label = multiDay ? `${date.slice(5)} ${hh}:${mm}` : `${hh}:${mm}`;
      points.push(p);
    }
  }
  return { ok: true, count, tick, points };
}

export type ChatRow = { ts: number; hour: number; vid: string; nick: string; text: string };
/** 해당 날짜의 채팅로그(시간순) */
export async function readChatLog(date: string): Promise<ChatRow[]> {
  const r = getRedis();
  if (!r) return [];
  const rows = (await r.lrange(chatLogKey(date), 0, -1)) || [];
  return (rows as unknown[]).filter(Boolean) as ChatRow[];
}

export type ReceiptRow = { id: string; ts: number; n: string; t: number; f: number };
/** 해당 날짜에 생성된 자랑 URL 목록(생성순) */
export async function readReceipts(date: string): Promise<ReceiptRow[]> {
  const r = getRedis();
  if (!r) return [];
  const rows = (await r.lrange(receiptsKey(date), 0, -1)) || [];
  return (rows as unknown[]).filter(Boolean) as ReceiptRow[];
}

const RECEIPTS_TTL = 60 * 60 * 24 * 5; // receiptStore와 동일(5일)
/** 자랑 URL 수동 삭제 — 콘텐츠 키(r:<id>) 삭제(공유 링크 즉시 만료) + 어드민 날짜 리스트에서 제거. */
export async function deleteReceipt(date: string, id: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  await r.del(`r:${id}`); // 공유 페이지(/r/<id>)가 즉시 만료됨
  const key = receiptsKey(date);
  const rows = ((await r.lrange(key, 0, -1)) || []) as unknown as ReceiptRow[];
  const kept = rows.filter((x) => x && x.id !== id);
  if (kept.length !== rows.length) {
    // 리스트를 필터해 재기록(LREM은 객체 정확매칭이 취약 → del 후 재삽입).
    // 삭제는 드물고 보통 과거 날짜 대상이라 동시 saveReceipt(rpush)와의 경쟁은 사실상 없음.
    // 남은 TTL을 보존해 재기록이 만료창을 늘리지 않게 한다(-1/-2면 기본 TTL).
    const ttlMs = await r.pttl(key);
    const p = r.pipeline();
    p.del(key);
    if (kept.length) {
      p.rpush(key, ...kept);
      if (typeof ttlMs === "number" && ttlMs > 0) p.pexpire(key, ttlMs);
      else p.expire(key, RECEIPTS_TTL);
    }
    await p.exec();
  }
  return true;
}
