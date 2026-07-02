"use client";

import { useRouter } from "next/navigation";
import {
  RECEIPT_HISTORY_MAX_SHARE,
  type ReceiptData,
} from "@/lib/receipt/receiptShare";
import { shareCtaLook } from "@/lib/receipt/shareCta";
import ReceiptCard from "@/components/ReceiptCard";
import LiveEarningsBanner from "@/components/LiveEarningsBanner";

/* 공유받은 사람이 링크 타고 들어왔을 때 보는 화면.
   - 상단: 보낸 사람의 급여명세서 카드(ReceiptCard).
   - 중단: 실시간 라이브 배너(현재 접속자 · 다같이 번 돈) — LiveEarningsBanner 공용 컴포넌트.
   - 하단: "{닉}님처럼" 넛지 + CTA. CTA는 SPA 라우팅으로 메인 이동(같은 vid 재연결). */

const SESSION_FROM_GAME_KEY = "mt_came_from_game";

export default function PayslipShare({
  data,
  siteUrlHref,
}: {
  data: ReceiptData;
  siteUrlHref: string;
}) {
  const router = useRouter();
  const nick = data.n || "익명의 볼일러"; // 보낸 사람 닉 — CTA 사회적 증거 문구에 사용

  function handleCtaClick() {
    try {
      sessionStorage.setItem(SESSION_FROM_GAME_KEY, "1");
    } catch {}
    router.push("/");
  }

  return (
    <main style={{ ...wrap, cursor: "pointer" }} onClick={handleCtaClick}>
      <div style={cardWrap}>
        <ReceiptCard
          d={data}
          siteUrlHref={siteUrlHref}
          maxHistoryRows={RECEIPT_HISTORY_MAX_SHARE}
        />
      </div>

      <LiveEarningsBanner />

      <div style={ctaWrap}>
        <div style={ctaNudge}>{nick}님처럼</div>
        <div style={cta}>
          <img
            src="/brand-icon.png"
            alt=""
            width={26}
            height={26}
            style={{ display: "block" }}
          />
          돈버는 화장실에서 나도 벌기
        </div>
      </div>
    </main>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  padding: "16px",
  background: "radial-gradient(120% 120% at 50% 0%, #1b2a22 0%, #0d120f 60%)",
};
const cardWrap: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  filter: "drop-shadow(0 16px 34px rgba(0,0,0,.5))",
};
const ctaWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
};
const ctaNudge: React.CSSProperties = {
  color: "#9fdcc9",
  fontSize: 13,
  fontWeight: 800,
  textAlign: "center",
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
