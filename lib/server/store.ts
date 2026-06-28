/* ===================================================================
   서버 코어 로직 — Upstash Redis read/write 한 곳에 집약.
   라우트 핸들러는 이 모듈을 얇게 호출만 한다.
   읽기/쓰기 분리 원칙:
     · 캐시되는 GET /api/snapshot → 오직 읽기 (이 파일의 getSnapshot)
     · 방문자/presence/카운터 쓰기 → POST(beacon/chat/flush)에서만
   =================================================================== */

import { getRedis } from "@/lib/redis";
import { maxSessionEarnCap } from "@/lib/constants";
import {
  K,
  dk,
  vk,
  ak,
  TTL,
  DEFAULTS,
  kstDateKey,
  last7DateKeys,
  type AdminConfig,
} from "@/lib/server/keys";

export type ChatKind = "chat" | "flush" | "system";
export type ChatRow = {
  id: number;
  vid: string;
  nick: string;
  text: string;
  kind: ChatKind;
  ts: number;
};

const FLUSH_CAP = maxSessionEarnCap(); // 1회 물내림 최대 적립 상한
const MAX_NICK = 16;

/* ---------- 설정 로드 (DEFAULTS + mt:admincfg 덮어쓰기) ---------- */
export async function loadConfig(): Promise<AdminConfig> {
  const r = getRedis();
  if (!r) return { ...DEFAULTS };
  const raw = (await r.hgetall(K.adminCfg)) as Record<string, unknown> | null;
  if (!raw) return { ...DEFAULTS };
  const merged: AdminConfig = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof AdminConfig)[]) {
    if (raw[key] === undefined || raw[key] === null) continue;
    const def = DEFAULTS[key];
    const v = raw[key];
    if (typeof def === "boolean")
      (merged[key] as boolean) = v === true || v === "true" || v === 1;
    else if (typeof def === "number") (merged[key] as number) = Number(v);
  }
  return merged;
}

/* ---------- 닉네임/텍스트 위생 ---------- */
function clean(s: unknown, max: number): string {
  return String(s ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "") // 제어문자 제거
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/* ====================== 읽기 (snapshot — 캐시됨, 쓰기 금지) ====================== */
export async function getSnapshot(cfg: AdminConfig) {
  const r = getRedis();
  const serverNow = Date.now();
  if (!r) {
    return {
      presence: 0,
      global: 0,
      chats: [] as ChatRow[],
      cursor: 0,
      pollMs: cfg.pollMs,
      serverNow,
    };
  }
  const [global, cursor, rawChats, presence] = await Promise.all([
    r.get<number>(K.global),
    r.get<number>(K.chatSeq),
    r.lrange(K.chats, 0, cfg.chatSampleK - 1),
    r.zcount(K.presenceZ, serverNow - cfg.presenceWindowMs, "+inf"),
  ]);
  const chats = (rawChats as unknown as ChatRow[]).filter(Boolean);
  return {
    presence: presence ?? 0,
    global: global ?? 0,
    chats, // 최신순(LPUSH). 클라가 id>lastSeen로 diff.
    cursor: cursor ?? 0,
    pollMs: cfg.pollMs,
    serverNow,
  };
}

/* ====================== 어뷰징 게이트 ====================== */
export async function isBanned(vid: string): Promise<boolean> {
  const r = getRedis();
  if (!r || !vid) return false;
  return (await r.exists(vk.ban(vid))) === 1;
}

/** 10초 윈도 레이트리밋. 초과 시 자동 차단(EX) 후 tripped=true. */
async function passRate(vid: string, cfg: AdminConfig): Promise<boolean> {
  const r = getRedis();
  if (!r || !vid) return true;
  const bucket = Math.floor(Date.now() / (TTL.rateWindow * 1000));
  const key = vk.rate(vid, bucket);
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, TTL.rateWindow);
  if (n > cfg.rateLimitN) {
    // 소켓 우회 도배 추정 — 조용히 자동 차단(사용자는 모름)
    await r.set(vk.ban(vid), 1, { ex: cfg.autoBlockSec });
    return false;
  }
  return true;
}

