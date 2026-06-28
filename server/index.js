/* ===================================================================
   돈버는 화장실 · 실시간 소켓 서버 (Railway, 단일 인스턴스)
   -------------------------------------------------------------------
   · 실시간 채팅/물내림/presence = 메모리 + socket.io 브로드캐스트 (Redis 안 씀)
   · 영속(통계/7일로그/밴/공유) = Upstash Redis, 이벤트 때만 기록
   · 어드민 REST = Bearer 토큰 인증(크로스오리진), 로그인 5회 잠금
   단일 인스턴스라 presence·ban캐시·rate-limit를 전부 메모리로 → 빠르고 공짜.
   =================================================================== */

import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";

import { DEFAULTS, FLUSH_CAP } from "./lib/keys.js";
import {
  loadConfig,
  setConfig,
  loadGlobal,
  loadActiveBans,
  recordVisitor,
  recordChatDurable,
  recordFlushDurable,
  getStats,
  getAdminChats,
  banVid,
  unbanVid,
  warnVid,
  listBans,
  listWarned,
  clearChats,
  resetServer,
  clean,
} from "./lib/store.js";
import {
  passwordMatches,
  createSession,
  destroySession,
  isValidSession,
  isLoginLocked,
  recordLoginFail,
  clearLoginFail,
  bearer,
} from "./lib/auth.js";

const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN ||
  "https://moneytoilet.kr,http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/* ===================== 인메모리 상태 ===================== */
let cfg = { ...DEFAULTS };
let globalMoney = 0; // 누적 '다같이 번 돈' (메모리가 라이브 진실, Redis는 영속)
let chatSeq = Date.now(); // 채팅 id (재시작 충돌 방지로 시각 시드)
const presence = new Map(); // vid -> Set(socketId)
const ring = []; // 최근 채팅 링버퍼(백필용)
const bans = new Map(); // vid -> expiry(ms) | Infinity  (영구밴=Redis복원, 자동밴=메모리만)
const rate = new Map(); // vid -> [최근 timestamp...]

/* ---------- 헬퍼 ---------- */
function isBanned(vid) {
  const exp = bans.get(vid);
  if (exp === undefined) return false;
  if (exp !== Infinity && Date.now() > exp) {
    bans.delete(vid);
    return false;
  }
  return true;
}
function rateOk(vid) {
  const now = Date.now();
  const arr = (rate.get(vid) || []).filter((t) => now - t < cfg.rateWindowMs);
  arr.push(now);
  rate.set(vid, arr);
  return arr.length <= cfg.rateLimitN;
}
function pushRing(row) {
  ring.push(row);
  while (ring.length > cfg.ringMax) ring.shift();
}
let presenceTimer = null;
let presenceDirty = false;
function broadcastPresence() {
  presenceDirty = true;
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    if (!presenceDirty) return;
    presenceDirty = false;
    io.emit("presence", { count: presence.size });
  }, cfg.presenceBroadcastMs);
}

/* ===================== Express(어드민 REST) ===================== */
const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: "16kb" }));

app.get("/", (_req, res) => res.send("ok")); // Railway 헬스체크

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// 로그인 — IP 5회 실패 시 15분 잠금
app.post("/admin/login", async (req, res) => {
  const ip = clientIp(req);
  if (await isLoginLocked(ip)) return res.status(429).json({ ok: false, error: "locked" });
  const pw = String(req.body?.password ?? "");
  if (!pw || !passwordMatches(pw)) {
    await recordLoginFail(ip);
    return res.status(401).json({ ok: false });
  }
  await clearLoginFail(ip);
  const token = await createSession();
  if (!token) return res.status(500).json({ ok: false, error: "no-store" });
  res.json({ ok: true, token });
});

