/* ===================================================================
   돈버는 화장실 · 실시간 소켓 서버 (Railway, 단일 인스턴스)
   -------------------------------------------------------------------
   라이브(메모리): 동접 presence · 오늘 카운터(방문자/채팅/물내림/다같이번돈)
                   · 시간별 24버킷 · 밴캐시 · rate-limit · 채팅 버퍼
   영속(Redis, 5분 배치): 날짜키 1개에 일일 스냅샷(JSON) + 시간별
                          채팅로그는 날짜별 LIST에 append(3일 TTL)
                          밴/경고는 변경 시에만 즉시 write
   → Upstash 무료 500k/월 보호 (대략 월 2~3만 commands).
   =================================================================== */

import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";

import {
  DEFAULTS, FLUSH_CAP, MAX_PER_SEC, kstDateKey, kstHour, lastDateKeys,
} from "./lib/keys.js";
import {
  loadConfig, setConfig, persistDay, loadDay, loadDays,
  appendChatLog, loadChatLog, loadActiveBans,
  banVid, unbanVid, warnVid, listBans, listWarned, resetAll, clean,
} from "./lib/store.js";
import {
  passwordMatches, createSession, destroySession, isValidSession,
  isLoginLocked, recordLoginFail, clearLoginFail, bearer,
} from "./lib/auth.js";

const PORT = process.env.PORT || 4000;

/* ===================== 인메모리 상태 ===================== */
let cfg = { ...DEFAULTS };
const presence = new Map(); // vid -> { sockets:Set, nick, since }
const bans = new Map(); // vid -> expiry(ms)|Infinity
const chatBuf = []; // [{date,ts,hour,vid,nick,text}] 5분마다 flush
let day = null; // 오늘 라이브 카운터

function emptyHours() {
  return Array.from({ length: 24 }, () => ({ visitors: 0, chat: 0, flush: 0, money: 0 }));
}
function newDay(date) {
  return {
    date,
    day: { visitors: 0, chat: 0, flush: 0, money: 0 },
    hours: emptyHours(),
    seen: new Set(), // 일 단위 dedup(라이브)
    seenHour: Array.from({ length: 24 }, () => new Set()),
  };
}
function ensureDay() {
  const d = kstDateKey();
  if (day && day.date === d) return;
  if (day) flushPersist().catch(() => {}); // 자정 롤오버 — 이전 날 저장
  day = newDay(d);
}
function markVisitor(vid) {
  ensureDay();
  const h = kstHour();
  if (!day.seen.has(vid)) { day.seen.add(vid); day.day.visitors++; }
  if (!day.seenHour[h].has(vid)) { day.seenHour[h].add(vid); day.hours[h].visitors++; }
}

/* ---------- 어뷰징 게이트 ---------- */
function isBanned(vid) {
  const exp = bans.get(vid);
  if (exp === undefined) return false;
  if (exp !== Infinity && Date.now() > exp) { bans.delete(vid); return false; }
  return true;
}
const rate = new Map(); // vid -> [ts...]
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

/* ---------- 5분 배치 영속 ---------- */
async function flushPersist() {
  if (day) {
    const blob = {
      date: day.date,
      updatedAt: Date.now(),
      day: { ...day.day },
      hours: day.hours.map((h) => ({ ...h })),
    };
    await persistDay(day.date, blob);
  }
  if (chatBuf.length) {
    const byDate = {};
    for (const row of chatBuf.splice(0)) (byDate[row.date] ||= []).push(row);
    for (const [date, rows] of Object.entries(byDate)) {
      await appendChatLog(date, rows.map(({ ts, hour, vid, nick, text }) => ({ ts, hour, vid, nick, text })));
    }
  }
}

/* ===================== Express (어드민 REST) ===================== */
const app = express();
app.set("trust proxy", true); // Railway 엣지 뒤 — req.ip 신뢰
app.use(cors()); // 공개 채팅 + 토큰 인증이라 오리진 전부 허용(연결 문제 원천 제거)
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

