/* Redis 키 빌더 · 설정 상수 · KST 날짜 헬퍼 (소켓서버용)
   설계: 라이브 카운터는 메모리, 5분마다 날짜키 1개에 JSON 스냅샷(복구/조회용).
        매 이벤트 Redis write 금지 → Upstash 무료 500k/월 보호. */

const KST = 9 * 3600 * 1000;

export function kstDateKey(at = Date.now()) {
  const d = new Date(at + KST);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function kstHour(at = Date.now()) {
  return new Date(at + KST).getUTCHours(); // 0~23 (KST)
}
/** 최근 N일 KST 날짜키 (오늘, 어제, ...) */
export function lastDateKeys(n, at = Date.now()) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(kstDateKey(at - i * 86400_000));
  return out;
}

export const K = {
  adminCfg: "mt:admincfg", // 운영 노브 HASH
  bansIndex: "mt:bans:index", // 블랙리스트 인덱스 ZSET (score=만료ms, 영구=+inf)
  warnedIndex: "mt:warned:index", // 경고 인덱스 ZSET
};

export const dayKey = (date) => `mt:day:${date}`; // 일일 통계 스냅샷(JSON)
export const chatLogKey = (date) => `mt:chatlog:${date}`; // 3일 채팅로그(LIST)

export const vk = {
  ban: (vid) => `mt:ban:${vid}`,
  warn: (vid) => `mt:warn:${vid}`,
};
export const ak = {
  session: (token) => `mt:admin:session:${token}`,
  loginFail: (ipHash) => `mt:admin:loginfail:${ipHash}`,
};

export const TTL = {
  dayBlob: 60 * 60 * 24 * 95, // 통계 95일 보관
  chatLog: 60 * 60 * 24 * 3, // 채팅로그 3일
  warn: 60 * 60 * 24 * 30,
  adminSession: 60 * 60 * 24,
  loginLock: 60 * 15,
};

export const LOGIN_MAX_FAILS = 5;
export const DURATION_SEC = { "1d": 86400, "3d": 259200, "7d": 604800, "30d": 2592000, perm: null };

/* 물내림 클램프 — 1억 월급 기준 초당 최대 적립 × 경과초 (그리핑 방지) */
export const MAX_PER_SEC = Math.ceil(100_000_000 / (22 * 8 * 3600)); // 158원/초
export const FLUSH_CAP = MAX_PER_SEC * 3600; // 1시간치 = 568,800

export const CHATLOG_MAX = 6000; // 날짜별 채팅로그 상한(LTRIM)

export const DEFAULTS = {
  backfillN: 30,
  ringMax: 60,
  rateLimitN: 7,
  rateWindowMs: 10_000,
  autoBlockSec: 10,
  maxMsgLen: 40,
  presenceBroadcastMs: 2000,
  persistMs: 300_000, // 5분마다 통계/채팅로그 영속
  chatDisabled: false,
};
