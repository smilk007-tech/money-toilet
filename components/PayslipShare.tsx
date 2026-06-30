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
   - 완전한 인게임 유저로 취급: "hello"를 보내 실제 presence/visits에 정상 집계된다.
     단, 화면에 보여줄 접속자수는 (서버 count - 1) — 나 자신을 빼고 "제3자가 보기엔
     사람이 더 있어 보이게" 하기 위함. 음수면 0으로 표기.
   - 오늘 누적금액: 소켓 첫 수신값의 90%부터 시작해 60초 동안 100%까지 creep 애니메이션.
     그 이후에도 같은 속도로 계속 올라감(접속 유도용이라 초과해도 무방).
     서버 재수신 시에는 현재 표시값 기준으로 속도만 재보정 — 절대 100%로 점프하지 않음.
   - 인게임에서 뒤로가기로 재진입한 경우: max(소켓값 100%, 게임에서 봤던 값)에서 시작해
     10%를 60초에 걸쳐 올림 (일관된 게임 사용성). sessionStorage 플래그로 감지.
   - NEXT_PUBLIC_RT가 꺼져있으면(로컬/오프라인) 가짜 소켓으로 대체.
   - CTA는 새 탭이 아니라 SPA 라우팅(router.push)으로 이동 — 같은 vid로 메인에서
     바로 재연결되어 깔끔하게 이어지는 느낌을 준다. */

const SESSION_FROM_GAME_KEY = "mt_came_from_game";

// FOMO 배너 노출 임계값 — 접속자/금액이 너무 적으면 오히려 "썰렁해 보여서" 역효과.
// 둘 중 하나라도 넘으면 노출. 오픈 초반엔 트래픽이 적으니 낮게 잡아두고, 트래픽 늘면 올릴 것.
const FOMO_MIN_PRESENCE = 1; // 나 말고 1명 이상 있으면 노출
const FOMO_MIN_TOTAL = 10_000; // 오늘 누적 1만원 이상이면 노출
const CREEP_DURATION_S = 60; // 90% → 100% 채우는 시간(초). 이후에도 같은 속도로 계속 올라감.

