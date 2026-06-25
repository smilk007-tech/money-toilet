"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { encodeReceiptForShare, type ReceiptData } from "@/lib/receiptShare";
import ReceiptCard from "@/components/ReceiptCard";
import { resolveShareOrigin } from "@/lib/siteUrl";

const OPEN_EVENT = "ddong:payslip-open";
const TOAST_EVENT = "ddong:toast";
const STAMP_EVENT = "ddong:payslip-stamped"; // 도장을 찍는 순간 game.js에 알림(영수증 버튼 즉시 노출용)
const SHARED_EVENT = "ddong:payslip-shared"; // 저장/공유 성공 순간 — 만족 정점에서 홈화면 추가 유도(InstallPrompt가 수신)
const STAMP_CONFIRM_KEY = "ddong_payslip_confirmed"; // 지급완료 확인 넛지 — 최초 1회만
const CLICK_TO_STAMP_DELAY_MS = 500; // 확인 클릭 후 도장이 떨어지기 시작하기까지 대기
const STAMP_SLAM_MS = 1350; // receiptStampSlam 애니메이션 길이와 동일하게 유지
const ACTIONS_REVEAL_DELAY_MS = 280; // 도장 착지 후 버튼이 등장하기까지 호흡
const HINT_REVEAL_DELAY_MS = 380; // 버튼 등장 후 안내문구가 뒤따라 등장하기까지 호흡

// ts·sl은 모달 열 때마다 바뀌므로 실제 게임 진행 상태만으로 fingerprint 생성
function stableFingerprint(d: ReceiptData): string {
  return `${d.n}|${d.t}|${d.f}|${d.h.join(",")}`;
}

// 세션 내 메모리 캐시 — fingerprint 동일하면 API 재호출 없이 기존 ID 재사용
const shareIdCache = new Map<string, string>(); // fingerprint → shareId

function toast(msg: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: msg }));
}

// 명세서를 저장하거나 공유한 "만족 정점" 순간을 알린다 — 이때만 홈화면 추가 배너를 띄운다.
function notifyShared() {
  try {
    window.dispatchEvent(new CustomEvent(SHARED_EVENT));
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
  const [animateReveal, setAnimateReveal] = useState(false); // 최초 1회 도장 시퀀스에서만 등장 애니메이션 재생
  const cardRef = useRef<HTMLDivElement>(null);
  const exportCardRef = useRef<HTMLDivElement>(null);
  const siteUrlHref =
    typeof window !== "undefined" ? resolveShareOrigin() : undefined;

  const close = useCallback(() => setData(null), []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setData((e as CustomEvent<ReceiptData>).detail);
      let already = false;
      try {
        already = localStorage.getItem(STAMP_CONFIRM_KEY) === "1";
      } catch {}
      setStage(already ? "done" : "idle");
      setAnimateReveal(false);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  // 도장 착지 → 버튼 등장 → 안내문구 등장 순으로 한 단계씩 늦게 보여준다
  useEffect(() => {
    if (!animateReveal || stage !== "revealed") return;
    const t = window.setTimeout(() => setStage("done"), HINT_REVEAL_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [stage, animateReveal]);

  function confirmStamp() {
    if (stage !== "idle") return;
    setAnimateReveal(true);
    setStage("waiting");
    window.setTimeout(() => {
      setStage("stamping");
      window.setTimeout(() => {
        try {
          localStorage.setItem(STAMP_CONFIRM_KEY, "1");
        } catch {}
        try {
          window.dispatchEvent(new CustomEvent(STAMP_EVENT));
        } catch {}
        window.setTimeout(() => setStage("revealed"), ACTIONS_REVEAL_DELAY_MS);
      }, STAMP_SLAM_MS);
    }, CLICK_TO_STAMP_DELAY_MS);
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
        notifyShared();
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("공유 링크를 복사했어요! SNS에 붙여넣기 🔗");
      notifyShared();
      return;
    } catch {}
    window.open(url, "_blank");
    notifyShared();
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
      notifyShared();
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

export { OPEN_EVENT };
