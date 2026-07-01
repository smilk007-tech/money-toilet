/* ===================================================================
   KV 기반 영수증 저장소
   - Upstash Redis REST API 사용 (서버 전용)
   - 환경변수 미설정 시 null 반환 → 호출부에서 base64url 폴백
   =================================================================== */

import type { ReceiptData } from "@/lib/receipt/receiptShare";
import { getRedis } from "@/lib/redis";

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30일

// 어드민 "자랑 URL 생성 리스트" — KST 날짜별 LIST. TTL은 채팅로그와 동일(오늘~그끄저께 조회).
const RECEIPTS_TTL = 60 * 60 * 24 * 5; // 5일
const RECEIPTS_MAX = 5000; // 하루 상한(초과 시 오래된 것부터 버림)
const receiptsKey = (date: string) => `mt:receipts:${date}`;
// KST(UTC+9) 날짜키 — server/lib/keys.js·adminRead 와 동일 규칙이어야 어드민 조회가 맞물린다.
function kstDate(at: number): string {
  const d = new Date(at + 9 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// 6자리 [a-zA-Z0-9] 알파뉴메릭 ID
const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const SHORT_ID_LENGTH = 6;
export const SHORT_ID_RE = new RegExp(`^[a-zA-Z0-9]{${SHORT_ID_LENGTH}}$`);

function genId(): string {
  const arr = new Uint8Array(SHORT_ID_LENGTH);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => CHARS[b % CHARS.length]).join("");
}

function normalizeLoaded(o: unknown): ReceiptData | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const h: number[] = Array.isArray(r.h)
    ? (r.h as unknown[]).flatMap((item): number[] => {
        if (typeof item === "number" && isFinite(item))
          return [Math.max(0, Math.floor(item))];
        // 레거시 [회차, 금액] 쌍
        if (Array.isArray(item) && item.length >= 2)
          return [Math.max(0, Math.floor(Number(item[1]) || 0))];
        return [];
      })
    : [];
  return {
    n: String(r.n ?? "익명의 볼일러").slice(0, 16),
    h,
    t: Math.max(0, Math.floor(Number(r.t) || 0)),
    f: Math.max(0, Math.floor(Number(r.f) || 0)),
    ts: Number(r.ts) || Date.now(),
    sl: Math.max(0, Math.floor(Number(r.sl) || 0)),
  };
}

export async function saveReceipt(data: ReceiptData): Promise<string | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const id = genId();
    await r.set(`r:${id}`, data, { ex: TTL_SECONDS });
    // 어드민 조회용 — 생성된 자랑 URL을 '생성 시각(서버)' 기준 KST 날짜별 리스트에 기록.
    // 이 write는 URL 신규 생성 때만 발생(클라 캐시로 재생성 억제)하고, 어차피 위 set과 같은 요청이라 부담이 작다.
    try {
      const now = Date.now();
      const key = receiptsKey(kstDate(now));
      const entry = { id, ts: now, n: data.n, t: data.t, f: data.f };
      const p = r.pipeline();
      p.rpush(key, entry);
      p.ltrim(key, -RECEIPTS_MAX, -1);
      p.expire(key, RECEIPTS_TTL);
      await p.exec();
    } catch {
      /* 리스트 기록 실패는 공유 기능에 영향 없음 — 무시 */
    }
    return id;
  } catch {
    return null;
  }
}

export async function loadReceipt(id: string): Promise<ReceiptData | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(`r:${id}`);
    return normalizeLoaded(raw);
  } catch {
    return null;
  }
}