export default function PayslipShare({
  data,
  siteUrlHref,
}: {
  data: ReceiptData;
  siteUrlHref: string;
}) {
  const router = useRouter();
  const [count, setCount] = useState(0);

  // 인게임에서 뒤로가기로 재진입한 경우 감지 — sessionStorage 플래그 확인 후 즉시 소비
  const [cameFromGame] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const v = sessionStorage.getItem(SESSION_FROM_GAME_KEY);
      if (v === "1") {
        sessionStorage.removeItem(SESSION_FROM_GAME_KEY);
        return true;
      }
    } catch {}
    return false;
  });
  const cameFromGameRef = useRef(cameFromGame);

  // 인게임에서 마지막으로 보였던 global 값 — 공유 페이지 표시값의 하한선으로 사용
  // (sessionStorage에 게임이 이탈할 때 저장; cameFromGame 여부와 무관하게 읽음)
  const [gameGlobal] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    try {
      const v = sessionStorage.getItem("mt_game_global");
      return v !== null ? parseFloat(v) || 0 : 0;
    } catch {
      return 0;
    }
  });
  const gameGlobalRef = useRef(gameGlobal);

  // liveWon: 서버 실제값 — FOMO 임계 판단용 (소켓 수신 전까지 0)
  const [liveWon, setLiveWon] = useState(0);
  // displayWon: 화면에 보여주는 값 (절대 감소 없음 — monotonic 보장)
  // 일반 진입: 소켓 첫 수신값의 90%서 시작, 이후 소켓 값으로 속도만 재보정
  // 인게임 재진입: max(소켓 첫 수신값 100%, gameGlobal)에서 시작
  // data.g는 더 이상 사용하지 않음 — 소켓 실시간 값만 사용
  const initBase = cameFromGame ? gameGlobal : 0; // 소켓 수신 전 임시 시작값
  const [displayWon, setDisplayWon] = useState(initBase);
  const countRef = useRef(count);
  countRef.current = count;
  const liveWonRef = useRef(liveWon);
  liveWonRef.current = liveWon;

  // creep 상태 — displayTicker가 이걸 읽어서 displayWon을 계산
  // synced=false: 아직 소켓 첫 응답 대기 중
  const creep = useRef({
    base: initBase,
    rate: 1, // 소켓 수신 전 더미값(applyGlobal !synced 분기에서 즉시 교체됨)
    startedAt: Date.now(),
    synced: false,
  });

  useEffect(() => {
    const STEP_MS = 120;

    // 서버 실제값 수신 시: liveWon 갱신 + creep 재보정
    // 최초 1회: total의 90%서 시작, 10% 갭을 60초에 걸쳐 채움
    // 이후: 현재 표시값 기준으로 새 실제값을 향해 재보정(화면 점프 없이 자연스럽게)
    function applyGlobal(total: number) {
      const c = creep.current;
      const elapsed = (Date.now() - c.startedAt) / 1000;
      const curDisplay = c.base + c.rate * elapsed;

      setLiveWon(total);

      if (!c.synced) {
        // 소켓 첫 수신값으로 creep 초기화
        // 일반 진입: total * 90% 에서 시작 — 이후 소켓 재수신 시 속도만 재보정하며 절대 100%로 점프하지 않음
        // 인게임 재진입: max(total, gameGlobal) 에서 시작 (게임에서 봤던 값보다 낮아지지 않음)
        const rawBase = cameFromGameRef.current ? total : total * 0.9;
        const base = cameFromGameRef.current
          ? Math.max(rawBase, gameGlobalRef.current)
          : rawBase; // 일반 진입은 gameGlobal 무시 — 항상 소켓값 90%
        const gap = Math.max(total * 0.1, total - base, 1);
        creep.current = {
          base,
          rate: gap / CREEP_DURATION_S,
          startedAt: Date.now(),
          synced: true,
        };
        if (base > curDisplay) setDisplayWon(base);
      } else {
        const gap = total - curDisplay;
        if (gap > 0) {
          // 현재 표시값에서 다시 올라가는 것처럼 — 최소 기존 속도는 유지
          creep.current = {
            base: curDisplay,
            rate: Math.max(c.rate, gap / CREEP_DURATION_S),
            startedAt: Date.now(),
            synced: true,
          };
        }
        // gap <= 0: 서버 값이 현재 표시보다 낮아도 무시 — 절대 감소 없음
      }
    }

    // displayWon 애니메이션 ticker — creep 상태 기반으로 120ms마다 갱신.
    // prev와 비교해 항상 max 값을 사용 → 어떤 상황에서도 화면값이 감소하지 않음(monotonic).
    const displayTicker = setInterval(() => {
      const c = creep.current;
      const elapsed = (Date.now() - c.startedAt) / 1000;
      const next = c.base + c.rate * elapsed;
      setDisplayWon((prev) => Math.max(prev, next));
    }, STEP_MS);

    const useReal = process.env.NEXT_PUBLIC_RT === "1";

    if (useReal) {
      const url = socketUrl();
      if (!url) return () => clearInterval(displayTicker);
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
        });
      });
      sock.on("presence", ({ count: c }: { count: number }) =>
        setCount(Math.max(0, c - 1)),
      );
      sock.on("global", ({ total }: { total: number }) => applyGlobal(total));

      return () => {
        clearInterval(displayTicker);
        try {
          sock.disconnect();
        } catch {}
      };
    }

    const socket = new FakeToiletSocket();
    socket.on("presence", ({ count: c }: { count: number }) =>
      setCount(Math.max(0, c - 1)),
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
      try {
        socket.disconnect();
      } catch {}
    };
  }, []);

  function handleCtaClick() {
    try {
      sessionStorage.setItem(SESSION_FROM_GAME_KEY, "1");
      // 공유 페이지의 마지막 실시간 값을 게임 페이지로 전달 — 소켓 재연결 전 0 깜빡임 방지
      // stalls: 공유 페이지는 자신을 제외한 값(count - 1)을 표시하므로, +1해서 게임 기준으로 복원
      sessionStorage.setItem(
        "mt_handoff_global",
        String(Math.round(liveWonRef.current)),
      );
      sessionStorage.setItem("mt_handoff_stalls", String(countRef.current + 1));
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

      {/* 실시간 라이브 배너 — 접속자/금액 둘 다 낮으면 역효과라 숨김.
          둘 중 하나만 기준 미달이면 그 줄만 숨기고 다른 한쪽으로 FOMO를 준다. */}
      {(() => {
        const showCount = count >= FOMO_MIN_PRESENCE;
        const showAmt = liveWon >= FOMO_MIN_TOTAL;
        if (!showCount && !showAmt) return null;
        return (
          <div style={liveBox}>
            {showCount ? (
              <div style={liveDot}>
                <span style={dot} />
                현재 접속자 {count.toLocaleString("ko-KR")}명
              </div>
            ) : (
              <div style={liveDot}>오늘 다 같이</div>
            )}
            {showAmt && <div style={liveAmt}>{fmtWon(displayWon)}</div>}
            <div style={liveSub}>
              {showCount && showAmt
                ? "다 같이 변기 위에서 실시간으로 쓸어담는 중 💰"
                : showAmt
                  ? "변기 위에서 실시간으로 쓸어담는 중 💰"
                  : "변기 위에서 대기 중 🚽"}
            </div>
          </div>
        );
      })()}

      <div style={cta}>🚽 돈버는 화장실 입장</div>
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
