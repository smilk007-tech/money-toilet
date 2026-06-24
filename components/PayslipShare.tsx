"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FakeToiletSocket } from "@/lib/fakeSocket";
import { fmtWon, type ReceiptData } from "@/lib/receiptShare";
import { shareCtaLook } from "@/lib/shareCta";
import ReceiptCard from "@/components/ReceiptCard";

/* 공유받은 사람이 링크 타고 들어왔을 때 보는 화면.
   - 가짜 소켓에 연결해 현재 접속자(N명)와 실시간 누적금액을 살아 움직이게 한다.
   - 명세서 하단에 "함께 돈 벌러 가기" CTA로 앱 메인 랜딩. */

const AVG_RATE_PER_PERSON = 3_000_000 / (22 * 8 * 3600); // ≈ 4.73원/초/인

export default function PayslipShare({
  data,
  siteUrlHref,
}: {
  data: ReceiptData;
  siteUrlHref: string;
}) {
  const router = useRouter();
  const [count, setCount] = useState(data.p || 0);
  const [liveWon, setLiveWon] = useState(data.g || 0);
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    const socket = new FakeToiletSocket();
    socket.on("presence", ({ count }: { count: number }) => setCount(count));
    socket.on("global", ({ total }: { total: number }) =>
      setLiveWon((prev) => Math.max(prev, total)),
    );
    socket.on("flush", (f: { total: number }) =>
      setLiveWon((prev) => Math.max(prev, f.total)),
    );
    socket.connect();

    // 접속자 수 × 인당 초당수입 만큼 매끄럽게 차오르는 카운터
    const STEP_MS = 120;
    const ticker = setInterval(() => {
      setLiveWon(
        (prev) =>
          prev + countRef.current * AVG_RATE_PER_PERSON * (STEP_MS / 1000),
      );
    }, STEP_MS);

    return () => {
      clearInterval(ticker);
      try {
        socket.disconnect();
      } catch {}
    };
  }, []);

  return (
    <main
      style={{ ...wrap, cursor: "pointer" }}
      onClick={() => router.push("/")}
    >
      <div style={cardWrap}>
        <ReceiptCard d={data} siteUrlHref={siteUrlHref} />
      </div>

      {/* 실시간 라이브 배너 */}
      <div style={liveBox}>
        <div style={liveDot}>
          <span style={dot} />
          현재 접속자 {count.toLocaleString("ko-KR")}명
        </div>
        <div style={liveAmt}>{fmtWon(liveWon)}</div>
        <div style={liveSub}>
          지금 이 {count.toLocaleString("ko-KR")}명이 변기 위에서 실시간으로
          쓸어담는 중 💸
        </div>
      </div>

      <div style={cta}>🚽 함께 돈 벌러 가기</div>
    </main>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 16,
  padding: "16px",
  background: "radial-gradient(120% 120% at 50% 0%, #1b2a22 0%, #0d120f 60%)",
};
const cardWrap: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  filter: "drop-shadow(0 16px 34px rgba(0,0,0,.5))",
};
const liveBox: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  padding: "10px 14px",
  borderRadius: 12,
  background: "rgba(16,24,18,0.7)",
  border: "1px solid rgba(125,255,176,0.28)",
};
const liveDot: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  color: "#9fdcc9",
  fontSize: 13,
  fontWeight: 700,
};
const dot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "#36e0a0",
  boxShadow: "0 0 10px #36e0a0",
};
const liveAmt: React.CSSProperties = {
  color: "#ffd84d",
  fontSize: 30,
  fontWeight: 900,
  lineHeight: 1,
  fontVariantNumeric: "tabular-nums",
  textShadow: "0 0 16px rgba(255,216,77,0.35)",
};
const liveSub: React.CSSProperties = {
  color: "#cfeee2",
  fontSize: 12.5,
  fontWeight: 600,
  textAlign: "center",
  lineHeight: 1.35,
};
const cta: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  ...shareCtaLook,
  fontWeight: 900,
  fontSize: 17,
  padding: "14px 24px",
  borderRadius: 14,
  textDecoration: "none",
};
