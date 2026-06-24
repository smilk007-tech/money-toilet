/* ===================================================================
   KV 기반 영수증 저장소
   - Upstash Redis REST API 사용 (서버 전용)
   - 환경변수 미설정 시 null 반환 → 호출부에서 base64url 폴백
   =================================================================== */

import { Redis } from "@upstash/redis";
import type { ReceiptData } from "@/lib/receiptShare";

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30일

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  // Vercel KV(대시보드 연결)와 Upstash 직접 연결 둘 다 지원
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!_redis) _redis = new Redis({ url, token });
  return _redis;
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
    g: Math.max(0, Math.floor(Number(r.g) || 0)),
    p: Math.max(0, Math.floor(Number(r.p) || 0)),
    f: Math.max(0, Math.floor(Number(r.f) || 0)),
    ts: Number(r.ts) || Date.now(),
    sl: Math.max(0, Math.floor(Number(r.sl) || 0)),
  };
}

export async function saveReceipt(data: ReceiptData): Promise<string | null> {
  const r = getRedis();
  if (!r) return null;
  const id = genId();
  await r.set(`r:${id}`, data, { ex: TTL_SECONDS });
  return id;
}

export async function loadReceipt(id: string): Promise<ReceiptData | null> {
  const r = getRedis();
  if (!r) return null;
  const raw = await r.get(`r:${id}`);
  return normalizeLoaded(raw);
}