/* ====================== 쓰기: 방문자/presence (beacon/chat/flush) ====================== */
export async function recordPresence(vid: string, nick?: string) {
  const r = getRedis();
  if (!r || !vid) return;
  const now = Date.now();
  const today = kstDateKey(now);
  const p = r.pipeline();
  p.zadd(K.presenceZ, { score: now, member: vid });
  p.zremrangebyscore(K.presenceZ, 0, now - DEFAULTS.presenceMaxAgeMs);
  p.expire(K.presenceZ, TTL.presenceZday);
  p.pfadd(K.uvAll, vid);
  p.pfadd(dk.uv(today), vid);
  p.expire(dk.uv(today), TTL.dayBucket);
  const cleanNick = clean(nick, MAX_NICK);
  if (cleanNick) p.set(vk.nick(vid), cleanNick, { ex: TTL.nick });
  await p.exec();
}

/* ====================== 쓰기: 채팅 ====================== */
export type ChatResult =
  | { ok: true; id: number; shadow: false }
  | { ok: true; id: null; shadow: true }; // 섀도밴/차단 — 클라엔 정상처럼

export async function postChat(
  vid: string,
  nick: string,
  text: string,
  cfg: AdminConfig,
): Promise<ChatResult> {
  const r = getRedis();
  const cleanText = clean(text, cfg.maxMsgLen);
  if (!r || !vid || !cleanText) return { ok: true, id: null, shadow: true };
  if (cfg.chatDisabled) return { ok: true, id: null, shadow: true }; // 킬스위치
  // 밴/레이트 → 섀도밴(아무것도 저장/카운트 안 함, 200 정상 응답)
  if (await isBanned(vid)) return { ok: true, id: null, shadow: true };
  if (!(await passRate(vid, cfg))) return { ok: true, id: null, shadow: true };

  const cleanNick = clean(nick, MAX_NICK) || "익명의 볼일러";
  const now = Date.now();
  const today = kstDateKey(now);
  const id = await r.incr(K.chatSeq);
  const row: ChatRow = { id, vid, nick: cleanNick, text: cleanText, kind: "chat", ts: now };
  const adminRow = { ...row, warnCount: await r.get<number>(vk.warn(vid)).then((n) => n ?? 0) };

  const p = r.pipeline();
  p.lpush(K.chats, row);
  p.ltrim(K.chats, 0, cfg.displayBufferMax - 1);
  p.expire(K.chats, TTL.chats);
  p.lpush(K.adminChats, adminRow);
  p.ltrim(K.adminChats, 0, cfg.adminLogMax - 1);
  p.expire(K.adminChats, TTL.adminChats);
  p.incr(K.chatAll);
  p.incr(dk.chat(today));
  p.expire(dk.chat(today), TTL.dayBucket);
  p.set(vk.nick(vid), cleanNick, { ex: TTL.nick });
  await p.exec();
  // 활성 유저는 presence/방문자에도 반영(중복은 HLL/ZSET이 흡수)
  await recordPresence(vid);
  return { ok: true, id, shadow: false };
}

/* ====================== 쓰기: 물내림 ====================== */
export type FlushResult = { ok: true; total: number; shadow: boolean };

