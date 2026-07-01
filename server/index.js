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

import { DEFAULTS, FLUSH_CAP, MAX_PER_SEC, MAX_AUTOBLOCK_SEC, kstDateKey, kstHour, emptyBucket, driftPresenceFloor, initialPresenceFloor, PRESENCE_FLOOR_MAX } from "./lib/keys.js";
import {
  loadConfig, setConfig, persistToday, loadToday, persistHours, loadHours,
  appendChatLog, loadActiveBans, banVid, unbanVid, listBans, clean,
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
const chatBuf = []; // [{date,ts,hour,vid,nick,text}]
let today = null; // { date, visits, newVisitors, chat, flush, money }
let hours = null; // [24] of bucket
let todayDirty = false; // 마지막 영속 이후 today 변경 여부
const hoursDirty = new Set(); // 마지막 영속 이후 변경된 시간 인덱스

function freshToday(date) {
  return { date, visits: 0, newVisitors: 0, chat: 0, flush: 0, money: 0, share: 0, bragUrl: 0 };
}
function ensureDay() {
  const d = kstDateKey();
  if (today && today.date === d) return;
  const rolled = !!today; // 자정 롤오버(서버 부팅 첫 호출 제외)
  if (rolled) flushPersist().catch(() => {}); // 이전 날 저장
  today = freshToday(d);
  hours = Array.from({ length: 24 }, emptyBucket);
  // 접속 중인 클라이언트는 'global' 푸시만으론 자정 초기화를 구분 못 함(스냅처럼 보임) → 전용 이벤트로 안내
  if (rolled) io.emit("dayReset", { total: 0, date: d });
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
// 물내림 적립 시계 — vid별 마지막 물내림 시각(소켓 재연결과 무관하게 유지).
// 소켓당으로 두면 재연결마다 1시간 헤드룸이 재무장돼 도배 주입에 악용되므로 vid 기준으로 보존한다.
const flushClock = new Map(); // vid -> 마지막 물내림 ts(ms)
const FLUSH_HEADROOM_MS = 3600_000; // 최초/장기부재 후 물내림에 허용하는 적립 헤드룸(=1시간, 클라 부재중 적립 상한과 동일)
// 공유 집계 연타 방어 — vid당 SHARE_DEDUP_MS 안의 반복 공유는 1회만 집계(악성 연타로 지표 부풀리기 차단).
// 클릭 즉시 클라가 emit하므로 이탈로 인한 누수는 없고, 여기서 과집계만 걸러낸다.
const shareClock = new Map(); // vid -> 마지막 공유 집계 ts(ms)
const SHARE_DEDUP_MS = 60_000;
const STRIKE_DECAY_MS = 5 * 60 * 1000; // 마지막 위반 후 이 시간 지나면 누적 strike 리셋(선량한 장기세션 보호)

/* ---------- 접속자 표시 바닥값(자동 드리프트) ----------
   빈 방 이탈 방지용 최소 표시 인원. 공개 broadcast만 max(실제, 바닥값)으로 패딩하고,
   어드민 스냅샷은 항상 실제 presence.size를 쓴다(운영자는 진짜를 봐야 함). */
let presenceFloorNow = 0;
// 공개용 표시 인원 — 실제가 바닥값보다 크면 실제값 그대로(패딩만)
function publicPresence() {
  return Math.max(presence.size, presenceFloorNow);
}
// 설정 반영 즉시 재동기화 — auto면 지금 시간대 목표치 근처로, 수동이면 상한 고정
function resyncPresenceFloor() {
  presenceFloorNow = cfg.presenceFloorAuto
    ? initialPresenceFloor(cfg.presenceFloorMax)
    : Math.max(0, Math.min(PRESENCE_FLOOR_MAX, Math.floor(cfg.presenceFloorMax) || 0));
}
// 자동 드리프트 — auto일 때만 ~10분(8~12분 지터) 간격으로 한 걸음씩 이동 후 (값 변할 때만) 브로드캐스트.
// 클럭 그리드(:00,:10…)로 안 보이게 매번 지터. 순수 연산 + 디바운스 브로드캐스트뿐 → 부하 무시 수준.
function scheduleFloorDrift() {
  const delay = 8 * 60_000 + Math.floor(Math.random() * 4 * 60_000); // 8~12분
  setTimeout(() => {
    if (cfg.presenceFloorAuto) {
      const next = driftPresenceFloor(presenceFloorNow, cfg.presenceFloorMax);
      if (next !== presenceFloorNow) { presenceFloorNow = next; broadcastPresence(); }
    }
    scheduleFloorDrift();
  }, delay);
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
    io.to("admins").emit("adminStats", adminLiveSnapshot());
  }, cfg.presenceBroadcastMs);
}

