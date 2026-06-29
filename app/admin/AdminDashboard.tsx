"use client";

/* 어드민 대시보드 (모바일 우선)
   - 라이브(presence/오늘/online/실시간채팅): 어드민 전용 소켓(admins 룸) push — REST 안 탐
   - 과거(시간별/채팅로그): Vercel API가 공유 Redis 조회 — 토큰 검증(단일 ADMIN_SECRET, Railway만)
   - 로그인/밴: 소켓서버(Railway) REST */

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

type Bucket = { visits: number; newVisitors: number; chat: number; flush: number; money: number };
type Online = { vid: string; nick: string; conns: number; since: number; banned: boolean };
type ChatRow = { ts: number; hour: number; vid: string; nick: string; text: string };
type BanRow = { vid: string; expiry: number | null };
type Live = { presence: number; today: Bucket & { date: string }; hours: Bucket[]; online: Online[] };

const SOCKET_BASE = (
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost" ? "http://localhost:4000" : "")
).replace(/\/$/, "");
const TOKEN_KEY = "mt_admin_token";
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };

const won = (n: number) => (n || 0).toLocaleString("ko-KR");
const hhmm = (ts: number) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const EMPTY: Bucket = { visits: 0, newVisitors: 0, chat: 0, flush: 0, money: 0 };
const sumDay = (hours: Bucket[]) => hours.reduce((a, h) => ({
  visits: a.visits + h.visits, newVisitors: a.newVisitors + h.newVisitors,
  chat: a.chat + h.chat, flush: a.flush + h.flush, money: a.money + h.money,
}), { ...EMPTY });
const DURATIONS = [{ v: "1d", t: "1일" }, { v: "3d", t: "3일" }, { v: "7d", t: "1주" }, { v: "30d", t: "1달" }, { v: "perm", t: "영구" }];

