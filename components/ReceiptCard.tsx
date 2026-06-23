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
    borderTop: `2px dashed ${LINE}`,
    height: 0,
    margin: "11px 0",
  } as const;
  const solid = {
    display: "flex",
    borderTop: `2px solid ${INK}`,
    height: 0,
    margin: "10px 0",
  } as const;
  const row = {
    display: "flex",
    justifyContent: "space-between",
    width: "100%",
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
        padding: "30px 36px",
        borderRadius: 16,
        fontFamily: '"Noto Sans KR"',
      }}
    >
      <div style={{ ...center, fontSize: 34, fontWeight: 800 }}>돈버는 화장실</div>
      <div
        style={{
          ...center,
          fontSize: 17,
          fontWeight: 700,
          color: SUB,
          letterSpacing: 5,
          marginTop: 6,
        }}
      >
        급여명세서
      </div>

      <div style={dash} />
      <div style={{ ...row, fontSize: 15 }}>
        <span style={{ color: SUB }}>발급일</span>
        <span>{issued}</span>
      </div>
      <div style={{ ...row, fontSize: 15, marginTop: 8 }}>
        <span style={{ color: SUB }}>성명</span>
        <span style={{ fontWeight: 700 }}>{d.n}</span>
      </div>

      <div style={dash} />
      <div style={{ ...row, fontSize: 13, color: SUB }}>
        <span>지급 항목</span>
        <span>금액</span>
      </div>

      {omitted && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%",
            marginTop: 8,
          }}
        >
          <span style={{ display: "flex", fontSize: 16, color: SUB }}>·</span>
          <span style={{ display: "flex", fontSize: 16, color: SUB }}>·</span>
          <span style={{ display: "flex", fontSize: 16, color: SUB }}>·</span>
          <span
            style={{
              display: "flex",
              fontSize: 11,
              color: SUB,
              marginTop: 2,
            }}
          >
            (이전 회차는 종이가 모자라 생략)
          </span>
        </div>
      )}

      {d.h.length > 0 ? (
        d.h.map(([round, amount], i) => (
          <div
            key={round}
            style={{ ...row, fontSize: 15, marginTop: i === 0 && !omitted ? 10 : 8 }}
          >
            <span>{round}회차 물내림 수당</span>
            <span>{fmtWon(amount)}</span>
          </div>
        ))
      ) : (
        <div style={{ ...center, fontSize: 14, color: SUB, marginTop: 12 }}>
          아직 물내린 적 없음 (지급 내역 0건)
        </div>
      )}

      <div style={solid} />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          width: "100%",
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 800 }}>
          총 {d.f}회 물내림 실수령액
        </span>
        <span style={{ fontSize: 36, fontWeight: 800 }}>{fmtWon(hero)}</span>
      </div>

      <div style={dash} />
      <div style={{ ...center, fontSize: 17, fontWeight: 700 }}>
        &quot;{d.sl}&quot;
      </div>
      <div style={{ ...center, fontSize: 15, fontWeight: 700, marginTop: 11 }}>
        똥탐 · paid-toilet
      </div>
    </div>
  );
}
