/* ===================================================================
   영수증 공유 데이터 인코딩 (백엔드 없이 URL에 스냅샷을 담는다)
   - 절대 월급/누적시간을 담지 않는다 (월급 역산 방지).
   - 클라이언트(게임)에서 encodeReceipt → /r/<d> 링크 생성,
     서버(공유 페이지 / OG 이미지)에서 decodeReceipt 로 복원.
   =================================================================== */

export interface ReceiptData {
  n: string; // 닉네임
  s: number; // 화장실 근무수당(이미 물내린 누적)
  l: number; // 실시간 적립(진행중)
  g: number; // 오늘 다같이 번 돈(글로벌)
  p: number; // 지금 볼일 중 인원
  f: number; // 내 물내림 횟수
  ts: number; // 발행 시각(epoch ms, 벽시계 — 누적시간 아님)
  sl: string; // 슬로건
}

const clampNum = (x: unknown) =>
  Math.max(0, Math.min(Math.floor(Number(x) || 0), 1e15));

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
      s: clampNum(o.s),
      l: clampNum(o.l),
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

export function heroAmount(d: ReceiptData): number {
  return Math.max(0, d.s) + Math.max(0, d.l);
}
