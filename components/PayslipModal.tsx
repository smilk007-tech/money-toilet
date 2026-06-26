"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { encodeReceiptForShare, type ReceiptData } from "@/lib/receiptShare";
import { LS as STORAGE_KEY } from "@/lib/storageKeys";
import { APP_EVENTS } from "@/lib/appEvents";
import ReceiptCard from "@/components/ReceiptCard";
import { resolveShareOrigin } from "@/lib/siteUrl";

const STAMP_CONFIRM_KEY = STORAGE_KEY.payslipConfirmed;

const FIRST_STAMP_TIMING = {
  click: 500,
  slam: 1200,
  actions: 250,
  hint: 300,
} as const;
const REPEAT_STAMP_DELAY_MS = 500;
const REPEAT_STAMP_SLAM_MS = 1200;

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
  const [stampSlamMs, setStampSlamMs] = useState<number>(
    FIRST_STAMP_TIMING.slam,
  );
  const hintDelayRef = useRef<number>(FIRST_STAMP_TIMING.hint);
  const stampTimersRef = useRef<number[]>([]);
  const stampFromConfirmRef = useRef(false);
  const repeatStampRef = useRef(false);
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
    repeatStampRef.current = false;
    setData(null);
    setStage("idle");
    setAnimateReveal(false);
  }, [clearStampTimers]);

  const startFirstStampSequence = useCallback(
    (receipt: ReceiptData) => {
      clearStampTimers();
      hintDelayRef.current = FIRST_STAMP_TIMING.hint;
      setStampSlamMs(FIRST_STAMP_TIMING.slam);
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
        pushTimer(() => {
          pushTimer(() => setStage("revealed"), FIRST_STAMP_TIMING.actions);
        }, FIRST_STAMP_TIMING.slam);
      }, FIRST_STAMP_TIMING.click);
    },
    [clearStampTimers],
  );

  const startRepeatStampSequence = useCallback(
    (receipt: ReceiptData) => {
      clearStampTimers();
      repeatStampRef.current = true;
      setAnimateReveal(false);
      setStampSlamMs(REPEAT_STAMP_SLAM_MS);
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
        pushTimer(() => setStage("done"), REPEAT_STAMP_SLAM_MS);
      }, REPEAT_STAMP_DELAY_MS);
    },
    [clearStampTimers],
  );

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<ReceiptData>).detail;
      clearStampTimers();
      stampFromConfirmRef.current = false;
      repeatStampRef.current = false;
      setData(detail);
      setAnimateReveal(false);
      if (isStampConfirmedFor(detail)) {
        setStage("done");
        return;
      }
      if (hasEverStamped()) {
        startRepeatStampSequence(detail);
        return;
      }
      setStage("idle");
    };
    window.addEventListener(APP_EVENTS.payslipOpen, onOpen);
    return () => window.removeEventListener(APP_EVENTS.payslipOpen, onOpen);
  }, [clearStampTimers, startFirstStampSequence, startRepeatStampSequence]);

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

  async function share() {
    if (!data) return;
    const encoded = encodeReceiptForShare(data);
    const fp = stableFingerprint(data);

    // 캐시 히트면 API 재호출 없이 바로 사용
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
    if (navigator.share) {
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
    if (!exportCardRef.current) return;
    try {
      const dataUrl = await toPng(exportCardRef.current, {
        pixelRatio: Math.max(2, window.devicePixelRatio || 1),
        cacheBust: true,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "money-toilet.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast("급여명세서 이미지를 저장했어요 🧾");
    } catch {
      toast("이미지 저장에 실패했어요 🥲");
    }
  }

  if (!data) return null;

  const showConfirmButton =
    stage === "idle" ||
    ((stage === "waiting" || stage === "stamping") &&
      stampFromConfirmRef.current);

  const showActionButtons =
    stage === "revealed" ||
    stage === "done" ||
    (repeatStampRef.current && (stage === "waiting" || stage === "stamping"));

  const showHint =
    stage === "done" ||
    (repeatStampRef.current &&
      (stage === "waiting" || stage === "stamping"));

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
              maxHeight="calc(100dvh - 176px)"
              stampVisible={stage !== "idle" && stage !== "waiting"}
              stampAnimate={stage === "stamping"}
              stampSlamMs={stampSlamMs}
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
                  className="receipt-btn receipt-btn--share btn-yellow"
                  type="button"
                  onClick={share}
                >
                  🔗 자랑하기
                </button>
              </div>
            ) : showConfirmButton ? (
              <button
                className={
                  "receipt-btn receipt-btn--save" +
                  (stage === "waiting" || stage === "stamping"
                    ? " receipt-btn--fading"
                    : "")
                }
                type="button"
                onClick={confirmStamp}
                disabled={stage === "waiting" || stage === "stamping"}
              >
                위 내용이 틀림없음을 확인합니다 👈
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
