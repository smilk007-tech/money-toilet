"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  encodeReceipt,
  fmtWon,
  heroAmount,
  type ReceiptData,
} from "@/lib/receiptShare";
import ReceiptCard from "@/components/ReceiptCard";

const OPEN_EVENT = "ddong:payslip-open";
const TOAST_EVENT = "ddong:toast";

function bragText(d: ReceiptData) {
  return `화장실에서 ${fmtWon(heroAmount(d))} 벌었다ㅋㅋ #변기위의 월루`;
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
    typeof window !== "undefined" ? window.location.origin : undefined;
  const siteUrlLabel = siteUrlHref?.replace(/^https?:\/\//, "");

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
    const url = `${location.origin}/r/${encodeReceipt(data)}`;
    const text = bragText(data);
    if (navigator.share) {
      try {
        await navigator.share({
          title: "화장실 급여명세서",
          text,
          url,
        });
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
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
      a.download = "ddongtam-payslip.png";
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
      <div
        className="receipt-modal__sheet"
        role="dialog"
        aria-label="화장실 급여명세서 공유"
      >
        <button
          className="receipt-modal__close"
          type="button"
          aria-label="닫기"
          onClick={close}
        >
          ✕
        </button>
        <div className="receipt-modal__preview" ref={cardRef}>
          <ReceiptCard
            d={data}
            siteUrlHref={siteUrlHref}
            siteUrlLabel={siteUrlLabel}
            footerMode="interactive"
            maxHeight="min(62dvh, 520px)"
          />
        </div>
        <div className="receipt-modal__export" aria-hidden>
          <div ref={exportCardRef} className="receipt-export-frame">
            <div className="receipt-export-frame__card">
              <ReceiptCard
                d={data}
                siteUrlHref={siteUrlHref}
                siteUrlLabel={siteUrlLabel}
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
            className="receipt-btn receipt-btn--share"
            type="button"
            onClick={share}
          >
            🔗 자랑하기
          </button>
        </div>
        <p className="receipt-modal__hint">내 월급은 공개되지 않습니다</p>
      </div>
    </div>
  );
}

export { OPEN_EVENT };