// 오늘(메모리·라이브) + 어제·엊그제(Redis) + 시간별
app.get("/admin/stats", requireAdmin, async (_req, res) => {
  ensureDay();
  const [today, ...prevDates] = lastDateKeys(3); // [오늘, 어제, 엊그제]
  const prev = await loadDays(prevDates);
  const liveToday = {
    date: today, source: "live",
    day: { ...day.day },
    hours: day.hours.map((h) => ({ ...h })),
  };
  const history = prevDates.map((date, i) => {
    const b = prev[i];
    return b
      ? { date, source: "redis", day: b.day, hours: b.hours }
      : { date, source: "empty", day: { visitors: 0, chat: 0, flush: 0, money: 0 }, hours: emptyHours() };
  });
  res.json({ ok: true, presence: presence.size, days: [liveToday, ...history] });
});

// 실시간 접속자 리스트
app.get("/admin/online", requireAdmin, (_req, res) => {
  const list = [...presence.entries()].map(([vid, info]) => ({
    vid, nick: info.nick || "", conns: info.sockets.size, since: info.since,
    banned: isBanned(vid),
  }));
  list.sort((a, b) => a.since - b.since);
  res.json({ ok: true, online: list });
});

// 날짜별 채팅로그 (오늘은 메모리 버퍼까지 합쳐 최신 반영)
app.get("/admin/chatlog", requireAdmin, async (req, res) => {
  const date = String(req.query.date || kstDateKey());
  const stored = await loadChatLog(date);
  const buffered = chatBuf.filter((r) => r.date === date)
    .map(({ ts, hour, vid, nick, text }) => ({ ts, hour, vid, nick, text, warnCount: 0 }));
  res.json({ ok: true, date, chats: [...stored, ...buffered] });
});

app.get("/admin/bans", requireAdmin, async (_req, res) => res.json({ ok: true, bans: await listBans() }));
app.get("/admin/warned", requireAdmin, async (_req, res) => res.json({ ok: true, warned: await listWarned() }));

app.post("/admin/ban", requireAdmin, async (req, res) => {
  const vid = String(req.body?.vid ?? "");
  const r = await banVid(vid, String(req.body?.duration ?? "1d"));
  if (r.ok) bans.set(vid, r.expiry); // 즉시 라이브 반영(다음 채팅부터 섀도밴)
  res.json({ ok: r.ok });
});
app.post("/admin/unban", requireAdmin, async (req, res) => {
  const vid = String(req.body?.vid ?? "");
  await unbanVid(vid); bans.delete(vid);
  res.json({ ok: true });
});
app.post("/admin/warn", requireAdmin, async (req, res) =>
  res.json({ ok: true, count: await warnVid(String(req.body?.vid ?? "")) }));
app.post("/admin/broadcast", requireAdmin, (req, res) => {
  const text = clean(req.body?.text ?? "", 120);
  if (text) io.emit("chat", { name: "공지", text, kind: "bot" });
  res.json({ ok: true });
});
app.post("/admin/config", requireAdmin, async (req, res) => {
  await setConfig(req.body ?? {}); cfg = await loadConfig();
  res.json({ ok: true, config: cfg });
});
app.post("/admin/reset", requireAdmin, async (req, res) => {
  const scope = String(req.body?.scope ?? "all");
  await resetAll();
  day = newDay(kstDateKey()); chatBuf.length = 0;
  io.emit("global", { total: 0 });
  res.json({ ok: true, scope });
});

/* ===================== socket.io ===================== */
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ["GET", "POST"] } });

