/* ===================================================================
   돈버는 화장실 · 실시간 소켓 서버 (Railway, 단일 인스턴스)
   라이브(메모리): presence(실유저만) · 오늘 러닝합계 · 시간별 24버킷 · 밴 · rate
   영속(Redis, 5분 배치): mt:today(러닝) + mt:hours:<date>(시간별 HASH) + 채팅로그
   어드민: 소켓 'admins' 룸으로 라이브 push(presence/오늘/online/채팅), presence 제외
           과거 데이터는 Vercel이 Redis 직접 조회(토큰 검증). 단일 ADMIN_SECRET(Railway).
   =================================================================== */

import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";

import { DEFAULTS, FLUSH_CAP, MAX_AUTOBLOCK_SEC, kstDateKey, kstHour, kstMinuteOfDay, emptyBucket, driftPresenceFloor, initialPresenceFloor, PRESENCE_FLOOR_MAX } from "./lib/keys.js";
import {
  loadConfig, setConfig, persistToday, loadToday, persistHours, loadHours,
  persistMinutes, loadMinutes, appendChatLog, loadActiveBans, banVid, unbanVid, listBans, clean,
} from "./lib/store.js";
import {
  passwordMatches, createSession, destroySession, isValidSession,
  isLoginLocked, recordLoginFail, clearLoginFail, bearer,
} from "./lib/auth.js";

const PORT = process.env.PORT || 4000;

/* ===================== 인메모리 상태 ===================== */
let cfg = { ...DEFAULTS };
const presence = new Map(); // vid -> { sockets:Set, nick, since }  (실유저만, 어드민 제외)
const bans = new Map(); // vid -> expiry(ms)|Infinity
const chatBuf = []; // [{date,ts,hour,vid,nick,text}] — Redis chatlog append용(영속 시 비움)
let today = null; // { date, visits, newVisitors, chat, flush, money, share, donate, brag }
let hours = null; // [24] of bucket
let minutes = new Map(); // 분of하루(0~1439) -> 분단위 버킷(+presence 게이지). 어드민 차트/테이블 상세조회용
let todayDirty = false; // 마지막 영속 이후 today 변경 여부
let hoursDirty = new Set(); // 마지막 영속 이후 변경된 시간 인덱스
let dirtyMinutes = new Set(); // 마지막 영속 이후 변경된 분 인덱스

/* ---------- 오늘치 라이브 로그(메모리, 자정 리셋) — Task3 ----------
   어드민은 접속 즉시 '오늘 하루치' 채팅/접속 로그를 스냅샷으로 받아본다(어드민 로그인 이후분만이 아니라).
   과거(어제~)는 Vercel이 Redis로 조회. 서버 재기동/자정 리셋으로 이 메모리가 비어도, 어드민 브라우저는
   이미 받은 것을 새로고침 전까지 유지한다(프론트 상태 보존). */
const todayChatLog = []; // [{ts,hour,vid,nick,text}]
const todayConnLog = []; // [{ts,type:'join'|'leave',vid,nick}]
const TODAY_LOG_MAX = 20000; // 메모리 보호 상한(초과 시 오래된 것부터 버림)

// 무거운 write(today/hours/minutes)는 60초로 합침. chatlog는 30초로 배치(어드민 '오늘'은 소켓 라이브라
// Redis chatlog는 과거조회·크래시대비용뿐 → 10초일 이유가 없음). presence·dwell 샘플만 매 10초 틱.
const STAT_PERSIST_MS = 60_000;
const CHAT_PERSIST_MS = 30_000;
let lastStatPersistAt = 0;
let lastChatPersistAt = 0;
// 시간별 스냅샷은 이제 pushAdminLive(≈2초, 변화 시)에 함께 실어 라이브로 보낸다.
// 이 인터벌은 유휴/자정 롤오버 대비 heartbeat(60초) — 변화가 없어도 최소 한 번은 최신화.
const ADMIN_HOURS_PUSH_MS = 60_000;

