"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  encodeReceiptForShare,
  receiptDocNo,
  type ReceiptData,
} from "@/lib/receipt/receiptShare";
import { LS as STORAGE_KEY } from "@/lib/storageKeys";
import { APP_EVENTS } from "@/lib/appEvents";
import ReceiptCard from "@/components/ReceiptCard";
import { resolveShareOrigin } from "@/lib/siteUrl";
import { isPC } from "@/lib/engine/device";

const STAMP_CONFIRM_KEY = STORAGE_KEY.payslipConfirmed;

const FIRST_STAMP_TIMING = {
  click: 500,
  slam: 1200,
  actions: 350,
  hint: 400,
} as const;
// 슬램 애니메이션(receiptStampSlam)에서 도장이 종이에 "딱" 닿는 순간 = 10% 키프레임.
const STAMP_IMPACT_RATIO = 0.1;

// 도장 효과음(종이 착지 순간 1회). 모듈 싱글톤으로 재사용.
let stampAudio: HTMLAudioElement | null = null;
function playStampSound() {
  if (typeof window === "undefined") return;
  try {
    if (!stampAudio) {
      stampAudio = new Audio("/sound/moneytoilet-stamp-sound.mp3");
      stampAudio.preload = "auto";
    }
    stampAudio.currentTime = 0;
    const p = stampAudio.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {}
}

// ts·sl은 모달 열 때마다 바뀌므로 실제 게임 진행 상태만으로 fingerprint 생성
function stableFingerprint(d: ReceiptData): string {
  return `${d.n}|${d.t}|${d.f}|${d.h.join(",")}`;
}

// 세션 내 메모리 캐시 — fingerprint 동일하면 API 재호출 없이 기존 ID 재사용
const shareIdCache = new Map<string, string>(); // fingerprint → shareId

function toast(msg: string) {
  window.dispatchEvent(new CustomEvent(APP_EVENTS.toast, { detail: msg }));
}

function readConfirmedVersion(): string | null {
  try {
    const raw = localStorage.getItem(STAMP_CONFIRM_KEY);
    return raw === null || raw === "" ? null : raw;
  } catch {
    return null;
  }
}

// 물내림 1회 = 명세서 1버전 (회차 + 마지막 물내림 시각)
function receiptVersionKey(d: ReceiptData): string {
  return `${d.f}|${d.ts ?? 0}`;
}

function isStampConfirmedFor(d: ReceiptData): boolean {
  return readConfirmedVersion() === receiptVersionKey(d);
}

function saveConfirmedVersion(d: ReceiptData) {
  try {
    localStorage.setItem(STAMP_CONFIRM_KEY, receiptVersionKey(d));
  } catch {}
}

function hasEverStamped() {
  try {
    return localStorage.getItem(STORAGE_KEY.payslipStampEver) === "1";
  } catch {
    return false;
  }
}

function markEverStamped() {
  try {
    localStorage.setItem(STORAGE_KEY.payslipStampEver, "1");
  } catch {}
}

/* 게임 미리보기 팝업 — 공유 페이지와 동일한 ReceiptCard 를 렌더한다. */
export default function PayslipModal() {
  const [data, setData] = useState<ReceiptData | null>(null);
  // idle(확인 버튼) → waiting(클릭 후 도장 내려오기 전 대기) → stamping(도장 애니메이션)
  // → revealed(저장/자랑하기 등장) → done(안내문구까지 등장)
  const [stage, setStage] = useState<
    "idle" | "waiting" | "stamping" | "revealed" | "done"
  >("idle");
  const [animateReveal, setAnimateReveal] = useState(false); // 최초 확인 버튼 플로우에서만 하단 등장 애니
  const [shakeBrag, setShakeBrag] = useState(false); // 재열람 시 자랑하기 버튼 흔들림
  const hintDelayRef = useRef<number>(FIRST_STAMP_TIMING.hint);
  const stampTimersRef = useRef<number[]>([]);
  const stampFromConfirmRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const exportCardRef = useRef<HTMLDivElement>(null);
  const siteUrlHref =
    typeof window !== "undefined" ? resolveShareOrigin() : undefined;

  const clearStampTimers = useCallback(() => {
    stampTimersRef.current.forEach((id) => window.clearTimeout(id));
    stampTimersRef.current = [];
  }, []);

  const close = useCallback(() => {
    clearStampTimers();
    stampFromConfirmRef.current = false;
    setData(null);
    setStage("idle");
    setAnimateReveal(false);
    setShakeBrag(false);
  }, [clearStampTimers]);

  const startFirstStampSequence = useCallback(
    (receipt: ReceiptData) => {
      clearStampTimers();
      hintDelayRef.current = FIRST_STAMP_TIMING.hint;
      setAnimateReveal(true);
      setStage("waiting");
      const pushTimer = (fn: () => void, ms: number) => {
        stampTimersRef.current.push(window.setTimeout(fn, ms));
      };
      pushTimer(() => {
        setStage("stamping");
        saveConfirmedVersion(receipt);
        markEverStamped();
        try {
          window.dispatchEvent(new CustomEvent(APP_EVENTS.payslipStamped));
        } catch {}
        // 도장이 종이에 닿는 순간(슬램 10%)에 효과음
        pushTimer(playStampSound, FIRST_STAMP_TIMING.slam * STAMP_IMPACT_RATIO);
        pushTimer(() => {
          pushTimer(() => setStage("revealed"), FIRST_STAMP_TIMING.actions);
        }, FIRST_STAMP_TIMING.slam);
      }, FIRST_STAMP_TIMING.click);
    },
    [clearStampTimers],
  );

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<ReceiptData>).detail;
      clearStampTimers();
      stampFromConfirmRef.current = false;
      setData(detail);
      setAnimateReveal(false);
      setShakeBrag(false);

      if (isStampConfirmedFor(detail)) {
        // 같은 회차 명세서 재열람
        setStage("done");
        // 3·8·13·18회차 물내림 시에만 조용하게 한 번 흔들기
        if (detail.f % 5 === 3)
          stampTimersRef.current.push(window.setTimeout(() => setShakeBrag(true), 400));
        return;
      }
      if (hasEverStamped()) {
        // 2회차 이상 물내림 — 도장 애니 없이 즉시 done
        saveConfirmedVersion(detail);
        markEverStamped();
        try {
          window.dispatchEvent(new CustomEvent(APP_EVENTS.payslipStamped));
        } catch {}
        setStage("done");
        if (detail.f % 5 === 3)
          stampTimersRef.current.push(window.setTimeout(() => setShakeBrag(true), 400));
        return;
      }
      // 첫 영수증: '위 내용이 사실임을 확인합니다 👉'를 직접 눌러야만 도장이 찍힌다.
      setStage("idle");
    };
    window.addEventListener(APP_EVENTS.payslipOpen, onOpen);
    return () => window.removeEventListener(APP_EVENTS.payslipOpen, onOpen);
  }, [clearStampTimers, startFirstStampSequence]);

  // 도장 착지 → 버튼 등장 → 안내문구 등장 순으로 한 단계씩 늦게 보여준다
  useEffect(() => {
    if (!animateReveal || stage !== "revealed") return;
    const t = window.setTimeout(() => setStage("done"), hintDelayRef.current);
    return () => window.clearTimeout(t);
  }, [stage, animateReveal]);


  function confirmStamp() {
    if (stage !== "idle" || !data) return;
    stampFromConfirmRef.current = true;
    startFirstStampSequence(data);
  }

  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, close]);

  useEffect(() => () => clearStampTimers(), [clearStampTimers]);

  // 공유 URL 생성 — 짧은 공유 ID(/api/receipt)를 우선 시도, 실패 시 인코딩 원문(긴 URL) 폴백
  async function share() {
    if (!data) return;
    const encoded = encodeReceiptForShare(data);
    const fp = stableFingerprint(data);

    // 집계 신호는 '클릭 즉시'(모든 await 이전) 발사 — 공유 시트/네트워크 도중 이탈해도 유실되지 않는다.
    try {
      window.dispatchEvent(new CustomEvent(APP_EVENTS.brag));
    } catch {}

    let shareId = shareIdCache.get(fp) ?? encoded;
    if (!shareIdCache.has(fp)) {
      try {
        const res = await fetch("/api/receipt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ d: encoded }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.id) {
            shareId = json.id;
            shareIdCache.set(fp, json.id);
          }
        }
      } catch {
        // 네트워크 오류 등 → 긴 URL 폴백
      }
    }

    const url = `${resolveShareOrigin()}/r/${shareId}`;
    const text = url;
    if (!isPC() && navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("공유 링크를 복사했어요! SNS에 붙여넣기 🔗");
      return;
    } catch {}
    window.open(url, "_blank");
  }

  async function save() {
    if (!exportCardRef.current || !data) return;
    try {
      const dataUrl = await toPng(exportCardRef.current, {
        pixelRatio: Math.max(2, window.devicePixelRatio || 1),
        cacheBust: true,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `돈버는화장실-${receiptDocNo(data)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast("급여명세서를 저장했어요 🧾");
    } catch {
      toast("이미지 저장에 실패했어요 🥲");
    }
  }

  if (!data) return null;

  const showConfirmButton =
    stage === "idle" ||
    ((stage === "waiting" || stage === "stamping") &&
      stampFromConfirmRef.current);

  const showActionButtons = stage === "revealed" || stage === "done";
  const showHint = stage === "done";

  return (
    <div className="receipt-modal" role="presentation">
      <div className="receipt-modal__backdrop" onClick={close} aria-hidden />
      <div className="receipt-modal__frame">
        <button
          className="receipt-modal__close"
          type="button"
          aria-label="닫기"
          onClick={close}
        >
          ✕
        </button>
        <div
          className="receipt-modal__sheet"
          role="dialog"
          aria-label="급여명세서"
        >
          <div className="receipt-modal__preview" ref={cardRef}>
            <ReceiptCard
              d={data}
              siteUrlHref={siteUrlHref}
              footerMode="interactive"
              maxHeight="calc(var(--app-h, 100dvh) - 176px)"
              stampVisible={stage !== "idle" && stage !== "waiting"}
              stampAnimate={stage === "stamping"}
              stampSlamMs={FIRST_STAMP_TIMING.slam}
            />
          </div>
          <div className="receipt-modal__export" aria-hidden>
            <div ref={exportCardRef} className="receipt-export-frame">
              <div className="receipt-export-frame__card">
                <ReceiptCard
                  d={data}
                  siteUrlHref={siteUrlHref}
                  footerMode="snapshot"
                />
              </div>
            </div>
          </div>
          <div className="receipt-modal__actions">
            {showActionButtons ? (
              <div
                className={
                  "receipt-modal__actions-row" +
                  (animateReveal ? " receipt-modal__actions-row--in" : "")
                }
              >
                <button
                  className="receipt-btn receipt-btn--save"
                  type="button"
                  onClick={save}
                >
                  📷 저장
                </button>
                <button
                  className={
                    "receipt-btn receipt-btn--share btn-yellow" +
                    (shakeBrag ? " receipt-btn--shake" : "")
                  }
                  type="button"
                  onClick={share}
                >
                  🔗 자랑하기
                </button>
              </div>
            ) : showConfirmButton ? (
              <button
                className={
                  "receipt-btn receipt-btn--confirm" +
                  (stage === "waiting" || stage === "stamping"
                    ? " receipt-btn--fading"
                    : "")
                }
                type="button"
                onClick={confirmStamp}
                disabled={stage === "waiting" || stage === "stamping"}
              >
                👉 위 내용이 사실임을 확인합니다
              </button>
            ) : null}
          </div>
          <p
            className={
              "receipt-modal__hint" +
              (stage === "done" && animateReveal
                ? " receipt-modal__hint--in"
                : "")
            }
            style={showHint ? undefined : { visibility: "hidden" }}
          >
            내 월급은 공개되지 않습니다
          </p>
        </div>
      </div>
    </div>
  );
}
