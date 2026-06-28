/* Redis 키 빌더 · 설정 상수 · KST 날짜 헬퍼 (소켓서버용, plain JS) */

export function kstDateKey(at = Date.now()) {
  const d = new Date(at + 9 * 3600 * 1000); // KST = UTC+9
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function last7DateKeys(at = Date.now()) {
  const out = [];
  for (let i = 0; i < 7; i++) out.push(kstDateKey(at - i * 86400_000));
  return out;
}

export const K = {
  global: "mt:global", // 누적 '다같이 번 돈' (단일 진실)
  uvAll: "mt:uv:all", // 전체 누적 순방문자 (HLL)
  chatAll: "mt:chat:all", // 전체 누적 채팅수
  adminChats: "mt:adminchats", // 어드민 7일 감사 로그 (LIST)
  bansIndex: "mt:bans:index", // 블랙리스트 인덱스 ZSET (score=만료 epoch ms, 영구=+inf)
  warnedIndex: "mt:warned:index", // 경고 리스트 인덱스 ZSET (score=경고수)
  adminCfg: "mt:admincfg", // 라이브 운영 노브 (HASH)
};

export const dk = {
  uv: (d) => `mt:uv:${d}`,
  chat: (d) => `mt:chat:${d}`,
  money: (d) => `mt:money:${d}`,
};

export const vk = {
  ban: (vid) => `mt:ban:${vid}`,
  warn: (vid) => `mt:warn:${vid}`,
  nick: (vid) => `mt:nick:${vid}`,
};

export const ak = {
  session: (token) => `mt:admin:session:${token}`,
  loginFail: (ipHash) => `mt:admin:loginfail:${ipHash}`,
};

export const TTL = {
  adminChats: 60 * 60 * 24 * 7, // 7일
  dayBucket: 60 * 60 * 24 * 60, // 60일
  warn: 60 * 60 * 24 * 30, // 30일
  nick: 60 * 60 * 24 * 30, // 30일
  adminSession: 60 * 60 * 24, // 24시간
  loginLock: 60 * 15, // 15분
};

export const LOGIN_MAX_FAILS = 5;

/* 1회 물내림 최대 적립 상한 (1억 월급 × 1시간 기준) — 서버측 그리핑 방지 클램프 */
export const FLUSH_CAP =
  Math.ceil(100_000_000 / (22 * 8 * 3600)) * 3600; // = 568,800

/** 밴 기간 → 초 (perm=영구) */
export const DURATION_SEC = {
  "1d": 86400,
  "3d": 3 * 86400,
  "7d": 7 * 86400,
  "30d": 30 * 86400,
  perm: null,
};

/* 기본 운영값 — 어드민 mt:admincfg HASH로 덮어쓰기 가능 */
export const DEFAULTS = {
  backfillN: 30, // 새 입장자에게 보낼 최근 채팅 수
  ringMax: 60, // 메모리 채팅 링버퍼 상한
  adminLogMax: 1000, // mt:adminchats 상한
  rateLimitN: 7, // 10초 윈도 채팅 허용 상한
  rateWindowMs: 10_000, // 레이트 윈도
  autoBlockSec: 10, // 휴리스틱 트립 자동 차단(초)
  maxMsgLen: 40, // 채팅 길이 상한
  presenceBroadcastMs: 2000, // presence 브로드캐스트 최소 간격(디바운스)
  chatDisabled: false, // 킬스위치
};
