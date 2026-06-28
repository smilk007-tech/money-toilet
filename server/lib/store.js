/* 영속 스토어 — Upstash Redis 쓰기/읽기 (이벤트 기반, 폴링 없음).
   실시간 흐름·presence·ban캐시·rate는 index.js의 메모리에서 처리.
   여기는 "사건 발생 시 영속 기록 + 어드민 조회"만 담당. */

import { getRedis } from "./redis.js";
import { K, dk, vk, TTL, DEFAULTS, DURATION_SEC, kstDateKey, last7DateKeys } from "./keys.js";

const MAX_NICK = 16;

export function clean(s, max) {
  return String(s ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function loadConfig() {
  const r = getRedis();
  if (!r) return { ...DEFAULTS };
  const raw = await r.hgetall(K.adminCfg);
  if (!raw) return { ...DEFAULTS };
  const merged = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (raw[key] === undefined || raw[key] === null) continue;
    const def = DEFAULTS[key];
    if (typeof def === "boolean")
      merged[key] = raw[key] === true || raw[key] === "true" || raw[key] === 1;
    else if (typeof def === "number") merged[key] = Number(raw[key]);
  }
  return merged;
}

export async function setConfig(patch) {
  const r = getRedis();
  if (!r) return;
  const allowed = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (patch[key] === undefined) continue;
    const def = DEFAULTS[key];
    if (typeof def === "boolean") allowed[key] = Boolean(patch[key]);
    else if (typeof def === "number") allowed[key] = Number(patch[key]);
  }
  if (Object.keys(allowed).length) await r.hset(K.adminCfg, allowed);
}

/* ---------- 부팅 시 메모리 복원 ---------- */
export async function loadGlobal() {
  const r = getRedis();
  if (!r) return 0;
  return (await r.get(K.global)) ?? 0;
}

export async function loadActiveBans() {
  const r = getRedis();
  if (!r) return [];
  const now = Date.now();
  const raw = await r.zrange(K.bansIndex, 0, -1, { withScores: true });
  const out = [];
  const stale = [];
  for (let i = 0; i < raw.length; i += 2) {
    const vid = String(raw[i]);
    const score = Number(raw[i + 1]);
    const perm = !isFinite(score);
    if (!perm && score < now) {
      stale.push(vid);
      continue;
    }
    out.push({ vid, expiry: perm ? Infinity : score });
  }
  if (stale.length) await r.zrem(K.bansIndex, ...stale);
  return out;
}

/* ---------- 이벤트 영속 ---------- */
export async function recordVisitor(vid, nick) {
  const r = getRedis();
  if (!r || !vid) return;
  const today = kstDateKey();
  const p = r.pipeline();
  p.pfadd(K.uvAll, vid);
  p.pfadd(dk.uv(today), vid);
  p.expire(dk.uv(today), TTL.dayBucket);
  const cn = clean(nick, MAX_NICK);
  if (cn) p.set(vk.nick(vid), cn, { ex: TTL.nick });
  await p.exec();
}

/** 수락된 채팅을 어드민 로그·카운터에 기록 (row: {id,vid,nick,text,kind,ts,amount?,warnCount?}) */
export async function recordChatDurable(row, cfg) {
  const r = getRedis();
  if (!r) return;
  const today = kstDateKey();
  const p = r.pipeline();
  p.lpush(K.adminChats, row);
  p.ltrim(K.adminChats, 0, cfg.adminLogMax - 1);
  p.expire(K.adminChats, TTL.adminChats);
  if (row.kind === "chat") {
    p.incr(K.chatAll);
    p.incr(dk.chat(today));
    p.expire(dk.chat(today), TTL.dayBucket);
  }
  if (row.nick) p.set(vk.nick(row.vid), clean(row.nick, MAX_NICK), { ex: TTL.nick });
  await p.exec();
}

/** 물내림 누적 — Redis INCRBY 후 새 total 반환 */
export async function recordFlushDurable(amount) {
  const r = getRedis();
  if (!r) return null;
  const today = kstDateKey();
  const p = r.pipeline();
  p.incrby(K.global, amount);
  p.incrby(dk.money(today), amount);
  p.expire(dk.money(today), TTL.dayBucket);
  const res = await p.exec();
  return Number(res[0]) || 0;
}

export async function getWarnCount(vid) {
  const r = getRedis();
  if (!r || !vid) return 0;
  return (await r.get(vk.warn(vid))) ?? 0;
}

