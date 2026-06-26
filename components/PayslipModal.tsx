"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { encodeReceiptForShare, type ReceiptData } from "@/lib/receiptShare";
import { LS as STORAGE_KEY } from "@/lib/storageKeys";
import { APP_EVENTS } from "@/lib/appEvents";
import ReceiptCard from "@/components/ReceiptCard";
import { resolveShareOrigin } from "@/lib/siteUrl";

const STAMP_CONFIRM_KEY = STORAGE_KEY.payslipConfirmed;

const STAMP_TIMING = {
  first: {
    click: 400,
    slam: 1000,
    actions: 250,
    hint: 300,
  },
  repeat: {
    click: 100,
    slam: 300,
    actions: 150,
    hint: 200,
  },
} as const;

type StampTiming = (typeof STAMP_TIMING)[keyof typeof STAMP_TIMING];

// ts·sl은 모달 열 때마다 바뀌므로 실제 게임 진행 상태만으로 fingerprint 생성
function stableFingerprint(d: ReceiptData): string {
  return `${d.n}|${d.t}|${d.f}|${d.h.join(",")}`;
}

// 세션 내 메모리 캐시 — fingerprint 동일하면 API 재호출 없이 기존 ID 재사용
const shareIdCache = new Map<string, string>(); // fingerprint → shareId

function toast(msg: string) {
  window.dispatchEvent(new CustomEvent(APP_EVENTS.toast, { detail: msg }));
}

function readConfirmedFlushCount(): number | null {
  try {
    const raw = localStorage.getItem(STAMP_CONFIRM_KEY);
    if (raw === null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function isStampConfirmedFor(flushCount: number): boolean {
  const confirmed = readConfirmedFlushCount();
  return confirmed !== null && confirmed === flushCount;
}

function saveConfirmedFlushCount(flushCount: number) {
  try {
    localStorage.setItem(STAMP_CONFIRM_KEY, String(flushCount));
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

function getStampTiming(): StampTiming {
  return hasEverStamped() ? STAMP_TIMING.repeat : STAMP_TIMING.first;
}

/* 게임 미리보기 팝업 — 공유 페이지와 동일한 ReceiptCard 를 렌더한다. */
export default function PayslipModal() {
  const [data, setData] = useState<ReceiptData | null>(null);
  // idle(확인 버튼) → waiting(클릭 후 도장 내려오기 전 대기) → stamping(도장 애니메이션)
  // → revealed(저장/자랑하기 등장) → done(안내문구까지 등장)
  const [stage, setStage] = useState<
    "idle" | "waiting" | "stamping" | "revealed" | "done"
  >("idle");
  const [animateReveal, setAnimateReveal] = useState(false); // 최초 1회 도장 시퀀스에서만 등장 애니메이션 재생
  const [stampSlamMs, setStampSlamMs] = useState<number>(
    STAMP_TIMING.first.slam,
  );
  const hintDelayRef = useRef<number>(STAMP_TIMING.first.hint);
  const cardRef = useRef<HTMLDivElement>(null);
  const exportCardRef = useRef<HTMLDivElement>(null);
  const siteUrlHref =
    typeof window !== "undefined" ? resolveShareOrigin() : undefined;

  const close = useCallback(() => setData(null), []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<ReceiptData>).detail;
      setData(detail);
      setStage(isStampConfirmedFor(detail.f) ? "done" : "idle");
      setAnimateReveal(false);
    };
    window.addEventListener(APP_EVENTS.payslipOpen, onOpen);
    return () => window.removeEventListener(APP_EVENTS.payslipOpen, onOpen);
  }, []);

  // 도장 착지 → 버튼 등장 → 안내문구 등장 순으로 한 단계씩 늦게 보여준다
  useEffect(() => {
    if (!animateReveal || stage !== "revealed") return;
    const t = window.setTimeout(() => setStage("done"), hintDelayRef.current);
    return () => window.clearTimeout(t);
  }, [stage, animateReveal]);

  function confirmStamp() {
    if (stage !== "idle" || !data) return;
    const flushCount = data.f;
    const timing = getStampTiming();
    hintDelayRef.current = timing.hint;
    setStampSlamMs(timing.slam);
    setAnimateReveal(true);
    setStage("waiting");
    window.setTimeout(() => {
      setStage("stamping");
      window.setTimeout(() => {
        saveConfirmedFlushCount(flushCount);
        markEverStamped();
        try {
          window.dispatchEvent(new CustomEvent(APP_EVENTS.payslipStamped));
        } catch {}
        window.setTimeout(() => setStage("revealed"), timing.actions);
      }, timing.slam);
    }, timing.click);
  }

  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, close]);

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
            {stage === "revealed" || stage === "done" ? (
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
            ) : (
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
            )}
          </div>
          <p
            className={
              "receipt-modal__hint" +
              (stage === "done" && animateReveal
                ? " receipt-modal__hint--in"
                : "")
            }
            style={stage === "done" ? undefined : { visibility: "hidden" }}
          >
            내 월급은 공개되지 않습니다
          </p>
        </div>
      </div>
    </div>
  );
}
