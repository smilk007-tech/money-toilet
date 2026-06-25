"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { encodeReceiptForShare, type ReceiptData } from "@/lib/receiptShare";
import ReceiptCard from "@/components/ReceiptCard";
import { resolveShareOrigin } from "@/lib/siteUrl";

const OPEN_EVENT = "ddong:payslip-open";
const TOAST_EVENT = "ddong:toast";

// ts·sl은 모달 열 때마다 바뀌므로 실제 게임 진행 상태만으로 fingerprint 생성
function stableFingerprint(d: ReceiptData): string {
  return `${d.n}|${d.t}|${d.f}|${d.h.join(",")}`;
}

// 세션 내 메모리 캐시 — fingerprint 동일하면 API 재호출 없이 기존 ID 재사용
const shareIdCache = new Map<string, string>(); // fingerprint → shareId

function shareText(url: string) {
  return `돈버는 화장실 - ${url}`;
}

function toast(msg: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: msg }));
}

/* 게임 미리보기 팝업 — 공유 페이지와 동일한 ReceiptCard 를 렌더한다. */
export default function PayslipModal() {
  const [data, setData] = useState<ReceiptData | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const exportCardRef = useRef<HTMLDivElement>(null);
  const siteUrlHref =
    typeof window !== "undefined" ? resolveShareOrigin() : undefined;

  const close = useCallback(() => setData(null), []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setData((e as CustomEvent<ReceiptData>).detail);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

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
    const text = shareText(url);
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
          <p className="receipt-modal__hint">내 월급은 공개되지 않습니다</p>
        </div>
      </div>
    </div>
  );
}

export { OPEN_EVENT };
