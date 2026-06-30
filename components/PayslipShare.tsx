"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FakeToiletSocket } from "@/lib/engine/fakeSocket";
import { io } from "socket.io-client";
import { socketUrl } from "@/lib/engine/realSocket";
import { getVid, wasVidCreated } from "@/lib/engine/identity";
import { LS } from "@/lib/storageKeys";
import {
  fmtWon,
  RECEIPT_HISTORY_MAX_SHARE,
  type ReceiptData,
} from "@/lib/receipt/receiptShare";
import { shareCtaLook } from "@/lib/receipt/shareCta";
import ReceiptCard from "@/components/ReceiptCard";

/* 공유받은 사람이 링크 타고 들어왔을 때 보는 화면.
   - isShare: true 플래그로 hello 전송 → 서버가 presence 맵에 포함하지 않음(방문 집계는 정상).
     화면에 보여줄 접속자수는 서버가 내보내는 그대로 사용(자기 자신 차감 불필요).
   - 오늘 누적금액: 소켓 첫 수신값까지 1천원부터 60초에 걸쳐 creep 애니메이션.
     이후 재수신 시 현재 표시값 기준으로 속도만 재보정 — 절대 점프 없음.
   - 인게임에서 뒤로가기로 재진입한 경우: max(소켓값 100%, 게임에서 봤던 값)에서 시작.
     sessionStorage 플래그로 감지.
   - NEXT_PUBLIC_RT가 꺼져있으면(로컬/오프라인) 가짜 소켓으로 대체.
   - CTA는 SPA 라우팅(router.push)으로 이동 — 같은 vid로 메인에서 바로 재연결. */

const SESSION_FROM_GAME_KEY = "mt_came_from_game";

// FOMO 배너 노출 임계값
const CREEP_DURATION_S = 60; // creep 속도 기준 시간(초)

