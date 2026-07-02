"use client";

/* 어드민 대시보드 (모바일 우선)
   - 라이브(presence/오늘/online/실시간채팅): 어드민 전용 소켓 push
   - 과거(시간별/채팅로그): Vercel API(공유 Redis, 토큰검증)
   - 로그인/밴/공지: 소켓서버(Railway) REST */

import { useCallback, useEffect, useRef, useState } from "react";
import { activeNoticeFrom } from "@/lib/notices";
import { io, type Socket } from "socket.io-client";
import StatsChart from "./StatsChart";

// share: 공유하기, donate: 후원하기, brag: 자랑하기(단순 클릭) / dwellSec: 체류시간 집계(Σ 동접×초)
type Bucket = { visits: number; newVisitors: number; chat: number; flush: number; money: number; share: number; donate: number; brag: number; dwellSec: number };
type Online = { vid: string; nick: string; conns: number; since: number; banned: boolean };
// '오늘' 관측한 유저(채팅서버가 준 오늘치 접속로그 + 현재 online 기반). 이탈해도 이탈 표기로 남긴다.
// initialNick/nickChanged: 오늘 최초 닉 대비 현재 닉 변경 여부(닉변 배지용, 오늘 기준).
type Tracked = Online & { status: "online" | "left"; leftAt?: number; reconnects: number; initialNick?: string; nickChanged?: boolean };
type ConnRow = { ts: number; type: "join" | "leave"; vid: string; nick: string };
type ChatRow = { ts: number; hour: number; vid: string; nick: string; text: string };
type ReceiptRow = { id: string; ts: number; n: string; t: number; f: number };
type BanRow = { vid: string; expiry: number | null };
// 서버가 "adminStats"(라이브: presence/today/online)와 "adminHours"(5분 주기)를 분리 push하므로
// 클라에서는 부분 갱신을 병합해서 들고 있어야 함(매번 전체 스냅샷이 오지 않음).
type Live = { presence: number; floor: number; today: Bucket & { date: string }; hours: Bucket[]; online: Online[] };
type LiveStats = Pick<Live, "presence" | "floor" | "today" | "online">;
type LiveHours = Pick<Live, "hours">;

const SOCKET_BASE = (
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost" ? "http://localhost:4000" : "")
).replace(/\/$/, "");
const TOKEN_KEY = "mt_admin_token";
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };

