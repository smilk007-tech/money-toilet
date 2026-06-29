/* 영속 스토어 — Upstash Redis. 5분 배치로만 기록(이벤트마다 write 금지).
   - mt:today        : SET 러닝합계 (TTL 없음)
   - mt:hours:<date> : HSET 시간별(바뀐 시간만), 95일 TTL
   - mt:chatlog:<date>: RPUSH 배치, 3일 TTL
   - 밴: 변경 시에만 즉시 write */

import { getRedis } from "./redis.js";
import {
  K, vk, hoursKey, chatLogKey, TTL, DEFAULTS, DURATION_SEC, CHATLOG_MAX,
  emptyBucket, lastDateKeys,
} from "./keys.js";

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

/* ---------- 오늘 러닝합계 + 시간별 영속 ---------- */
// running: {date, visits, newVisitors, chat, flush, money}
export async function persistToday(running) {
  const r = getRedis();
  if (!r) return;
  await r.set(K.today, running); // TTL 없음
}
export async function loadToday() {
  const r = getRedis();
  if (!r) return null;
  return (await r.get(K.today)) || null;
}
// hours: 24개 버킷 배열 — 비어있지 않은 시간만 HSET
export async function persistHours(date, hours) {
  const r = getRedis();
  if (!r) return;
  const obj = {};
  hours.forEach((h, i) => {
    if (h.visits || h.newVisitors || h.chat || h.flush || h.money) obj[i] = h;
  });
  if (!Object.keys(obj).length) return;
  const p = r.pipeline();
  p.hset(hoursKey(date), obj);
  p.expire(hoursKey(date), TTL.hours);
  await p.exec();
}
export async function loadHours(date) {
  const r = getRedis();
  if (!r) return Array.from({ length: 24 }, emptyBucket);
  const raw = (await r.hgetall(hoursKey(date))) || {};
  const arr = Array.from({ length: 24 }, emptyBucket);
  for (const [k, v] of Object.entries(raw)) {
    const i = Number(k);
    if (i >= 0 && i < 24 && v) arr[i] = { ...emptyBucket(), ...v };
  }
  return arr;
}

/* ---------- 채팅로그(배치 append) ---------- */
// rows: [{ts, hour, vid, nick, text}]
export async function appendChatLog(date, rows) {
  const r = getRedis();
  if (!r || !rows.length) return;
  const p = r.pipeline();
  p.rpush(chatLogKey(date), ...rows);
  p.ltrim(chatLogKey(date), -CHATLOG_MAX, -1);
  p.expire(chatLogKey(date), TTL.chatLog);
  await p.exec();
}

/* ---------- 밴 ---------- */
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

/* ---------- 초기화 (통계/채팅로그만, 밴은 유지) ---------- */
export async function resetStats() {
  const r = getRedis();
  if (!r) return;
  const dates = lastDateKeys(95);
  const logDates = lastDateKeys(3);
  await r.del(K.today, ...dates.map(hoursKey), ...logDates.map(chatLogKey));
}
