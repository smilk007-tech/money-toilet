"use client";

/* 어드민 대시보드 (모바일 우선)
   - 라이브(presence/오늘/online/실시간채팅): 어드민 전용 소켓 push
   - 과거(시간별/채팅로그): Vercel API(공유 Redis, 토큰검증)
   - 로그인/밴/공지: 소켓서버(Railway) REST */

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

type Bucket = { visits: number; newVisitors: number; chat: number; flush: number; money: number };
type Online = { vid: string; nick: string; conns: number; since: number; banned: boolean };
type ChatRow = { ts: number; hour: number; vid: string; nick: string; text: string };
type BanRow = { vid: string; expiry: number | null };
// 서버가 "adminStats"(라이브: presence/today/online)와 "adminHours"(5분 주기)를 분리 push하므로
// 클라에서는 부분 갱신을 병합해서 들고 있어야 함(매번 전체 스냅샷이 오지 않음).
type Live = { presence: number; today: Bucket & { date: string }; hours: Bucket[]; online: Online[] };
type LiveStats = Pick<Live, "presence" | "today" | "online">;
type LiveHours = Pick<Live, "hours">;

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
  const [tab, setTab] = useState<"stats" | "online" | "liveChat" | "chatlog" | "bans">("stats");
  const [live, setLive] = useState<Live | null>(null);
  const [liveChats, setLiveChats] = useState<ChatRow[]>([]);
  // vid → 최신 닉네임 맵 — adminChat/adminStats 수신 시마다 갱신.
  // 라이브 채팅 렌더 시 이 맵을 우선 사용해 닉네임 변경을 소급 반영.
  const [nickByVid, setNickByVid] = useState<Record<string, string>>({});
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
  const [onSort, setOnSort] = useState<"new" | "old">("new");
  const [onQ, setOnQ] = useState("");
  const [bc, setBc] = useState("");
  const [bcSent, setBcSent] = useState(false);
  const sockRef = useRef<Socket | null>(null);
  const loadedChatDatesRef = useRef<Set<string>>(new Set()); // 과거 채팅로그 메모리 캐시 적중 판정용
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2000); };

  useEffect(() => {
    (async () => { if (!getToken()) return setAuthed(false); const { status } = await rail("me"); setAuthed(status === 200); })();
  }, []);

  useEffect(() => {
    if (!authed) return;
    const sock = io(SOCKET_BASE || undefined, { auth: { adminToken: getToken() }, transports: ["websocket", "polling"], reconnection: true });
    sockRef.current = sock;
    sock.on("adminStats", (d: LiveStats) => {
      // 온라인 목록에서 vid→nick 최신화
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
      setLiveChats((prev) => [c, ...prev].slice(0, 1000));
    });
    return () => { sock.close(); sockRef.current = null; };
  }, [authed]);

  const loadBans = useCallback(async () => { const { data } = await rail("bans"); if (data.ok) setBans(data.bans || []); }, []);
  useEffect(() => {
    if (!authed) return;
    loadBans();
    for (const ago of [1, 2]) {
      const date = dateOf(ago);
      vercel(`hours?date=${date}`).then(({ data }) => { if (data.ok) setHistHours((p) => ({ ...p, [date]: data.hours })); });
    }
  }, [authed, loadBans]);

  // 채팅로그 로더 — 과거 날짜(ago>=1)는 불변이라 메모리 캐시 적중 시 재요청하지 않는다.
  // 오늘(ago=0)은 최초 1회 로드 후, 새로고침(force)일 때만 Vercel 캐시를 우회해 신규 데이터를 가져온다.
  const loadChatlog = useCallback(async (ago: number) => {
    const date = dateOf(ago);
    // 과거(ago>=1)는 불변 → 메모리 캐시 적중 시 재요청 생략. 오늘(ago=0)은 항상 라이브로 새로 불러옴
    // (서브탭 재진입·자정 롤오버 시에도 최신 반영). 캐시버스터로 CDN/데이터 캐시 우회.
    if (ago >= 1 && loadedChatDatesRef.current.has(date)) return;
    setChatlogLoading(true);
    const bust = ago === 0 ? `&_t=${Date.now()}` : "";
    const { data } = await vercel(`chatlog?date=${date}${bust}`);
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

  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const { status, data } = await rail("login", { method: "POST", body: JSON.stringify({ password: pw }) });
    if (status === 200 && data.token) { try { localStorage.setItem(TOKEN_KEY, data.token); } catch { /* */ } setAuthed(true); setPw(""); }
    else if (status === 429) setErr("시도가 너무 많아 잠겼습니다. 15분 후 다시.");
    else setErr("비밀번호가 틀렸습니다");
  };
  const logout = async () => { await rail("logout", { method: "POST", body: "{}" }); try { localStorage.removeItem(TOKEN_KEY); } catch { /* */ } setAuthed(false); };
  const ban = async (vid: string) => { const { data } = await rail("ban", { method: "POST", body: JSON.stringify({ vid, duration: dur[vid] ?? "1d" }) }); if (data.ok) { flash("차단됨"); loadBans(); } else flash("실패"); };
  const unban = async (vid: string) => { const { data } = await rail("unban", { method: "POST", body: JSON.stringify({ vid }) }); if (data.ok) { flash("해제됨"); loadBans(); } };
  const reset = async () => { if (!confirm("통계·채팅로그 전체 초기화? (밴은 유지)")) return; await rail("reset", { method: "POST", body: "{}" }); flash("초기화됨"); };
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
  const baseChats = tab === "liveChat" ? liveChats : (histChats[dateOf(chatlogDay)] || []);
  const q1 = chatQ.trim().toLowerCase();
  const chats = [...baseChats]
    .filter((c) => !q1 || c.text.toLowerCase().includes(q1) || (c.nick || "").toLowerCase().includes(q1) || c.vid.toLowerCase().includes(q1))
    .sort((a, b) => (chatSort === "new" ? b.ts - a.ts : a.ts - b.ts));
  // 접속자 필터/정렬
  const q2 = onQ.trim().toLowerCase();
  const onlines = [...(live?.online || [])]
    .filter((o) => !q2 || (o.nick || "").toLowerCase().includes(q2) || o.vid.toLowerCase().includes(q2))
    .sort((a, b) => (onSort === "new" ? b.since - a.since : a.since - b.since));

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
        <span style={s.liveN}>● 실시간 {live?.presence ?? 0}명</span>
        <button onClick={logout} style={s.btnGhost}>로그아웃</button>
      </header>
      <nav style={s.tabs}>
        {([["stats", "통계"], ["online", "동접자"], ["liveChat", "현재채팅"], ["chatlog", "채팅로그"], ["bans", "블랙"]] as const).map(([k, t]) => (
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
                  <b>{d.label}</b><span style={s.dim2}>{dateOf(d.ago)}{d.live ? " · LIVE" : ""}</span>
                  <span style={s.chevron}>{isExpanded ? "▲시간별" : "▼시간별"}</span>
                </div>
                <div style={s.stats}>
                  <Stat l="방문" v={won(totals.visits)} /><Stat l="신규" v={won(totals.newVisitors)} />
                  <Stat l="채팅" v={won(totals.chat)} /><Stat l="물내림" v={won(totals.flush)} />
                  <Stat l="번 돈" v={won(totals.money)} />
                </div>
                {isExpanded && (
                  <table style={s.htable}>
                    <thead><tr>{["시", "방문", "신규", "채팅", "물내림", "금액"].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {(d.hours || []).map((h, hr) => (h.visits || h.chat || h.flush || h.money) ? (
                        <tr key={hr}><td style={s.td}>{String(hr).padStart(2, "0")}</td><td style={s.td}>{h.visits}</td><td style={s.td}>{h.newVisitors}</td><td style={s.td}>{h.chat}</td><td style={s.td}>{h.flush}</td><td style={s.td}>{won(h.money)}</td></tr>
                      ) : null)}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
          <div style={s.card}>
            <div style={s.cardTitle}>운영</div>
            <button style={{ ...s.btnDanger, width: "100%" }} onClick={reset}>🧨 통계·채팅로그 초기화</button>
          </div>
        </div>
      )}

      {tab === "online" && (
        <div>
          <div style={s.ctrlRow}>
            <input style={s.search} placeholder="검색: 닉네임 / UUID" value={onQ} onChange={(e) => setOnQ(e.target.value)} />
            <button style={s.sortBtn} onClick={() => setOnSort((v) => (v === "new" ? "old" : "new"))}>{onSort === "new" ? "최신순" : "과거순"}</button>
          </div>
          <div style={s.note}>접속 {onlines.length}명 (어드민 제외)</div>
          {onlines.length === 0 && <Empty />}
          {onlines.map((o) => (
            <LogRow
              key={o.vid}
              nick={o.nick || "익명"}
              time={`${hhmm(o.since)}~`}
              vid={o.vid}
              tags={<>{o.conns > 1 && <span style={s.tag}>{o.conns}연결</span>}{o.banned && <span style={s.banTag}>차단</span>}</>}
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
          </div>
          <div style={s.note}>{chats.length}건 (접속 후 수신분)</div>
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
            {chatlogDay === 0 && (
              <button style={s.sortBtn} onClick={() => loadChatlog(0)} disabled={chatlogLoading} title="오늘 채팅로그 새로고침(캐시 우회)">{chatlogLoading ? "…" : "🔄"}</button>
            )}
          </div>
          <div style={s.note}>
            {dateOf(chatlogDay)} · {chats.length}건{chatlogDay === 0 ? " · 5분 주기 반영(새로고침으로 최신화)" : " · 보관본(메모리 캐시)"}
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

      {tab === "bans" && (
        <div>
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

function Stat({ l, v }: { l: string; v: string }) { return <div style={s.stat}><div style={s.statV}>{v}</div><div style={s.statL}>{l}</div></div>; }
function Empty() { return <div style={s.empty}>데이터 없음</div>; }

// 채팅/동접 공통 카드 — [닉네임 (태그)] ………… [시간(우측끝)] / (메시지) / [UUID][차단]
function LogRow({ nick, time, message, vid, tags, dur, setDur, onBan }: {
  nick: string; time: string; message?: string | null; vid: string; tags?: React.ReactNode;
  dur: Record<string, string>; setDur: (f: (p: Record<string, string>) => Record<string, string>) => void; onBan: (v: string) => void;
}) {
  return (
    <div style={s.crow}>
      <div style={s.rowHead}>
        <b style={s.rowNick}>{nick}</b>
        {tags}
        <span style={s.rowTime}>{time}</span>
      </div>
      {message ? <div style={s.rowBody}>{message}</div> : null}
      <div style={s.cfoot}><code style={s.uuid}>{vid}</code><BanCtl vid={vid} dur={dur} setDur={setDur} onBan={onBan} /></div>
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

const css = <style>{`html,body{overflow-y:auto!important;height:auto!important;min-height:100%;position:static!important;background:#0f1512;margin:0}*{box-sizing:border-box}button{cursor:pointer}button:active{transform:translateY(1px)}input{outline:none}`}</style>;
const s: Record<string, React.CSSProperties> = {
  wrap: { fontFamily: "system-ui,-apple-system,sans-serif", color: "#e7efe9", background: "#0f1512", minHeight: "100vh", padding: 10, maxWidth: 780, margin: "0 auto" },
  loginBox: { display: "flex", flexDirection: "column", gap: 12, marginTop: 80 },
  h1: { fontSize: 20, textAlign: "center" },
  input: { padding: 14, fontSize: 16, borderRadius: 10, border: "1px solid #2c3a32", background: "#16201b", color: "#fff" },
  err: { color: "#ff8a8a", textAlign: "center" },
  top: { display: "flex", alignItems: "center", gap: 10, padding: "4px 2px 10px", position: "sticky", top: 0, background: "#0f1512", zIndex: 10 },
  liveN: { color: "#7ff0b0", fontSize: 13, marginLeft: "auto" },
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
  btnPrimary: { padding: 14, borderRadius: 10, border: "none", background: "#ffd233", color: "#1a1a1a", fontSize: 16, fontWeight: 700 },
  btnGhost: { padding: "7px 11px", borderRadius: 8, border: "1px solid #2c3a32", background: "transparent", color: "#9fb3a6", fontSize: 12 },
  btnDanger: { padding: 11, borderRadius: 9, border: "1px solid #5a2630", background: "#2a1518", color: "#ff9a9a", fontSize: 13 },
  // 채팅로그 서브탭 [오늘][어제][엊그제][그끄저께]
  subtabs: { display: "flex", gap: 4, marginBottom: 8 },
  subtab: { flex: 1, padding: "7px 4px", borderRadius: 8, border: "1px solid #2c3a32", background: "#16201b", color: "#9fb3a6", fontSize: 12.5, whiteSpace: "nowrap" },
  subtabOn: { background: "#1f6b45", color: "#fff", borderColor: "#1f6b45", fontWeight: 700 },
  // 채팅/동접 공통 카드 — 개선된 레이아웃(닉 좌측, 시간 우측끝)
  crow: { background: "#141d18", border: "1px solid #1f2a23", borderRadius: 7, padding: "8px", marginBottom: 4 },
  rowHead: { display: "flex", alignItems: "center", gap: 6, lineHeight: 1.4 },
  rowNick: { fontSize: 12.5, color: "#ffd84d", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "62%" },
  rowTime: { marginLeft: "auto", fontSize: 10.5, color: "#7ff0b0", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  rowBody: { marginTop: 5, fontSize: 13, color: "#e7efe9", wordBreak: "break-word", lineHeight: 1.4 },
  cline: { display: "flex", alignItems: "baseline", gap: 6, fontSize: 13, flexWrap: "wrap", lineHeight: 1.35 },
  clineNew: { display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, lineHeight: 1.4 },
  time: { fontSize: 10, color: "#7ff0b0", whiteSpace: "nowrap", minWidth: 42, fontVariantNumeric: "tabular-nums" },
  nick: { fontSize: 12.5, color: "#ffd84d", fontWeight: 600, whiteSpace: "nowrap", minWidth: 60, borderRight: "1px solid #2c3a32", paddingRight: 8 },
  msg: { flex: 1, color: "#e7efe9", wordBreak: "break-word" },
  nb: { fontSize: 12.5, color: "#cfe5d8", whiteSpace: "nowrap" },
  ctx: { wordBreak: "break-word", color: "#e7efe9", flex: 1 },
  cfoot: { display: "flex", alignItems: "center", gap: 6, marginTop: 5 },
  uuid: { fontSize: 10, color: "#6f8378", background: "#0f1512", padding: "1px 5px", borderRadius: 4, wordBreak: "break-all", flex: 1, userSelect: "all" },
  tag: { fontSize: 10, background: "#3a2f12", color: "#ffd233", padding: "1px 5px", borderRadius: 4 },
  banTag: { fontSize: 10, background: "#3a1f12", color: "#ffb27f", padding: "1px 5px", borderRadius: 4 },
  dim: { color: "#7a8c80", fontSize: 11, marginLeft: "auto", whiteSpace: "nowrap" },
  dim2: { color: "#7a8c80", fontSize: 11 },
  banCtl: { display: "flex", gap: 5, alignItems: "center" },
  select: { padding: 5, borderRadius: 6, border: "1px solid #2c3a32", background: "#0f1512", color: "#e7efe9", fontSize: 11 },
  btnSm: { padding: "5px 11px", borderRadius: 6, border: "1px solid #5a2630", background: "#2a1518", color: "#ff9a9a", fontSize: 12, whiteSpace: "nowrap" },
  empty: { textAlign: "center", color: "#6f8378", padding: 30 },
};
