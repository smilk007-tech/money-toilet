/* ===================================================================
   화장실 급여명세서 공유 데이터 인코딩 (백엔드 없이 URL에 스냅샷을 담는다)
   - 절대 월급/누적시간을 담지 않는다 (월급 역산 방지).
   - 클라이언트(게임)에서 encodeReceipt → /r/<d> 링크 생성,
     서버(공유 페이지 / OG 이미지)에서 decodeReceipt 로 복원.
   =================================================================== */

// 지급내역 한 줄: [회차, 금액]
export type PayLine = [number, number];

export interface ReceiptData {
  n: string; // 닉네임(성명)
  h: PayLine[]; // 지급내역(최근 7건) [회차, 금액]
  t: number; // 누적 실수령액(내가 번 돈 총합)
  g: number; // 오늘 다같이 번 돈(글로벌)
  p: number; // 발급 시점 접속자(볼일 중 인원)
  f: number; // 총 물내림 횟수
  ts: number; // 발급 시각(epoch ms, 벽시계 — 누적시간 아님)
  sl: string; // 명언(슬로건)
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
    .slice(-7);
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
      sl: String(o.sl ?? "").slice(0, 40),
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

// 지급내역에서 생략된 이전 회차가 있는지(맨 위 ⋮ 표시 여부)
export function hasOmittedLines(d: ReceiptData): boolean {
  if (d.h.length === 0) return false;
  return d.h[0][0] > 1 || d.f > d.h.length;
}
