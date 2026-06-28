"use client";

/* 어드민 대시보드 — 모바일 우선. 데이터는 소켓서버(Railway) REST에서 Bearer 토큰으로.
   탭: 통계(오늘/어제/엊그제 + 시간별) · 실시간접속 · 채팅로그(날짜별) · 블랙 */

import { useCallback, useEffect, useState } from "react";

type Metric = { visitors: number; chat: number; flush: number; money: number };
type DayStat = { date: string; source: string; day: Metric; hours: Metric[] };
type Online = { vid: string; nick: string; conns: number; since: number; banned: boolean };
type ChatRow = { ts: number; hour: number; vid: string; nick: string; text: string; warnCount?: number };
type BanRow = { vid: string; expiry: number | null };

const SOCKET_BASE = (
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4000"
    : "")
).replace(/\/$/, "");
const TOKEN_KEY = "mt_admin_token";
const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
};

async function api(path: string, opts?: RequestInit) {
  const token = getToken();
  const res = await fetch(`${SOCKET_BASE}/admin/${path}`, {
    cache: "no-store",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...opts,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const won = (n: number) => (n || 0).toLocaleString("ko-KR") + "원";
const num = (n: number) => (n || 0).toLocaleString("ko-KR");
const when = (ts: number) => new Date(ts).toLocaleString("ko-KR", { hour12: false });
const DAY_LABELS = ["오늘", "어제", "엊그제"];
const DURATIONS = [
  { v: "1d", t: "1일" }, { v: "3d", t: "3일" }, { v: "7d", t: "1주" },
  { v: "30d", t: "1달" }, { v: "perm", t: "영구" },
];

export default function AdminDashboard() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"stats" | "online" | "chatlog" | "bans">("stats");
  const [presence, setPresence] = useState(0);
  const [days, setDays] = useState<DayStat[]>([]);
  const [expand, setExpand] = useState<string | null>(null);
  const [online, setOnline] = useState<Online[]>([]);
  const [logDate, setLogDate] = useState(0); // 0=오늘 1=어제 2=엊그제
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [bans, setBans] = useState<BanRow[]>([]);
  const [dur, setDur] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2200); };

  const dateOf = (i: number) => {
    const d = new Date(Date.now() - i * 86400000 + 9 * 3600000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };

  const loadTab = useCallback(async (t: string, ld = 0) => {
    if (t === "stats") {
      const { data } = await api("stats");
      if (data.ok) { setPresence(data.presence); setDays(data.days || []); }
    } else if (t === "online") {
      const { data } = await api("online");
      if (data.ok) setOnline(data.online || []);
    } else if (t === "chatlog") {
      const { data } = await api(`chatlog?date=${dateOf(ld)}`);
      if (data.ok) setChats(data.chats || []);
    } else if (t === "bans") {
      const { data } = await api("bans");
      if (data.ok) setBans(data.bans || []);
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (!getToken()) return setAuthed(false);
      const { status } = await api("me");
      setAuthed(status === 200);
    })();
  }, []);
  useEffect(() => { if (authed) loadTab(tab, logDate); }, [authed, tab, logDate, loadTab]);
  // 실시간접속/통계 탭은 5초마다 갱신
  useEffect(() => {
    if (!authed || (tab !== "online" && tab !== "stats")) return;
    const id = setInterval(() => loadTab(tab, logDate), 5000);
    return () => clearInterval(id);
  }, [authed, tab, logDate, loadTab]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const { status, data } = await api("login", { method: "POST", body: JSON.stringify({ password: pw }) });
    if (status === 200 && data.token) {
      try { localStorage.setItem(TOKEN_KEY, data.token); } catch { /* noop */ }
      setAuthed(true); setPw("");
    } else if (status === 429) setErr("시도가 너무 많아 잠겼습니다. 15분 후 다시.");
    else setErr("비밀번호가 틀렸습니다");
  };
  const logout = async () => {
    await api("logout", { method: "POST", body: "{}" });
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
    setAuthed(false);
  };
  const act = async (path: string, body: object, ok = "완료") => {
    const { data } = await api(path, { method: "POST", body: JSON.stringify(body) });
    if (data.ok) { flash(ok); loadTab(tab, logDate); } else flash("실패");
  };
  const ban = (vid: string) => act("ban", { vid, duration: dur[vid] ?? "1d" }, "차단됨");
  const reset = () => { if (confirm("정말 전체 초기화? 되돌릴 수 없습니다.")) act("reset", { scope: "all" }, "초기화됨"); };
  const broadcast = () => { const t = prompt("공지 문구"); if (t) act("broadcast", { text: t }, "공지 전송됨"); };

  if (authed === null) return <div style={s.wrap}>{css}로딩중…</div>;
  if (!authed)
    return (
      <div style={s.wrap}>{css}
        <form onSubmit={login} style={s.loginBox}>
          <h1 style={s.h1}>🚽 MoneyToilet 어드민</h1>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="비밀번호" style={s.input} autoFocus />
          <button type="submit" style={s.btnPrimary}>로그인</button>
          {err && <div style={s.err}>{err}</div>}
        </form>
      </div>
    );

  return (
    <div style={s.wrap}>{css}
      <header style={s.top}>
        <b>🚽 어드민</b>
        <span style={s.live}>● 실시간 {presence}명</span>
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
          {days.map((d, i) => (
            <div key={d.date} style={s.card}>
              <div style={s.cardHead} onClick={() => setExpand(expand === d.date ? null : d.date)}>
                <b>{DAY_LABELS[i] || d.date}</b>
                <span style={s.dim}>{d.date} {d.source === "live" ? "· LIVE" : ""}</span>
                <span style={s.chevron}>{expand === d.date ? "▲ 시간별" : "▼ 시간별"}</span>
              </div>
              <div style={s.stats}>
                <Stat l="방문자" v={num(d.day.visitors)} />
                <Stat l="채팅" v={num(d.day.chat)} />
                <Stat l="물내림" v={num(d.day.flush)} />
                <Stat l="다같이 번 돈" v={won(d.day.money)} />
              </div>
              {expand === d.date && (
                <table style={s.htable}>
                  <thead><tr><th style={s.th}>시</th><th style={s.th}>방문</th><th style={s.th}>채팅</th><th style={s.th}>물내림</th><th style={s.th}>금액</th></tr></thead>
                  <tbody>
                    {d.hours.map((h, hr) => (h.visitors || h.chat || h.flush || h.money) ? (
                      <tr key={hr}><td style={s.td}>{hr}시</td><td style={s.td}>{h.visitors}</td><td style={s.td}>{h.chat}</td><td style={s.td}>{h.flush}</td><td style={s.td}>{num(h.money)}</td></tr>
                    ) : null)}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          <div style={s.card}>
            <div style={s.cardTitle}>운영</div>
            <div style={s.row}>
              <button style={s.btn} onClick={broadcast}>📣 공지</button>
              <button style={s.btnDanger} onClick={reset}>🧨 전체 초기화</button>
            </div>
          </div>
        </div>
      )}

      {tab === "online" && (
        <div>
          <div style={s.note}>현재 접속 {online.length}명 (5초마다 갱신)</div>
          {online.length === 0 && <Empty />}
          {online.map((o) => (
            <div key={o.vid} style={s.line}>
              <div style={s.lineHead}>
                <b>{o.nick || "익명"}</b>
                {o.conns > 1 && <span style={s.tag}>{o.conns}연결</span>}
                {o.banned && <span style={s.warnTag}>차단됨</span>}
                <span style={s.dim}>{when(o.since)}</span>
              </div>
              <div style={s.lineFoot}>
                <code style={s.vid}>{o.vid.slice(0, 12)}</code>
                <BanCtl vid={o.vid} dur={dur} setDur={setDur} onBan={ban} onWarn={(v) => act("warn", { vid: v }, "경고+1")} />
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "chatlog" && (
        <div>
          <div style={s.tabs}>
            {DAY_LABELS.map((l, i) => (
              <button key={i} onClick={() => setLogDate(i)} style={{ ...s.tab, ...(logDate === i ? s.tabOn : {}) }}>{l}</button>
            ))}
          </div>
          <div style={s.note}>{chats.length}건 (시간순)</div>
          {chats.length === 0 && <Empty />}
          {chats.map((c, i) => (
            <div key={i} style={s.line}>
              <div style={s.lineHead}>
                <span style={s.hourTag}>{c.hour}시</span>
                <b>{c.nick || "익명"}</b>
                {!!c.warnCount && <span style={s.warnTag}>경고 {c.warnCount}</span>}
                <span style={s.dim}>{when(c.ts)}</span>
              </div>
              <div style={s.text}>{c.text}</div>
              <div style={s.lineFoot}>
                <code style={s.vid}>{c.vid.slice(0, 12)}</code>
                <BanCtl vid={c.vid} dur={dur} setDur={setDur} onBan={ban} onWarn={(v) => act("warn", { vid: v }, "경고+1")} />
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "bans" && (
        <div>
          {bans.length === 0 && <Empty />}
          {bans.map((b) => (
            <div key={b.vid} style={s.line}>
              <div style={s.lineHead}>
                <code style={s.vid}>{b.vid.slice(0, 16)}</code>
                <span style={s.dim}>{b.expiry === null ? "영구" : `~${when(b.expiry)}`}</span>
              </div>
              <div style={s.lineFoot}>
                <button style={s.btnSm} onClick={() => act("unban", { vid: b.vid }, "해제됨")}>해제</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ l, v }: { l: string; v: string }) {
  return <div style={s.stat}><div style={s.statV}>{v}</div><div style={s.statL}>{l}</div></div>;
}
function Empty() { return <div style={s.empty}>데이터 없음</div>; }
function BanCtl({ vid, dur, setDur, onBan, onWarn }: {
  vid: string; dur: Record<string, string>;
  setDur: (f: (p: Record<string, string>) => Record<string, string>) => void;
  onBan: (v: string) => void; onWarn: (v: string) => void;
}) {
  return (
    <span style={s.banCtl}>
      <select value={dur[vid] ?? "1d"} onChange={(e) => setDur((p) => ({ ...p, [vid]: e.target.value }))} style={s.select}>
        {DURATIONS.map((d) => <option key={d.v} value={d.v}>{d.t}</option>)}
      </select>
      <button style={s.btnSm} onClick={() => onBan(vid)}>차단</button>
      <button style={s.btnSmWarn} onClick={() => onWarn(vid)}>경고</button>
    </span>
  );
}

const css = <style>{`*{box-sizing:border-box}body{margin:0;background:#0f1512}button{cursor:pointer}button:active{transform:translateY(1px)}`}</style>;
const s: Record<string, React.CSSProperties> = {
  wrap: { fontFamily: "system-ui,-apple-system,sans-serif", color: "#e7efe9", background: "#0f1512", minHeight: "100vh", padding: 12, maxWidth: 720, margin: "0 auto" },
  loginBox: { display: "flex", flexDirection: "column", gap: 12, marginTop: 80 },
  h1: { fontSize: 20, textAlign: "center" },
  input: { padding: 14, fontSize: 16, borderRadius: 10, border: "1px solid #2c3a32", background: "#16201b", color: "#fff" },
  err: { color: "#ff8a8a", textAlign: "center" },
  top: { display: "flex", alignItems: "center", gap: 10, padding: "6px 2px 12px" },
  live: { color: "#7ff0b0", fontSize: 13, marginLeft: "auto" },
  tabs: { display: "flex", gap: 6, marginBottom: 12 },
  tab: { flex: 1, padding: "10px 4px", borderRadius: 9, border: "1px solid #2c3a32", background: "#16201b", color: "#9fb3a6", fontSize: 13 },
  tabOn: { background: "#ffd233", color: "#1a1a1a", borderColor: "#ffd233", fontWeight: 700 },
  toast: { position: "sticky", top: 6, background: "#1f6b45", padding: "8px 12px", borderRadius: 8, marginBottom: 10, textAlign: "center", zIndex: 5 },
  note: { color: "#8fa89a", fontSize: 12, margin: "2px 2px 10px" },
  card: { background: "#16201b", border: "1px solid #243029", borderRadius: 12, padding: 14, marginBottom: 12 },
  cardHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" },
  cardTitle: { fontSize: 13, color: "#8fa89a", marginBottom: 10 },
  chevron: { marginLeft: "auto", fontSize: 12, color: "#ffd233" },
  stats: { display: "flex", gap: 6 },
  stat: { flex: 1, textAlign: "center" },
  statV: { fontSize: 16, fontWeight: 800, color: "#fff" },
  statL: { fontSize: 10, color: "#8fa89a", marginTop: 4 },
  htable: { width: "100%", marginTop: 12, borderCollapse: "collapse", fontSize: 12 },
  th: { color: "#8fa89a", textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #243029", fontWeight: 500 },
  td: { textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #1b241e" },
  row: { display: "flex", gap: 8 },
  btn: { flex: 1, padding: 12, borderRadius: 9, border: "1px solid #2c3a32", background: "#1d2a23", color: "#e7efe9", fontSize: 14 },
  btnPrimary: { padding: 14, borderRadius: 10, border: "none", background: "#ffd233", color: "#1a1a1a", fontSize: 16, fontWeight: 700 },
  btnGhost: { padding: "8px 12px", borderRadius: 8, border: "1px solid #2c3a32", background: "transparent", color: "#9fb3a6", fontSize: 13 },
  btnDanger: { flex: 1, padding: 12, borderRadius: 9, border: "1px solid #5a2630", background: "#2a1518", color: "#ff9a9a", fontSize: 13 },
  line: { background: "#16201b", border: "1px solid #243029", borderRadius: 10, padding: 10, marginBottom: 8 },
  lineHead: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  lineFoot: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
  text: { marginTop: 6, fontSize: 15, wordBreak: "break-word" },
  dim: { color: "#7a8c80", fontSize: 11, marginLeft: "auto" },
  vid: { fontSize: 11, color: "#6f8378", background: "#0f1512", padding: "2px 6px", borderRadius: 5 },
  tag: { fontSize: 10, background: "#3a2f12", color: "#ffd233", padding: "1px 6px", borderRadius: 5 },
  hourTag: { fontSize: 10, background: "#1d2a23", color: "#7ff0b0", padding: "1px 6px", borderRadius: 5 },
  warnTag: { fontSize: 10, background: "#3a1f12", color: "#ffb27f", padding: "1px 6px", borderRadius: 5 },
  banCtl: { display: "flex", gap: 6, marginLeft: "auto", alignItems: "center" },
  select: { padding: 6, borderRadius: 7, border: "1px solid #2c3a32", background: "#0f1512", color: "#e7efe9", fontSize: 12 },
  btnSm: { padding: "6px 12px", borderRadius: 7, border: "1px solid #5a2630", background: "#2a1518", color: "#ff9a9a", fontSize: 12 },
  btnSmWarn: { padding: "6px 12px", borderRadius: 7, border: "1px solid #5a4226", background: "#2a2015", color: "#ffc98a", fontSize: 12 },
  empty: { textAlign: "center", color: "#6f8378", padding: 30 },
};
