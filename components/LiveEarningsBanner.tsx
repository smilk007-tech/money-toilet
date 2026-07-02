"use client";

import { useEffect, useRef, useState } from "react";
import { FakeToiletSocket } from "@/lib/engine/fakeSocket";
import { io } from "socket.io-client";
import { socketUrl } from "@/lib/engine/realSocket";
import { getVid, wasVidCreated } from "@/lib/engine/identity";
import { LS } from "@/lib/storageKeys";
import { fmtWon } from "@/lib/receipt/receiptShare";

/* 공유/에러 페이지 공용 실시간 라이브 배너 — [현재 접속자 · 다같이 번 돈 N원 · 다같이 변기에서].
   - isShare:true 로 hello → 서버 presence 제외(방문 집계는 정상). 접속자수는 서버값 그대로.
   - 금액: 실제 누적을 상한으로 슬롯머신처럼 랜덤 중간목표에 촤르르륵 올랐다 잠깐 멈추길 반복하며 도달 후 정지.
   - 접속자+금액을 모두 받은 순간 한 번만 페이드인, 이후엔 숫자만 제자리 갱신(레이아웃 시프트 0).
   - NEXT_PUBLIC_RT 미설정 시 가짜 소켓으로 대체(로컬/오프라인). */

export default function LiveEarningsBanner() {
  const [count, setCount] = useState(0);
  const [displayWon, setDisplayWon] = useState(0); // 화면 표시값(슬롯머신 롤업)
  const [revealed, setRevealed] = useState(false);

  const countRef = useRef(0);
  const realRef = useRef(0); // 서버 실제 누적 = 표시 상한
  const dispRef = useRef(0); // 현재 표시값
  const seededRef = useRef(false);
  // 슬롯머신 롤업 상태 — rolling(굴러가는 중) / idle(다음 목표 전 잠깐 멈춤)
  const anim = useRef<{ mode: "idle" | "rolling"; from: number; to: number; start: number; dur: number; pauseUntil: number }>({
    mode: "idle", from: 0, to: 0, start: 0, dur: 0, pauseUntil: 0,
  });

  useEffect(() => {
    let raf = 0;
    let didReveal = false, gotGlobal = false, gotPresence = false;
    const doReveal = () => { if (didReveal) return; didReveal = true; clearTimeout(revealFallback); setRevealed(true); };
    const maybeReveal = () => { if (gotGlobal && gotPresence) doReveal(); };
    const revealFallback = setTimeout(doReveal, 1200);

    function applyPresence(c: number) {
      const next = Math.max(countRef.current, Math.max(0, c));
      countRef.current = next;
      setCount(next);
      gotPresence = true;
      maybeReveal();
    }
    // 서버 실제 누적만 상한(realRef)으로 반영. 최초 1회 표시값을 상한보다 낮게 심어 등반 여지를 만든다.
    function applyGlobal(total: number) {
      gotGlobal = true;
      maybeReveal();
      if (total > realRef.current) realRef.current = total;
      if (!seededRef.current) {
        seededRef.current = true;
        const base = total > 0 ? Math.floor(total * 0.65) : 0; // 65%에서 시작 — 여유 갭 확보
        dispRef.current = base;
        setDisplayWon(base);
        anim.current.pauseUntil = performance.now() + 1200; // 영수증 읽을 여유 후 등반 시작
      }
    }

    // 남은 갭의 30~55%씩 기하급수적으로 접근 — 10초 안에 목표치 96% 근접, 20초면 잔여 갭 극소화.
    // 절대 단위가 아닌 갭 비율이므로 틱이 거듭될수록 스텝이 작아지며 자연스럽게 수렴.
    const EASE = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = () => {
      const now = performance.now();
      const a = anim.current;
      const real = realRef.current;
      if (a.mode === "rolling") {
        const t = a.dur > 0 ? Math.min(1, (now - a.start) / a.dur) : 1;
        const v = a.from + (a.to - a.from) * EASE(t);
        dispRef.current = v;
        setDisplayWon(v);
        if (t >= 1) {
          dispRef.current = a.to;
          setDisplayWon(a.to);
          a.mode = "idle";
          // 쿨타임: 짧게 0.2s ~ 길게 1.4s — 초반엔 빠르게 여러 번, 후반엔 갭이 작아 느려도 무방
          const r = Math.random();
          const pause = r < 0.4
            ? 200  + Math.random() * 300   // 40%: 0.2~0.5s (빠른 연타)
            : r < 0.8
            ? 400  + Math.random() * 500   // 40%: 0.4~0.9s (보통)
            : 700  + Math.random() * 700;  // 20%: 0.7~1.4s (숨 고르기)
          a.pauseUntil = now + pause;
        }
      } else if (dispRef.current < real - 0.5 && now >= a.pauseUntil) {
        // 남은 갭의 30~55% — 초반엔 큰 덩어리, 갈수록 잔여분이 줄어 자연스럽게 수렴
        const gap = real - dispRef.current;
        const pct = 0.30 + Math.random() * 0.25;
        const step = Math.max(1, Math.floor(gap * pct));
        a.mode = "rolling";
        a.from = dispRef.current;
        a.to = dispRef.current + step;
        a.start = now;
        a.dur = 1000 + Math.random() * 1000; // 1.0~2.0s (전보다 약간 느리게)
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const useReal = process.env.NEXT_PUBLIC_RT === "1";
    if (useReal) {
      const url = socketUrl();
      if (!url) return () => { cancelAnimationFrame(raf); clearTimeout(revealFallback); };
      const sock = io(url, { transports: ["websocket", "polling"], reconnection: true });
      let firstConnect = true;
      sock.on("connect", () => {
        const fresh = firstConnect;
        firstConnect = false;
        const nick = (() => { try { return localStorage.getItem(LS.nick) || ""; } catch { return ""; } })();
        sock.emit("hello", { vid: getVid(), nick, fresh, isNew: fresh && wasVidCreated(), isShare: true });
      });
      sock.on("presence", ({ count: c }: { count: number }) => applyPresence(c));
      sock.on("global", ({ total }: { total: number }) => applyGlobal(total));
      return () => { cancelAnimationFrame(raf); clearTimeout(revealFallback); try { sock.disconnect(); } catch {} };
    }

    const socket = new FakeToiletSocket();
    socket.on("presence", ({ count: c }: { count: number }) => applyPresence(c));
    socket.on("global", ({ total }: { total: number }) => applyGlobal(total));
    socket.on("flush", (f: { total: number }) => applyGlobal(f.total));
    socket.connect();
    return () => { cancelAnimationFrame(raf); clearTimeout(revealFallback); try { socket.disconnect(); } catch {} };
  }, []);

  return (
    <div style={liveBox}>
      <div style={{ ...liveInner, opacity: revealed ? 1 : 0, transform: revealed ? "none" : "translateY(3px)" }}>
        <div style={liveDot}>
          <span style={dot} />
          {count > 1 ? `현재 접속자 ${count.toLocaleString("ko-KR")}명` : "현재 실시간 누적"}
        </div>
        <div style={liveAmt}>{fmtWon(Math.round(displayWon))}</div>
        <div style={liveSub}>다같이 변기 위에서 쓸어담는 중 💰</div>
      </div>
    </div>
  );
}

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
const liveSub: React.CSSProperties = {
  color: "#cfeee2",
  fontSize: 12.5,
  fontWeight: 600,
  textAlign: "center",
  lineHeight: 1.35,
};
