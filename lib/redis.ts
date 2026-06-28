/* ===================================================================
   공유 Upstash Redis 클라이언트
   - 채팅/통계/밴/어드민 등 모든 서버 로직이 이 단일 클라이언트를 재사용.
   - Vercel KV(대시보드 연결)와 Upstash 직접 연결 둘 다 지원.
   - 환경변수 미설정 시 null 반환 → 호출부에서 폴백 처리.
   =================================================================== */

import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;

export function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!_redis) _redis = new Redis({ url, token });
  return _redis;
}