export async function postFlush(
  vid: string,
  nick: string,
  amount: number,
  broadcast: boolean,
  text: string | null,
  cfg: AdminConfig,
): Promise<FlushResult> {
  const r = getRedis();
  if (!r) return { ok: true, total: 0, shadow: true };
  const amt = Math.floor(Number(amount) || 0);
  // 서버측 절대 클램프 — 소켓 조작 INCRBY 그리핑 방지
  if (amt < 1 || amt > FLUSH_CAP)
    return { ok: true, total: (await r.get<number>(K.global)) ?? 0, shadow: true };
  // 밴/레이트/킬스위치 → 글로벌 안 올림, 현재값만 반환(클라 낙관값은 monotonic 유지)
  if (
    cfg.chatDisabled ||
    (await isBanned(vid)) ||
    !(await passRate(vid, cfg))
  ) {
    return { ok: true, total: (await r.get<number>(K.global)) ?? 0, shadow: true };
  }

  const now = Date.now();
  const today = kstDateKey(now);
  const cleanNick = clean(nick, MAX_NICK) || "익명의 볼일러";
  const p = r.pipeline();
  p.incrby(K.global, amt);
  p.incrby(dk.money(today), amt);
  p.expire(dk.money(today), TTL.dayBucket);
  const res = await p.exec();
  const total = Number((res as unknown[])[0]) || 0;

  // 자랑 채팅 동봉(broadcast) — flush kind 행으로 버퍼에 추가
  if (broadcast) {
    const id = await r.incr(K.chatSeq);
    const brag = clean(text, cfg.maxMsgLen);
    const row: ChatRow = { id, vid, nick: cleanNick, text: brag, kind: "flush", ts: now };
    const fp = r.pipeline();
    fp.lpush(K.chats, { ...row, amount: amt });
    fp.ltrim(K.chats, 0, cfg.displayBufferMax - 1);
    fp.expire(K.chats, TTL.chats);
    fp.lpush(K.adminChats, { ...row, amount: amt, warnCount: 0 });
    fp.ltrim(K.adminChats, 0, cfg.adminLogMax - 1);
    fp.expire(K.adminChats, TTL.adminChats);
    await fp.exec();
  }
  await recordPresence(vid, cleanNick);
  return { ok: true, total, shadow: false };
}

/* ====================== 어드민: 통계 ====================== */
export async function getStats() {
  const r = getRedis();
  if (!r) return null;
  const now = Date.now();
  const today = kstDateKey(now);
  const week = last7DateKeys(now);

  const [allUv, allChat, allMoney, presence] = await Promise.all([
    r.pfcount(K.uvAll),
    r.get<number>(K.chatAll),
    r.get<number>(K.global),
    r.zcount(K.presenceZ, now - DEFAULTS.presenceWindowMs, "+inf"),
  ]);

  // 오늘
  const [todayUv, todayChat, todayMoney] = await Promise.all([
    r.pfcount(dk.uv(today)),
    r.get<number>(dk.chat(today)),
    r.get<number>(dk.money(today)),
  ]);

  // 주간 — 방문자는 PFMERGE(중복 제거), 채팅/돈은 합산
  const tmp = `mt:uv:_wk:${now}`;
  await r.pfmerge(tmp, ...week.map(dk.uv));
  const weekUv = await r.pfcount(tmp);
  await r.expire(tmp, 120);
  const weekChats = await r.mget<(number | null)[]>(...week.map(dk.chat));
  const weekMoneys = await r.mget<(number | null)[]>(...week.map(dk.money));
  const sum = (arr: (number | null)[]) =>
    arr.reduce<number>((s, v) => s + (Number(v) || 0), 0);

  return {
    presence: presence ?? 0,
    allTime: { visitors: allUv ?? 0, chats: allChat ?? 0, money: allMoney ?? 0 },
    today: {
      visitors: todayUv ?? 0,
      chats: todayChat ?? 0,
      money: todayMoney ?? 0,
    },
    week: { visitors: weekUv ?? 0, chats: sum(weekChats), money: sum(weekMoneys) },
    serverNow: now,
  };
}

/* ====================== 어드민: 7일 채팅 로그 ====================== */
export async function getAdminChats(offset = 0, limit = 100) {
  const r = getRedis();
  if (!r) return [];
  const rows = await r.lrange(K.adminChats, offset, offset + limit - 1);
  return (rows as unknown[]).filter(Boolean);
}

/* ====================== 어드민: 밴/경고 ====================== */
const DURATION_SEC: Record<string, number | null> = {
  "1d": 86400,
  "3d": 3 * 86400,
  "7d": 7 * 86400,
  "30d": 30 * 86400,
  perm: null, // 영구
};

export async function banVid(vid: string, duration: string) {
  const r = getRedis();
  if (!r || !vid) return false;
  const sec = DURATION_SEC[duration];
  if (sec === undefined) return false;
  const score = sec === null ? "+inf" : Date.now() + sec * 1000;
  const p = r.pipeline();
  if (sec === null) p.set(vk.ban(vid), 1);
  else p.set(vk.ban(vid), 1, { ex: sec });
  p.zadd(K.bansIndex, { score: score as number, member: vid });
  await p.exec();
  return true;
}

