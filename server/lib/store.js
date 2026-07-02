/* 영속 스토어 — Upstash Redis. 배치로만 기록(이벤트마다 write 금지).
   영속 주기(persistMs=10초)에 '변경분만' write하되, 무거운 write(today/hours/minutes)는
   서버(index.js)에서 60초로 합쳐(coalesce) 무료티어(월 50만 커맨드) 안에 머문다.
   - mt:today        : SET 러닝합계 (TTL 없음)
   - mt:hours:<date> : HSET 시간별(바뀐 시간만, field 0~23), 95일 TTL
   - mt:min:<date>   : HSET 분단위(바뀐 분만, field 0~1439, value=버킷+presence), 30일 TTL
   - mt:chatlog:<date>: RPUSH 배치, 5일 TTL
   - 밴: 변경 시에만 즉시 write */

import { getRedis } from "./redis.js";
import {
  K, vk, hoursKey, minKey, chatLogKey, TTL, DEFAULTS, DURATION_SEC, CHATLOG_MAX,
  emptyBucket, lastDateKeys,
} from "./keys.js";

// TTL은 키마다 '이 프로세스에서 처음 쓸 때' 한 번만 건다. HSET/RPUSH는 기존 TTL을 지우지 않으므로
// 매 배치마다 EXPIRE를 반복할 필요가 없다(반복 EXPIRE = 낭비 커맨드). 재기동 시 Set이 비어 다시 1회 건다(무해).
const ttlOnce = new Set();
function expireOnce(pipeline, key, ttl) {
  if (ttlOnce.has(key)) return;
  pipeline.expire(key, ttl);
  ttlOnce.add(key);
}

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
    else if (Array.isArray(def)) m[key] = Array.isArray(raw[key]) ? raw[key] : def;
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
    else if (Array.isArray(def)) out[key] = Array.isArray(patch[key]) ? patch[key] : def;
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
// hours: 24개 버킷 배열, dirty: 마지막 영속 이후 변경된 시간 인덱스만 HSET
// (매 5분 틱마다 안 바뀐 버킷까지 재기록하면 유휴 상태에서도 불필요한 write가 계속 발생함)
export async function persistHours(date, hours, dirty) {
  const r = getRedis();
  if (!r) return;
  const idxs = dirty ? [...dirty] : hours.map((_, i) => i).filter((i) => {
    const h = hours[i];
    return h.visits || h.newVisitors || h.chat || h.flush || h.money;
  });
  const obj = {};
  for (const i of idxs) obj[i] = hours[i];
  if (!Object.keys(obj).length) return;
  const p = r.pipeline();
  p.hset(hoursKey(date), obj);
  expireOnce(p, hoursKey(date), TTL.hours);
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

/* ---------- 분단위 영속(어드민 차트/테이블 상세조회용) ----------
   minutesMap: Map<분of하루(0~1439), 버킷(+presence 게이지)>, dirty: 변경된 분 인덱스 Set.
   시간별과 동일하게 '바뀐 분만' HSET → 유휴 시 write 0. presence는 그 분의 피크 동접(게이지). */
export async function persistMinutes(date, minutesMap, dirty) {
  const r = getRedis();
  if (!r || !minutesMap) return;
  const idxs = dirty ? [...dirty] : [...minutesMap.keys()];
  const obj = {};
  for (const i of idxs) { const b = minutesMap.get(i); if (b) obj[i] = b; }
  if (!Object.keys(obj).length) return;
  const p = r.pipeline();
  p.hset(minKey(date), obj);
  expireOnce(p, minKey(date), TTL.minutes);
  await p.exec();
}
// 특정 날짜의 분단위 버킷 Map<분,버킷> — 없는 분은 호출부(읽기)에서 0으로 채운다(sparse).
export async function loadMinutes(date) {
  const r = getRedis();
  const map = new Map();
  if (!r) return map;
  const raw = (await r.hgetall(minKey(date))) || {};
  for (const [k, v] of Object.entries(raw)) {
    const i = Number(k);
    if (i >= 0 && i < 1440 && v) map.set(i, { ...emptyBucket(), presence: 0, ...v });
  }
  return map;
}

/* ---------- 채팅로그(배치 append) ---------- */
// rows: [{ts, hour, vid, nick, text}]
export async function appendChatLog(date, rows) {
  const r = getRedis();
  if (!r || !rows.length) return;
  const p = r.pipeline();
  p.rpush(chatLogKey(date), ...rows);
  p.ltrim(chatLogKey(date), -CHATLOG_MAX, -1);
  expireOnce(p, chatLogKey(date), TTL.chatLog);
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
  const minDates = lastDateKeys(30); // 분단위 TTL(30일)에 맞춰 초기화 범위도 30일
  const logDates = lastDateKeys(5); // 채팅로그 TTL(5일)에 맞춰 초기화 범위도 5일
  await r.del(K.today, ...dates.map(hoursKey), ...minDates.map(minKey), ...logDates.map(chatLogKey));
}