function freshToday(date) {
  return { date, visits: 0, newVisitors: 0, chat: 0, flush: 0, money: 0, share: 0, donate: 0, brag: 0, dwellSec: 0 };
}
let lastDwellAt = 0; // 마지막 체류시간 샘플 시각(경과분만큼 dwellSec 적립)
// 분단위 버킷 = 통계 버킷 + presence 게이지 샘플(카운터 아님 → tick 합산 시 max로 집계)
function emptyMinute() {
  return { ...emptyBucket(), presence: 0 };
}
// today/hours/minutes 동시 누적 + dirty 표기 — ensureDay는 호출부에서 이미 부른 상태를 가정.
function accrue(field, n, h, m) {
  today[field] += n;
  hours[h][field] += n;
  let mb = minutes.get(m);
  if (!mb) minutes.set(m, (mb = emptyMinute()));
  mb[field] += n;
  todayDirty = true;
  hoursDirty.add(h);
  dirtyMinutes.add(m);
}
function ensureDay() {
  const d = kstDateKey();
  if (today && today.date === d) return;
  const rolled = !!today; // 자정 롤오버(서버 부팅 첫 호출 제외)
  if (rolled) {
    // 이전 날 잔여분을 '스냅샷'으로 저장 — 아래 모듈변수 재할당과의 async 경쟁 방지(옛 참조를 명시 전달).
    persistSnapshot(
      today.date,
      todayDirty ? today : null,
      hoursDirty.size ? hours : null,
      new Set(hoursDirty),
      dirtyMinutes.size ? minutes : null,
      new Set(dirtyMinutes),
      chatBuf.splice(0),
    );
  }
  today = freshToday(d);
  hours = Array.from({ length: 24 }, emptyBucket);
  minutes = new Map();
  todayDirty = false;
  hoursDirty = new Set();
  dirtyMinutes = new Set();
  todayChatLog.length = 0;
  todayConnLog.length = 0;
  lastStatPersistAt = 0;
  // 접속 중인 클라이언트는 'global' 푸시만으론 자정 초기화를 구분 못 함(스냅처럼 보임) → 전용 이벤트로 안내
  if (rolled) io.emit("dayReset", { total: 0, date: d });
}

/* 오늘치 채팅/접속 로그 추가 — 메모리 보관 + (채팅은) Redis append 버퍼 + 어드민 라이브 push */
function logChat(row) {
  chatBuf.push(row); // Redis chatlog append용
  todayChatLog.push({ ts: row.ts, hour: row.hour, vid: row.vid, nick: row.nick, text: row.text });
  if (todayChatLog.length > TODAY_LOG_MAX) todayChatLog.splice(0, todayChatLog.length - TODAY_LOG_MAX);
  if (adminsConnected()) io.to("admins").emit("adminChat", { ts: row.ts, hour: row.hour, vid: row.vid, nick: row.nick, text: row.text });
}
function logConn(type, vid, nick) {
  const row = { ts: Date.now(), type, vid, nick: nick || "" };
  todayConnLog.push(row);
  if (todayConnLog.length > TODAY_LOG_MAX) todayConnLog.splice(0, todayConnLog.length - TODAY_LOG_MAX);
  if (adminsConnected()) io.to("admins").emit("adminConn", row);
}