io.on("connection", (socket) => {
  socket.data.vid = null;
  socket.data.nick = "";
  socket.data.lastFlushAt = Date.now();

  socket.on("hello", (p = {}) => {
    const incoming = String(p.vid ?? "").slice(0, 64);
    if (!incoming) return;
    if (!socket.data.vid) socket.data.vid = incoming; // vid 소켓당 고정(회전 차단)
    const vid = socket.data.vid;
    socket.data.nick = clean(p.nick, 16);

    let info = presence.get(vid);
    if (!info) presence.set(vid, (info = { sockets: new Set(), nick: "", since: Date.now() }));
    info.sockets.add(socket.id);
    info.nick = socket.data.nick || info.nick;
    markVisitor(vid);

    socket.emit("backfill", { chats: [] });
    socket.emit("global", { total: day.day.money });
    socket.emit("presence", { count: presence.size });
    broadcastPresence();
  });

  socket.on("chat", (p = {}) => {
    const vid = socket.data.vid;
    if (!vid) return;
    if (p.nick) { socket.data.nick = clean(p.nick, 16); const i = presence.get(vid); if (i) i.nick = socket.data.nick; }
    const text = clean(p.text, cfg.maxMsgLen);
    if (!text || cfg.chatDisabled) return;
    if (isBanned(vid)) return; // 섀도밴
    if (!rateOk(vid)) { bans.set(vid, Date.now() + cfg.autoBlockSec * 1000); return; } // 10초 자동차단
    const nick = socket.data.nick || "익명의 볼일러";
    ensureDay();
    const h = kstHour();
    day.day.chat++; day.hours[h].chat++;
    chatBuf.push({ date: day.date, ts: Date.now(), hour: h, vid, nick, text });
    socket.broadcast.emit("chat", { name: nick, text, kind: "bot" });
  });

  socket.on("flush", (p = {}) => {
    const vid = socket.data.vid;
    if (!vid) return;
    if (p.nick) { socket.data.nick = clean(p.nick, 16); const i = presence.get(vid); if (i) i.nick = socket.data.nick; }
    let amount = Math.floor(Number(p.amount) || 0);
    if (amount < 1) return;
    if (cfg.chatDisabled || isBanned(vid) || !rateOk(vid)) return;
    // 서버측 적립 클램프 — 경과시간 × 최대초당 (금액 조작/그리핑 방지)
    const now = Date.now();
    const accrued = Math.ceil((MAX_PER_SEC * (now - socket.data.lastFlushAt)) / 1000) + MAX_PER_SEC;
    amount = Math.min(amount, accrued, FLUSH_CAP);
    socket.data.lastFlushAt = now;
    if (amount < 1) return;

    ensureDay();
    const h = kstHour();
    day.day.money += amount; day.hours[h].money += amount;
    day.day.flush++; day.hours[h].flush++;

    const nick = socket.data.nick || "익명의 볼일러";
    if (p.broadcast !== false) {
      const text = clean(p.text, cfg.maxMsgLen);
      socket.broadcast.emit("flush", { name: nick, amount, total: day.day.money, me: false, chat: true, text });
    }
    io.emit("global", { total: day.day.money });
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
  });
});

/* ===================== 부팅 / 종료 ===================== */
async function boot() {
  cfg = await loadConfig();
  day = newDay(kstDateKey());
  const blob = await loadDay(day.date); // 재시작 복구(카운트만, seen은 초기화)
  if (blob) {
    day.day = { ...day.day, ...blob.day };
    if (Array.isArray(blob.hours)) day.hours = blob.hours.map((h) => ({ visitors: 0, chat: 0, flush: 0, money: 0, ...h }));
  }
  for (const b of await loadActiveBans()) bans.set(b.vid, b.expiry);

  setInterval(() => flushPersist().catch((e) => console.error("[persist]", e)), cfg.persistMs);

  server.listen(PORT, () => {
    console.log(`[mt-socket] :${PORT} day=${day.date} money=${day.day.money} bans=${bans.size}`);
  });
}
// 배포 재시작(SIGTERM) 전에 마지막 플러시 — 데이터 손실 최소화
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    try { await flushPersist(); } catch { /* noop */ }
    process.exit(0);
  });
}
boot();