const won = (n: number) => (n || 0).toLocaleString("ko-KR");
const hhmm = (ts: number) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const EMPTY: Bucket = { visits: 0, newVisitors: 0, chat: 0, flush: 0, money: 0, share: 0, donate: 0, brag: 0, dwellSec: 0 };
// 통계탭 시간별 표 컬럼 — 한눈에 다 보이게(모바일) 9열 고정: 시간 + 아래 8개
const HOUR_COLS: { key: keyof Bucket; label: string }[] = [
  { key: "visits", label: "방문" }, { key: "newVisitors", label: "신규" },
  { key: "chat", label: "채팅" }, { key: "flush", label: "물내림" },
  { key: "share", label: "공유" }, { key: "donate", label: "후원" }, { key: "brag", label: "자랑" },
  { key: "money", label: "금액" },
];
const sumDay = (hours: Bucket[]) => hours.reduce((a, h) => ({
  visits: a.visits + h.visits, newVisitors: a.newVisitors + h.newVisitors,
  chat: a.chat + h.chat, flush: a.flush + h.flush, money: a.money + h.money,
  share: a.share + (h.share || 0), donate: a.donate + (h.donate || 0), brag: a.brag + (h.brag || 0),
  dwellSec: a.dwellSec + (h.dwellSec || 0),
}), { ...EMPTY });
// 체류초 → 사람이 읽는 길이("3시간 20분" / "12분 5초" / "45초")
const fmtDur = (sec: number) => {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분 ${ss}초`;
  return `${ss}초`;
};
const DURATIONS = [{ v: "1d", t: "1일" }, { v: "3d", t: "3일" }, { v: "7d", t: "1주" }, { v: "30d", t: "1달" }, { v: "perm", t: "영구" }];

// 채팅/접속 로그 누적 병합(dedupe) — 재접속 시 서버 스냅샷과 기존 상태를 합쳐 '이미 받은 것'을 지우지 않는다.
const CHAT_KEEP = 3000, CONN_KEEP = 20000;
function mergeChats(prev: ChatRow[], incoming: ChatRow[]): ChatRow[] {
  const seen = new Set(prev.map((c) => `${c.ts}|${c.vid}|${c.text}`));
  const add = incoming.filter((c) => !seen.has(`${c.ts}|${c.vid}|${c.text}`));
  if (!add.length) return prev;
  const out = [...add, ...prev];
  return out.length > CHAT_KEEP ? out.slice(0, CHAT_KEEP) : out;
}
function mergeConns(prev: ConnRow[], incoming: ConnRow[]): ConnRow[] {
  const seen = new Set(prev.map((c) => `${c.ts}|${c.type}|${c.vid}`));
  const add = incoming.filter((c) => !seen.has(`${c.ts}|${c.type}|${c.vid}`));
  if (!add.length) return prev;
  const out = [...prev, ...add];
  return out.length > CONN_KEEP ? out.slice(out.length - CONN_KEEP) : out;
}
// 오늘치 접속로그 + 현재 online 목록 → 동접/이탈 파생(오늘 기준). reconnects = 첫 입장 이후의 재입장 횟수.
function deriveTracked(connLog: ConnRow[], online: Online[], nickByVid: Record<string, string>): Tracked[] {
  const byVid: Record<string, Tracked & { joins: number }> = {};
  for (const row of [...connLog].sort((a, b) => a.ts - b.ts)) {
    let t = byVid[row.vid];
    if (!t) t = byVid[row.vid] = { vid: row.vid, nick: row.nick || "", conns: 0, since: row.ts, banned: false, status: "left", reconnects: 0, joins: 0 };
    if (row.nick) t.nick = row.nick;
    if (row.type === "join") {
      t.joins++; t.status = "online";
      if (row.ts < t.since) t.since = row.ts;
      if (!t.initialNick && row.nick) t.initialNick = row.nick; // 오늘 최초 닉
    } else { t.status = "left"; t.leftAt = row.ts; }
  }
  const onlineVids = new Set<string>();
  for (const o of online) {
    onlineVids.add(o.vid);
    let t = byVid[o.vid];
    if (!t) t = byVid[o.vid] = { ...o, initialNick: o.nick, status: "online", reconnects: 0, joins: 1 };
    t.status = "online"; t.conns = o.conns; t.banned = o.banned;
    if (o.nick) t.nick = o.nick;
    if (!t.initialNick && o.nick) t.initialNick = o.nick;
    if (o.since && o.since < t.since) t.since = o.since;
  }
  const out: Tracked[] = [];
  for (const vid of Object.keys(byVid)) {
    const t = byVid[vid];
    if (t.status === "online" && !onlineVids.has(vid)) { t.status = "left"; if (!t.leftAt) t.leftAt = t.since; } // 지금 online 아니면 이탈
    const nick = nickByVid[vid] || t.nick || "";
    out.push({
      vid, nick, conns: t.conns, since: t.since, banned: t.banned, status: t.status, leftAt: t.leftAt,
      reconnects: Math.max(0, t.joins - 1),
      initialNick: t.initialNick,
      nickChanged: !!(t.initialNick && nick && nick !== t.initialNick), // 오늘 최초 닉 ≠ 현재 닉
    });
  }
  return out;
}

// KST 날짜 (daysAgo: 0=오늘 1=어제 2=엊그제)
const dateOf = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * 86400000 + 9 * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

async function rail(path: string, opts?: RequestInit) {
  const token = getToken();
  const res = await fetch(`${SOCKET_BASE}/admin/${path}`, {
    cache: "no-store", headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...opts,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function vercel(path: string) {
  const token = getToken();
  const res = await fetch(`/api/admin/${path}`, { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

export default function AdminDashboard() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"stats" | "chart" | "online" | "liveChat" | "chatlog" | "receipts" | "bans" | "ops">("stats");
  const [opsTab, setOpsTab] = useState<"boost" | "chat" | "notice" | "ops">("boost");
  const [cfgSaved, setCfgSaved] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [liveChats, setLiveChats] = useState<ChatRow[]>([]);
  // vid → 최신 닉네임 맵 — adminChat/adminStats 수신 시마다 갱신.
  // 라이브 채팅 렌더 시 이 맵을 우선 사용해 닉네임 변경을 소급 반영.
  const [nickByVid, setNickByVid] = useState<Record<string, string>>({});
  // 동접자 추적 — 채팅서버가 준 '오늘치 접속로그' + 현재 online 목록으로 파생(오늘 기준, 어드민 로그인 시점 무관).
  // 서버 재기동/자정 리셋으로 스냅샷이 비어도, 이미 받은 로그는 새로고침 전까지 브라우저에 남는다(누적 dedupe).
  const [connLog, setConnLog] = useState<ConnRow[]>([]);
  const [histChats, setHistChats] = useState<Record<string, ChatRow[]>>({});
  const [histHours, setHistHours] = useState<Record<string, Bucket[]>>({});
  const [bans, setBans] = useState<BanRow[]>([]);
  const [expandDates, setExpandDates] = useState<Set<string>>(new Set(["오늘"])); // 여러 날짜 동시 expand
  const [dur, setDur] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  // 정렬/검색/공지
  const [chatSort, setChatSort] = useState<"new" | "old">("new");
  const [chatQ, setChatQ] = useState("");
  const [chatlogDay, setChatlogDay] = useState(0); // 채팅로그 서브탭: 0=오늘 1=어제 2=엊그제 3=그끄저께
  const [chatlogLoading, setChatlogLoading] = useState(false);
  // 자랑URL 탭 — 날짜별 생성 목록
  const [histReceipts, setHistReceipts] = useState<Record<string, ReceiptRow[]>>({});
  const [receiptDay, setReceiptDay] = useState(0); // 0=오늘 1=어제 2=엊그제 3=그끄저께
  const [receiptLoading, setReceiptLoading] = useState(false);
  const loadedReceiptDatesRef = useRef<Set<string>>(new Set());
  const [excludeFlush, setExcludeFlush] = useState(false);
  const [onSort, setOnSort] = useState<"new" | "old">("new");
  const [onQ, setOnQ] = useState("");
  const [bc, setBc] = useState("");
  const [bcSent, setBcSent] = useState(false);
  // 채팅 레이트리밋 + 공지 설정
  type NoticeEntry = { text: string; start?: string; end?: string; url?: string };
  type CfgState = { chatDisabled: boolean; rateLimitN: number; rateWindowMs: number; chatMinIntervalMs: number; autoBlockSec: number; maxMsgLen: number; notices: NoticeEntry[]; presenceFloorAuto: boolean; presenceFloorMax: number };
  const CFG_DEFAULTS: CfgState = { chatDisabled: false, rateLimitN: 7, rateWindowMs: 10000, chatMinIntervalMs: 700, autoBlockSec: 10, maxMsgLen: 40, notices: [], presenceFloorAuto: true, presenceFloorMax: 3 };
  const [cfg, setCfg] = useState<CfgState>(CFG_DEFAULTS);
  const [cfgLoaded, setCfgLoaded] = useState(false);
  const sockRef = useRef<Socket | null>(null);
  const loadedChatDatesRef = useRef<Set<string>>(new Set()); // 과거 채팅로그 메모리 캐시 적중 판정용
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2000); };

  useEffect(() => {
    (async () => { if (!getToken()) return setAuthed(false); const { status } = await rail("me"); setAuthed(status === 200); })();
  }, []);

  useEffect(() => {
    if (!authed) return;
    // 재접속 시에도 기존 로그를 지우지 않는다(누적 dedupe) — 서버 재기동/자정 리셋으로 스냅샷이 비어도 유지.
    const sock = io(SOCKET_BASE || undefined, { auth: { adminToken: getToken() }, transports: ["websocket", "polling"], reconnection: true });
    sockRef.current = sock;
    sock.on("adminStats", (d: LiveStats) => {
      // 온라인 목록에서 vid→nick 최신화(닉변 소급 반영). 동접자 파생은 connLog+online에서 렌더 시 계산.
      if (d.online) {
        setNickByVid((prev) => {
          const next = { ...prev };
          for (const o of d.online) if (o.nick && o.vid) next[o.vid] = o.nick;
          return next;
        });
      }
      setLive((prev) => ({ ...(prev as Live), ...d }) as Live);
    });
    sock.on("adminHours", (d: LiveHours) => setLive((prev) => ({ ...(prev as Live), ...d }) as Live));
    sock.on("adminChat", (c: ChatRow) => {
      // 채팅 수신 시점의 nick으로 맵 업데이트 — 닉 변경 시 이전 메시지도 소급 반영
      if (c.nick && c.vid) setNickByVid((prev) => ({ ...prev, [c.vid]: c.nick }));
      setLiveChats((prev) => mergeChats(prev, [c]));
    });
    // 오늘 하루치 접속 로그 이벤트(입장/이탈) — 오늘 기준 동접/이탈/재접속 파생용
    sock.on("adminConn", (row: ConnRow) => setConnLog((prev) => mergeConns(prev, [row])));
    // 접속 즉시 서버가 주는 '오늘 전체' 스냅샷 — 어드민 로그인 이후분만이 아니라 하루치 전체
    sock.on("adminTodayLog", (d: { chats: ChatRow[]; conns: ConnRow[] }) => {
      if (d.chats?.length) setLiveChats((prev) => mergeChats(prev, d.chats));
      if (d.conns?.length) setConnLog((prev) => mergeConns(prev, d.conns));
    });
    return () => { sock.close(); sockRef.current = null; };
  }, [authed]);

  const loadCfg = useCallback(async () => {
    const { data } = await rail("config");
    if (data.ok && data.config) setCfg({ ...CFG_DEFAULTS, ...data.config });
    setCfgLoaded(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const saveCfg = async () => {
    const { data } = await rail("config", { method: "POST", body: JSON.stringify(cfg) });
    if (data.ok) { setCfg({ ...CFG_DEFAULTS, ...data.config }); setCfgSaved(true); setTimeout(() => setCfgSaved(false), 2000); }
    else flash("저장 실패");
  };
  const loadBans = useCallback(async () => { const { data } = await rail("bans"); if (data.ok) setBans(data.bans || []); }, []);
  useEffect(() => {
    if (!authed) return;
    loadCfg();
    loadBans();
    for (const ago of [1, 2]) {
      const date = dateOf(ago);
      vercel(`hours?date=${date}`).then(({ data }) => { if (data.ok) setHistHours((p) => ({ ...p, [date]: data.hours })); });
    }
  }, [authed, loadBans]);

  // 채팅로그 로더 — 오늘(ago=0)은 채팅서버 라이브(liveChats)로 보여주므로 Redis 조회 안 함.
  // 과거(ago>=1)만 Redis에서 조회하고, 불변이라 메모리 캐시 적중 시 재요청하지 않는다.
  const loadChatlog = useCallback(async (ago: number) => {
    if (ago === 0) return; // 오늘은 소켓 라이브 사용
    const date = dateOf(ago);
    if (loadedChatDatesRef.current.has(date)) return;
    setChatlogLoading(true);
    const { data } = await vercel(`chatlog?date=${date}`);
    if (data.ok) {
      loadedChatDatesRef.current.add(date);
      setHistChats((p) => ({ ...p, [date]: data.chats || [] }));
    }
    setChatlogLoading(false);
  }, []);
  useEffect(() => {
    if (!authed || tab !== "chatlog") return;
    loadChatlog(chatlogDay); // 선택된 서브탭 날짜만 로드(과거는 캐시 적중 시 무요청)
  }, [authed, tab, chatlogDay, loadChatlog]);

  // 자랑URL 로더 — 채팅로그와 동일 정책(과거는 메모리 캐시, 오늘은 항상 라이브).
  const loadReceipts = useCallback(async (ago: number) => {
    const date = dateOf(ago);
    if (ago >= 1 && loadedReceiptDatesRef.current.has(date)) return;
    setReceiptLoading(true);
    const bust = ago === 0 ? `&_t=${Date.now()}` : "";
    const { data } = await vercel(`receipts?date=${date}${bust}`);
    if (data.ok) {
      loadedReceiptDatesRef.current.add(date);
      setHistReceipts((p) => ({ ...p, [date]: data.receipts || [] }));
    }
    setReceiptLoading(false);
  }, []);
  useEffect(() => {
    if (!authed || tab !== "receipts") return;
    loadReceipts(receiptDay);
  }, [authed, tab, receiptDay, loadReceipts]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const { status, data } = await rail("login", { method: "POST", body: JSON.stringify({ password: pw }) });
    if (status === 200 && data.token) { try { localStorage.setItem(TOKEN_KEY, data.token); } catch { /* */ } setAuthed(true); setPw(""); }
    else if (status === 429) setErr("시도가 너무 많아 잠겼습니다. 15분 후 다시.");
    else setErr("비밀번호가 틀렸습니다");
  };
  const logout = async () => { await rail("logout", { method: "POST", body: "{}" }); try { localStorage.removeItem(TOKEN_KEY); } catch { /* */ } setAuthed(false); };
  const ban = async (vid: string) => {
    const d = dur[vid] ?? "1d";
    const durLabel = DURATIONS.find((x) => x.v === d)?.t ?? d;
    if (!confirm(`이 사용자를 ${durLabel} 차단할까요?\n${vid}`)) return;
    const { data } = await rail("ban", { method: "POST", body: JSON.stringify({ vid, duration: d }) });
    if (data.ok) { flash("차단됨"); loadBans(); } else flash("실패");
  };
  const unban = async (vid: string) => {
    if (!confirm(`이 사용자의 차단을 해제할까요?\n${vid}`)) return;
    const { data } = await rail("unban", { method: "POST", body: JSON.stringify({ vid }) });
    if (data.ok) { flash("해제됨"); loadBans(); }
  };
  // 자랑 URL 수동 삭제 — 오클릭 방지 confirm 허들 후 삭제(콘텐츠+목록). 삭제 즉시 목록에서 제거.
  const delReceipt = async (date: string, id: string) => {
    if (!confirm(`자랑 URL /r/${id} 을(를) 삭제할까요?\n공유 링크가 즉시 만료되며 되돌릴 수 없습니다.`)) return;
    const token = getToken();
    const res = await fetch(`/api/admin/receipts?date=${date}&id=${id}`, {
      method: "DELETE", cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setHistReceipts((p) => ({ ...p, [date]: (p[date] || []).filter((rc) => rc.id !== id) }));
      flash("삭제됨");
    } else flash("삭제 실패");
  };
  const resetMoney = async () => {
    if (!confirm("'다같이 번 돈'과 오늘 시간·분 금액 기록을 모두 0으로 초기화할까요?\n되돌릴 수 없습니다.")) return;
    await rail("reset-money", { method: "POST", body: "{}" });
    flash("초기화됨");
  };
  const sendBc = async () => {
    const t = bc.trim();
    if (!t) return;
    await rail("broadcast", { method: "POST", body: JSON.stringify({ text: t }) });
    setBc("");
    setBcSent(true);
    setTimeout(() => setBcSent(false), 2000);
  };

  if (authed === null) return <div style={s.wrap}>{css}로딩중…</div>;
  if (!authed) return (
    <div style={s.wrap}>{css}
      <form onSubmit={login} style={s.loginBox}>
        <h1 style={s.h1}>🚽 MoneyToilet 어드민</h1>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="비밀번호" style={s.input} autoFocus />
        <button type="submit" style={s.btnPrimary}>로그인</button>
        {err && <div style={s.err}>{err}</div>}
      </form>
    </div>
  );

  const dayCards = [
    { ago: 0, label: "오늘", hours: live?.hours, live: true },
    { ago: 1, label: "어제", hours: histHours[dateOf(1)], live: false },
    { ago: 2, label: "엊그제", hours: histHours[dateOf(2)], live: false },
  ];

  // 채팅로그 필터/정렬
  // 오늘(liveChat 탭 · 채팅로그 '오늘' 서브탭)은 채팅서버 라이브(liveChats), 어제~는 Redis(histChats).
  const baseChats = tab === "liveChat" || (tab === "chatlog" && chatlogDay === 0)
    ? liveChats
    : (histChats[dateOf(chatlogDay)] || []);
  const q1 = chatQ.trim().toLowerCase();
  const chats = [...baseChats]
    .filter((c) => {
      if (excludeFlush && c.text.startsWith("💰")) return false;
      if (!q1) return true;
      // 현재채팅은 nickByVid 우선 — 닉 변경 후에도 새 닉으로 검색 가능
      const nick = (tab === "liveChat" ? nickByVid[c.vid] || c.nick : c.nick) || "";
      return c.text.toLowerCase().includes(q1) || nick.toLowerCase().includes(q1) || c.vid.toLowerCase().includes(q1);
    })
    .sort((a, b) => (chatSort === "new" ? b.ts - a.ts : a.ts - b.ts));
  // 접속자/이탈자 — 오늘치 접속로그(connLog) + 현재 online에서 파생(오늘 기준).
  const q2 = onQ.trim().toLowerCase();
  const trackedArr = deriveTracked(connLog, live?.online || [], nickByVid)
    .filter((o) => !q2 || (o.nick || "").toLowerCase().includes(q2) || o.vid.toLowerCase().includes(q2));
  const onlines = trackedArr
    .filter((o) => o.status === "online")
    .sort((a, b) => (onSort === "new" ? b.since - a.since : a.since - b.since));
  const leftUsers = trackedArr
    .filter((o) => o.status === "left")
    .sort((a, b) => (b.leftAt || 0) - (a.leftAt || 0)); // 최근 이탈 먼저
  // vid별 오늘 채팅/물내림 횟수 — 라이브 채팅로그에서 파생(물내림 로그는 "💰"로 시작).
  const countsByVid: Record<string, { chat: number; flush: number }> = {};
  for (const c of liveChats) {
    if (!c.vid) continue;
    const m = countsByVid[c.vid] || (countsByVid[c.vid] = { chat: 0, flush: 0 });
    if (c.text.startsWith("💰")) m.flush++; else m.chat++;
  }
  // 동접 행 태그 — 있는 데이터만: [닉변][재접N][챗N][내림N][차단]
  const onlineTags = (o: Tracked) => {
    const c = countsByVid[o.vid] || { chat: 0, flush: 0 };
    return (
      <>
        {o.nickChanged && <span style={s.nickTag}>닉변</span>}
        {o.reconnects > 0 && <span style={s.tag}>재접속 {o.reconnects}</span>}
        {c.chat > 0 && <span style={s.tag}>채팅 {c.chat}</span>}
        {c.flush > 0 && <span style={s.tag}>물내림 {c.flush}</span>}
        {o.banned && <span style={s.banTag}>차단</span>}
      </>
    );
  };
  // 자랑URL — 선택 날짜의 생성 목록(최신순)
  const receiptRows = [...(histReceipts[dateOf(receiptDay)] || [])].sort((a, b) => b.ts - a.ts);

  const toggleExpandDate = (label: string) => {
    setExpandDates((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div style={s.wrap}>{css}
      <header style={s.top}>
        <b>🚽 어드민</b>
        <div style={s.headRight}>
          <span style={s.headStat}>
            <span className="admin-live-dot">●</span> 실제 <b style={s.liveReal}>{live?.presence ?? 0}</b> · 표시 <b style={s.liveShown}>{(live?.presence ?? 0) + (live?.floor ?? 0)}</b>명
          </span>
          <span style={s.headMoney}>오늘 다같이 <b style={s.headMoneyV}>{won(live?.today?.money ?? 0)}</b>원</span>
        </div>
        <button onClick={logout} style={s.btnGhost}>로그아웃</button>
      </header>
      <nav style={s.tabs}>
        {([["stats", "통계"], ["chart", "차트"], ["online", "동접"], ["liveChat", "챗 Now"], ["chatlog", "챗 Log"], ["receipts", "자랑"], ["bans", "차단"], ["ops", "🛠 제어"]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...s.tab, ...(tab === k ? s.tabOn : {}) }}>{t}</button>
        ))}
      </nav>
      {msg && <div style={s.toast}>{msg}</div>}

      {tab === "stats" && (
        <div>
          {dayCards.map((d) => {
            const key = d.label;
            const isExpanded = expandDates.has(key);
            // 오늘은 서버의 실제 today 사용, 어제/엊그제는 hours 합계
            const totals = d.ago === 0 && live?.today ? live.today : (d.hours ? sumDay(d.hours) : EMPTY);
            return (
              <div key={key} style={s.card}>
                <div style={s.cardHead} onClick={() => toggleExpandDate(key)}>
                  <b style={s.dayLabel}>{d.label}</b>
                  <span style={s.dayDate}>{dateOf(d.ago)}</span>
                  {d.live && <span style={s.liveBadge}>LIVE</span>}
                  <span style={s.chevron}>{isExpanded ? "시간별 ▴" : "시간별 ▾"}</span>
                </div>
                <div style={s.sumGrid}>
                  {([
                    ["방문", won(totals.visits)],
                    ["신규", won(totals.newVisitors)],
                    ["채팅", won(totals.chat)],
                    ["물내림", won(totals.flush)],
                    ["공유", won(totals.share)],
                    ["후원", won(totals.donate)],
                    ["자랑", won(totals.brag)],
                    ["평균체류", totals.visits ? fmtDur(totals.dwellSec / totals.visits) : "-"],
                  ] as [string, string][]).map(([l, v]) => (
                    <div key={l} style={s.sumCell}>
                      <span style={s.sumCellL}>{l}</span>
                      <span style={s.sumCellV}>{v}</span>
                    </div>
                  ))}
                </div>
                {isExpanded && (
                  <div style={s.htableWrap}>
                    <table style={s.htable}>
                      <thead>
                        <tr>
                          <th style={{ ...s.th, textAlign: "left" }}>시간</th>
                          {HOUR_COLS.map((c) => <th key={c.key} style={s.th}>{c.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {(d.hours || Array.from({ length: 24 }, () => EMPTY)).map((h, hr) => {
                          const zero = HOUR_COLS.every((c) => !h[c.key]);
                          return (
                            <tr key={hr} style={zero ? { opacity: 0.4 } : undefined}>
                              <td style={{ ...s.td, textAlign: "left", color: "#7ff0b0" }}>{String(hr).padStart(2, "0")}:00</td>
                              {HOUR_COLS.map((c) => (
                                <td key={c.key} style={s.td}>{c.key === "money" ? won(h.money) : (h[c.key] || 0)}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "chart" && <StatsChart />}

      {tab === "ops" && (
        <div>
          <div style={s.subtabs}>
            {([["boost", "👥 부스트"], ["chat", "💬 채팅"], ["notice", "📢 공지"], ["ops", "💸 운영"]] as const).map(([k, t]) => (
              <button key={k} onClick={() => setOpsTab(k)} style={{ ...s.subtab, ...(opsTab === k ? s.subtabOn : {}) }}>{t}</button>
            ))}
          </div>

          {/* 저장 인라인 피드백 */}
          {cfgSaved && <div style={s.saveOk}>✓ 저장됨</div>}

          {opsTab === "boost" && (
            <div style={s.card}>
              <div style={s.cardTitle}>👥 드리프트 인원 부스트</div>
              <div style={s.cfgDesc}>실제 접속자에 드리프트 인원을 더해 표시합니다. 시간대 패턴(직장인 기준)으로 0~최대값 사이를 자동 조절하며, 사용자는 실시간 인원 변동을 체감합니다. 통계·이 화면의 접속 숫자는 항상 실제값입니다.</div>
              <div style={{ ...s.note, marginTop: 8, marginBottom: 0 }}>
                드리프트 <b style={{ color: "#ffd233" }}>+{live?.floor ?? 0}명</b> 적용 중 · 실제 접속 <b style={{ color: "#7ff0b0" }}>{live?.presence ?? 0}명</b> · 표시 <b style={{ color: "#fff" }}>{(live?.presence ?? 0) + (live?.floor ?? 0)}명</b>
              </div>
              <label style={s.cfgRow}>
                <div><div style={s.cfgLabel}>드리프트 최대 추가 인원</div><div style={s.cfgDesc}>0~9. 1명 입장 시 최대 이 수만큼 더해 보임. 오픈 초기엔 3 권장 (0=끔)</div></div>
                <div style={s.cfgInputWrap}><input type="number" min={0} max={9} value={cfg.presenceFloorMax} style={s.cfgNum} onChange={(e) => setCfg((p) => ({ ...p, presenceFloorMax: Math.max(0, Math.min(9, Math.floor(Number(e.target.value)) || 0)) }))} /><span style={s.cfgUnit}>명</span></div>
              </label>
              <button style={{ ...s.btnPrimary, width: "100%", marginTop: 8 }} onClick={saveCfg}>저장</button>
            </div>
          )}

          {opsTab === "chat" && (
            <div style={s.card}>
              <div style={s.cardTitle}>💬 채팅 제어</div>
              {!cfgLoaded ? <div style={s.dim2}>불러오는 중…</div> : (<>
                <label style={s.cfgRow}>
                  <div><div style={s.cfgLabel}>🚨 긴급 채팅 차단</div><div style={s.cfgDesc}>ON 즉시 모든 유저 채팅 전면 차단</div></div>
                  <input type="checkbox" checked={cfg.chatDisabled} onChange={(e) => setCfg((p) => ({ ...p, chatDisabled: e.target.checked }))} />
                </label>
                <label style={s.cfgRow}>
                  <div><div style={s.cfgLabel}>최대 채팅 횟수</div><div style={s.cfgDesc}>아래 시간창 안에 이 횟수 초과하면 서버 차단</div></div>
                  <div style={s.cfgInputWrap}><input type="number" min={1} max={50} value={cfg.rateLimitN} style={s.cfgNum} onChange={(e) => setCfg((p) => ({ ...p, rateLimitN: Number(e.target.value) }))} /><span style={s.cfgUnit}>회</span></div>
                </label>
                <label style={s.cfgRow}>
                  <div><div style={s.cfgLabel}>측정 시간창</div><div style={s.cfgDesc}>위 횟수를 세는 슬라이딩 윈도우 길이</div></div>
                  <div style={s.cfgInputWrap}><input type="number" min={1} max={60} value={cfg.rateWindowMs / 1000} style={s.cfgNum} onChange={(e) => setCfg((p) => ({ ...p, rateWindowMs: Number(e.target.value) * 1000 }))} /><span style={s.cfgUnit}>초</span></div>
                </label>
                <label style={s.cfgRow}>
                  <div><div style={s.cfgLabel}>연타 방지 간격</div><div style={s.cfgDesc}>같은 사람 연속 채팅 시 최소 대기시간. 미만이면 무시</div></div>
                  <div style={s.cfgInputWrap}><input type="number" min={0} max={10} step={0.1} value={cfg.chatMinIntervalMs / 1000} style={s.cfgNum} onChange={(e) => setCfg((p) => ({ ...p, chatMinIntervalMs: Math.round(Number(e.target.value) * 1000) }))} /><span style={s.cfgUnit}>초</span></div>
                </label>
                <label style={s.cfgRow}>
                  <div><div style={s.cfgLabel}>도배 차단 시간</div><div style={s.cfgDesc}>도배 감지 시 1회 차단. 반복 위반할수록 배수로 늘어남</div></div>
                  <div style={s.cfgInputWrap}><input type="number" min={1} max={300} value={cfg.autoBlockSec} style={s.cfgNum} onChange={(e) => setCfg((p) => ({ ...p, autoBlockSec: Number(e.target.value) }))} /><span style={s.cfgUnit}>초</span></div>
                </label>
                <label style={s.cfgRow}>
                  <div><div style={s.cfgLabel}>메시지 최대 길이</div><div style={s.cfgDesc}>초과 글자는 서버에서 조용히 잘라냄</div></div>
                  <div style={s.cfgInputWrap}><input type="number" min={10} max={200} value={cfg.maxMsgLen} style={s.cfgNum} onChange={(e) => setCfg((p) => ({ ...p, maxMsgLen: Number(e.target.value) }))} /><span style={s.cfgUnit}>자</span></div>
                </label>
                <button style={{ ...s.btnPrimary, width: "100%", marginTop: 8 }} onClick={saveCfg}>저장</button>
              </>)}
            </div>
          )}

          {opsTab === "notice" && (
            <div style={s.card}>
              <div style={s.cardTitle}>📢 공지 배너</div>
              <div style={s.cfgDesc}>활성 공지 1건이 상단에 흘러가는 배너로 표시됩니다. 날짜 생략 시 즉시·무한 노출.</div>
              {cfg.notices.length === 0 && <div style={{ ...s.cfgDesc, marginTop: 10, textAlign: "center" }}>등록된 공지 없음</div>}
              {cfg.notices.map((n, i) => {
                const isActive = !!n.text.trim() && activeNoticeFrom(cfg.notices)?.text === n.text.trim();
                const upd = (patch: Partial<typeof n>) => setCfg((p) => { const ns = [...p.notices]; ns[i] = { ...ns[i], ...patch }; return { ...p, notices: ns }; });
                return (
                  <div key={i} style={s.noticeCard}>
                    <div style={s.noticeCardHead}>
                      <span style={{ fontSize: 11, color: isActive ? "#7ff0b0" : "#5a7a6a", fontWeight: isActive ? 700 : 400 }}>{isActive ? "● 현재 표시 중" : "○ 비활성"}</span>
                      <button style={s.btnSm} onClick={() => { if (!confirm("이 공지를 삭제할까요? (저장 전까지는 되돌릴 수 있음)")) return; setCfg((p) => ({ ...p, notices: p.notices.filter((_, j) => j !== i) })); }}>삭제</button>
                    </div>
                    <div style={s.cfgDesc}>공지 문구 *</div>
                    <input value={n.text} style={{ ...s.noticeInput, width: "100%", marginTop: 3, boxSizing: "border-box" as const }} placeholder="서버 점검 예정" onChange={(e) => upd({ text: e.target.value })} />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <div style={{ flex: 1 }}>
                        <div style={s.cfgDesc}>시작 (생략=즉시)</div>
                        <input value={n.start || ""} style={{ ...s.noticeInput, width: "100%", marginTop: 3, boxSizing: "border-box" as const }} placeholder="2026-07-05" onChange={(e) => upd({ start: e.target.value || undefined })} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={s.cfgDesc}>종료 (생략=무한)</div>
                        <input value={n.end || ""} style={{ ...s.noticeInput, width: "100%", marginTop: 3, boxSizing: "border-box" as const }} placeholder="2026-07-05T12:00" onChange={(e) => upd({ end: e.target.value || undefined })} />
                      </div>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <div style={s.cfgDesc}>URL (선택 — 클릭 시 이동)</div>
                      <input value={n.url || ""} style={{ ...s.noticeInput, width: "100%", marginTop: 3, boxSizing: "border-box" as const }} placeholder="https://..." onChange={(e) => upd({ url: e.target.value || undefined })} />
                    </div>
                  </div>
                );
              })}
              <button style={{ ...s.btnGhost, width: "100%", marginTop: 8 }} onClick={() => setCfg((p) => ({ ...p, notices: [...p.notices, { text: "" }] }))}>+ 공지 추가</button>
              <button style={{ ...s.btnPrimary, width: "100%", marginTop: 8 }} onClick={saveCfg}>저장</button>
            </div>
          )}

          {opsTab === "ops" && (
            <div style={s.card}>
              <div style={s.cardTitle}>💸 운영</div>
              <button style={{ ...s.btnDanger, width: "100%" }} onClick={resetMoney}>다같이 번 돈 초기화</button>
            </div>
          )}
        </div>
      )}

      {tab === "online" && (
        <div>
          <div style={s.ctrlRow}>
            <input style={s.search} placeholder="검색: 닉네임 / UUID" value={onQ} onChange={(e) => setOnQ(e.target.value)} />
            <button style={s.sortBtn} onClick={() => setOnSort((v) => (v === "new" ? "old" : "new"))}>{onSort === "new" ? "최신순" : "과거순"}</button>
          </div>
          <div style={s.note}>접속 {onlines.length}명 · 이탈 {leftUsers.length}명 (오늘 · 어드민 제외)</div>
          {onlines.length === 0 && leftUsers.length === 0 && <Empty />}
          {onlines.map((o) => (
            <LogRow
              key={o.vid}
              nick={o.nick || "익명"}
              time={`${hhmm(o.since)}~`}
              vid={o.vid}
              tags={onlineTags(o)}
              dur={dur}
              setDur={setDur}
              onBan={ban}
            />
          ))}
          {leftUsers.length > 0 && <div style={s.leftDivider}>👋 이탈자 {leftUsers.length}명</div>}
          {leftUsers.map((o) => (
            <LogRow
              key={o.vid}
              muted
              nick={o.nick || "익명"}
              time={`${hhmm(o.since)}~${o.leftAt ? hhmm(o.leftAt) : ""}`}
              vid={o.vid}
              tags={onlineTags(o)}
              dur={dur}
              setDur={setDur}
              onBan={ban}
            />
          ))}
        </div>
      )}

      {tab === "liveChat" && (
        <div>
          <div style={s.bcBox}>
            {!bcSent ? (
              <>
                <input style={s.bcInput} placeholder="관리자 채팅 보내기 (모든 사용자에게)" value={bc}
                  onChange={(e) => setBc(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendBc(); }} maxLength={120} />
                <button style={s.sendBtn} onClick={sendBc}>📢 전송</button>
              </>
            ) : (
              <div style={s.bcSentMsg}>✓ 관리자 채팅 전송됨</div>
            )}
          </div>
          <div style={s.ctrlRow}>
            <input style={s.search} placeholder="검색: 메시지 / 닉네임 / UUID" value={chatQ} onChange={(e) => setChatQ(e.target.value)} />
            <button style={s.sortBtn} onClick={() => setChatSort((v) => (v === "new" ? "old" : "new"))}>{chatSort === "new" ? "최신순" : "과거순"}</button>
            <button style={{ ...s.sortBtn, ...(excludeFlush ? s.filterOn : {}) }} onClick={() => setExcludeFlush((v) => !v)}>💰제외</button>
          </div>
          <div style={s.note}>{chats.length}건 (오늘 · 실시간)</div>
          {chats.length === 0 && <Empty />}
          {chats.map((c, i) => {
            // 라이브 채팅은 nickByVid 우선 — 닉 변경 시 이전 메시지도 최신 닉으로 갱신
            const displayNick = nickByVid[c.vid] || c.nick || "익명";
            return (
              <LogRow
                key={i}
                nick={displayNick}
                time={hhmm(c.ts)}
                message={c.text}
                vid={c.vid}
                dur={dur}
                setDur={setDur}
                onBan={ban}
              />
            );
          })}
        </div>
      )}

      {tab === "chatlog" && (
        <div>
          <div style={s.subtabs}>
            {["오늘", "어제", "엊그제", "그끄저께"].map((label, i) => (
              <button key={label} onClick={() => setChatlogDay(i)} style={{ ...s.subtab, ...(chatlogDay === i ? s.subtabOn : {}) }}>{label}</button>
            ))}
          </div>
          <div style={s.ctrlRow}>
            <input style={s.search} placeholder="검색: 메시지 / 닉네임 / UUID" value={chatQ} onChange={(e) => setChatQ(e.target.value)} />
            <button style={s.sortBtn} onClick={() => setChatSort((v) => (v === "new" ? "old" : "new"))}>{chatSort === "new" ? "최신순" : "과거순"}</button>
            <button style={{ ...s.sortBtn, ...(excludeFlush ? s.filterOn : {}) }} onClick={() => setExcludeFlush((v) => !v)}>💰제외</button>
          </div>
          <div style={s.note}>
            {dateOf(chatlogDay)} · {chats.length}건{chatlogDay === 0 ? " · 채팅서버 라이브(오늘 전체)" : " · 보관본(메모리 캐시)"}
          </div>
          {chatlogLoading && chats.length === 0 ? <div style={s.empty}>불러오는 중…</div> : chats.length === 0 ? <Empty /> : null}
          {chats.map((c, i) => (
            <LogRow
              key={`${c.ts}-${i}`}
              nick={c.nick || "익명"}
              time={hhmm(c.ts)}
              message={c.text}
              vid={c.vid}
              dur={dur}
              setDur={setDur}
              onBan={ban}
            />
          ))}
        </div>
      )}

      {tab === "receipts" && (
        <div>
          <div style={s.subtabs}>
            {["오늘", "어제", "엊그제", "그끄저께"].map((label, i) => (
              <button key={label} onClick={() => setReceiptDay(i)} style={{ ...s.subtab, ...(receiptDay === i ? s.subtabOn : {}) }}>{label}</button>
            ))}
          </div>
          <div style={s.note}>
            {dateOf(receiptDay)} · {receiptRows.length}건 생성{receiptDay === 0 ? " · 실시간" : " · 보관본(메모리 캐시)"}
            {receiptDay === 0 && (
              <button style={{ ...s.sortBtn, marginLeft: 8, padding: "3px 9px" }} onClick={() => loadReceipts(0)} disabled={receiptLoading} title="오늘 목록 새로고침">{receiptLoading ? "…" : "🔄"}</button>
            )}
          </div>
          <div style={s.receiptHint}>💡 "열기 ↗"는 새 탭에서 공유 페이지 · "삭제"는 확인 후 공유 링크를 즉시 만료시킵니다</div>
          {receiptLoading && receiptRows.length === 0 ? <div style={s.empty}>불러오는 중…</div> : receiptRows.length === 0 ? <Empty /> : null}
          {receiptRows.map((rc) => (
            <div key={rc.id} style={s.receiptRow}>
              <div style={s.rowHead}>
                <b style={s.rowNick}>{rc.n || "익명"}</b>
                <span style={s.receiptAmt}>{won(rc.t)}원</span>
                <span style={s.rowTime}>{hhmm(rc.ts)}</span>
              </div>
              <div style={s.receiptFoot}>
                <code style={s.receiptId}>/r/{rc.id}</code>
                <span style={s.receiptFlush}>물내림 {rc.f}회</span>
                <a href={`/r/${rc.id}`} target="_blank" rel="noopener noreferrer" style={s.receiptOpen}>열기 ↗</a>
                <button style={s.receiptDel} onClick={() => delReceipt(dateOf(receiptDay), rc.id)}>삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "bans" && (
        <div>
          <div style={s.ctrlRow}>
            <div style={{ ...s.note, marginBottom: 0 }}>차단 중 {bans.length}명 · 만료 시 자동 해제</div>
            <button style={{ ...s.sortBtn, marginLeft: "auto" }} onClick={loadBans}>🔄 새로고침</button>
          </div>
          {bans.length === 0 && <Empty />}
          {bans.map((b) => (
            <div key={b.vid} style={s.crow}>
              <div style={s.cline}><span style={s.dim}>{b.expiry === null ? "영구 차단" : `~${new Date(b.expiry).toLocaleString("ko-KR", { hour12: false })}`}</span></div>
              <div style={s.cfoot}><code style={s.uuid}>{b.vid}</code><button style={s.btnSm} onClick={() => unban(b.vid)}>해제</button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty() { return <div style={s.empty}>데이터 없음</div>; }

// 채팅/동접 공통 카드 — [닉네임 (태그)] ………… [시간(우측끝)] / (메시지) / [UUID][차단]
function LogRow({ nick, time, message, vid, tags, dur, setDur, onBan, muted }: {
  nick: string; time: string; message?: string | null; vid: string; tags?: React.ReactNode;
  dur: Record<string, string>; setDur: (f: (p: Record<string, string>) => Record<string, string>) => void; onBan: (v: string) => void; muted?: boolean;
}) {
  // 동접·챗 공용 3영역 카드: (1) 닉 · 시간  (2) 내용=메시지 또는 태그(전폭, 자연 줄바꿈)  (3) uuid · 차단
  return (
    <div style={muted ? { ...s.crow, ...s.crowMuted } : s.crow}>
      <div style={s.rowHead}>
        <b style={s.rowNick}>{nick}</b>
        <span style={s.rowTime}>{time}</span>
      </div>
      {message ? (
        <div style={s.rowBody}>{message}</div>
      ) : tags ? (
        <div style={s.rowTags}>{tags}</div>
      ) : null}
      <div style={s.cfoot}>
        <code style={s.uuid}>{vid}</code>
        <BanCtl vid={vid} dur={dur} setDur={setDur} onBan={onBan} />
      </div>
    </div>
  );
}
function BanCtl({ vid, dur, setDur, onBan }: { vid: string; dur: Record<string, string>; setDur: (f: (p: Record<string, string>) => Record<string, string>) => void; onBan: (v: string) => void }) {
  return (
    <span style={s.banCtl}>
      <select value={dur[vid] ?? "1d"} onChange={(e) => setDur((p) => ({ ...p, [vid]: e.target.value }))} style={s.select}>
        {DURATIONS.map((d) => <option key={d.v} value={d.v}>{d.t}</option>)}
      </select>
      <button style={s.btnSm} onClick={() => onBan(vid)}>차단</button>
    </span>
  );
}

const css = <style>{`html,body{overflow-y:auto!important;height:auto!important;min-height:100%;position:static!important;background:#0f1512;margin:0}*{box-sizing:border-box}button{cursor:pointer}button:active{transform:translateY(1px)}input{outline:none}.admin-live-dot{opacity:.55}`}</style>;
const s: Record<string, React.CSSProperties> = {
  wrap: { fontFamily: "system-ui,-apple-system,sans-serif", color: "#e7efe9", background: "#0f1512", minHeight: "100vh", padding: 10, maxWidth: 780, margin: "0 auto" },
  loginBox: { display: "flex", flexDirection: "column", gap: 12, marginTop: 80 },
  h1: { fontSize: 20, textAlign: "center" },
  input: { padding: 14, fontSize: 16, borderRadius: 10, border: "1px solid #2c3a32", background: "#16201b", color: "#fff" },
  err: { color: "#ff8a8a", textAlign: "center" },
  top: { display: "flex", alignItems: "center", gap: 10, padding: "4px 2px 10px", position: "sticky", top: 0, background: "#0f1512", zIndex: 10 },
  headRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1, marginLeft: "auto" },
  headStat: { color: "#8fa89a", fontSize: 11.5, whiteSpace: "nowrap" },
  headMoney: { color: "#8fa89a", fontSize: 11, whiteSpace: "nowrap" },
  headMoneyV: { color: "#ffd84d", fontWeight: 700, fontVariantNumeric: "tabular-nums" as const },
  liveReal: { color: "#7ff0b0", fontVariantNumeric: "tabular-nums" as const },
  liveShown: { color: "#ffffff", fontVariantNumeric: "tabular-nums" as const },
  tabs: { display: "flex", gap: 4, marginBottom: 10, overflowX: "auto" },
  tab: { flex: 1, padding: "10px 4px", borderRadius: 9, borderWidth: 1, borderStyle: "solid", borderColor: "#2c3a32", background: "#16201b", color: "#9fb3a6", fontSize: 12, whiteSpace: "nowrap" },
  tabOn: { background: "#ffd233", color: "#1a1a1a", borderColor: "#ffd233", fontWeight: 700 },
  toast: { position: "sticky", top: 44, background: "#1f6b45", padding: "7px 12px", borderRadius: 8, marginBottom: 8, textAlign: "center", zIndex: 9 },
  note: { color: "#8fa89a", fontSize: 12, margin: "0 2px 8px" },
  ctrlRow: { display: "flex", gap: 6, marginBottom: 8 },
  search: { flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #2c3a32", background: "#16201b", color: "#e7efe9", fontSize: 13 },
  sortBtn: { padding: "8px 12px", borderRadius: 8, border: "1px solid #2c3a32", background: "#1d2a23", color: "#ffd233", fontSize: 12, whiteSpace: "nowrap" },
  bcBox: { display: "flex", gap: 6, marginBottom: 8 },
  bcInput: { flex: 1, padding: "9px 11px", borderRadius: 8, border: "1px solid #5a4a1a", background: "#211c0e", color: "#ffe7a0", fontSize: 13 },
  sendBtn: { padding: "9px 13px", borderRadius: 8, border: "none", background: "#ffd233", color: "#1a1a1a", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" },
  bcSentMsg: { flex: 1, padding: "9px 11px", borderRadius: 8, background: "rgba(127, 240, 176, 0.15)", color: "#7ff0b0", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" },
  card: { background: "#16201b", border: "1px solid #243029", borderRadius: 12, padding: 12, marginBottom: 10 },
  cardHead: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, cursor: "pointer" },
  cardTitle: { fontSize: 13, color: "#8fa89a", marginBottom: 8 },
  chevron: { marginLeft: "auto", fontSize: 11.5, color: "#8fa89a", fontWeight: 500 },
  // 계층: 날짜 라벨(1) > 번 돈 히어로(2) > 나머지 지표(3, 볼드 없이 담백하게)
  dayLabel: { fontSize: 15, fontWeight: 800, color: "#eafff5" },
  dayDate: { fontSize: 11, color: "#6f8378", fontVariantNumeric: "tabular-nums" as const },
  liveBadge: { fontSize: 9.5, fontWeight: 800, color: "#0d120f", background: "#7ff0b0", padding: "1px 5px", borderRadius: 4, letterSpacing: 0.3 },
  // 요약 — 아주 작은 그리드(상하배치 셀). 값 볼드/노랑 없이 통일. 번 돈은 값이 길어 전폭(gridColumn 1/-1).
  sumGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "7px 8px" },
  sumCell: { display: "flex", flexDirection: "column", gap: 2, padding: "6px 9px", background: "#12190f", borderRadius: 7, minWidth: 0 },
  sumCellL: { fontSize: 10.5, color: "#8fa89a" },
  sumCellV: { fontSize: 14, fontWeight: 600, color: "#e7efe9", fontVariantNumeric: "tabular-nums" as const, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  // 시간별 테이블 — 차트 탭 테이블과 동일 톤(불투명 sticky 헤더). 24행 무스크롤(페이지 스크롤 사용)
  htableWrap: { border: "1px solid #243029", borderRadius: 8, marginTop: 12, overflowX: "auto" },
  htable: { width: "100%", borderCollapse: "collapse" as const, fontSize: 11.5, fontVariantNumeric: "tabular-nums" as const },
  th: { position: "sticky" as const, top: 0, zIndex: 1, background: "#0d120f", color: "#cfe5d8", textAlign: "right" as const, padding: "8px 7px", borderBottom: "1px solid #33463b", fontWeight: 700, whiteSpace: "nowrap" as const, boxShadow: "0 2px 5px rgba(0,0,0,0.5)" },
  tr: {},
  td: { textAlign: "right" as const, padding: "5px 7px", borderBottom: "1px solid #161f1a", color: "#d7e6dd", whiteSpace: "nowrap" as const },
  tdTime: { color: "#7ff0b0", fontWeight: 700, textAlign: "left" as const },
  btnPrimary: { padding: 14, borderRadius: 10, border: "none", background: "#ffd233", color: "#1a1a1a", fontSize: 16, fontWeight: 700 },
  btnGhost: { padding: "7px 11px", borderRadius: 8, border: "1px solid #2c3a32", background: "transparent", color: "#9fb3a6", fontSize: 12 },
  btnDanger: { padding: 11, borderRadius: 9, border: "1px solid #5a2630", background: "#2a1518", color: "#ff9a9a", fontSize: 13 },
  cfgRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid #1e2b24", cursor: "default" },
  cfgLabel: { fontSize: 13, color: "#c8ddd4", fontWeight: 500 },
  cfgDesc: { fontSize: 11, color: "#5a7a6a", marginTop: 2, lineHeight: 1.4 },
  cfgInputWrap: { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 },
  cfgUnit: { fontSize: 12, color: "#5a7a6a", flexShrink: 0 },
  cfgNum: { width: 64, padding: "4px 6px", borderRadius: 6, border: "1px solid #2c3a32", background: "#0e1812", color: "#e8f5ee", fontSize: 13, textAlign: "right" as const },
  noticeCard: { background: "#0e1812", border: "1px solid #2c3a32", borderRadius: 8, padding: "10px 10px 12px", marginTop: 10 },
  noticeCardHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  noticeInput: { padding: "6px 8px", borderRadius: 6, border: "1px solid #2c3a32", background: "#141d18", color: "#e8f5ee", fontSize: 12, display: "block" },
  // 채팅로그 서브탭 [오늘][어제][엊그제][그끄저께]
  subtabs: { display: "flex", gap: 4, marginBottom: 8 },
  subtab: { flex: 1, padding: "7px 4px", borderRadius: 8, border: "1px solid #2c3a32", background: "#16201b", color: "#9fb3a6", fontSize: 12.5, whiteSpace: "nowrap" },
  subtabOn: { background: "#1f6b45", color: "#fff", borderColor: "#1f6b45", fontWeight: 700 },
  // 채팅/동접 공통 카드 — 개선된 레이아웃(닉 좌측, 시간 우측끝)
  crow: { background: "#141d18", border: "1px solid #1f2a23", borderRadius: 7, padding: "8px", marginBottom: 4 },
  rowHead: { display: "flex", alignItems: "baseline", gap: 8, lineHeight: 1.35 },
  rowNick: { fontSize: 12.5, color: "#ffd84d", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "72%" },
  rowTime: { marginLeft: "auto", fontSize: 10.5, color: "#7ff0b0", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  rowTags: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" as const, marginTop: 5 },
  rowBody: { marginTop: 5, fontSize: 13, color: "#e7efe9", wordBreak: "break-word", lineHeight: 1.4 },
  cline: { display: "flex", alignItems: "baseline", gap: 6, fontSize: 13, flexWrap: "wrap", lineHeight: 1.35 },
  clineNew: { display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, lineHeight: 1.4 },
  time: { fontSize: 10, color: "#7ff0b0", whiteSpace: "nowrap", minWidth: 42, fontVariantNumeric: "tabular-nums" },
  nick: { fontSize: 12.5, color: "#ffd84d", fontWeight: 600, whiteSpace: "nowrap", minWidth: 60, borderRight: "1px solid #2c3a32", paddingRight: 8 },
  msg: { flex: 1, color: "#e7efe9", wordBreak: "break-word" },
  nb: { fontSize: 12.5, color: "#cfe5d8", whiteSpace: "nowrap" },
  ctx: { wordBreak: "break-word", color: "#e7efe9", flex: 1 },
  cfoot: { display: "flex", alignItems: "center", gap: 6, marginTop: 5 },
  uuid: { fontSize: 10, color: "#6f8378", background: "#0f1512", padding: "2px 6px", borderRadius: 4, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", userSelect: "all" },
  tag: { fontSize: 10, background: "#3a2f12", color: "#ffd233", padding: "1px 5px", borderRadius: 4 },
  banTag: { fontSize: 10, background: "#3a1f12", color: "#ffb27f", padding: "1px 5px", borderRadius: 4 },
  leftTag: { fontSize: 10, background: "#26302b", color: "#9fb3a6", padding: "1px 5px", borderRadius: 4 },
  nickTag: { fontSize: 10, background: "#1a2a3a", color: "#7fd0ff", padding: "1px 5px", borderRadius: 4 },
  filterOn: { background: "#1a3a25", color: "#7ff0b0", borderColor: "#1f6b45" },
  saveOk: { background: "rgba(127,240,176,0.15)", color: "#7ff0b0", border: "1px solid #1f6b45", borderRadius: 8, padding: "8px 12px", textAlign: "center" as const, fontSize: 13, fontWeight: 700, marginBottom: 8 },
  crowMuted: { opacity: 0.5 },
  leftDivider: { color: "#8fa89a", fontSize: 11.5, fontWeight: 700, margin: "12px 2px 6px", borderTop: "1px dashed #2c3a32", paddingTop: 10 },
  dim: { color: "#7a8c80", fontSize: 11, marginLeft: "auto", whiteSpace: "nowrap" },
  dim2: { color: "#7a8c80", fontSize: 11 },
  banCtl: { display: "flex", gap: 5, alignItems: "center" },
  select: { padding: 5, borderRadius: 6, border: "1px solid #2c3a32", background: "#0f1512", color: "#e7efe9", fontSize: 11 },
  btnSm: { padding: "5px 11px", borderRadius: 6, border: "1px solid #5a2630", background: "#2a1518", color: "#ff9a9a", fontSize: 12, whiteSpace: "nowrap" },
  empty: { textAlign: "center", color: "#6f8378", padding: 30 },
  // 자랑URL 카드 — 통째로 탭 가능한 링크(모바일 큰 터치 영역)
  receiptHint: { fontSize: 11.5, color: "#8fa89a", margin: "0 2px 8px" },
  receiptRow: { display: "block", textDecoration: "none", background: "#141d18", border: "1px solid #24463a", borderRadius: 9, padding: "10px 11px", marginBottom: 6 },
  receiptAmt: { fontSize: 13, fontWeight: 800, color: "#ffd84d", marginLeft: 8, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  receiptFoot: { display: "flex", alignItems: "center", gap: 8, marginTop: 7, flexWrap: "wrap" as const },
  receiptId: { fontSize: 11, color: "#7fd0ff", background: "#0f1b22", padding: "2px 6px", borderRadius: 5, wordBreak: "break-all" },
  receiptFlush: { fontSize: 11, color: "#9fb3a6" },
  receiptOpen: { marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "#7ff0b0", whiteSpace: "nowrap", textDecoration: "none" },
  receiptDel: { fontSize: 11.5, fontWeight: 700, color: "#ff9a9a", background: "#2a1518", border: "1px solid #5a2630", borderRadius: 6, padding: "3px 10px", whiteSpace: "nowrap" },
};