// 게이트 미들웨어
async function requireAdmin(req, res, next) {
  if (await isValidSession(bearer(req))) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

app.get("/admin/me", requireAdmin, (_req, res) => res.json({ ok: true }));
app.get("/admin/stats", requireAdmin, async (_req, res) =>
  res.json({ ok: true, stats: await getStats(presence.size) }),
);
app.get("/admin/chats", requireAdmin, async (req, res) => {
  const offset = Number(req.query.offset ?? 0) || 0;
  res.json({ ok: true, chats: await getAdminChats(offset, 100) });
});
app.get("/admin/bans", requireAdmin, async (_req, res) =>
  res.json({ ok: true, bans: await listBans() }),
);
app.get("/admin/warned", requireAdmin, async (_req, res) =>
  res.json({ ok: true, warned: await listWarned() }),
);

app.post("/admin/ban", requireAdmin, async (req, res) => {
  const vid = String(req.body?.vid ?? "");
  const r = await banVid(vid, String(req.body?.duration ?? "1d"));
  if (r.ok) bans.set(vid, r.expiry); // 메모리 즉시 반영
  res.json({ ok: r.ok });
});
app.post("/admin/unban", requireAdmin, async (req, res) => {
  const vid = String(req.body?.vid ?? "");
  await unbanVid(vid);
  bans.delete(vid);
  res.json({ ok: true });
});
app.post("/admin/warn", requireAdmin, async (req, res) =>
  res.json({ ok: true, count: await warnVid(String(req.body?.vid ?? "")) }),
);
app.post("/admin/clearchat", requireAdmin, async (_req, res) => {
  await clearChats();
  ring.length = 0;
  res.json({ ok: true });
});
app.post("/admin/reset", requireAdmin, async (req, res) => {
  const scope = String(req.body?.scope ?? "");
  if (!["global", "stats", "all"].includes(scope))
    return res.status(400).json({ ok: false });
  await resetServer(scope);
  if (scope === "global" || scope === "all") {
    globalMoney = 0;
    io.emit("global", { total: 0 });
  }
  if (scope === "all") ring.length = 0;
  res.json({ ok: true });
});
app.post("/admin/broadcast", requireAdmin, async (req, res) => {
  const text = clean(req.body?.text ?? "", 120);
  if (text) {
    const row = { id: ++chatSeq, vid: "system", nick: "공지", text, kind: "system", ts: Date.now() };
    pushRing(row);
    io.emit("chat", { name: "공지", text, kind: "bot" });
  }
  res.json({ ok: true });
});
app.post("/admin/config", requireAdmin, async (req, res) => {
  await setConfig(req.body ?? {});
  cfg = await loadConfig();
  res.json({ ok: true, config: cfg });
});
app.post("/admin/logout", requireAdmin, async (req, res) => {
  await destroySession(bearer(req));
  res.json({ ok: true });
});

/* ===================== socket.io ===================== */
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  socket.data.vid = null;
  socket.data.nick = "";

  socket.on("hello", (payload = {}) => {
    const vid = String(payload.vid ?? "").slice(0, 64);
    if (!vid) return;
    socket.data.vid = vid;
    socket.data.nick = clean(payload.nick, 16);

    // presence 등록
    let set = presence.get(vid);
    if (!set) presence.set(vid, (set = new Set()));
    set.add(socket.id);

    recordVisitor(vid, socket.data.nick); // 영속(fire-and-forget)
    socket.emit("backfill", { chats: ring.slice(-cfg.backfillN) });
    socket.emit("global", { total: globalMoney });
    socket.emit("presence", { count: presence.size }); // 새 입장자 즉시 반영
    broadcastPresence(); // 나머지에게 디바운스 갱신
  });

  socket.on("chat", (payload = {}) => {
    const vid = socket.data.vid;
    if (!vid) return;
    if (payload.nick) socket.data.nick = clean(payload.nick, 16);
    const text = clean(payload.text, cfg.maxMsgLen);
    if (!text || cfg.chatDisabled) return;
    if (isBanned(vid)) return; // 섀도밴 — 조용히 폐기(본인 화면엔 이미 떠 있음)
    if (!rateOk(vid)) {
      bans.set(vid, Date.now() + cfg.autoBlockSec * 1000); // 10초 자동 차단(메모리)
      return;
    }
    const nick = socket.data.nick || "익명의 볼일러";
    const row = { id: ++chatSeq, vid, nick, text, kind: "chat", ts: Date.now() };
    pushRing(row);
    socket.broadcast.emit("chat", { name: nick, text, kind: "bot" }); // 나 빼고
    recordChatDurable(row, cfg); // 영속
  });

  socket.on("flush", (payload = {}) => {
    const vid = socket.data.vid;
    if (!vid) return;
    if (payload.nick) socket.data.nick = clean(payload.nick, 16);
    const amount = Math.floor(Number(payload.amount) || 0);
    if (amount < 1 || amount > FLUSH_CAP) return; // 서버 클램프
    if (cfg.chatDisabled || isBanned(vid) || !rateOk(vid)) return;

    globalMoney += amount; // 메모리 누적(라이브 진실)
    recordFlushDurable(amount); // 영속(fire-and-forget)

    const nick = socket.data.nick || "익명의 볼일러";
    if (payload.broadcast !== false) {
      const text = clean(payload.text, cfg.maxMsgLen);
      const row = { id: ++chatSeq, vid, nick, text, kind: "flush", ts: Date.now(), amount };
      pushRing(row);
      socket.broadcast.emit("flush", {
        name: nick,
        amount,
        total: globalMoney,
        me: false,
        chat: true,
        text,
      });
      recordChatDurable(row, cfg);
    }
    io.emit("global", { total: globalMoney }); // 모두 동기화(보낸 사람도 화해)
  });

  socket.on("disconnect", () => {
    const vid = socket.data.vid;
    if (!vid) return;
    const set = presence.get(vid);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        presence.delete(vid);
        rate.delete(vid); // 메모리 정리
      }
    }
    broadcastPresence();
  });
});

/* ===================== 부팅 ===================== */
async function boot() {
  cfg = await loadConfig();
  globalMoney = await loadGlobal();
  const active = await loadActiveBans();
  for (const b of active) bans.set(b.vid, b.expiry);
  server.listen(PORT, () => {
    console.log(`[mt-socket] listening :${PORT}`);
    console.log(`[mt-socket] origins: ${ALLOWED_ORIGINS.join(", ")}`);
    console.log(`[mt-socket] global=${globalMoney} bans=${bans.size}`);
  });
}
boot();