/* ---------- 어뷰징 ---------- */
function isBanned(vid) {
  const exp = bans.get(vid);
  if (exp === undefined) return false;
  if (exp !== Infinity && Date.now() > exp) { bans.delete(vid); return false; }
  return true;
}
const rate = new Map();
// 슬라이딩 윈도우 레이트리밋 — 버킷(chat/flush)별로 분리해 한쪽이 다른 쪽 예산을 잠식하지 않게 한다.
function rateOk(vid, bucket = "chat") {
  const key = vid + ":" + bucket;
  const now = Date.now();
  const arr = (rate.get(key) || []).filter((t) => now - t < cfg.rateWindowMs);
  arr.push(now);
  rate.set(key, arr);
  return arr.length <= cfg.rateLimitN;
}
// 공유/후원/자랑 클릭 연타 방어는 클라(js)에서 kind별 디바운스로 1차 차단한다.
// 서버는 rateOk("clicked") 슬라이딩 윈도우를 이벤트루프 보호용 백스톱으로만 둔다(별도 dedup 없음).
const STRIKE_DECAY_MS = 5 * 60 * 1000; // 마지막 위반 후 이 시간 지나면 누적 strike 리셋(선량한 장기세션 보호)

/* ---------- 접속자 표시 바닥값(자동 드리프트) ----------
   빈 방 이탈 방지용 최소 표시 인원. 공개 broadcast만 max(실제, 바닥값)으로 패딩하고,
   어드민 스냅샷은 항상 실제 presence.size를 쓴다(운영자는 진짜를 봐야 함). */
let presenceFloorNow = 0;
// 공개용 표시 인원 — 실제 접속자 + 드리프트 추가 인원 (덧셈: 입장 시 바로 체감)
function publicPresence() {
  return presence.size + presenceFloorNow;
}
// 설정 반영 즉시 재동기화 — 항상 auto(드리프트 값이 0이 아니면 항상 발동)
function resyncPresenceFloor() {
  presenceFloorNow = initialPresenceFloor(cfg.presenceFloorMax);
}
// 드리프트 인터벌 — 10초~10분을 가중치 구간으로 쪼개 인간적으로 불규칙하게.
// 짧은 간격(빠른 연속 이동)이 자주 일어나되, 조용한 긴 텀도 드물게 섞인다.
function driftDelay() {
  const r = Math.random();
  if (r < 0.15) return  10_000 + Math.floor(Math.random() *  20_000); // 10~30s  (15%) 순간 연속
  if (r < 0.40) return  30_000 + Math.floor(Math.random() *  60_000); // 30~90s  (25%) 빠른 편
  if (r < 0.65) return  90_000 + Math.floor(Math.random() *  90_000); // 90~180s (25%) 보통
  if (r < 0.85) return 180_000 + Math.floor(Math.random() * 180_000); // 180~360s(20%) 느린 편
  return               360_000 + Math.floor(Math.random() * 240_000); // 360~600s(15%) 긴 정적
}
function scheduleFloorDrift() {
  setTimeout(() => {
    if (cfg.presenceFloorMax > 0) {
      const next = driftPresenceFloor(presenceFloorNow, cfg.presenceFloorMax);
      if (next !== presenceFloorNow) { presenceFloorNow = next; broadcastPresence(); pushAdminLive(); }
    }
    scheduleFloorDrift();
  }, driftDelay());
}

/* ---------- presence 브로드캐스트(디바운스) ---------- */
let pTimer = null, pDirty = false;
function broadcastPresence() {
  pDirty = true;
  if (pTimer) return;
  pTimer = setTimeout(() => {
    pTimer = null;
    if (!pDirty) return;
    pDirty = false;
    io.emit("presence", { count: publicPresence() });
  }, cfg.presenceBroadcastMs);
}

/* ---------- 어드민 라이브 push ---------- */
function onlineList() {
  return [...presence.entries()].map(([vid, info]) => ({
    vid, nick: info.nick || "", conns: info.sockets.size, since: info.since, banned: isBanned(vid),
  })).sort((a, b) => a.since - b.since);
}
// 라이브성 데이터(자주 바뀜) — presence/오늘 러닝합계/온라인 목록
function adminLiveSnapshot() {
  ensureDay();
  // presence는 항상 실제값(운영자 진실), floor는 현재 공개 표시에 적용 중인 바닥값(투명성)
  return { presence: presence.size, floor: presenceFloorNow, today: { ...today }, online: onlineList() };
}
// 시간별 통계(5분 배치 영속과 같은 주기로만 바뀌어도 충분 — 매번 보낼 필요 없음)
function adminHoursSnapshot() {
  ensureDay();
  return { hours: hours.map((h) => ({ ...h })) };
}
function adminsConnected() {
  return (io.sockets.adapter.rooms.get("admins")?.size || 0) > 0;
}

