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

  // 라이브 배너 등장 제어 — 첫 스냅샷(접속자 + 금액)을 모두 받은 뒤 '한 번만' 페이드인한다.
  // 등장 시점에 구조(접속자줄·금액줄 노출 여부)를 freeze해 이후엔 숫자만 제자리 갱신 →
  // 진입 0.5초 내 텍스트가 막 바뀌거나 '1명 접속' 시 내용이 또 바뀌는 시각 노이즈를 없앤다.
  const [revealed, setRevealed] = useState(false);
  const [frozen, setFrozen] = useState<{
    hasPresence: boolean;
    hasAmount: boolean;
  } | null>(null);

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
      setFrozen({
        hasPresence: countRef.current >= FOMO_MIN_PRESENCE,
        hasAmount: liveWonRef.current >= FOMO_MIN_TOTAL,
      });
      setRevealed(true);
    }
    function maybeReveal() {
      if (gotGlobal && gotPresence) doReveal();
    }
    // 소켓이 끝내 조용해도(오프라인 등) 빈 박스가 남지 않도록 폴백 등장.
    const revealFallback = setTimeout(doReveal, 1200);

    // presence 수신 — 표시값은 (서버 count - 1). ref를 동기 갱신해 reveal 판정이 최신값을 보게 함.
    function applyPresence(c: number) {
      const next = Math.max(0, c - 1);
      countRef.current = next;
      setCount(next);
      gotPresence = true;
      maybeReveal();
    }

    // 서버 실제값 수신 시: liveWon 갱신 + creep 재보정
    // 최초 1회: total의 90%서 시작, 10% 갭을 60초에 걸쳐 채움
    // 이후: 현재 표시값 기준으로 새 실제값을 향해 재보정(화면 점프 없이 자연스럽게)
    function applyGlobal(total: number) {
      const c = creep.current;
      const elapsed = (Date.now() - c.startedAt) / 1000;
      const curDisplay = c.base + c.rate * elapsed;

      liveWonRef.current = total; // reveal 판정용 동기 갱신
      setLiveWon(total);
      gotGlobal = true;
      maybeReveal();

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
          {frozen?.hasPresence ? (
            <div style={liveDot}>
              <span style={dot} />
              현재 접속자 {count.toLocaleString("ko-KR")}명
            </div>
          ) : (
            <div style={liveDot}>지금도 다 같이 버는 중</div>
          )}
          {frozen?.hasAmount ? (
            <div style={liveAmt}>{fmtWon(displayWon)}</div>
          ) : (
            <div style={liveAmtIdle}>오늘도 차곡차곡 💰</div>
          )}
          <div style={liveSub}>
            다 같이 변기 위에서 실시간으로 쓸어담는 중 💰
          </div>
        </div>
      </div>

      <div style={cta}>
        <img
          src="/brand-icon.png"
          alt=""
          width={26}
          height={26}
          style={{ display: "block" }}
        />
        돈버는 화장실 입장
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
