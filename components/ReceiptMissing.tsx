"use client";

import { useRouter } from "next/navigation";
import { shareCtaLook } from "@/lib/receipt/shareCta";
import LiveEarningsBanner from "@/components/LiveEarningsBanner";

/* 급여명세서를 불러올 수 없을 때(만료·잘못된 링크) 보여주는 화면.
   공유 페이지(PayslipShare)와 톤을 맞춘다: 라이브 배너(현재접속자·다같이 번 돈)를 동일하게 보여주고,
   맨 아래 CTA로 메인 유도. 보낸 사람 닉이 없으므로 "~~님처럼" 넛지는 없다. */

const SESSION_FROM_GAME_KEY = "mt_came_from_game";

export default function ReceiptMissing() {
  const router = useRouter();
  function go() {
    try {
      sessionStorage.setItem(SESSION_FROM_GAME_KEY, "1");
    } catch {}
    router.push("/");
  }

  return (
    <main style={{ ...wrap, cursor: "pointer" }} onClick={go}>
      <div style={msgWrap}>
        <div style={msgEmoji}>🧾💨</div>
        <div style={msgTitle}>급여명세서를 불러올 수 없어요</div>
        <div style={msgSub}>사라졌거나 만료된 링크예요</div>
      </div>

      <LiveEarningsBanner />

      <div style={cta}>
        <img
          src="/brand-icon.png"
          alt=""
          width={26}
          height={26}
          style={{ display: "block" }}
        />
        돈버는 화장실에서 돈 벌기
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
const msgWrap: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  textAlign: "center",
};
const msgEmoji: React.CSSProperties = { fontSize: 40, lineHeight: 1 };
const msgTitle: React.CSSProperties = {
  color: "#eafff5",
  fontSize: 18,
  fontWeight: 900,
};
const msgSub: React.CSSProperties = {
  color: "#9fdcc9",
  fontSize: 13,
  fontWeight: 600,
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