// 어드민 라이브 push — 상태가 실제로 바뀐 시점에만, 디바운스해서 한 번에 묶어 보냄
// (매초 폴링하던 이전 구조는 변동 없어도 매번 presence/today/online 전체를 다시 보내 비효율적이었음)
let aTimer = null, aDirty = false;
function pushAdminLive() {
  aDirty = true;
  if (aTimer || !adminsConnected()) return;
  aTimer = setTimeout(() => {
    aTimer = null;
    if (!aDirty || !adminsConnected()) return;
    aDirty = false;
    // 요약(오늘 러닝합계·presence·online)과 시간별 24버킷을 함께 라이브로(≈2초). 둘 다 메모리 → Redis 무관.
    io.to("admins").emit("adminStats", adminLiveSnapshot());
    io.to("admins").emit("adminHours", adminHoursSnapshot());
  }, cfg.presenceBroadcastMs);
}

/* ---------- 영속(10초 틱 / 무거운 write는 60초 합침) ---------- */
// 분단위 presence 샘플 — 그 분의 피크 동접(게이지). 아무도 없으면 write 안 함(sparse 유지, 읽을 때 0).
function sampleMinutePresence() {
  const size = presence.size;
  if (size <= 0) return;
  const m = kstMinuteOfDay();
  let mb = minutes.get(m);
  if (!mb) minutes.set(m, (mb = emptyMinute()));
  if (size > mb.presence) mb.presence = size;
  dirtyMinutes.add(m);
}
// 체류시간 샘플 — 경과초 × 동접 인원을 dwellSec에 적립(today/hours/minutes). 정지·드리프트 대비 경과는 상한.
function sampleDwell() {
  const now = Date.now();
  const elapsedMs = lastDwellAt ? Math.min(now - lastDwellAt, 3 * (cfg.persistMs || 10_000)) : 0;
  lastDwellAt = now;
  const size = presence.size;
  if (size <= 0 || elapsedMs <= 0) return;
  const sec = Math.round((size * elapsedMs) / 1000);
  if (sec <= 0) return;
  ensureDay();
  accrue("dwellSec", sec, kstHour(), kstMinuteOfDay());
}

async function persistChatBuf() {
  if (!chatBuf.length) return;
  const byDate = {};
  for (const row of chatBuf.splice(0)) (byDate[row.date] ||= []).push(row);
  for (const [date, rows] of Object.entries(byDate)) {
    await appendChatLog(date, rows.map(({ ts, hour, vid, nick, text }) => ({ ts, hour, vid, nick, text })));
  }
}

// 현재 날의 dirty today/hours/minutes만 저장. 모든 참조/플래그를 await 이전에 '동기 캡처'해,
// await 도중 자정 롤오버(모듈변수 재할당)가 끼어들어도 옛 날 데이터를 옛 날짜에 정확히 쓴다(경쟁 방지).
// 캡처와 동시에 모듈 dirty를 새 Set으로 교체 → await 중 도착한 증분은 다음 틱이 잡는다(누락 없음).
async function persistStats() {
  if (!today || !today.date) return;
  const todayRef = today, hoursRef = hours, minutesRef = minutes, date = today.date;
  const tDirty = todayDirty; todayDirty = false;
  const hDirty = hoursDirty; hoursDirty = new Set();
  const mDirty = dirtyMinutes; dirtyMinutes = new Set();
  if (tDirty) await persistToday(todayRef);
  if (hDirty.size) await persistHours(date, hoursRef, hDirty);
  if (mDirty.size) await persistMinutes(date, minutesRef, mDirty);
}

