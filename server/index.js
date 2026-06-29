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

import { DEFAULTS, FLUSH_CAP, MAX_PER_SEC, kstDateKey, kstHour, emptyBucket } from "./lib/keys.js";
import {
  loadConfig, setConfig, persistToday, loadToday, persistHours, loadHours,
  appendChatLog, loadActiveBans, banVid, unbanVid, listBans, resetStats, clean,
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
  return { date, visits: 0, newVisitors: 0, chat: 0, flush: 0, money: 0 };
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
function rateOk(vid) {
  const now = Date.now();
  const arr = (rate.get(vid) || []).filter((t) => now - t < cfg.rateWindowMs);
  arr.push(now);
  rate.set(vid, arr);
  return arr.length <= cfg.rateLimitN;
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
    io.emit("presence", { count: presence.size });
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
  return { presence: presence.size, today: { ...today }, online: onlineList() };
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
app.post("/admin/config", requireAdmin, async (req, res) => {
  await setConfig(req.body ?? {}); cfg = await loadConfig();
  res.json({ ok: true, config: cfg });
});
app.post("/admin/reset", requireAdmin, async (_req, res) => {
  await resetStats();
  today = freshToday(kstDateKey()); hours = Array.from({ length: 24 }, emptyBucket); chatBuf.length = 0;
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
  socket.data.lastFlushAt = Date.now();

  // 연결 즉시 현재 상태 1회 전송 — 'hello'를 보내지 않는 수동 관전자(공유페이지 등)도
  // presence/오늘 합계를 바로 볼 수 있게(이 emit 자체는 presence/visits에 영향 없음)
  ensureDay();
  socket.emit("presence", { count: presence.size });
  socket.emit("global", { total: today.money });

  socket.on("hello", (p = {}) => {
    const incoming = String(p.vid ?? "").slice(0, 64);
    if (!incoming) return;
    if (!socket.data.vid) socket.data.vid = incoming; // vid 소켓당 고정
    const vid = socket.data.vid;
    socket.data.nick = clean(p.nick, 16);

    let info = presence.get(vid);
    if (!info) presence.set(vid, (info = { sockets: new Set(), nick: "", since: Date.now() }));
    info.sockets.add(socket.id);
    info.nick = socket.data.nick || info.nick;

    // 방문 카운트 — 소켓당 1회, 새 페이지진입(fresh)일 때만(재연결 제외)
    if (!socket.data.counted && p.fresh) {
      socket.data.counted = true;
      ensureDay();
      const h = kstHour();
      today.visits++; hours[h].visits++;
      if (p.isNew) { today.newVisitors++; hours[h].newVisitors++; } // 신규 UUID
      todayDirty = true; hoursDirty.add(h);
    }

    socket.emit("global", { total: today ? today.money : 0 });
    socket.emit("presence", { count: presence.size });
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
    if (!rateOk(vid)) { bans.set(vid, Date.now() + cfg.autoBlockSec * 1000); return; }
    const nick = socket.data.nick || "익명의 볼일러";
    ensureDay();
    const h = kstHour();
    today.chat++; hours[h].chat++;
    todayDirty = true; hoursDirty.add(h);
    const ts = Date.now();
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
    if (cfg.chatDisabled || isBanned(vid) || !rateOk(vid)) return;
    const now = Date.now();
    const accrued = Math.ceil((MAX_PER_SEC * (now - socket.data.lastFlushAt)) / 1000) + MAX_PER_SEC;
    amount = Math.min(amount, accrued, FLUSH_CAP);
    socket.data.lastFlushAt = now;
    if (amount < 1) return;

    ensureDay();
    const h = kstHour();
    today.money += amount; hours[h].money += amount;
    today.flush++; hours[h].flush++;
    todayDirty = true; hoursDirty.add(h);

    const nick = socket.data.nick || "익명의 볼일러";
    if (p.broadcast !== false) {
      const text = clean(p.text, cfg.maxMsgLen);
      const kind = p.kind === "capped" ? "capped" : undefined; // 1시간 동결 후 물내림 — 다른 유저 화면에 코믹하게 구분 표시
      socket.broadcast.emit("flush", { name: nick, amount, total: today.money, me: false, chat: true, text, kind });
    }
    io.emit("global", { total: today.money });
    pushAdminLive();
  });

  socket.on("disconnect", () => {
    const vid = socket.data.vid;
    if (!vid) return;
    const info = presence.get(vid);
    if (info) {
      info.sockets.delete(socket.id);
      if (info.sockets.size === 0) { presence.delete(vid); rate.delete(vid); }
    }
    broadcastPresence();
    pushAdminLive();
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