// KST 날짜 (0=오늘 1=어제 2=엊그제)
const dateOf = (i: number) => {
  const d = new Date(Date.now() - i * 86400000 + 9 * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

// Railway 소켓서버 REST (로그인/밴)
async function rail(path: string, opts?: RequestInit) {
  const token = getToken();
  const res = await fetch(`${SOCKET_BASE}/admin/${path}`, {
    cache: "no-store", headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...opts,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
// Vercel 과거조회 API
async function vercel(path: string) {
  const token = getToken();
  const res = await fetch(`/api/admin/${path}`, { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

export default function AdminDashboard() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"stats" | "online" | "chatlog" | "bans">("stats");
  const [chatSub, setChatSub] = useState<0 | 1 | 2 | 3>(0); // 0실시간 1오늘 2어제 3엊그제
  const [live, setLive] = useState<Live | null>(null);
  const [liveChats, setLiveChats] = useState<ChatRow[]>([]);
  const [histHours, setHistHours] = useState<Record<string, Bucket[]>>({});
  const [histChats, setHistChats] = useState<Record<string, ChatRow[]>>({});
  const [bans, setBans] = useState<BanRow[]>([]);
  const [expand, setExpand] = useState<string | null>(null);
  const [dur, setDur] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const sockRef = useRef<Socket | null>(null);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2000); };

  // 인증 확인
  useEffect(() => {
    (async () => { if (!getToken()) return setAuthed(false); const { status } = await rail("me"); setAuthed(status === 200); })();
  }, []);

  // 어드민 소켓 연결 (라이브 push)
  useEffect(() => {
    if (!authed) return;
    const sock = io(SOCKET_BASE || undefined, { auth: { adminToken: getToken() }, transports: ["websocket", "polling"], reconnection: true });
    sockRef.current = sock;
    sock.on("adminStats", (d: Live) => setLive(d));
    sock.on("adminChat", (c: ChatRow) => setLiveChats((prev) => [c, ...prev].slice(0, 1000)));
    return () => { sock.close(); sockRef.current = null; };
  }, [authed]);

  // 밴 목록 + 어제/엊그제 시간별(1회)
  const loadBans = useCallback(async () => { const { data } = await rail("bans"); if (data.ok) setBans(data.bans || []); }, []);
  useEffect(() => {
    if (!authed) return;
    loadBans();
    for (const i of [1, 2]) {
      const date = dateOf(i);
      vercel(`hours?date=${date}`).then(({ data }) => { if (data.ok) setHistHours((p) => ({ ...p, [date]: data.hours })); });
    }
  }, [authed, loadBans]);

  // 채팅로그 과거 조회: 오늘=5분마다, 어제/엊그제=1회
  const loadChatlog = useCallback(async (i: number) => {
    const date = dateOf(i);
    const { data } = await vercel(`chatlog?date=${date}`);
    if (data.ok) setHistChats((p) => ({ ...p, [date]: data.chats || [] }));
  }, []);
  useEffect(() => {
    if (!authed || tab !== "chatlog") return;
    if (chatSub === 0) return; // 실시간은 소켓
    loadChatlog(chatSub);
    if (chatSub === 1) { const id = setInterval(() => loadChatlog(1), 300000); return () => clearInterval(id); } // 오늘 5분
  }, [authed, tab, chatSub, loadChatlog]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const { status, data } = await rail("login", { method: "POST", body: JSON.stringify({ password: pw }) });
    if (status === 200 && data.token) { try { localStorage.setItem(TOKEN_KEY, data.token); } catch { /* */ } setAuthed(true); setPw(""); }
    else if (status === 429) setErr("시도가 너무 많아 잠겼습니다. 15분 후 다시.");
    else setErr("비밀번호가 틀렸습니다");
  };
  const logout = async () => { await rail("logout", { method: "POST", body: "{}" }); try { localStorage.removeItem(TOKEN_KEY); } catch { /* */ } setAuthed(false); };
  const ban = async (vid: string) => {
    const { data } = await rail("ban", { method: "POST", body: JSON.stringify({ vid, duration: dur[vid] ?? "1d" }) });
    if (data.ok) { flash("차단됨"); loadBans(); } else flash("실패");
  };
  const unban = async (vid: string) => { const { data } = await rail("unban", { method: "POST", body: JSON.stringify({ vid }) }); if (data.ok) { flash("해제됨"); loadBans(); } };
  const broadcast = async () => { const t = prompt("공지 문구"); if (t) { await rail("broadcast", { method: "POST", body: JSON.stringify({ text: t }) }); flash("공지 전송"); } };
  const reset = async () => { if (!confirm("통계·채팅로그 전체 초기화? (밴은 유지)")) return; await rail("reset", { method: "POST", body: "{}" }); flash("초기화됨"); };

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
    { i: 0, label: "오늘", totals: live ? sumDay(live.hours) : EMPTY, hours: live?.hours, live: true },
    { i: 1, label: "어제", totals: histHours[dateOf(1)] ? sumDay(histHours[dateOf(1)]) : EMPTY, hours: histHours[dateOf(1)], live: false },
    { i: 2, label: "엊그제", totals: histHours[dateOf(2)] ? sumDay(histHours[dateOf(2)]) : EMPTY, hours: histHours[dateOf(2)], live: false },
  ];
  const curChats = chatSub === 0 ? liveChats : (histChats[dateOf(chatSub)] || []);

  return (
    <div style={s.wrap}>{css}
      <header style={s.top}>
        <b>🚽 어드민</b>
        <span style={s.live}>● 실시간 {live?.presence ?? 0}명</span>
        <button onClick={logout} style={s.btnGhost}>로그아웃</button>
      </header>
      <nav style={s.tabs}>
        {([["stats", "통계"], ["online", "실시간접속"], ["chatlog", "채팅로그"], ["bans", "블랙"]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...s.tab, ...(tab === k ? s.tabOn : {}) }}>{t}</button>
        ))}
      </nav>
      {msg && <div style={s.toast}>{msg}</div>}

      {tab === "stats" && (
        <div>
          {dayCards.map((d) => {
            const key = dateOf(d.i);
            return (
              <div key={key} style={s.card}>
                <div style={s.cardHead} onClick={() => setExpand(expand === key ? null : key)}>
                  <b>{d.label}</b><span style={s.dim}>{key}{d.live ? " · LIVE" : ""}</span>
                  <span style={s.chevron}>{expand === key ? "▲시간별" : "▼시간별"}</span>
                </div>
                <div style={s.stats}>
                  <Stat l="방문" v={won(d.totals.visits)} /><Stat l="신규" v={won(d.totals.newVisitors)} />
                  <Stat l="채팅" v={won(d.totals.chat)} /><Stat l="물내림" v={won(d.totals.flush)} />
                  <Stat l="번 돈" v={won(d.totals.money)} />
                </div>
                {expand === key && (
                  <table style={s.htable}>
                    <thead><tr>{["시", "방문", "신규", "채팅", "물내림", "금액"].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {(d.hours || []).map((h, hr) => (h.visits || h.chat || h.flush || h.money) ? (
                        <tr key={hr}><td style={s.td}>{hr}</td><td style={s.td}>{h.visits}</td><td style={s.td}>{h.newVisitors}</td><td style={s.td}>{h.chat}</td><td style={s.td}>{h.flush}</td><td style={s.td}>{won(h.money)}</td></tr>
                      ) : null)}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
          <div style={s.card}>
            <div style={s.cardTitle}>운영</div>
            <div style={s.row}><button style={s.btn} onClick={broadcast}>📣 공지</button><button style={s.btnDanger} onClick={reset}>🧨 통계 초기화</button></div>
          </div>
        </div>
      )}

      {tab === "online" && (
        <div>
          <div style={s.note}>현재 접속 {live?.online.length ?? 0}명 (어드민 제외)</div>
          {(live?.online.length ?? 0) === 0 && <Empty />}
          {live?.online.map((o) => (
            <div key={o.vid} style={s.crow}>
              <div style={s.cmeta}><b>{o.nick || "익명"}</b>{o.conns > 1 && <span style={s.tag}>{o.conns}연결</span>}{o.banned && <span style={s.banTag}>차단</span>}<span style={s.dim}>{hhmm(o.since)}~</span></div>
              <div style={s.cfoot}><code style={s.uuid}>{o.vid}</code><BanCtl vid={o.vid} dur={dur} setDur={setDur} onBan={ban} /></div>
            </div>
          ))}
        </div>
      )}

      {tab === "chatlog" && (
        <div>
          <nav style={s.subtabs}>
            {["실시간", "오늘", "어제", "엊그제"].map((l, i) => (
              <button key={i} onClick={() => setChatSub(i as 0 | 1 | 2 | 3)} style={{ ...s.subtab, ...(chatSub === i ? s.tabOn : {}) }}>{l}</button>
            ))}
          </nav>
          <div style={s.note}>{curChats.length}건{chatSub === 0 ? " (접속 후 수신분)" : ""}</div>
          {curChats.length === 0 && <Empty />}
          {curChats.map((c, i) => (
            <div key={i} style={s.crow}>
              <div style={s.cmeta}><span style={s.htag}>{c.hour}시 {hhmm(c.ts)}</span><b>{c.nick || "익명"}</b><span style={s.ctext}>{c.text}</span></div>
              <div style={s.cfoot}><code style={s.uuid}>{c.vid}</code><BanCtl vid={c.vid} dur={dur} setDur={setDur} onBan={ban} /></div>
            </div>
          ))}
        </div>
      )}

      {tab === "bans" && (
        <div>
          {bans.length === 0 && <Empty />}
          {bans.map((b) => (
            <div key={b.vid} style={s.crow}>
              <div style={s.cmeta}><span style={s.dim}>{b.expiry === null ? "영구" : `~${new Date(b.expiry).toLocaleString("ko-KR", { hour12: false })}`}</span></div>
              <div style={s.cfoot}><code style={s.uuid}>{b.vid}</code><button style={s.btnSm} onClick={() => unban(b.vid)}>해제</button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ l, v }: { l: string; v: string }) { return <div style={s.stat}><div style={s.statV}>{v}</div><div style={s.statL}>{l}</div></div>; }
function Empty() { return <div style={s.empty}>데이터 없음</div>; }
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

// body overflow:hidden(게임 globals.css) 우회 → 어드민 스크롤 허용
const css = <style>{`html,body{overflow-y:auto!important;height:auto!important;min-height:100%;position:static!important;background:#0f1512;margin:0}*{box-sizing:border-box}button{cursor:pointer}button:active{transform:translateY(1px)}`}</style>;
const s: Record<string, React.CSSProperties> = {
  wrap: { fontFamily: "system-ui,-apple-system,sans-serif", color: "#e7efe9", background: "#0f1512", minHeight: "100vh", padding: 10, maxWidth: 760, margin: "0 auto" },
  loginBox: { display: "flex", flexDirection: "column", gap: 12, marginTop: 80 },
  h1: { fontSize: 20, textAlign: "center" },
  input: { padding: 14, fontSize: 16, borderRadius: 10, border: "1px solid #2c3a32", background: "#16201b", color: "#fff" },
  err: { color: "#ff8a8a", textAlign: "center" },
  top: { display: "flex", alignItems: "center", gap: 10, padding: "4px 2px 10px", position: "sticky", top: 0, background: "#0f1512", zIndex: 10 },
  live: { color: "#7ff0b0", fontSize: 13, marginLeft: "auto" },
  tabs: { display: "flex", gap: 6, marginBottom: 10 },
  tab: { flex: 1, padding: "10px 4px", borderRadius: 9, border: "1px solid #2c3a32", background: "#16201b", color: "#9fb3a6", fontSize: 13 },
  subtabs: { display: "flex", gap: 5, marginBottom: 8 },
  subtab: { flex: 1, padding: "7px 4px", borderRadius: 7, border: "1px solid #2c3a32", background: "#16201b", color: "#9fb3a6", fontSize: 12 },
  tabOn: { background: "#ffd233", color: "#1a1a1a", borderColor: "#ffd233", fontWeight: 700 },
  toast: { position: "sticky", top: 44, background: "#1f6b45", padding: "7px 12px", borderRadius: 8, marginBottom: 8, textAlign: "center", zIndex: 9 },
  note: { color: "#8fa89a", fontSize: 12, margin: "0 2px 8px" },
  card: { background: "#16201b", border: "1px solid #243029", borderRadius: 12, padding: 12, marginBottom: 10 },
  cardHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" },
  cardTitle: { fontSize: 13, color: "#8fa89a", marginBottom: 8 },
  chevron: { marginLeft: "auto", fontSize: 12, color: "#ffd233" },
  stats: { display: "flex", gap: 4 },
  stat: { flex: 1, textAlign: "center" },
  statV: { fontSize: 15, fontWeight: 800, color: "#fff" },
  statL: { fontSize: 10, color: "#8fa89a", marginTop: 3 },
  htable: { width: "100%", marginTop: 10, borderCollapse: "collapse", fontSize: 11 },
  th: { color: "#8fa89a", textAlign: "right", padding: "3px 5px", borderBottom: "1px solid #243029", fontWeight: 500 },
  td: { textAlign: "right", padding: "3px 5px", borderBottom: "1px solid #1b241e" },
  row: { display: "flex", gap: 8 },
  btn: { flex: 1, padding: 11, borderRadius: 9, border: "1px solid #2c3a32", background: "#1d2a23", color: "#e7efe9", fontSize: 14 },
  btnPrimary: { padding: 14, borderRadius: 10, border: "none", background: "#ffd233", color: "#1a1a1a", fontSize: 16, fontWeight: 700 },
  btnGhost: { padding: "7px 11px", borderRadius: 8, border: "1px solid #2c3a32", background: "transparent", color: "#9fb3a6", fontSize: 12 },
  btnDanger: { flex: 1, padding: 11, borderRadius: 9, border: "1px solid #5a2630", background: "#2a1518", color: "#ff9a9a", fontSize: 13 },
  // 컴팩트 채팅/접속 행
  crow: { background: "#141d18", border: "1px solid #1f2a23", borderRadius: 8, padding: "6px 8px", marginBottom: 5 },
  cmeta: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, flexWrap: "wrap" },
  ctext: { wordBreak: "break-word", flex: "1 1 100%", marginTop: 2 },
  cfoot: { display: "flex", alignItems: "center", gap: 6, marginTop: 4 },
  uuid: { fontSize: 10, color: "#6f8378", background: "#0f1512", padding: "1px 5px", borderRadius: 4, wordBreak: "break-all", flex: 1, userSelect: "all" },
  htag: { fontSize: 10, background: "#1d2a23", color: "#7ff0b0", padding: "1px 5px", borderRadius: 4, whiteSpace: "nowrap" },
  tag: { fontSize: 10, background: "#3a2f12", color: "#ffd233", padding: "1px 5px", borderRadius: 4 },
  banTag: { fontSize: 10, background: "#3a1f12", color: "#ffb27f", padding: "1px 5px", borderRadius: 4 },
  dim: { color: "#7a8c80", fontSize: 11, marginLeft: "auto", whiteSpace: "nowrap" },
  banCtl: { display: "flex", gap: 5, alignItems: "center" },
  select: { padding: 5, borderRadius: 6, border: "1px solid #2c3a32", background: "#0f1512", color: "#e7efe9", fontSize: 11 },
  btnSm: { padding: "5px 11px", borderRadius: 6, border: "1px solid #5a2630", background: "#2a1518", color: "#ff9a9a", fontSize: 12, whiteSpace: "nowrap" },
  empty: { textAlign: "center", color: "#6f8378", padding: 30 },
};
