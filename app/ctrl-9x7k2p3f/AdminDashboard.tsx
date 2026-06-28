"use client";

/* 어드민 대시보드 — 모바일 우선(질문 17).
   페이지엔 비밀이 없다. 모든 데이터는 쿠키 게이트된 /api/admin/* 에서만 온다.
   미인증이면 401 → 로그인 폼 표시. */

import { useCallback, useEffect, useState } from "react";

type Stats = {
  presence: number;
  allTime: Triple;
  today: Triple;
  week: Triple;
  serverNow: number;
};
type Triple = { visitors: number; chats: number; money: number };
type ChatRow = {
  id: number;
  vid: string;
  nick: string;
  text: string;
  kind: string;
  ts: number;
  warnCount?: number;
  amount?: number;
};
type BanRow = { vid: string; nick: string; expiry: number | null };
type WarnRow = { vid: string; nick: string; warnCount: number };

const won = (n: number) => (n || 0).toLocaleString("ko-KR") + "원";
const when = (ts: number) =>
  new Date(ts).toLocaleString("ko-KR", { hour12: false });

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/admin/${path}`, {
    cache: "no-store",
    headers: { "content-type": "application/json" },
    ...opts,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const DURATIONS = [
  { v: "1d", t: "1일" },
  { v: "3d", t: "3일" },
  { v: "7d", t: "1주" },
  { v: "30d", t: "1달" },
  { v: "perm", t: "영구" },
];

export default function AdminDashboard() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"stats" | "chats" | "bans" | "warned">("stats");

  const [stats, setStats] = useState<Stats | null>(null);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [bans, setBans] = useState<BanRow[]>([]);
  const [warned, setWarned] = useState<WarnRow[]>([]);
  const [dur, setDur] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 2500);
  };

  const loadTab = useCallback(async (t: string) => {
    if (t === "stats") {
      const { data } = await api("stats");
      if (data.ok) setStats(data.stats);
    } else if (t === "chats") {
      const { data } = await api("chats");
      if (data.ok) setChats(data.chats || []);
    } else if (t === "bans") {
      const { data } = await api("bans");
      if (data.ok) setBans(data.bans || []);
    } else if (t === "warned") {
      const { data } = await api("warned");
      if (data.ok) setWarned(data.warned || []);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await api("me");
      setAuthed(status === 200);
    })();
  }, []);

  useEffect(() => {
    if (authed) loadTab(tab);
  }, [authed, tab, loadTab]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    const { status } = await api("login", {
      method: "POST",
      body: JSON.stringify({ password: pw }),
    });
    if (status === 200) {
      setAuthed(true);
      setPw("");
    } else if (status === 429)
      setErr("시도가 너무 많아 잠겼습니다. 15분 후 다시 시도하세요.");
    else setErr("비밀번호가 틀렸습니다");
  };

  const act = async (path: string, body?: object, ok = "완료") => {
    const { data } = await api(path, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    });
    if (data.ok) {
      flash(ok);
      loadTab(tab);
    } else flash("실패");
  };

  const ban = (vid: string) =>
    act("ban", { vid, duration: dur[vid] ?? "1d" }, "차단됨");
  const reset = (scope: string, label: string) => {
    if (!confirm(`정말 "${label}" 초기화할까요? 되돌릴 수 없습니다.`)) return;
    act("reset", { scope }, "초기화됨");
  };
  const broadcast = () => {
    const text = prompt("공지로 띄울 문구");
    if (text) act("broadcast", { text }, "공지 전송됨");
  };
  const logout = async () => {
    await api("logout", { method: "POST", body: "{}" });
    setAuthed(false);
  };

  if (authed === null)
    return <div style={s.wrap}>{css}로딩중…</div>;

  if (!authed)
    return (
      <div style={s.wrap}>
        {css}
        <form onSubmit={login} style={s.loginBox}>
          <h1 style={s.h1}>🚽 MoneyToilet 어드민</h1>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="비밀번호"
            style={s.input}
            autoFocus
          />
          <button type="submit" style={s.btnPrimary}>
            로그인
          </button>
          {err && <div style={s.err}>{err}</div>}
        </form>
      </div>
    );

  return (
    <div style={s.wrap}>
      {css}
      <header style={s.top}>
        <b>🚽 어드민</b>
        {stats && <span style={s.live}>● 현재 {stats.presence}명</span>}
        <button onClick={logout} style={s.btnGhost}>
          로그아웃
        </button>
      </header>

      <nav style={s.tabs}>
        {(
          [
            ["stats", "통계"],
            ["chats", "채팅(7일)"],
            ["bans", "블랙"],
            ["warned", "경고"],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{ ...s.tab, ...(tab === k ? s.tabOn : {}) }}
          >
            {t}
          </button>
        ))}
      </nav>

      {msg && <div style={s.toast}>{msg}</div>}

      {tab === "stats" && stats && (
        <div>
          <Section title="누적(전체기간)" t={stats.allTime} />
          <Section title="오늘" t={stats.today} />
          <Section title="최근 7일" t={stats.week} />
          <div style={s.card}>
            <div style={s.cardTitle}>운영</div>
            <div style={s.row}>
              <button style={s.btn} onClick={broadcast}>
                📣 공지 띄우기
              </button>
              <button
                style={s.btn}
                onClick={() => act("clearchat", {}, "채팅 비움")}
              >
                🧹 채팅 비우기
              </button>
            </div>
            <div style={s.row}>
              <button
                style={s.btnDanger}
                onClick={() => reset("global", "다같이 번 돈")}
              >
                💰 누적금액 초기화
              </button>
              <button
                style={s.btnDanger}
                onClick={() => reset("stats", "통계")}
              >
                📊 통계 초기화
              </button>
            </div>
            <button
              style={{ ...s.btnDanger, width: "100%", marginTop: 8 }}
              onClick={() => reset("all", "전체(서버)")}
            >
              🧨 전체 서버 초기화
            </button>
          </div>
        </div>
      )}

      {tab === "chats" && (
        <div>
          {chats.length === 0 && <Empty />}
          {chats.map((c) => (
            <div key={c.id} style={s.line}>
              <div style={s.lineHead}>
                <b>{c.nick || "익명"}</b>
                {c.kind === "flush" && <span style={s.tag}>물내림</span>}
                {c.kind === "system" && <span style={s.tag}>공지</span>}
                {!!c.warnCount && (
                  <span style={s.warnTag}>경고 {c.warnCount}</span>
                )}
                <span style={s.dim}>{when(c.ts)}</span>
              </div>
              <div style={s.text}>{c.text}</div>
              <div style={s.lineFoot}>
                <code style={s.vid}>{c.vid.slice(0, 12)}</code>
                <BanControls
                  vid={c.vid}
                  dur={dur}
                  setDur={setDur}
                  onBan={ban}
                  onWarn={(v) => act("warn", { vid: v }, "경고 +1")}
                />
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
                <b>{b.nick || "익명"}</b>
                <span style={s.dim}>
                  {b.expiry === null ? "영구" : `~${when(b.expiry)}`}
                </span>
              </div>
              <div style={s.lineFoot}>
                <code style={s.vid}>{b.vid.slice(0, 12)}</code>
                <button
                  style={s.btnSm}
                  onClick={() => act("unban", { vid: b.vid }, "해제됨")}
                >
                  해제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "warned" && (
        <div>
          {warned.length === 0 && <Empty />}
          {warned.map((w) => (
            <div key={w.vid} style={s.line}>
              <div style={s.lineHead}>
                <b>{w.nick || "익명"}</b>
                <span style={s.warnTag}>경고 {w.warnCount}</span>
              </div>
              <div style={s.lineFoot}>
                <code style={s.vid}>{w.vid.slice(0, 12)}</code>
                <BanControls
                  vid={w.vid}
                  dur={dur}
                  setDur={setDur}
                  onBan={ban}
                  onWarn={(v) => act("warn", { vid: v }, "경고 +1")}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, t }: { title: string; t: Triple }) {
  return (
    <div style={s.card}>
      <div style={s.cardTitle}>{title}</div>
      <div style={s.stats}>
        <Stat label="방문자" v={(t.visitors || 0).toLocaleString("ko-KR")} />
        <Stat label="채팅" v={(t.chats || 0).toLocaleString("ko-KR")} />
        <Stat label="다같이 번 돈" v={won(t.money)} />
      </div>
    </div>
  );
}
function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div style={s.stat}>
      <div style={s.statV}>{v}</div>
      <div style={s.statL}>{label}</div>
    </div>
  );
}
function Empty() {
  return <div style={s.empty}>데이터 없음</div>;
}
function BanControls({
  vid,
  dur,
  setDur,
  onBan,
  onWarn,
}: {
  vid: string;
  dur: Record<string, string>;
  setDur: (f: (p: Record<string, string>) => Record<string, string>) => void;
  onBan: (vid: string) => void;
  onWarn: (vid: string) => void;
}) {
  return (
    <span style={s.banCtl}>
      <select
        value={dur[vid] ?? "1d"}
        onChange={(e) => setDur((p) => ({ ...p, [vid]: e.target.value }))}
        style={s.select}
      >
        {DURATIONS.map((d) => (
          <option key={d.v} value={d.v}>
            {d.t}
          </option>
        ))}
      </select>
      <button style={s.btnSm} onClick={() => onBan(vid)}>
        차단
      </button>
      <button style={s.btnSmWarn} onClick={() => onWarn(vid)}>
        경고
      </button>
    </span>
  );
}

/* ---------- 스타일(모바일 우선, 인라인) ---------- */
const css = (
  <style>{`
    * { box-sizing: border-box; }
    body { margin:0; background:#0f1512; }
    .mt-admin button { cursor:pointer; }
    .mt-admin button:active { transform: translateY(1px); }
  `}</style>
);
const s: Record<string, React.CSSProperties> = {
  wrap: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#e7efe9",
    background: "#0f1512",
    minHeight: "100vh",
    padding: "12px",
    maxWidth: 680,
    margin: "0 auto",
  },
  loginBox: { display: "flex", flexDirection: "column", gap: 12, marginTop: 80 },
  h1: { fontSize: 20, textAlign: "center" },
  input: {
    padding: "14px",
    fontSize: 16,
    borderRadius: 10,
    border: "1px solid #2c3a32",
    background: "#16201b",
    color: "#fff",
  },
  err: { color: "#ff8a8a", textAlign: "center" },
  top: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 2px 12px",
  },
  live: { color: "#7ff0b0", fontSize: 13, marginLeft: "auto" },
  tabs: { display: "flex", gap: 6, marginBottom: 12 },
  tab: {
    flex: 1,
    padding: "10px 4px",
    borderRadius: 9,
    border: "1px solid #2c3a32",
    background: "#16201b",
    color: "#9fb3a6",
    fontSize: 13,
  },
  tabOn: { background: "#ffd233", color: "#1a1a1a", borderColor: "#ffd233", fontWeight: 700 },
  toast: {
    position: "sticky",
    top: 6,
    background: "#1f6b45",
    padding: "8px 12px",
    borderRadius: 8,
    marginBottom: 10,
    textAlign: "center",
  },
  card: {
    background: "#16201b",
    border: "1px solid #243029",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 13, color: "#8fa89a", marginBottom: 10 },
  stats: { display: "flex", gap: 8 },
  stat: { flex: 1, textAlign: "center" },
  statV: { fontSize: 18, fontWeight: 800, color: "#fff" },
  statL: { fontSize: 11, color: "#8fa89a", marginTop: 4 },
  row: { display: "flex", gap: 8, marginBottom: 8 },
  btn: {
    flex: 1,
    padding: "12px",
    borderRadius: 9,
    border: "1px solid #2c3a32",
    background: "#1d2a23",
    color: "#e7efe9",
    fontSize: 14,
  },
  btnPrimary: {
    padding: "14px",
    borderRadius: 10,
    border: "none",
    background: "#ffd233",
    color: "#1a1a1a",
    fontSize: 16,
    fontWeight: 700,
  },
  btnGhost: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #2c3a32",
    background: "transparent",
    color: "#9fb3a6",
    fontSize: 13,
  },
  btnDanger: {
    flex: 1,
    padding: "12px",
    borderRadius: 9,
    border: "1px solid #5a2630",
    background: "#2a1518",
    color: "#ff9a9a",
    fontSize: 13,
  },
  line: {
    background: "#16201b",
    border: "1px solid #243029",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  lineHead: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  lineFoot: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap",
  },
  text: { marginTop: 6, fontSize: 15, wordBreak: "break-word" },
  dim: { color: "#7a8c80", fontSize: 11, marginLeft: "auto" },
  vid: {
    fontSize: 11,
    color: "#6f8378",
    background: "#0f1512",
    padding: "2px 6px",
    borderRadius: 5,
  },
  tag: {
    fontSize: 10,
    background: "#3a2f12",
    color: "#ffd233",
    padding: "1px 6px",
    borderRadius: 5,
  },
  warnTag: {
    fontSize: 10,
    background: "#3a1f12",
    color: "#ffb27f",
    padding: "1px 6px",
    borderRadius: 5,
  },
  banCtl: { display: "flex", gap: 6, marginLeft: "auto", alignItems: "center" },
  select: {
    padding: "6px",
    borderRadius: 7,
    border: "1px solid #2c3a32",
    background: "#0f1512",
    color: "#e7efe9",
    fontSize: 12,
  },
  btnSm: {
    padding: "6px 12px",
    borderRadius: 7,
    border: "1px solid #5a2630",
    background: "#2a1518",
    color: "#ff9a9a",
    fontSize: 12,
  },
  btnSmWarn: {
    padding: "6px 12px",
    borderRadius: 7,
    border: "1px solid #5a4226",
    background: "#2a2015",
    color: "#ffc98a",
    fontSize: 12,
  },
  empty: { textAlign: "center", color: "#6f8378", padding: 30 },
};
