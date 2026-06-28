/* 영속 스토어 — Upstash Redis. 이벤트마다 쓰지 않고 "5분 배치"로만 기록.
   · 일일 통계 = 날짜키 1개에 JSON 스냅샷(SET, 5분마다)
   · 채팅로그 = 날짜별 LIST에 버퍼 append(RPUSH, 5분마다), 3일 TTL 자동삭제
   · 밴/경고 = 변경 시에만 즉시 write(드묾) */

import { getRedis } from "./redis.js";
import {
  K, vk, dayKey, chatLogKey, TTL, DEFAULTS, DURATION_SEC, CHATLOG_MAX, lastDateKeys,
} from "./keys.js";

const MAX_NICK = 16;
export function clean(s, max) {
  return String(s ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/* ---------- 설정 ---------- */
export async function loadConfig() {
  const r = getRedis();
  if (!r) return { ...DEFAULTS };
  const raw = await r.hgetall(K.adminCfg);
  if (!raw) return { ...DEFAULTS };
  const m = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (raw[key] == null) continue;
    const def = DEFAULTS[key];
    if (typeof def === "boolean") m[key] = raw[key] === true || raw[key] === "true" || raw[key] === 1;
    else if (typeof def === "number") m[key] = Number(raw[key]);
  }
  return m;
}
export async function setConfig(patch) {
  const r = getRedis();
  if (!r) return;
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (patch[key] === undefined) continue;
    const def = DEFAULTS[key];
    if (typeof def === "boolean") out[key] = Boolean(patch[key]);
    else if (typeof def === "number") out[key] = Number(patch[key]);
  }
  if (Object.keys(out).length) await r.hset(K.adminCfg, out);
}

/* ---------- 일일 통계 스냅샷 ---------- */
// blob: { date, updatedAt, day:{visitors,chat,flush,money}, hours:[{visitors,chat,flush,money}×24] }
export async function persistDay(date, blob) {
  const r = getRedis();
  if (!r) return;
  await r.set(dayKey(date), blob, { ex: TTL.dayBlob });
}
export async function loadDay(date) {
  const r = getRedis();
  if (!r) return null;
  return (await r.get(dayKey(date))) || null;
}
/** 어드민용 — 여러 날짜 한 번에 */
export async function loadDays(dates) {
  const r = getRedis();
  if (!r) return dates.map(() => null);
  const res = await r.mget(...dates.map(dayKey));
  return res.map((x) => x || null);
}

/* ---------- 채팅로그(배치 append) ---------- */
// rows: [{ts, hour, vid, nick, text}]  (날짜는 호출부가 같은 날 것으로 그룹)
export async function appendChatLog(date, rows) {
  const r = getRedis();
  if (!r || !rows.length) return;
  const p = r.pipeline();
  p.rpush(chatLogKey(date), ...rows);
  p.ltrim(chatLogKey(date), -CHATLOG_MAX, -1);
  p.expire(chatLogKey(date), TTL.chatLog);
  await p.exec();
}
export async function loadChatLog(date) {
  const r = getRedis();
  if (!r) return [];
  const rows = (await r.lrange(chatLogKey(date), 0, -1)) || [];
  if (rows.length === 0) return rows;
  // 경고횟수 조회시 합류(채팅당 read 회피)
  const vids = [...new Set(rows.map((x) => x.vid).filter((v) => v && v !== "system"))];
  if (!vids.length) return rows.map((x) => ({ ...x, warnCount: 0 }));
  const counts = await r.mget(...vids.map((v) => vk.warn(v)));
  const map = Object.fromEntries(vids.map((v, i) => [v, Number(counts[i]) || 0]));
  return rows.map((x) => ({ ...x, warnCount: map[x.vid] || 0 }));
}

/* ---------- 밴/경고 ---------- */
export async function loadActiveBans() {
  const r = getRedis();
  if (!r) return [];
  const now = Date.now();
  const raw = await r.zrange(K.bansIndex, 0, -1, { withScores: true });
  const out = [], stale = [];
  for (let i = 0; i < raw.length; i += 2) {
    const vid = String(raw[i]); const score = Number(raw[i + 1]); const perm = !isFinite(score);
    if (!perm && score < now) { stale.push(vid); continue; }
    out.push({ vid, expiry: perm ? Infinity : score });
  }
  if (stale.length) await r.zrem(K.bansIndex, ...stale);
  return out;
}
export async function banVid(vid, duration) {
  const r = getRedis();
  if (!r || !vid) return { ok: false };
  const sec = DURATION_SEC[duration];
  if (sec === undefined) return { ok: false };
  const expiry = sec === null ? Infinity : Date.now() + sec * 1000;
  const p = r.pipeline();
  if (sec === null) p.set(vk.ban(vid), 1);
  else p.set(vk.ban(vid), 1, { ex: sec });
  p.zadd(K.bansIndex, { score: sec === null ? "+inf" : expiry, member: vid });
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
export async function listBans() {
  const r = getRedis();
  if (!r) return [];
  const now = Date.now();
  const raw = await r.zrange(K.bansIndex, 0, -1, { withScores: true });
  const rows = [], stale = [];
  for (let i = 0; i < raw.length; i += 2) {
    const vid = String(raw[i]); const score = Number(raw[i + 1]); const perm = !isFinite(score);
    if (!perm && score < now) { stale.push(vid); continue; }
    rows.push({ vid, expiry: perm ? null : score });
  }
  if (stale.length) await r.zrem(K.bansIndex, ...stale);
  return rows;
}
export async function listWarned(limit = 100) {
  const r = getRedis();
  if (!r) return [];
  const raw = await r.zrange(K.warnedIndex, 0, limit - 1, { rev: true, withScores: true });
  const rows = [];
  for (let i = 0; i < raw.length; i += 2) rows.push({ vid: String(raw[i]), warnCount: Number(raw[i + 1]) });
  return rows;
}

/* ---------- 초기화 ---------- */
export async function resetAll() {
  const r = getRedis();
  if (!r) return;
  const days = lastDateKeys(95);
  const keys = [...days.map(dayKey), ...lastDateKeys(3).map(chatLogKey), K.warnedIndex];
  await r.del(...keys);
}
