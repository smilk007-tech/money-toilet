import { fmtWon, heroAmount, type ReceiptData } from "@/lib/receiptShare";

/* 영수증 카드 — Satori(OG 이미지)와 일반 HTML 양쪽에서 렌더되도록
   flex + 인라인 스타일만 사용한다. (gap/grid/clamp 등 미사용) */
export default function ReceiptCard({ d }: { d: ReceiptData }) {
  const hero = heroAmount(d);
  const dt = new Date(d.ts || Date.now());
  const z = (n: number) => String(n).padStart(2, "0");
  const issued = `${dt.getFullYear()}.${z(dt.getMonth() + 1)}.${z(dt.getDate())} ${z(dt.getHours())}:${z(dt.getMinutes())}`;

  const INK = "#20271f";
  const SUB = "#717a6f";
  const GOLD = "#a9760a";
  const LINE = "#c9ccc0";
  const dash = {
    display: "flex",
    borderTop: `2px dashed ${LINE}`,
    height: 0,
    margin: "11px 0",
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
        padding: "30px 40px",
        borderRadius: 16,
        fontFamily: '"Noto Sans KR"',
      }}
    >
      <div style={{ ...center, fontSize: 44, fontWeight: 800 }}>💩 똥탐</div>
      <div
        style={{
          ...center,
          fontSize: 17,
          fontWeight: 700,
          color: SUB,
          letterSpacing: 6,
          marginTop: 4,
        }}
      >
        화장실 영수증
      </div>

      <div style={dash} />
      <div style={{ ...row, fontSize: 17 }}>
        <span style={{ color: SUB }}>발행</span>
        <span>{issued}</span>
      </div>
      <div style={{ ...row, fontSize: 17, marginTop: 8 }}>
        <span style={{ color: SUB }}>손님</span>
        <span style={{ fontWeight: 700 }}>{d.n}</span>
      </div>

      <div style={dash} />
      <div style={{ ...row, fontSize: 19 }}>
        <span>화장실 근무수당</span>
        <span>{fmtWon(d.s)}</span>
      </div>
      <div style={{ ...row, fontSize: 19, marginTop: 10 }}>
        <span>실시간 적립(진행중)</span>
        <span>{fmtWon(d.l)}</span>
      </div>

      <div
        style={{
          display: "flex",
          borderTop: `2px solid ${INK}`,
          height: 0,
          margin: "11px 0",
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-end", width: "100%" }}>
        <span style={{ fontSize: 21, fontWeight: 800 }}>합계</span>
        <span
          style={{ fontSize: 13, color: SUB, marginLeft: 8, marginBottom: 3 }}
        >
          TOTAL
        </span>
      </div>
      <div style={{ ...center, fontSize: 54, fontWeight: 800, marginTop: 6 }}>
        {fmtWon(hero)}
      </div>

      <div
        style={{
          display: "flex",
          borderTop: `2px solid ${INK}`,
          height: 0,
          marginTop: 11,
        }}
      />
      <div
        style={{
          display: "flex",
          borderTop: `2px solid ${INK}`,
          height: 0,
          marginTop: 3,
          marginBottom: 11,
        }}
      />

      <div style={{ ...center, fontSize: 17, fontWeight: 700, color: SUB }}>
        오늘 다 같이 번 돈
      </div>
      <div
        style={{
          ...center,
          fontSize: 28,
          fontWeight: 800,
          color: GOLD,
          marginTop: 6,
        }}
      >
        {fmtWon(d.g)}
      </div>
      <div style={{ ...center, fontSize: 15, color: SUB, marginTop: 8 }}>
        지금 볼일 중 {d.p}명 · 내 물내림 {d.f}회
      </div>

      <div style={dash} />
      <div style={{ ...center, fontSize: 18, fontWeight: 700 }}>
        &quot;{d.sl}&quot;
      </div>
      <div style={{ ...center, fontSize: 15, fontWeight: 700, marginTop: 11 }}>
        똥탐 · paid-toilet
      </div>
    </div>
  );
}