// 자정 롤오버 전용 — 옛 날의 참조를 명시적으로 받아 fire-and-forget 저장(모듈변수 재할당 경쟁 없음).
function persistSnapshot(date, todayObj, hoursArr, hoursDirtySet, minutesMap, minDirtySet, chatRows) {
  (async () => {
    try {
      if (todayObj) await persistToday(todayObj);
      if (hoursArr && hoursDirtySet && hoursDirtySet.size) await persistHours(date, hoursArr, hoursDirtySet);
      if (minutesMap && minDirtySet && minDirtySet.size) await persistMinutes(date, minutesMap, minDirtySet);
      if (chatRows && chatRows.length) {
        const byDate = {};
        for (const row of chatRows) (byDate[row.date] ||= []).push(row);
        for (const [d, rows] of Object.entries(byDate)) await appendChatLog(d, rows.map(({ ts, hour, vid, nick, text }) => ({ ts, hour, vid, nick, text })));
      }
    } catch (e) { console.error("[persist rollover]", e); }
  })();
}

// 10초 틱 — presence·dwell 샘플(매 틱) + chatlog(30초 합침) + stats(60초 합침). 유휴 시 write 0.
async function flushPersist() {
  sampleMinutePresence();
  sampleDwell();
  const now = Date.now();
  if (now - lastChatPersistAt >= CHAT_PERSIST_MS) { lastChatPersistAt = now; await persistChatBuf(); }
  if (now - lastStatPersistAt >= STAT_PERSIST_MS) { lastStatPersistAt = now; await persistStats(); }
}

// 종료/롤오버 등 — 남은 것 전부 즉시 저장(주기 게이트 무시)
async function flushAll() {
  await persistChatBuf();
  await persistStats();
}

/* ===================== Express (어드민 REST: 로그인/밴/제어) ===================== */
const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "16kb" }));
app.get("/", (_req, res) => res.send("ok"));

async function requireAdmin(req, res, next) {
  if (await isValidSession(bearer(req))) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

app.post("/admin/login", async (req, res) => {
  const ip = req.ip || "unknown";
  if (await isLoginLocked(ip)) return res.status(429).json({ ok: false, error: "locked" });
  const pw = String(req.body?.password ?? "");
  if (!pw || !passwordMatches(pw)) { await recordLoginFail(ip); return res.status(401).json({ ok: false }); }
  await clearLoginFail(ip);
  const token = await createSession();
  if (!token) return res.status(500).json({ ok: false });
  res.json({ ok: true, token });
});
app.get("/admin/me", requireAdmin, (_req, res) => res.json({ ok: true }));
app.post("/admin/logout", requireAdmin, async (req, res) => { await destroySession(bearer(req)); res.json({ ok: true }); });
app.get("/admin/bans", requireAdmin, async (_req, res) => res.json({ ok: true, bans: await listBans() }));
app.post("/admin/ban", requireAdmin, async (req, res) => {
  const vid = String(req.body?.vid ?? "");
  const r = await banVid(vid, String(req.body?.duration ?? "1d"));
  if (r.ok) bans.set(vid, r.expiry);
  res.json({ ok: r.ok });
});
app.post("/admin/unban", requireAdmin, async (req, res) => {
  const vid = String(req.body?.vid ?? "");
  await unbanVid(vid); bans.delete(vid);
  res.json({ ok: true });
});
app.post("/admin/broadcast", requireAdmin, (req, res) => {
  const text = clean(req.body?.text ?? "", 120);
  if (text) io.emit("chat", { name: "관리자", text, kind: "admin" });
  res.json({ ok: true });
});
/* 공지 배너 — 인증 없이 공개. 클라이언트가 마운트 시 fetch. */
app.get("/notices", (_req, res) => {
  res.json({ ok: true, notices: cfg.notices ?? [] });
});
app.get("/admin/config", requireAdmin, (_req, res) => {
  res.json({ ok: true, config: cfg });
});
app.post("/admin/config", requireAdmin, async (req, res) => {
  await setConfig(req.body ?? {}); cfg = await loadConfig();
  io.emit("notices", { notices: cfg.notices ?? [] });
  resyncPresenceFloor(); broadcastPresence(); // 바닥값 설정 변경 즉시 반영
  res.json({ ok: true, config: cfg });
});
app.post("/admin/reset-money", requireAdmin, async (_req, res) => {
  ensureDay();
  // 러닝합계 + 오늘 시간·분 버킷의 금액까지 0으로(차트·표와 일관). 과거 날짜 Redis는 건드리지 않음.
  today.money = 0;
  for (const h of hours) h.money = 0;
  for (const mb of minutes.values()) mb.money = 0;
  todayDirty = true;
  for (let i = 0; i < 24; i++) hoursDirty.add(i);
  for (const k of minutes.keys()) dirtyMinutes.add(k);
  await persistStats();
  io.emit("global", { total: 0 });
  res.json({ ok: true });
});

/* ===================== socket.io ===================== */
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ["GET", "POST"] } });

