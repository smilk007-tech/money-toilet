import {
  fmtWon,
  heroAmount,
  hasOmittedLines,
  RECEIPT_HISTORY_MAX_MODAL,
  receiptDocNo,
  receiptIssuedAt,
  resolveReceiptSlogan,
  visibleHistoryRows,
  type ReceiptData,
} from "@/lib/receipt/receiptShare";

/* game.js readout__amt / .digit 와 동일 — 숫자마다 고정폭 셀을 써서 레이아웃 시프트 방지
   html-to-image(PNG 저장)·일반 HTML 양쪽에서 렌더되므로
   flex + 인라인 스타일만 쓰고 가상요소(::before/::after)는 쓰지 않는다. */
const digitCell = {
  display: "flex" as const,
  width: "0.66em",
  justifyContent: "center" as const,
};

function TabularText({
  text,
  bold = false,
  weight,
}: {
  text: string;
  bold?: boolean;
  weight?: number;
}) {
  const fw = weight ?? (bold ? 700 : 400);
  return (
    <span
      style={{
        whiteSpace: "nowrap",
        display: "flex",
        fontWeight: fw,
      }}
    >
      {text.split("").map((ch, i) =>
        /[0-9]/.test(ch) ? (
          <span key={i} style={digitCell}>
            {ch}
          </span>
        ) : (
          <span key={i} style={{ display: "flex" }}>
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

/* 닉네임 → 결정적 사원번호 (WC-#####) — 렌더마다 동일하게 */
function empNoOf(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `WC-${String(h % 100000).padStart(5, "0")}`;
}

/* 결정적 바코드 막대 — 발급정보 해시로 굵기/간격을 만든다 */
function barcodeBars(seed: string): { w: number; on: boolean }[] {
  let h = 2166136261;
  for (const c of seed) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const bars: { w: number; on: boolean }[] = [];
  for (let i = 0; i < 46; i++) {
    h = (Math.imul(h, 48271) + 11) >>> 0;
    bars.push({ w: 1 + ((h >> (i % 8)) % 3), on: i % 2 === 0 });
  }
  return bars;
}

/* 급여명세서 카드 */
export default function ReceiptCard({
  d,
  siteUrlHref,
  footerMode = "interactive",
  maxHeight,
  maxHistoryRows = RECEIPT_HISTORY_MAX_MODAL,
  stampVisible = true,
  stampAnimate = false,
  stampSlamMs,
}: {
  d: ReceiptData;
  siteUrlHref?: string;
  footerMode?: "interactive" | "snapshot";
  maxHeight?: string;
  maxHistoryRows?: number;
  stampVisible?: boolean;
  stampAnimate?: boolean;
  stampSlamMs?: number;
}) {
  const hero = heroAmount(d);
  const issued = receiptIssuedAt(d);
  const omitted = hasOmittedLines(d, maxHistoryRows);
  const empNo = empNoOf(d.n);
  const docNo = receiptDocNo(d);

  const INK = "#20271f";
  const SUB = "#717a6f";
  const LINE = "#c9ccc0";
  const BRAND = "#2f6b4e";
  const STAMP = "#c2453a";
  const ZEBRA = "#f2f0e3";

  const dash = {
    display: "flex",
    borderTop: `1.5px dashed ${LINE}`,
    height: 0,
    margin: "8px 0",
  } as const;
  const solid = {
    display: "flex",
    borderTop: `1.6px solid ${INK}`,
    height: 0,
    margin: "8px 0",
  } as const;
  const row = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    lineHeight: 1.25,
  } as const;
  const center = {
    display: "flex",
    justifyContent: "center",
    width: "100%",
  } as const;
  const metaRow = {
    ...row,
    fontSize: 10.5,
    marginTop: 3,
  } as const;
  const fmtRound = (n: number) => `${n.toLocaleString("ko-KR")}회차`;
  const rows = visibleHistoryRows(d, maxHistoryRows);
  const bars = barcodeBars(`${empNo}${docNo}${hero}`);

  /* 근무 요약 항목 */
  const summary: [string, string][] = [
    ["물 내림 횟수", `${d.f.toLocaleString("ko-KR")}회`],
    ["실 수령액", fmtWon(d.t)],
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        background: "#fbfaf3",
        color: INK,
        padding: "20px 24px",
        border: `1px solid ${LINE}`,
        borderRadius: 16,
        fontFamily: '"Noto Sans KR"',
        lineHeight: 1.25,
        boxSizing: "border-box",
        ...(maxHeight
          ? {
              maxHeight,
              overflowX: "hidden",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch" as const,
              overscrollBehavior: "contain" as const,
              scrollbarWidth: "none" as const,
              msOverflowStyle: "none" as const,
            }
          : {}),
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          ...center,
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700 }}>🧾 급여명세서</span>
        <span
          style={{
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: 1.5,
            color: BRAND,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "100%",
          }}
        >
          {d.n}
        </span>
        <span style={{ display: "flex", fontSize: 10, color: SUB }}>
          지급일 {issued}
        </span>
      </div>

      {/* 근무 요약 */}
      <div style={{ ...solid, margin: "10px 0" }} />
      <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
        {summary.map(([label, value], i) => (
          <div
            key={label}
            style={{ ...row, fontSize: 11.5, marginTop: i === 0 ? 0 : 3 }}
          >
            <span style={{ color: SUB }}>{label}</span>
            <TabularText text={value} weight={700} />
          </div>
        ))}
      </div>

      {/* 지급 내역 */}
      <div style={{ ...dash, margin: "9px 0" }} />
      <div
        style={{
          ...row,
          fontSize: 10,
          fontWeight: 600,
          color: SUB,
          letterSpacing: 0.5,
          padding: "0 7px",
        }}
      >
        <span>물 내림 🚽</span>
        <span>💰 금액</span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          marginTop: 4,
        }}
      >
        {(rows.length > 0 ? rows : [[0, 0] as [number, number]]).map(
          ([round, amount], i) => (
            <div
              key={round}
              style={{
                ...row,
                fontSize: 11.5,
                padding: "3px 7px",
                marginTop: i === 0 ? 0 : 1,
                background: i % 2 === 0 ? ZEBRA : "transparent",
              }}
            >
              <TabularText text={fmtRound(round)} />
              <TabularText text={fmtWon(amount)} weight={600} />
            </div>
          ),
        )}
        {omitted && (
          <div style={{ ...center, marginTop: 5 }}>
            <span style={{ display: "flex", fontSize: 10, color: SUB }}>
              (종이가 모자라 생략..😢)
            </span>
          </div>
        )}
      </div>

      {/* 합계(헤드라인) */}
      <div style={{ ...solid, margin: "10px 0" }} />
      <div
        style={{
          ...center,
          flexDirection: "column",
          alignItems: "center",
          gap: 3,
        }}
      >
        <span style={{ display: "flex", fontSize: 11, color: SUB }}>
          변기 위에서 번 돈
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 26,
            fontWeight: 800,
            color: BRAND,
            lineHeight: 1.1,
          }}
        >
          <span style={{ display: "flex", marginRight: 3 }}>총</span>
          <TabularText text={fmtWon(hero)} weight={900} />
        </span>
      </div>

      {/* 슬로건 + 지급완료 도장 */}
      <div style={{ ...dash, margin: "10px 0" }} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          position: "relative",
          padding: "4px 0",
        }}
      >
        <span
          style={{
            display: "flex",
            fontSize: 13,
            fontWeight: 600,
            fontStyle: "italic",
            lineHeight: 1.5,
            textAlign: "center",
            color: "#3d4a3e",
            maxWidth: "76%",
          }}
        >
          &quot;{resolveReceiptSlogan(d.sl)}&quot;
        </span>
        {stampVisible && (
          <div
            className={stampAnimate ? "receipt-stamp--slam" : undefined}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              position: "absolute",
              right: -14,
              width: 64,
              height: 64,
              borderRadius: 32,
              border: `2.5px solid ${STAMP}`,
              color: STAMP,
              transform: "rotate(-13deg)",
              opacity: 0.92,
              lineHeight: 1,
              backgroundColor: "#fbfaf3",
              bottom: 8,
              ...(stampAnimate && stampSlamMs
                ? { animationDuration: `${stampSlamMs}ms` }
                : {}),
            }}
          >
            <span
              style={{
                display: "flex",
                fontSize: 13,
                fontWeight: 900,
                letterSpacing: -0.5,
              }}
            >
              지급완료
            </span>
            <div
              style={{
                display: "flex",
                width: "80%",
                borderTop: `1px solid ${STAMP}`,
                opacity: 0.5,
              }}
            />
            <span
              style={{
                display: "flex",
                fontSize: 7.5,
                fontWeight: 700,
                letterSpacing: -0.2,
                textAlign: "center",
                lineHeight: 1.3,
              }}
            >
              by 돈버는화장실
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
