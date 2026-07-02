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

// 열림 → 잠깐 대기 → 도장 쾅 — 티어(상위 N%)가 도장에 실리므로 클릭 허들 없이 즉시 보여준다.
// (구 "위 내용이 사실임을 확인합니다" 확인 버튼은 명세서 안 인쇄 문구로 이전 — ReceiptCard)
const STAMP_DELAY_MS = 500;
const STAMP_SLAM_MS = 1200;
// 슬램 애니메이션(receiptStampSlam)에서 도장이 종이에 "딱" 닿는 순간에 효과음 재생
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

function markEverStamped() {
  try {
    localStorage.setItem(STORAGE_KEY.payslipStampEver, "1");
  } catch {}
}

// game.js가 payslipOpen detail에 실어 보내는 인게임 전용 메타 —
// 공유 URL 인코딩(encodeReceiptForShare)에 절대 섞이면 안 되므로 onOpen에서 분리 수거한다.
type PayslipOpenDetail = ReceiptData & {
  prevP?: number | null; // 직전 물내림 티어(상위 %) — 델타 메모용
  todaySec?: number | null; // 오늘 루팡시간(초) — 모달 크롬 표기용
};

function fmtDwell(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s % 60}초`;
  return `${s % 60}초`;
}

/* 게임 미리보기 팝업 — 공유 페이지와 동일한 ReceiptCard 를 렌더한다. */
export default function PayslipModal() {
  const [data, setData] = useState<ReceiptData | null>(null);
  // waiting(도장 내려오기 전 대기) → stamping(도장 애니메이션) → done
  const [stage, setStage] = useState<"waiting" | "stamping" | "done">(
    "waiting",
  );
  const [meta, setMeta] = useState<{
    prevP: number | null;
    todaySec: number | null;
  }>({ prevP: null, todaySec: null });
  const stampTimersRef = useRef<number[]>([]);
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
    setData(null);
    setStage("waiting");
    setMeta({ prevP: null, todaySec: null });
  }, [clearStampTimers]);

  const startStampSequence = useCallback(
    (receipt: ReceiptData) => {
      clearStampTimers();
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
        // 도장이 종이에 닿는 순간에 효과음
        pushTimer(playStampSound, STAMP_SLAM_MS * STAMP_IMPACT_RATIO);
        pushTimer(() => setStage("done"), STAMP_SLAM_MS);
      }, STAMP_DELAY_MS);
    },
    [clearStampTimers],
  );

  useEffect(() => {
    const onOpen = (e: Event) => {
      const { prevP, todaySec, ...receipt } = (
        e as CustomEvent<PayslipOpenDetail>
      ).detail;
      clearStampTimers();
      setData(receipt);
      setMeta({ prevP: prevP ?? null, todaySec: todaySec ?? null });
      if (isStampConfirmedFor(receipt)) {
        // 같은 명세서 버전을 다시 연 것 — 도장은 이미 찍힌 상태로 즉시 표시
        setStage("done");
        return;
      }
      startStampSequence(receipt);
    };
    window.addEventListener(APP_EVENTS.payslipOpen, onOpen);
    return () => window.removeEventListener(APP_EVENTS.payslipOpen, onOpen);
  }, [clearStampTimers, startStampSequence]);

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
    // '자랑하기' 단순 클릭 집계(URL 신규 생성 여부와 무관). URL 생성은 아래 로직에서 별도로 진행.
    try {
      window.dispatchEvent(new CustomEvent(APP_EVENTS.brag));
    } catch {}

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
    // PC는 네이티브 공유시트 대신 클립보드 복사. 모바일은 공유시트 우선.
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
              stampVisible={stage !== "waiting"}
              stampAnimate={stage === "stamping"}
              stampSlamMs={STAMP_SLAM_MS}
              // 델타 빨간펜 메모는 도장이 착지한 뒤에만 — 인게임 미리보기 전용(내보내기/공유 미포함)
              prevTierPercent={
                stage === "done" && meta.prevP != null ? meta.prevP : undefined
              }
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
            <div className="receipt-modal__actions-row">
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
          </div>
          {/* 오늘 루팡시간 — 서류(카드) 밖 모달 크롬. 저장 PNG·공유 페이지엔 안 들어간다(월급 역산 방지) */}
          {meta.todaySec != null && (
            <p className="receipt-modal__hint receipt-modal__hint--today">
              오늘 루팡시간 <b>{fmtDwell(meta.todaySec)}</b>
            </p>
          )}
          <p className="receipt-modal__hint">내 월급은 공개되지 않습니다</p>
        </div>
      </div>
    </div>
  );
}
