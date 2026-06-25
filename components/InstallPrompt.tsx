"use client";

import { useEffect, useRef, useState } from "react";

// 홈 화면 추가 유도 — 진입하자마자 띄우지 않는다.
// 명세서를 "저장/공유"한 만족 정점(ddong:payslip-shared)에서만 띄워서,
// 이미 이 게임을 좋아하는 사람한테만 "다음에도 화장실에서 켜자"를 권한다.
const DISMISS_KEY = "ddong_install_dismissed";
const SHARED_EVENT = "ddong:payslip-shared";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallPrompt() {
  const [mode, setMode] = useState<"android" | "ios" | null>(null);
  // 안드로이드 설치 프롬프트는 미리 잡아두고(화면엔 안 띄움), 공유 시점에 꺼내 쓴다.
  const deferredRef = useRef<BIPEvent | null>(null);
  const iosEligibleRef = useRef(false);

  useEffect(() => {
    // 서비스 워커 등록 (PWA 설치 요건) — 표시 여부와 무관하게 항상.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // 이미 설치(standalone)로 켰거나 직전에 닫았으면 아예 비활성.
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {}
    const disabled = standalone || dismissed;

    // 안드로이드(크롬 계열): 네이티브 설치 프롬프트를 미리 잡아만 둔다.
    const onBIP = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BIPEvent;
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    // iOS 사파리: beforeinstallprompt 없음 → 안내 대상인지 미리 판별만 해둔다.
    const ua = window.navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    iosEligibleRef.current = isIOS && isSafari;

    // 명세서 저장/공유 성공 순간에만 배너 등장.
    const onShared = () => {
      if (disabled || mode) return;
      if (deferredRef.current) setMode("android");
      else if (iosEligibleRef.current) setMode("ios");
      // 데스크탑/미지원 환경이면 아무것도 안 띄움(정상)
    };
    window.addEventListener(SHARED_EVENT, onShared);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener(SHARED_EVENT, onShared);
    };
  }, [mode]);

  if (!mode) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setMode(null);
  };

  const install = async () => {
    const deferred = deferredRef.current;
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    dismiss();
  };

  return (
    <div className="install-prompt" role="dialog" aria-label="홈 화면에 추가">
      <span className="install-prompt__ico" aria-hidden>
        🚽
      </span>
      {mode === "android" ? (
        <>
          <span className="install-prompt__text">
            홈 화면에 추가하고 다음에도 화장실에서 벌러 오기
          </span>
          <button
            type="button"
            className="install-prompt__cta"
            onClick={install}
          >
            추가
          </button>
        </>
      ) : (
        <span className="install-prompt__text">
          공유 <b>⎙</b> → <b>홈 화면에 추가</b> 하면 다음에도 바로 켜져요
        </span>
      )}
      <button
        type="button"
        className="install-prompt__close"
        onClick={dismiss}
        aria-label="닫기"
      >
        ✕
      </button>
    </div>
  );
}
