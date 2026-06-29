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
   - 오늘 누적금액(liveWon)은 실제 소켓 total을 기준으로 하되, 가입유도 화면 특성상
     채팅서버 값이 멈춰있어도 계속 슬금슬금 올라가는 것처럼 보이게 하고, 서버에서
     진짜 값이 갱신되면 그 값으로 스냅 후 다시 올라가는 척을 반복한다.
   - NEXT_PUBLIC_RT가 꺼져있으면(로컬/오프라인) 가짜 소켓으로 대체.
   - CTA는 새 탭이 아니라 SPA 라우팅(router.push)으로 이동 — 같은 vid로 메인에서
     바로 재연결되어 깔끔하게 이어지는 느낌을 준다. */

const AVG_RATE_PER_PERSON = 3_000_000 / (22 * 8 * 3600); // ≈ 4.73원/초/인 (가입유도용 가짜 상승분)

// FOMO 배너 노출 임계값 — 접속자/금액이 너무 적으면 오히려 "썰렁해 보여서" 역효과.
// 둘 중 하나라도 넘으면 노출. 오픈 초반엔 트래픽이 적으니 낮게 잡아두고, 트래픽 늘면 올릴 것.
const FOMO_MIN_PRESENCE = 1; // 나 말고 1명 이상 있으면 노출
const FOMO_MIN_TOTAL = 10_000; // 오늘 누적 1만원 이상이면 노출

export default function PayslipShare({
  data,
  siteUrlHref,
}: {
  data: ReceiptData;
  siteUrlHref: string;
}) {
  const router = useRouter();
  const [count, setCount] = useState(Math.max(0, (data.p || 0) - 1));
  const [liveWon, setLiveWon] = useState(data.g || 0);
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    const useReal = process.env.NEXT_PUBLIC_RT === "1";

    if (useReal) {
      const url = socketUrl();
      if (!url) return; // 소켓 서버 미설정 — 명세서 정적 수치 그대로 둠
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
      // 영수증 스냅샷(data.g)은 발급 시점 값이라 지금 실제값과 전혀 다를 수 있음(다른 날짜/구버전 등).
      // 최초 1회는 무조건 실제값으로 강제 동기화하고, 그 이후부터만 max로 비교해
      // 가짜 증가분이 실제값을 일시적으로 앞서가도 화면이 줄어드는 것처럼 보이지 않게 함.
      // synced=true는 updater 안에서 세팅해야 함 — React가 updater를 비동기로 실행하므로
      // setLiveWon() 호출 직후 바로 synced=true를 하면 updater가 실제로 실행되는 시점엔
      // 이미 true가 돼있어서 "최초 1회 강제 동기화"가 절대 발생하지 않는 버그가 생긴다.
      let synced = false;
      sock.on("global", ({ total }: { total: number }) => {
        setLiveWon((prev) => {
          const next = synced ? Math.max(prev, total) : total;
          synced = true;
          return next;
        });
      });

      // 채팅서버 값이 멈춰있어도 계속 올라가는 것처럼
      const STEP_MS = 120;
      const ticker = setInterval(() => {
        setLiveWon(
          (prev) =>
            prev +
            (countRef.current + 1) * AVG_RATE_PER_PERSON * (STEP_MS / 1000),
        );
      }, STEP_MS);

      return () => {
        clearInterval(ticker);
        try {
          sock.disconnect();
        } catch {}
      };
    }

    const socket = new FakeToiletSocket();
    socket.on("presence", ({ count: c }: { count: number }) =>
      setCount(Math.max(0, c - 1)),
    );
    socket.on("global", ({ total }: { total: number }) =>
      setLiveWon((prev) => Math.max(prev, total)),
    );
    socket.on("flush", (f: { total: number }) =>
      setLiveWon((prev) => Math.max(prev, f.total)),
    );
    socket.connect();

    const STEP_MS = 120;
    const ticker = setInterval(() => {
      setLiveWon(
        (prev) =>
          prev +
          (countRef.current + 1) * AVG_RATE_PER_PERSON * (STEP_MS / 1000),
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
            {showAmt && <div style={liveAmt}>{fmtWon(liveWon)}</div>}
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
