import {
  fmtWon,
  heroAmount,
  hasOmittedLines,
  type ReceiptData,
} from "@/lib/receiptShare";

/* 급여명세서 카드 — Satori(OG 이미지)와 일반 HTML 양쪽에서 렌더되도록
   flex + 인라인 스타일만 사용한다. (gap/grid/clamp 등 미사용) */
export default function ReceiptCard({ d }: { d: ReceiptData }) {
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
      }}
    >
      <div style={{ ...center, fontSize: 29, fontWeight: 800 }}>
        📌급여명세서
      </div>
      <div
        style={{
          ...center,
          fontSize: 14,
          fontWeight: 700,
          color: SUB,
          letterSpacing: 2,
          marginTop: 5,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {d.n}
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
          <span style={{ display: "flex", fontSize: 12, lineHeight: 0.8, color: SUB }}>·</span>
          <span style={{ display: "flex", fontSize: 12, lineHeight: 0.8, color: SUB }}>·</span>
          <span style={{ display: "flex", fontSize: 12, lineHeight: 0.8, color: SUB }}>·</span>
          <span
            style={{
              display: "flex",
              fontSize: 10,
              color: SUB,
              marginTop: 3,
            }}
          >
            (종이가 모자라 생략)
          </span>
        </div>
      )}

      {d.h.length > 0 ? (
        d.h.map(([round, amount], i) => (
          <div
            key={round}
            style={{
              ...row,
              fontSize: 14,
              marginTop: i === 0 && !omitted ? 8 : 6,
            }}
          >
            <span style={{ whiteSpace: "nowrap" }}>{round}회차</span>
            <span
              style={{
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {fmtWon(amount)}
            </span>
          </div>
        ))
      ) : (
        <div style={{ ...center, fontSize: 13, color: SUB, marginTop: 9 }}>
          아직 안내려봤음
        </div>
      )}

      <div style={solid} />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          width: "100%",
          lineHeight: 1.12,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 800 }}>
          총 {d.f}회 실수령액
        </span>
        <span
          style={{
            fontSize: 30,
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {fmtWon(hero)}
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
      <div style={{ ...center, fontSize: 12, fontWeight: 700, marginTop: 8 }}>
        돈버는화장실 · money-toilet
      </div>
    </div>
  );
}