export default function PayslipShare({
  data,
  siteUrlHref,
}: {
  data: ReceiptData;
  siteUrlHref: string;
}) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const nick = data.n || "익명의 볼일러"; // 보낸 사람 닉 — CTA 사회적 증거 문구에 사용

  // liveWon: 서버 실제값
  const [liveWon, setLiveWon] = useState(0);
  // displayWon: 화면에 보여주는 값 (monotonic — 절대 감소 없음, 목표치 도달 시 정지)
  const [displayWon, setDisplayWon] = useState(0);
  const countRef = useRef(count);
  countRef.current = count;
  const liveWonRef = useRef(liveWon);
  liveWonRef.current = liveWon;

  const [revealed, setRevealed] = useState(false);

  // creep 상태 — displayTicker가 읽어서 displayWon 계산. target 도달 시 정지.
  const creep = useRef({
    base: 0,
    rate: 0,
    target: 0,
    startedAt: Date.now(),
    synced: false,
  });

  useEffect(() => {
    const STEP_MS = 120;

    // ----- 라이브 배너 reveal 제어 -----
    // 접속자(presence)와 금액(global)을 '모두' 받은 순간에 단 한 번 등장시킨다.
    // 둘을 따로 반영하면 "0.5초 안에 텍스트가 두세 번 바뀌는" 노이즈가 생기므로 묶어서 처리.
    let didReveal = false;
    let gotGlobal = false;
    let gotPresence = false;
    function doReveal() {
      if (didReveal) return;
      didReveal = true;
      clearTimeout(revealFallback);
      // 등장 시점의 값으로 구조를 확정(freeze) — 이후엔 숫자만 제자리 갱신, 구조는 불변.
      setRevealed(true);
    }
    function maybeReveal() {
      if (gotGlobal && gotPresence) doReveal();
    }
    // 소켓이 끝내 조용해도(오프라인 등) 빈 박스가 남지 않도록 폴백 등장.
    const revealFallback = setTimeout(doReveal, 1200);

    // presence 수신 — 서버가 공유페이지 방문자를 presence에서 제외하므로 자기자신 차감 불필요.
    // 단조증가만 허용 — 접속자 감소는 화면에 표시하지 않음.
    function applyPresence(c: number) {
      const raw = Math.max(0, c);
      const next = Math.max(countRef.current, raw);
      countRef.current = next;
      setCount(next);
      gotPresence = true;
      maybeReveal();
    }

    // 서버 실제값 수신: liveWon 갱신 + creep 초기화/재보정
    // total >= 1000: 90%에서 시작해 60초에 걸쳐 실제값 도달 후 정지
    // total < 1000: 0원에서 시작해 60초에 걸쳐 1000원 향해 creep, 도달 시 정지
    function applyGlobal(total: number) {
      const c = creep.current;
      const elapsed = (Date.now() - c.startedAt) / 1000;
      const curDisplay = Math.min(c.base + c.rate * elapsed, c.target);

      liveWonRef.current = total;
      setLiveWon(total);
      gotGlobal = true;
      maybeReveal();

      if (!c.synced) {
        const base = total >= 1000 ? total * 0.9 : 0;
        const target = total >= 1000 ? total : 1000;
        creep.current = {
          base,
          rate: (target - base) / CREEP_DURATION_S,
          target,
          startedAt: Date.now(),
          synced: true,
        };
        if (base > 0) setDisplayWon(base);
      } else {
        // 새 값이 현재 target보다 높으면 target 갱신
        if (total > c.target) {
          const gap = total - curDisplay;
          creep.current = {
            base: curDisplay,
            rate: Math.max(c.rate, gap / CREEP_DURATION_S),
            target: total,
            startedAt: Date.now(),
            synced: true,
          };
        }
        // 서버 값이 낮아도 무시 — 절대 감소 없음
      }
    }

    // displayWon ticker — target 도달 시 정지, monotonic 보장
    const displayTicker = setInterval(() => {
      const c = creep.current;
      const elapsed = (Date.now() - c.startedAt) / 1000;
      const next = Math.min(c.base + c.rate * elapsed, c.target);
      setDisplayWon((prev) => Math.max(prev, next));
    }, STEP_MS);

    const useReal = process.env.NEXT_PUBLIC_RT === "1";

    if (useReal) {
      const url = socketUrl();
      if (!url)
        return () => {
          clearInterval(displayTicker);
          clearTimeout(revealFallback);
        };
      const sock = io(url, {
        transports: ["websocket", "polling"],
        reconnection: true,
      });
      let firstConnect = true;
      sock.on("connect", () => {
        const fresh = firstConnect;
        firstConnect = false;
        const vid = getVid();
        const nick = (() => {
          try {
            return localStorage.getItem(LS.nick) || "";
          } catch {
            return "";
          }
        })();
        sock.emit("hello", {
          vid,
          nick,
          fresh,
          isNew: fresh && wasVidCreated(),
          isShare: true,
        });
      });
      sock.on("presence", ({ count: c }: { count: number }) =>
        applyPresence(c),
      );
      sock.on("global", ({ total }: { total: number }) => applyGlobal(total));

      return () => {
        clearInterval(displayTicker);
        clearTimeout(revealFallback);
        try {
          sock.disconnect();
        } catch {}
      };
    }

    const socket = new FakeToiletSocket();
    socket.on("presence", ({ count: c }: { count: number }) =>
      applyPresence(c),
    );
    socket.on("global", ({ total }: { total: number }) => applyGlobal(total));
    socket.on("flush", (f: { total: number }) => {
      const c = creep.current;
      const elapsed = (Date.now() - c.startedAt) / 1000;
      const cur = c.base + c.rate * elapsed;
      if (f.total > cur) applyGlobal(f.total);
    });
    socket.connect();

    return () => {
      clearInterval(displayTicker);
      clearTimeout(revealFallback);
      try {
        socket.disconnect();
      } catch {}
    };
  }, []);

  function handleCtaClick() {
    try {
      // 게임 → 공유 페이지 재진입 감지용 플래그만 남김
      // (mt_handoff_global/stalls 제거 — 게임 페이지는 자체 소켓으로 로드, 깜빡임 원인이었음)
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

      {/* 실시간 라이브 배너 — 박스는 첫 페인트부터 항상 자리를 점유(레이아웃 시프트 0).
          접속자+금액을 모두 받은 순간 inner를 '한 번만' 페이드인하고, 이후엔 숫자만 제자리
          갱신한다. 구조(접속자줄·금액줄)는 등장 시점에 freeze되어 더 이상 바뀌지 않으므로
          진입 직후 텍스트가 연속으로 바뀌거나 '1명 접속' 시 내용이 또 바뀌는 노이즈가 사라진다. */}
      <div style={liveBox}>
        <div
          style={{
            ...liveInner,
            opacity: revealed ? 1 : 0,
            transform: revealed ? "none" : "translateY(3px)",
          }}
        >
          <div style={liveDot}>
            <span style={dot} />
            {count > 1
              ? `현재 접속자 ${count.toLocaleString("ko-KR")}명`
              : "실시간"}
          </div>
          <div style={liveAmt}>{fmtWon(displayWon)}</div>
          <div style={liveSub}>다같이 변기 위에서 쓸어담는 중 💰</div>
        </div>
      </div>

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
const liveBox: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  display: "flex",
  justifyContent: "center",
  padding: "10px 14px",
  borderRadius: 12,
  background: "rgba(16,24,18,0.7)",
  border: "1px solid rgba(125,255,176,0.28)",
};
// 등장 애니메이션 대상 — 박스는 항상 자리를 잡고, 이 안쪽만 한 번 페이드인한다.
const liveInner: React.CSSProperties = {
  width: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  transition: "opacity .55s ease, transform .55s ease",
  willChange: "opacity",
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
  background: "rgba(54, 224, 160, 0.5)",
  boxShadow: "0 0 6px rgba(54, 224, 160, 0.35)",
};
const liveAmt: React.CSSProperties = {
  color: "#ffd84d",
  fontSize: 30,
  fontWeight: 900,
  lineHeight: 1,
  fontVariantNumeric: "tabular-nums",
  textShadow: "0 0 16px rgba(255,216,77,0.35)",
};
// 금액 미달(콜드스타트) 시 금액줄 자리에 들어가는 대체 문구.
// liveAmt와 동일한 높이(30px)를 점유해 등장 전/후 박스 높이가 변하지 않게 한다.
const liveAmtIdle: React.CSSProperties = {
  height: 30,
  display: "flex",
  alignItems: "center",
  fontSize: 15,
  fontWeight: 800,
  color: "rgba(255,216,77,0.55)",
};
const liveSub: React.CSSProperties = {
  color: "#cfeee2",
  fontSize: 12.5,
  fontWeight: 600,
  textAlign: "center",
  lineHeight: 1.35,
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
