/* ===================================================================
   화장실 급여명세서 공유 데이터 인코딩 (백엔드 없이 URL에 스냅샷을 담는다)
   - 절대 월급/누적시간을 담지 않는다 (월급 역산 방지).
   - 클라이언트(게임)에서 encodeReceipt → /r/<d> 링크 생성,
     서버(공유 페이지 / OG 이미지)에서 decodeReceipt 로 복원.
   =================================================================== */

import { RECEIPT_SLOGANS } from "@/lib/constants";

// 지급내역 표시 상한 — 모달/이미지 저장 vs 공유 랜딩
export const RECEIPT_HISTORY_MAX_MODAL = 5;
export const RECEIPT_HISTORY_MAX_SHARE = 5;

export interface ReceiptData {
  n: string; // 닉네임(성명)
  h: number[]; // 지급내역 금액 배열 (오래된 순) — 회차는 f에서 역산
  t: number; // 누적 실수령액(내가 번 돈 총합)
  g: number; // 오늘 다같이 번 돈(글로벌)
  p: number; // 발급 시점 접속자(볼일 중 인원)
  f: number; // 총 물내림 횟수
  ts: number; // 발급 시각(epoch ms, 벽시계 — 누적시간 아님)
  sl: number; // 명언 인덱스 (RECEIPT_SLOGANS)
}

function randomSloganIndex(): number {
  return Math.floor(Math.random() * RECEIPT_SLOGANS.length);
}

/** URL/레거시 페이로드 → 유효한 명언 인덱스 (범위 밖이면 랜덤) */
function normalizeSloganIndex(raw: unknown): number {
  const len = RECEIPT_SLOGANS.length;
  if (len === 0) return 0;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const idx = Math.floor(raw);
    if (idx >= 0 && idx < len) return idx;
    return randomSloganIndex();
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const idx = parseInt(trimmed, 10);
      if (idx >= 0 && idx < len) return idx;
      return randomSloganIndex();
    }
    const found = RECEIPT_SLOGANS.indexOf(trimmed);
    if (found >= 0) return found;
    return randomSloganIndex();
  }

  return randomSloganIndex();
}

export function resolveReceiptSlogan(sl: number): string {
  const idx = Math.floor(Number(sl) || 0);
  if (idx >= 0 && idx < RECEIPT_SLOGANS.length) {
    return RECEIPT_SLOGANS[idx];
  }
  return RECEIPT_SLOGANS[randomSloganIndex()];
}

/* 발급 시각 표기는 항상 KST(Asia/Seoul) 기준으로 고정한다.
   — 서버(UTC)와 클라이언트(로컬)가 같은 ts를 다르게 렌더링해 생기는
     hydration mismatch(지급일/문서번호 깜빡임)를 방지. */
const SEOUL_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const SEOUL_WEEKDAY_FMT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  weekday: "short",
});

export interface ReceiptDateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

export function receiptDateParts(d: ReceiptData): ReceiptDateParts {
  const parts = SEOUL_DATE_FMT.formatToParts(new Date(d.ts || 0));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** 명세서 발급일 — YYYY.MM.DD (요일) HH:mm (KST 고정) */
export function receiptIssuedAt(d: ReceiptData): string {
  const { year, month, day, hour, minute } = receiptDateParts(d);
  const weekday = SEOUL_WEEKDAY_FMT.format(new Date(d.ts || 0));
  return `${year}.${month}.${day} (${weekday}) ${hour}:${minute}`;
}

/** 명세서 문서번호 — NO. 뒤 YYMMDD-HHmm (KST 고정) */
export function receiptDocNo(d: ReceiptData): string {
  const { year, month, day, hour, minute } = receiptDateParts(d);
  return `${year.slice(2)}${month}${day}-${hour}${minute}`;
}

const clampNum = (x: unknown) =>
  Math.max(0, Math.min(Math.floor(Number(x) || 0), 1e15));

function sanitizeHistory(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item): number[] => {
      // 신규: 숫자 하나 (금액만)
      if (typeof item === "number" && isFinite(item)) {
        return [clampNum(item)];
      }
      // 레거시: [회차, 금액] 쌍 → 금액만 추출
      if (Array.isArray(item) && item.length >= 2) {
        return [clampNum(item[1])];
      }
      return [];
    })
    .slice(-RECEIPT_HISTORY_MAX_MODAL);
}

function toBase64Url(bin: string): string {
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64);
}

export function encodeReceipt(obj: ReceiptData): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return toBase64Url(bin);
}

/** 공유 링크용 — 지급내역은 최근 6건만 URL에 담는다 */
export function encodeReceiptForShare(obj: ReceiptData): string {
  return encodeReceipt({
    ...obj,
    h: obj.h.slice(-RECEIPT_HISTORY_MAX_SHARE),
  });
}

export function decodeReceipt(s: string): ReceiptData | null {
  try {
    const bin = fromBase64Url(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const o = JSON.parse(new TextDecoder().decode(bytes));
    return {
      n: String(o.n ?? "익명의 볼일러").slice(0, 16),
      h: sanitizeHistory(o.h),
      t: clampNum(o.t),
      g: clampNum(o.g),
      p: clampNum(o.p),
      f: clampNum(o.f),
      ts: Number(o.ts) || Date.now(),
      sl: normalizeSloganIndex(o.sl),
    };
  } catch {
    return null;
  }
}

export function fmtWon(n: number): string {
  return Math.max(0, Math.ceil(Number(n) || 0)).toLocaleString("ko-KR") + "원";
}

// 헤드라인 금액 = 누적 실수령액(내가 번 돈 총합)
export function heroAmount(d: ReceiptData): number {
  return Math.max(0, d.t);
}

// 지급내역에서 생략 표시 여부 (데이터 생략 또는 화면 표시 상한 초과)
export function hasOmittedLines(
  d: ReceiptData,
  maxVisible = RECEIPT_HISTORY_MAX_MODAL,
): boolean {
  if (d.h.length === 0) return false;
  if (d.f > d.h.length) return true;
  return d.h.length > maxVisible;
}

// 화면 표시용: 최신순 [회차, 금액] 쌍으로 변환 (회차는 f에서 역산)
export function visibleHistoryRows(
  d: ReceiptData,
  maxVisible = RECEIPT_HISTORY_MAX_MODAL,
): [number, number][] {
  const reversed = [...d.h].reverse().slice(0, maxVisible);
  return reversed.map((amount, i) => [Math.max(1, d.f - i), amount]);
}