/* ---------- 5분 배치 영속 ---------- */
async function flushPersist() {
  // flushClock 정리 — 1시간 지난 항목은 기본 헤드룸과 동일해 무의미하므로 제거(메모리 보호).
  const cutoff = Date.now() - FLUSH_HEADROOM_MS;
  for (const [vid, t] of flushClock) if (t < cutoff) flushClock.delete(vid);
  // shareClock 정리 — dedup 창(60초)을 지난 항목은 무의미하므로 제거(메모리 보호).
  const shareCutoff = Date.now() - SHARE_DEDUP_MS;
  for (const [vid, t] of shareClock) if (t < shareCutoff) shareClock.delete(vid);
  if (today && todayDirty) {
    await persistToday(today);
    todayDirty = false;
  }
  if (today && hoursDirty.size) {
    await persistHours(today.date, hours, hoursDirty);
    hoursDirty.clear();
  }
  if (chatBuf.length) {
    const byDate = {};
    for (const row of chatBuf.splice(0)) (byDate[row.date] ||= []).push(row);
    for (const [date, rows] of Object.entries(byDate)) {
      await appendChatLog(date, rows.map(({ ts, hour, vid, nick, text }) => ({ ts, hour, vid, nick, text })));
    }
  }
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
  today.money = 0;
  await persistToday(today);
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
    socket.emit("adminStats", adminLiveSnapshot());
    socket.emit("adminHours", adminHoursSnapshot()); // 최초 1회는 즉시(이후엔 5분 주기로만)
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
      const h = kstHour();
      today.visits++; hours[h].visits++;
      if (p.isNew) { today.newVisitors++; hours[h].newVisitors++; }
      todayDirty = true; hoursDirty.add(h);
    }

    socket.emit("global", { total: today ? today.money : 0 });
    socket.emit("presence", { count: publicPresence() });

    // 공유페이지 방문자 — 방문 집계는 하지만 presence(실시간 볼일 중) 제외
    if (p.isShare) return;

    // 인게임 실유저 — presence에 추가하고 브로드캐스트
    let info = presence.get(vid);
    if (!info) presence.set(vid, (info = { sockets: new Set(), nick: "", since: Date.now() }));
    info.sockets.add(socket.id);
    info.nick = socket.data.nick || info.nick;

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
    const h = kstHour();
    today.chat++; hours[h].chat++;
    todayDirty = true; hoursDirty.add(h);
    const ts = now;
    chatBuf.push({ date: today.date, ts, hour: h, vid, nick, text });
    socket.broadcast.emit("chat", { name: nick, text, kind: "user" }); // 실제 옆사람(나 제외)
    if (adminsConnected()) io.to("admins").emit("adminChat", { ts, hour: h, vid, nick, text }); // 어드민 라이브
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
    // 적립 헤드룸은 vid별 마지막 물내림 기준 — 재연결해도 시계가 유지돼 도배 재무장을 막는다.
    // 최초/장기부재(>1h) 물내림만 1시간치 헤드룸을 받아 부재중 적립분(클라 상한=1시간)을 통과시킨다.
    const lastFlushAt = flushClock.get(vid) ?? now - FLUSH_HEADROOM_MS;
    const accrued = Math.ceil((MAX_PER_SEC * (now - lastFlushAt)) / 1000) + MAX_PER_SEC;
    amount = Math.min(amount, accrued, FLUSH_CAP);
    flushClock.set(vid, now);
    if (amount < 1) return;

    ensureDay();
    const h = kstHour();
    today.money += amount; hours[h].money += amount;
    today.flush++; hours[h].flush++;
    todayDirty = true; hoursDirty.add(h);

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
      chatBuf.push({ date: today.date, ts: now, hour: h, vid, nick, text: logText });
      if (adminsConnected()) io.to("admins").emit("adminChat", { ts: now, hour: h, vid, nick, text: logText });
    }
    io.emit("global", { total: today.money });
    pushAdminLive();
  });

  // 공유하기 클릭 집계 — 클라가 '클릭 즉시'(모든 await 이전) emit → 이탈로 인한 누수 없음.
  // created:true 면 자랑(명세서) URL 신규 생성(캐시미스)까지 함께 집계.
  // 악성 연타는 vid당 60초 1회로 제한(집계 왜곡 방지). 실제 URL 생성 자체를 막는 건 아님.
  socket.on("share", (p = {}) => {
    const vid = socket.data.vid;
    if (!vid) return;
    if (isBanned(vid)) return; // 섀도밴 — 집계 제외
    // 폭주 방어 — chat/flush와 동일한 슬라이딩 윈도우(rateLimitN/rateWindowMs)로 과도한 emit은 조용히 버린다.
    // 아래 60초 dedup은 '집계'만 막지만, 이건 '처리 자체'를 throttle해 이벤트루프를 보호한다(방어 심화).
    if (!rateOk(vid, "share")) return;
    const now = Date.now();
    const last = shareClock.get(vid) ?? 0;
    if (now - last < SHARE_DEDUP_MS) return; // 연타 dedup
    shareClock.set(vid, now);
    ensureDay();
    const h = kstHour();
    today.share++; hours[h].share++;
    if (p.created) { today.bragUrl++; hours[h].bragUrl++; }
    todayDirty = true; hoursDirty.add(h);
    pushAdminLive();
  });

  socket.on("disconnect", () => {
    const vid = socket.data.vid;
    if (!vid) return;
    const info = presence.get(vid);
    if (info) {
      info.sockets.delete(socket.id);
      if (info.sockets.size === 0) { presence.delete(vid); rate.delete(vid + ":chat"); rate.delete(vid + ":flush"); rate.delete(vid + ":share"); }
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
  for (const b of await loadActiveBans()) bans.set(b.vid, b.expiry);
  resyncPresenceFloor(); // 접속자 바닥값 초기화
  scheduleFloorDrift(); // 자동 드리프트 시작(auto일 때만 실제로 움직임)

  setInterval(() => flushPersist().catch((e) => console.error("[persist]", e)), cfg.persistMs);
  // 시간별 통계는 5분 배치 영속과 같은 주기로만 push(매초 폴링하지 않음) — presence/오늘/online은
  // pushAdminLive()로 변동 시점에만 디바운스 push(hello/chat/flush/disconnect에서 호출)
  setInterval(() => { if (adminsConnected()) io.to("admins").emit("adminHours", adminHoursSnapshot()); }, cfg.persistMs);

  server.listen(PORT, () => {
    console.log(`[mt-socket] :${PORT} day=${today.date} money=${today.money} visits=${today.visits} bans=${bans.size}`);
  });
}
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => { try { await flushPersist(); } catch { /* noop */ } process.exit(0); });
}
boot();
