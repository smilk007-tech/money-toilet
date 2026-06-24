/* ===================================================================
   화장실 급여명세서 공유 데이터 인코딩 (백엔드 없이 URL에 스냅샷을 담는다)
   - 절대 월급/누적시간을 담지 않는다 (월급 역산 방지).
   - 클라이언트(게임)에서 encodeReceipt → /r/<d> 링크 생성,
     서버(공유 페이지 / OG 이미지)에서 decodeReceipt 로 복원.
   =================================================================== */

import { RECEIPT_SLOGANS } from "@/lib/constants";

// 지급내역 표시 상한 — 모달/이미지 저장 vs 공유 랜딩
export const RECEIPT_HISTORY_MAX_MODAL = 10;
export const RECEIPT_HISTORY_MAX_SHARE = 6;

// 지급내역 한 줄: [회차, 금액]
export type PayLine = [number, number];

export interface ReceiptData {
  n: string; // 닉네임(성명)
  h: PayLine[]; // 지급내역 [회차, 금액] — 모달 최대 10건, 공유 URL은 6건
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

const clampNum = (x: unknown) =>
  Math.max(0, Math.min(Math.floor(Number(x) || 0), 1e15));

function sanitizeHistory(raw: unknown): PayLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): PayLine | null => {
      if (!Array.isArray(item)) return null;
      const round = clampNum(item[0]);
      const amount = clampNum(item[1]);
      if (round <= 0) return null;
      return [round, amount];
    })
    .filter((x): x is PayLine => x !== null)
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
  if (d.h[0][0] > 1 || d.f > d.h.length) return true;
  return d.h.length > maxVisible;
}

export function visibleHistoryRows(
  d: ReceiptData,
  maxVisible = RECEIPT_HISTORY_MAX_MODAL,
): PayLine[] {
  return [...d.h].reverse().slice(0, maxVisible);
}