io.on("connection", async (socket) => {
  // 어드민 전용 접속 — 토큰 검증 → admins 룸, presence 제외, 라이브 push만
  const adminToken = socket.handshake.auth?.adminToken;
  if (adminToken && (await isValidSession(String(adminToken)))) {
    socket.data.isAdmin = true;
    socket.join("admins");
    ensureDay();
    socket.emit("adminStats", adminLiveSnapshot());
    socket.emit("adminHours", adminHoursSnapshot()); // 최초 1회는 즉시(이후엔 ADMIN_HOURS_PUSH_MS 주기)
    // 오늘 하루치 라이브 로그 스냅샷(어드민 로그인 이후분만이 아니라 '오늘 전체') — Task3
    socket.emit("adminTodayLog", { chats: todayChatLog.slice(), conns: todayConnLog.slice() });
    return; // 어드민은 view-only — 유저 핸들러 미부착, 동접 제외
  }

  socket.data.vid = null;
  socket.data.nick = "";
  socket.data.counted = false;

  // 연결 즉시 현재 상태 1회 전송 — 'hello'를 보내지 않는 수동 관전자(공유페이지 등)도
  // presence/오늘 합계를 바로 볼 수 있게(이 emit 자체는 presence/visits에 영향 없음)
  ensureDay();
  socket.emit("presence", { count: publicPresence() });
  socket.emit("global", { total: today.money });

  socket.on("hello", (p = {}) => {
    const incoming = String(p.vid ?? "").slice(0, 64);
    if (!incoming) return;
    if (!socket.data.vid) socket.data.vid = incoming;
    const vid = socket.data.vid;
    socket.data.nick = clean(p.nick, 16);

    // 방문 카운트 — 소켓당 1회, 새 페이지진입(fresh)일 때만(재연결 제외)
    if (!socket.data.counted && p.fresh) {
      socket.data.counted = true;
      ensureDay();
      const h = kstHour(), m = kstMinuteOfDay();
      accrue("visits", 1, h, m);
      if (p.isNew) accrue("newVisitors", 1, h, m);
    }

    socket.emit("global", { total: today ? today.money : 0 });
    socket.emit("presence", { count: publicPresence() });

    // 공유페이지 방문자 — 방문 집계는 하지만 presence(실시간 볼일 중) 제외
    if (p.isShare) return;

    // 인게임 실유저 — presence에 추가하고 브로드캐스트
    let info = presence.get(vid);
    const isNewPresence = !info; // 이 vid의 첫 소켓(=오늘 접속 로그의 '입장')
    if (!info) presence.set(vid, (info = { sockets: new Set(), nick: "", since: Date.now() }));
    info.sockets.add(socket.id);
    info.nick = socket.data.nick || info.nick;
    if (isNewPresence) logConn("join", vid, info.nick); // 오늘 접속 로그 — 재접속 횟수/닉변 today 기준 파생

    broadcastPresence();
    pushAdminLive();
  });

  socket.on("chat", (p = {}) => {
    const vid = socket.data.vid;
    if (!vid) return;
    if (p.nick) { socket.data.nick = clean(p.nick, 16); const i = presence.get(vid); if (i) i.nick = socket.data.nick; }
    const text = clean(p.text, cfg.maxMsgLen);
    if (!text || cfg.chatDisabled) return;
    if (isBanned(vid)) return; // 섀도밴

    const now = Date.now();
    // (1) 연타 방지 — 같은 사람이 최소 간격 미만으로 보내면 조용히 무시(차단까진 아님)
    if (now - (socket.data.lastChatAt || 0) < cfg.chatMinIntervalMs) return;
    // (2) 동일 문구 도배 방지 — 직전과 같은 텍스트면 무시(간격은 갱신해 연타 패턴도 함께 차단)
    if (text === socket.data.lastChatText) { socket.data.lastChatAt = now; return; }
    // (3) 슬라이딩 윈도우 한도 초과 — 누적 위반(strike)으로 차단 시간을 점증시켜 상습범을 밀어냄.
    //     단 마지막 위반 후 STRIKE_DECAY_MS 지나면 strike를 리셋해, 한참 전에 한 번 튄
    //     선량한 장기세션 유저가 영구 가중되지 않게 한다.
    if (!rateOk(vid, "chat")) {
      if (now - (socket.data.lastStrikeAt || 0) > STRIKE_DECAY_MS) socket.data.chatStrikes = 0;
      socket.data.chatStrikes = (socket.data.chatStrikes || 0) + 1;
      socket.data.lastStrikeAt = now;
      const blockSec = Math.min(cfg.autoBlockSec * socket.data.chatStrikes, MAX_AUTOBLOCK_SEC);
      bans.set(vid, now + blockSec * 1000);
      return;
    }
    socket.data.lastChatAt = now;
    socket.data.lastChatText = text;

    const nick = socket.data.nick || "익명의 볼일러";
    ensureDay();
    const h = kstHour(), m = kstMinuteOfDay();
    accrue("chat", 1, h, m);
    const ts = now;
    socket.broadcast.emit("chat", { name: nick, text, kind: "user" }); // 실제 옆사람(나 제외)
    logChat({ date: today.date, ts, hour: h, vid, nick, text }); // 오늘 로그 + Redis 버퍼 + 어드민 라이브
    pushAdminLive();
  });

  socket.on("flush", (p = {}) => {
    const vid = socket.data.vid;
    if (!vid) return;
    if (p.nick) { socket.data.nick = clean(p.nick, 16); const i = presence.get(vid); if (i) i.nick = socket.data.nick; }
    let amount = Math.floor(Number(p.amount) || 0);
    if (amount < 1) return;
    if (cfg.chatDisabled || isBanned(vid) || !rateOk(vid, "flush")) return;
    const now = Date.now();
    amount = Math.min(amount, FLUSH_CAP);
    if (amount < 1) return;

    ensureDay();
    const h = kstHour(), m = kstMinuteOfDay();
    accrue("money", amount, h, m);
    accrue("flush", 1, h, m);

    const nick = socket.data.nick || "익명의 볼일러";
    if (p.broadcast !== false) {
      const text = clean(p.text, cfg.maxMsgLen);
      const isCapped = p.kind === "capped"; // 1시간 꽉 채운 물내림
      const kind = isCapped ? "capped" : undefined; // 다른 유저 화면에 코믹하게 구분 표시
      socket.broadcast.emit("flush", { name: nick, amount, total: today.money, me: false, chat: true, text, kind });
      // 물내림도 '채팅'이므로 로그를 남긴다 — 어드민 채팅로그에 정산 활동 포함.
      // 어드민 로그는 (다른 유저에게 코믹하게 보이는) 멘트와 분리해 항상 금액 멘트로 통일한다.
      // 1시간 꽉 채운(capped) 물내림만 뒤에 MAX 표기를 붙인다.
      const amountStr = amount.toLocaleString("ko-KR");
      const logText = isCapped
        ? `💰 ${amountStr}원 물내림! MAX`
        : `💰 ${amountStr}원 물내림!`;
      logChat({ date: today.date, ts: now, hour: h, vid, nick, text: logText });
    }
    io.emit("global", { total: today.money });
    pushAdminLive();
  });

  // 공유/후원/자랑 클릭 집계 — 클라가 '클릭 즉시'(모든 await 이전) emit → 이탈로 인한 누수 없음.
  // kind: 'share'(공유하기) | 'donate'(후원하기) | 'brag'(자랑하기, URL 생성과 무관한 단순 클릭).
  // 연타 차단은 클라(kind별 디바운스)가 담당. 서버 rateOk는 이벤트루프 보호용 백스톱만(dedup 없음).
  socket.on("clicked", (p = {}) => {
    const vid = socket.data.vid;
    if (!vid) return;
    if (isBanned(vid)) return; // 섀도밴 — 집계 제외
    const kind = p.kind;
    if (kind !== "share" && kind !== "donate" && kind !== "brag") return;
    if (!rateOk(vid, "clicked")) return; // 폭주 백스톱
    ensureDay();
    const h = kstHour(), m = kstMinuteOfDay();
    accrue(kind, 1, h, m);
    pushAdminLive();
  });

  socket.on("disconnect", () => {
    const vid = socket.data.vid;
    if (!vid) return;
    const info = presence.get(vid);
    if (info) {
      info.sockets.delete(socket.id);
      if (info.sockets.size === 0) {
        presence.delete(vid); rate.delete(vid + ":chat"); rate.delete(vid + ":flush"); rate.delete(vid + ":clicked");
        logConn("leave", vid, info.nick); // 오늘 접속 로그 — 이탈
      }
      // presence가 실제로 바뀐 경우에만 브로드캐스트 (공유페이지 방문자는 presence에 없으므로 여기 안 옴)
      broadcastPresence();
      pushAdminLive();
    }
  });
});

