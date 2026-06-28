/* 소켓서버 전용 Upstash Redis 클라이언트 (영속 데이터만 사용) */
import { Redis } from "@upstash/redis";

let _redis = null;

export function getRedis() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn("[redis] 환경변수 미설정 — 영속 비활성(메모리만 동작)");
    return null;
  }
  if (!_redis) _redis = new Redis({ url, token });
  return _redis;
}
