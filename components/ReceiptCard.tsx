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

function TabularText({ text, bold = false }: { text: string; bold?: boolean }) {
  return (
    <span
      style={{
        whiteSpace: "nowrap",
        display: "inline-block",
        fontWeight: bold ? 700 : undefined,
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        background: "#fbfaf3",
        color: INK,
        padding: "24px 26px",
        border: `1px solid ${LINE}`,
        borderRadius: 14,
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
        <span style={{ fontSize: 24, fontWeight: 800 }}>📌 급여명세서</span>
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "100%",
          }}
        >
          {d.n}
        </span>
      </div>

      <div style={dash} />
      <div style={{ ...row, fontSize: 13 }}>
        <span style={{ color: SUB }}>발급일</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{issued}</span>
      </div>

      <div style={dash} />
      <div style={{ ...row, fontSize: 12, fontWeight: 700, color: SUB }}>
        <span>물내림 수당</span>
        <span>금액</span>
      </div>

      {omitted && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%",
            marginTop: 5,
          }}
        >
          <span
            style={{
              display: "flex",
              fontSize: 10,
              color: SUB,
              marginTop: 3,
            }}
          >
            (종이가 모자라 생략...😢)
          </span>
        </div>
      )}
      {d.h.length > 0 ? (
        d.h.map(([round, amount], i) => (
          <div
            key={round}
            style={{
              ...row,
              fontSize: 12,
              marginTop: i === 0 && !omitted ? 8 : 6,
            }}
          >
            <TabularText text={fmtRound(round)} />
            <TabularText text={fmtWon(amount)} bold />
          </div>
        ))
      ) : (
        <div
          style={{
            ...row,
            fontSize: 12,
            marginTop: 8,
          }}
        >
          <TabularText text={fmtRound(0)} />
          <TabularText text={fmtWon(0)} bold />
        </div>
      )}

      <div style={dash} />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          lineHeight: 1.12,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700 }}>실 수령액</span>
        <span style={{ fontSize: 20, fontWeight: 800 }}>
          <TabularText text={fmtWon(hero)} bold />
        </span>
      </div>

      <div style={dash} />
      <div
        style={{
          ...center,
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 1.35,
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
            fontSize: 10,
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
