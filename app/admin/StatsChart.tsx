"use client";

/* 어드민 상세 통계 — 기간+틱 조회, recharts 차트(접속자·채팅=막대 / 통계=색상별 꺾은선) + 표(≥15분).
   데이터: /api/admin/series (분단위 Redis 합산, 빈 슬롯 0채움, 30일 보관). 오늘도 여기서 조회(≤60초 지연).
   접속자/금액은 게이지·대형스케일이라 접속자는 막대, 금액은 우측 보조축 꺾은선으로 분리. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

type SeriesPoint = {
  ts: number; label: string; presence: number; visits: number; newVisitors: number;
  chat: number; flush: number; money: number; share: number; donate: number; brag: number;
  dwellSec: number; dwellMin?: number; // dwellMin = 조회 후 클라에서 파생(분 단위)
};

const TOKEN_KEY = "mt_admin_token";
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
const pad = (n: number) => String(n).padStart(2, "0");
const won = (n: number) => (n || 0).toLocaleString("ko-KR");
// KST 기준 오늘/과거 날짜(YYYY-MM-DD)
const kstDateOf = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * 86400000 + 9 * 3600000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

const CHART_TICKS = [1, 3, 5, 10, 15, 30, 60];
const TABLE_TICKS = [15, 30, 60];
const tickLabel = (t: number) => (t >= 60 ? `${t / 60}시간` : `${t}분`);

// key: 데이터 필드, kind: 막대/선, axis: 좌(카운트)/우(금액), on: 기본 표시 여부
type Metric = { key: keyof SeriesPoint; label: string; kind: "bar" | "line"; axis: "left" | "right"; color: string; on: boolean };
const METRICS: Metric[] = [
  { key: "presence", label: "접속자", kind: "bar", axis: "left", color: "#ffd233", on: true },
  { key: "chat", label: "채팅", kind: "bar", axis: "left", color: "#4aa3ff", on: true },
  { key: "visits", label: "방문", kind: "line", axis: "left", color: "#7ff0b0", on: true },
  { key: "newVisitors", label: "신규", kind: "line", axis: "left", color: "#b98bff", on: false },
  { key: "flush", label: "물내림", kind: "line", axis: "left", color: "#ff6f91", on: false },
  { key: "share", label: "공유", kind: "line", axis: "left", color: "#5ad1c8", on: true },
  { key: "donate", label: "후원", kind: "line", axis: "left", color: "#ff9e57", on: true },
  { key: "brag", label: "자랑", kind: "line", axis: "left", color: "#e05fa0", on: true },
  { key: "dwellMin", label: "체류(분)", kind: "line", axis: "left", color: "#a5b4fc", on: false },
  { key: "money", label: "금액(원)", kind: "line", axis: "right", color: "#9be15d", on: false },
];
const TABLE_COLS: { key: keyof SeriesPoint; label: string }[] = [
  { key: "presence", label: "접속" }, { key: "dwellSec", label: "체류(분)" },
  { key: "visits", label: "방문" }, { key: "newVisitors", label: "신규" },
  { key: "chat", label: "채팅" }, { key: "flush", label: "물내림" },
  { key: "share", label: "공유" }, { key: "donate", label: "후원" }, { key: "brag", label: "자랑" },
  { key: "money", label: "금액" },
];

async function fetchSeries(start: string, end: string, tick: number) {
  const token = getToken();
  const res = await fetch(`/api/admin/series?start=${start}&end=${end}&tick=${tick}`, {
    cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// 조회 프리셋 — 24시간 단위 4일(오늘/어제/엊그제/그끄저께). chartTick 15분(96포인트)·tableTick 60분(24행).
const RANGES = [
  { key: "d0", label: "오늘", from: 0, to: 0, chartTick: 15, tableTick: 60, minTick: 1 },
  { key: "d1", label: "어제", from: 1, to: 1, chartTick: 15, tableTick: 60, minTick: 1 },
  { key: "d2", label: "엊그제", from: 2, to: 2, chartTick: 15, tableTick: 60, minTick: 1 },
  { key: "d3", label: "그끄저께", from: 3, to: 3, chartTick: 15, tableTick: 60, minTick: 1 },
] as const;

export default function StatsChart() {
  const [rangeKey, setRangeKey] = useState<string>("d0");
  const [chartTick, setChartTick] = useState(15);
  const [tableTick, setTableTick] = useState(15);
  const [chartData, setChartData] = useState<SeriesPoint[]>([]);
  const [tableData, setTableData] = useState<SeriesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [visible, setVisible] = useState<Record<string, boolean>>(
    () => Object.fromEntries(METRICS.map((m) => [m.key, m.on])),
  );

  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[0];
  const start = kstDateOf(range.from);
  const end = kstDateOf(range.to);
  const tickOpts = CHART_TICKS.filter((t) => t >= range.minTick); // 과다 포인트(3000↑) 방지

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    // 차트틱과 표틱이 같으면 동일 요청이라 1번만 호출(중복 제거)
    const sameTick = chartTick === tableTick;
    const [c, t] = await Promise.all([
      fetchSeries(start, end, chartTick),
      sameTick ? Promise.resolve(null) : fetchSeries(start, end, tableTick),
    ]);
    if (c.data?.ok) setChartData((c.data.points || []).map((p: SeriesPoint) => ({ ...p, dwellMin: Math.round((p.dwellSec || 0) / 60) })));
    else setErr(c.data?.hint || c.data?.error || "조회 실패");
    const tRes = sameTick ? c : t;
    if (tRes?.data?.ok) setTableData(tRes.data.points || []);
    setLoading(false);
  }, [start, end, chartTick, tableTick]);

  useEffect(() => { load(); }, [load]);

  // 프리셋 선택 → 조회 날짜 변경 + 범위별 가장 보기좋은 차트틱·표틱 자동 세팅(최소 틱으로 클램프)
  const pickRange = (r: (typeof RANGES)[number]) => {
    setRangeKey(r.key);
    setChartTick(Math.max(r.chartTick, r.minTick));
    setTableTick(r.tableTick);
  };

  const activeMetrics = useMemo(() => METRICS.filter((m) => visible[m.key]), [visible]);
  const hasRightAxis = activeMetrics.some((m) => m.axis === "right");

  return (
    <div>
      {/* 컨트롤 */}
      <div style={s.card}>
        {/* 1행: 조회 범위 프리셋(클릭 시 조회 날짜 변경) */}
        <div style={s.rangeRow}>
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => pickRange(r)}
              style={{ ...s.rangeBtn, ...(rangeKey === r.key ? s.rangeBtnOn : {}) }}>{r.label}</button>
          ))}
        </div>
        {/* 2행: 선택된 시작/종료일 */}
        <div style={s.rangeInfo}>
          <span>시작 <b style={s.rangeDate}>{start}</b></span>
          <span>종료 <b style={s.rangeDate}>{end}</b></span>
        </div>
        {/* 3행: 차트틱 · 표틱 · 조회(맨우측) */}
        <div style={s.ctrlRow3}>
          <label style={s.ctrlItem}><span style={s.ctrlLbl}>차트 틱</span>
            <select value={chartTick} onChange={(e) => setChartTick(Number(e.target.value))} style={s.sel}>
              {tickOpts.map((t) => <option key={t} value={t}>{tickLabel(t)}</option>)}
            </select></label>
          <label style={s.ctrlItem}><span style={s.ctrlLbl}>표 틱</span>
            <select value={tableTick} onChange={(e) => setTableTick(Number(e.target.value))} style={s.sel}>
              {TABLE_TICKS.map((t) => <option key={t} value={t}>{tickLabel(t)}</option>)}
            </select></label>
          <button style={s.reloadBtn} onClick={load} disabled={loading}>{loading ? "…" : "조회"}</button>
        </div>
        <div style={s.hint}>로그 없는 구간도 0으로 표시</div>
        {err && <div style={s.err}>{err}</div>}
      </div>

      {/* 메트릭 토글 */}
      <div style={s.chips}>
        {METRICS.map((m) => (
          <button key={m.key} onClick={() => setVisible((p) => ({ ...p, [m.key]: !p[m.key] }))}
            style={{ ...s.chip, ...(visible[m.key] ? { background: m.color, color: "#10140f", borderColor: m.color } : {}) }}>
            {m.kind === "bar" ? "▮" : "／"} {m.label}
          </button>
        ))}
      </div>

      {/* 차트 */}
      <div style={s.card}>
        <div style={{ width: "100%", height: 340 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 8, right: hasRightAxis ? 8 : 4, left: -18, bottom: 4 }}>
              <CartesianGrid stroke="#233029" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: "#8fa89a", fontSize: 10 }} minTickGap={24} />
              <YAxis yAxisId="left" tick={{ fill: "#8fa89a", fontSize: 10 }} allowDecimals={false} />
              {hasRightAxis && <YAxis yAxisId="right" orientation="right" tick={{ fill: "#9be15d", fontSize: 10 }} width={54} tickFormatter={(v) => won(v)} />}
              <Tooltip contentStyle={{ background: "#0f1512", border: "1px solid #2c3a32", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#e7efe9" }} formatter={(v, n) => [n === "금액(원)" ? `${won(Number(v))}원` : (v as number), n as string]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {activeMetrics.filter((m) => m.kind === "bar").map((m) => (
                <Bar key={m.key} yAxisId={m.axis} dataKey={m.key} name={m.label} fill={m.color} maxBarSize={26} isAnimationActive={false} />
              ))}
              {activeMetrics.filter((m) => m.kind === "line").map((m) => (
                <Line key={m.key} yAxisId={m.axis} type="monotone" dataKey={m.key} name={m.label} stroke={m.color} dot={false} strokeWidth={2} isAnimationActive={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 표(≥15분, 빈 슬롯 포함) */}
      <div style={s.card}>
        <div style={s.tableHead}>구간별 표 · {tableTick}분 단위 · {tableData.length}행</div>
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, textAlign: "left" }}>시각</th>
                {TABLE_COLS.map((c) => <th key={c.key} style={s.th}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {tableData.map((p) => {
                const zero = TABLE_COLS.every((c) => !p[c.key]);
                return (
                  <tr key={p.ts} style={zero ? { opacity: 0.4 } : undefined}>
                    <td style={{ ...s.td, textAlign: "left", color: "#7ff0b0" }}>{p.label}</td>
                    {TABLE_COLS.map((c) => (
                      <td key={c.key} style={s.td}>
                        {c.key === "money" ? won(p.money) : c.key === "dwellSec" ? Math.round((p.dwellSec || 0) / 60) : (p[c.key] || 0)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {tableData.length === 0 && <tr><td style={s.td} colSpan={TABLE_COLS.length + 1}>데이터 없음</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: { background: "#16201b", border: "1px solid #243029", borderRadius: 12, padding: 12, marginBottom: 10 },
  ctrlItem: { display: "flex", flexDirection: "column", gap: 4 },
  ctrlLbl: { fontSize: 11, color: "#8fa89a" },
  sel: { padding: "7px 8px", borderRadius: 8, border: "1px solid #2c3a32", background: "#0e1812", color: "#e8f5ee", fontSize: 13 },
  // 1행: 조회 범위 프리셋
  rangeRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  rangeBtn: { padding: "7px 12px", borderRadius: 999, border: "1px solid #2c3a32", background: "#16201b", color: "#9fb3a6", fontSize: 12.5, fontWeight: 600 },
  rangeBtnOn: { background: "#ffd233", color: "#1a1a1a", borderColor: "#ffd233", fontWeight: 800 },
  // 2행: 시작/종료일
  rangeInfo: { display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "#8fa89a" },
  rangeDate: { color: "#e8f5ee", fontVariantNumeric: "tabular-nums", fontWeight: 700 },
  // 3행: 차트틱 · 표틱 · 조회(우측)
  ctrlRow3: { display: "flex", gap: 10, alignItems: "flex-end", marginTop: 10 },
  reloadBtn: { marginLeft: "auto", padding: "9px 18px", borderRadius: 8, border: "none", background: "#ffd233", color: "#1a1a1a", fontSize: 13, fontWeight: 800 },
  hint: { fontSize: 11, color: "#5a7a6a", marginTop: 10 },
  err: { fontSize: 12, color: "#ff8a8a", marginTop: 8 },
  chips: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 },
  chip: { padding: "5px 10px", borderRadius: 20, border: "1px solid #2c3a32", background: "#16201b", color: "#9fb3a6", fontSize: 11.5, fontWeight: 600 },
  tableHead: { fontSize: 12, color: "#8fa89a", marginBottom: 8 },
  tableWrap: { border: "1px solid #243029", borderRadius: 8, overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 11, fontVariantNumeric: "tabular-nums" },
  // sticky 헤더 — 불투명 배경 + 그림자로 스크롤되는 행 위에서 또렷하게(투명도 문제 해결)
  th: { position: "sticky", top: 0, zIndex: 1, background: "#0d120f", color: "#cfe5d8", textAlign: "right", padding: "8px 7px", borderBottom: "1px solid #33463b", fontWeight: 700, whiteSpace: "nowrap", boxShadow: "0 2px 5px rgba(0,0,0,0.5)" },
  td: { textAlign: "right", padding: "5px 7px", borderBottom: "1px solid #161f1a", whiteSpace: "nowrap", color: "#d7e6dd" },
};