/* ===================== 부팅 / 종료 ===================== */
async function boot() {
  cfg = await loadConfig();
  const d = kstDateKey();
  today = freshToday(d);
  hours = Array.from({ length: 24 }, emptyBucket);
  const t = await loadToday();
  if (t && t.date === d) today = { ...today, ...t, date: d }; // 같은 날이면 러닝합계 복구
  hours = await loadHours(d); // 시간별 복구
  minutes = await loadMinutes(d); // 분단위 복구(재기동 후에도 오늘 차트 유지)
  for (const b of await loadActiveBans()) bans.set(b.vid, b.expiry);
  resyncPresenceFloor(); // 접속자 바닥값 초기화
  scheduleFloorDrift(); // 자동 드리프트 시작(presenceFloorMax > 0이면 항상 발동)

  setInterval(() => flushPersist().catch((e) => console.error("[persist]", e)), cfg.persistMs);
  // 어드민 시간별 스냅샷 push — persistMs(10초)와 분리한 자체 주기(10초 storm 방지). presence/오늘/online은
  // pushAdminLive()로 변동 시점에만 디바운스 push(hello/chat/flush/disconnect에서 호출)
  setInterval(() => { if (adminsConnected()) io.to("admins").emit("adminHours", adminHoursSnapshot()); }, ADMIN_HOURS_PUSH_MS);

  server.listen(PORT, () => {
    console.log(`[mt-socket] :${PORT} day=${today.date} money=${today.money} visits=${today.visits} bans=${bans.size}`);
  });
}
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => { try { await flushAll(); } catch { /* noop */ } process.exit(0); });
}
boot();