/* ---------- 어드민 조회 ---------- */
export async function getStats(presence) {
  const r = getRedis();
  if (!r) return null;
  const now = Date.now();
  const today = kstDateKey(now);
  const week = last7DateKeys(now);

  const [allUv, allChat, allMoney] = await Promise.all([
    r.pfcount(K.uvAll),
    r.get(K.chatAll),
    r.get(K.global),
  ]);
  const [todayUv, todayChat, todayMoney] = await Promise.all([
    r.pfcount(dk.uv(today)),
    r.get(dk.chat(today)),
    r.get(dk.money(today)),
  ]);

  const tmp = `mt:uv:_wk:${now}`;
  await r.pfmerge(tmp, ...week.map(dk.uv));
  const weekUv = await r.pfcount(tmp);
  await r.expire(tmp, 120);
  const weekChats = await r.mget(...week.map(dk.chat));
  const weekMoneys = await r.mget(...week.map(dk.money));
  const sum = (arr) => arr.reduce((s, v) => s + (Number(v) || 0), 0);

  return {
    presence: presence ?? 0,
    allTime: { visitors: allUv ?? 0, chats: allChat ?? 0, money: allMoney ?? 0 },
    today: { visitors: todayUv ?? 0, chats: todayChat ?? 0, money: todayMoney ?? 0 },
    week: { visitors: weekUv ?? 0, chats: sum(weekChats), money: sum(weekMoneys) },
    serverNow: now,
  };
}

export async function getAdminChats(offset = 0, limit = 100) {
  const r = getRedis();
  if (!r) return [];
  const rows = (await r.lrange(K.adminChats, offset, offset + limit - 1) || []).filter(Boolean);
  if (rows.length === 0) return rows;
  // 경고횟수는 저장 시점이 아니라 조회 시점에 합류(채팅당 Redis 읽기 회피)
  const vids = [...new Set(rows.map((x) => x.vid).filter((v) => v && v !== "system"))];
  if (vids.length === 0) return rows.map((x) => ({ ...x, warnCount: 0 }));
  const counts = await r.mget(...vids.map((v) => vk.warn(v)));
  const map = Object.fromEntries(vids.map((v, i) => [v, Number(counts[i]) || 0]));
  return rows.map((x) => ({ ...x, warnCount: map[x.vid] || 0 }));
}

/* ---------- 밴/경고 (Redis 영속; 메모리 캐시는 index.js에서 동기화) ---------- */
export async function banVid(vid, duration) {
  const r = getRedis();
  if (!r || !vid) return { ok: false };
  const sec = DURATION_SEC[duration];
  if (sec === undefined) return { ok: false };
  const expiry = sec === null ? Infinity : Date.now() + sec * 1000;
  const score = sec === null ? "+inf" : expiry;
  const p = r.pipeline();
  if (sec === null) p.set(vk.ban(vid), 1);
  else p.set(vk.ban(vid), 1, { ex: sec });
  p.zadd(K.bansIndex, { score, member: vid });
  await p.exec();
  return { ok: true, expiry };
}

export async function unbanVid(vid) {
  const r = getRedis();
  if (!r || !vid) return false;
  await Promise.all([r.del(vk.ban(vid)), r.zrem(K.bansIndex, vid)]);
  return true;
}

export async function warnVid(vid) {
  const r = getRedis();
  if (!r || !vid) return 0;
  const n = await r.incr(vk.warn(vid));
  if (n === 1) await r.expire(vk.warn(vid), TTL.warn);
  await r.zadd(K.warnedIndex, { score: n, member: vid });
  return n;
}

async function withNicks(r, rows) {
  if (!r || rows.length === 0) return rows.map((x) => ({ ...x, nick: "" }));
  const nicks = await r.mget(...rows.map((x) => vk.nick(x.vid)));
  return rows.map((x, i) => ({ ...x, nick: nicks[i] ?? "" }));
}

export async function listBans() {
  const r = getRedis();
  if (!r) return [];
  const now = Date.now();
  const raw = await r.zrange(K.bansIndex, 0, -1, { withScores: true });
  const rows = [];
  const stale = [];
  for (let i = 0; i < raw.length; i += 2) {
    const vid = String(raw[i]);
    const score = Number(raw[i + 1]);
    const perm = !isFinite(score);
    if (!perm && score < now) {
      stale.push(vid);
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
  const raw = await r.zrange(K.warnedIndex, 0, limit - 1, { rev: true, withScores: true });
  const rows = [];
  for (let i = 0; i < raw.length; i += 2)
    rows.push({ vid: String(raw[i]), warnCount: Number(raw[i + 1]) });
  return withNicks(r, rows);
}

export async function clearChats() {
  const r = getRedis();
  if (!r) return;
  await r.del(K.adminChats);
}

export async function resetServer(scope) {
  const r = getRedis();
  if (!r) return;
  if (scope === "global" || scope === "all") await r.del(K.global);
  if (scope === "stats" || scope === "all") {
    const week = last7DateKeys();
    await r.del(
      K.uvAll,
      K.chatAll,
      ...week.map(dk.uv),
      ...week.map(dk.chat),
      ...week.map(dk.money),
    );
  }
  if (scope === "all") await r.del(K.adminChats, K.warnedIndex);
}