export async function unbanVid(vid: string) {
  const r = getRedis();
  if (!r || !vid) return false;
  await Promise.all([r.del(vk.ban(vid)), r.zrem(K.bansIndex, vid)]);
  return true;
}

export async function warnVid(vid: string) {
  const r = getRedis();
  if (!r || !vid) return 0;
  const n = await r.incr(vk.warn(vid));
  if (n === 1) await r.expire(vk.warn(vid), TTL.warn);
  await r.zadd(K.warnedIndex, { score: n, member: vid });
  return n;
}

async function withNicks<T extends { vid: string }>(r: ReturnType<typeof getRedis>, rows: T[]) {
  if (!r || rows.length === 0) return rows.map((x) => ({ ...x, nick: "" }));
  const nicks = await r.mget<(string | null)[]>(...rows.map((x) => vk.nick(x.vid)));
  return rows.map((x, i) => ({ ...x, nick: nicks[i] ?? "" }));
}

export async function listBans() {
  const r = getRedis();
  if (!r) return [];
  const now = Date.now();
  // [member, score, member, score, ...]
  const raw = (await r.zrange(K.bansIndex, 0, -1, { withScores: true })) as (
    | string
    | number
  )[];
  const rows: { vid: string; expiry: number | null }[] = [];
  const stale: string[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const vid = String(raw[i]);
    const score = Number(raw[i + 1]);
    const perm = !isFinite(score);
    if (!perm && score < now) {
      stale.push(vid); // TTL로 이미 풀린 항목 — 인덱스에서 정리
      continue;
    }
    rows.push({ vid, expiry: perm ? null : score });
  }
  if (stale.length) await r.zrem(K.bansIndex, ...stale);
  return withNicks(r, rows);
}

export async function listWarned(limit = 100) {
  const r = getRedis();
  if (!r) return [];
  const raw = (await r.zrange(K.warnedIndex, 0, limit - 1, {
    rev: true,
    withScores: true,
  })) as (string | number)[];
  const rows: { vid: string; warnCount: number }[] = [];
  for (let i = 0; i < raw.length; i += 2)
    rows.push({ vid: String(raw[i]), warnCount: Number(raw[i + 1]) });
  return withNicks(r, rows);
}

/* ====================== 어드민: 채팅 비우기 / 서버 초기화 ====================== */
export async function clearChats() {
  const r = getRedis();
  if (!r) return;
  await r.del(K.chats, K.adminChats);
}

/** 서버 초기화 — scope에 따라 선택 초기화 */
export async function resetServer(scope: "global" | "stats" | "all") {
  const r = getRedis();
  if (!r) return;
  if (scope === "global" || scope === "all") await r.del(K.global);
  if (scope === "stats" || scope === "all") {
    // 누적 통계 + 최근 7일 버킷 + 채팅 버퍼
    const week = last7DateKeys();
    await r.del(
      K.uvAll,
      K.chatAll,
      ...week.map(dk.uv),
      ...week.map(dk.chat),
      ...week.map(dk.money),
    );
  }
  if (scope === "all") await r.del(K.chats, K.adminChats, K.warnedIndex);
}

export async function setConfig(patch: Record<string, unknown>) {
  const r = getRedis();
  if (!r) return;
  const allowed: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULTS) as (keyof AdminConfig)[]) {
    if (patch[key] === undefined) continue;
    const def = DEFAULTS[key];
    if (typeof def === "boolean") allowed[key] = Boolean(patch[key]);
    else if (typeof def === "number") allowed[key] = Number(patch[key]);
  }
  if (Object.keys(allowed).length) await r.hset(K.adminCfg, allowed);
}

export async function broadcast(text: string, cfg: AdminConfig) {
  const r = getRedis();
  if (!r) return;
  const msg = clean(text, 120);
  if (!msg) return;
  const id = await r.incr(K.chatSeq);
  const row: ChatRow = {
    id,
    vid: "system",
    nick: "공지",
    text: msg,
    kind: "system",
    ts: Date.now(),
  };
  const p = r.pipeline();
  p.lpush(K.chats, row);
  p.ltrim(K.chats, 0, cfg.displayBufferMax - 1);
  p.expire(K.chats, TTL.chats);
  await p.exec();
}
