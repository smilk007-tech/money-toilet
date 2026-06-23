import {
  fmtWon,
  heroAmount,
  hasOmittedLines,
  type ReceiptData,
} from "@/lib/receiptShare";

/* game.js readout__amt / .digit 와 동일 — 숫자마다 고정폭 셀을 써서 레이아웃 시프트 방지 */
const digitCell = {
  display: "inline-block",
  width: "0.66em",
  textAlign: "center" as const,
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
  return (
    <span
      style={{
        whiteSpace: "nowrap",
        display: "inline-block",
        fontWeight: weight ?? (bold ? 700 : undefined),
      }}
    >
      {text.split("").map((ch, i) =>
        /[0-9]/.test(ch) ? (
          <span key={i} style={digitCell}>
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </span>
  );
}

/* 급여명세서 카드 — Satori(OG 이미지)와 일반 HTML 양쪽에서 렌더되도록
   flex + 인라인 스타일만 사용한다. (gap/grid/clamp 등 미사용) */
export default function ReceiptCard({
  d,
  siteUrlHref,
  siteUrlLabel,
  footerMode = "interactive",
  maxHeight,
}: {
  d: ReceiptData;
  siteUrlHref?: string;
  siteUrlLabel?: string;
  footerMode?: "interactive" | "snapshot";
  maxHeight?: string;
}) {
  const hero = heroAmount(d);
  const dt = new Date(d.ts || Date.now());
  const z = (n: number) => String(n).padStart(2, "0");
  const issued = `${dt.getFullYear()}.${z(dt.getMonth() + 1)}.${z(dt.getDate())} ${z(dt.getHours())}:${z(dt.getMinutes())}`;
  const omitted = hasOmittedLines(d);

  const INK = "#20271f";
  const SUB = "#717a6f";
  const LINE = "#c9ccc0";
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
  const fmtRound = (n: number) => `${n.toLocaleString("ko-KR")}회차`;
  const rows = [...d.h].reverse(); // 최신(마지막 회차)이 맨 위로 쌓이도록 역순 표시

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
      <div
        style={{
          ...center,
          flexDirection: "column",
          alignItems: "center",
          gap: 5,
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 700 }}>📌 급여명세서</span>
        <span
          style={{
            fontSize: 17,
            fontWeight: 800,
            letterSpacing: 1.5,
            color: "#2f6b4e",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "100%",
          }}
        >
          {d.n}
        </span>
      </div>

      <div style={{ ...solid, margin: "10px 0" }} />
      <div style={{ ...row, fontSize: 10.5 }}>
        <span style={{ color: SUB }}>발급일</span>
        <span style={{ color: SUB, fontVariantNumeric: "tabular-nums" }}>
          {issued}
        </span>
      </div>

      <div style={{ ...dash, margin: "8px 0" }} />
      <div
        style={{
          ...row,
          fontSize: 11,
          fontWeight: 500,
          color: SUB,
          letterSpacing: 0.5,
        }}
      >
        <span>물내림 수당</span>
        <span>금액</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          marginTop: 5,
        }}
      >
        {rows.length > 0 ? (
          rows.map(([round, amount], i) => (
            <div
              key={round}
              style={{
                ...row,
                fontSize: 11.5,
                padding: "3px 7px",
                marginTop: i === 0 ? 0 : 1,
                background: i % 2 === 0 ? "#f2f0e3" : "transparent",
              }}
            >
              <TabularText text={fmtRound(round)} />
              <TabularText text={fmtWon(amount)} weight={600} />
            </div>
          ))
        ) : (
          <div
            style={{
              ...row,
              fontSize: 11.5,
              padding: "3px 7px",
            }}
          >
            <TabularText text={fmtRound(0)} />
            <TabularText text={fmtWon(0)} weight={600} />
          </div>
        )}

        {omitted && (
          <div
            style={{
              ...center,
              marginTop: 5,
            }}
          >
            <span
              style={{
                display: "flex",
                fontSize: 10,
                color: SUB,
              }}
            >
              종이가 모자라 생략...😢
            </span>
          </div>
        )}
      </div>

      <div style={{ ...dash, margin: "10px 0" }} />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          lineHeight: 1.15,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700 }}>실 수령액</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#2f6b4e" }}>
          <TabularText text={fmtWon(hero)} weight={900} />
        </span>
      </div>

      <div style={{ ...solid, margin: "10px 0" }} />
      <div
        style={{
          ...center,
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 1.4,
          textAlign: "center",
        }}
      >
        &quot;{d.sl}&quot;
      </div>
      {footerMode === "snapshot" ? (
        <div
          style={{
            ...center,
            marginTop: 8,
            fontSize: 10.5,
            fontWeight: 700,
            color: "#3f7668",
            textDecoration: "underline",
            wordBreak: "break-all",
            textAlign: "center",
          }}
        >
          {siteUrlLabel ?? siteUrlHref ?? "money-toilet"}
        </div>
      ) : (
        <a
          href={siteUrlHref}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            ...center,
            fontSize: 12,
            fontWeight: 600,
            marginTop: 8,
            color: SUB,
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          돈버는 화장실 · money-toilet
        </a>
      )}
    </div>
  );
}
