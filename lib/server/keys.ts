/* ===================================================================
   Redis 키 빌더 & 서버 설정 상수 (한 곳에서 관리 — 인라인 문자열 금지)
   네임스페이스: mt:*  (receipt 저장소의 r:* 와 분리)
   =================================================================== */

/* ---------- KST(Asia/Seoul) 날짜 버킷 ----------
   일/주 통계와 "오전 9시 리셋" 동작을 한국 시간에 고정.
   서버 UTC와 무관하게 항상 KST 기준 YYYY-MM-DD를 만든다. */
export function kstDateKey(at: number = Date.now()): string {
  // KST = UTC+9. 오프셋을 더한 뒤 UTC 필드를 읽으면 KST 달력 날짜가 된다.
  const d = new Date(at + 9 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 최근 7일(오늘 포함)의 KST 날짜키 배열 — 주간 집계용 */
export function last7DateKeys(at: number = Date.now()): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(kstDateKey(at - i * 86400_000));
  return out;
}

/* ---------- 고정 키 ---------- */
export const K = {
  global: "mt:global", // 누적 '다같이 번 돈' (서버 소유, 단일 진실)
  chatSeq: "mt:chatseq", // 단조 증가 채팅 id (커서 diff)
  chats: "mt:chats", // 화면용 최근 채팅 링버퍼 (LTRIM)
  adminChats: "mt:adminchats", // 어드민 7일 감사 로그 (LTRIM)
  presenceZ: "mt:presence:z", // 동접 추정 ZSET (score=last-seen ms)
  uvAll: "mt:uv:all", // 전체 누적 순방문자 (HyperLogLog)
  chatAll: "mt:chat:all", // 전체 누적 채팅수
  bansIndex: "mt:bans:index", // 블랙리스트 인덱스 ZSET (score=만료 epoch ms, 영구=+inf)
  warnedIndex: "mt:warned:index", // 경고 리스트 인덱스 ZSET (score=경고수)
  adminCfg: "mt:admincfg", // 라이브 운영 노브 (HASH)
  cmds: "mt:cmds", // 오늘 명령 사용량 추정 카운터 (날짜 접미사)
} as const;

/* ---------- 날짜별 키 ---------- */
export const dk = {
  uv: (d: string) => `mt:uv:${d}`, // 일별 순방문자 (HLL)
  chat: (d: string) => `mt:chat:${d}`, // 일별 채팅수
  money: (d: string) => `mt:money:${d}`, // 일별 적립액
  cmds: (d: string) => `mt:cmds:${d}`, // 일별 명령 사용량 추정
};

/* ---------- vid별 키 ---------- */
export const vk = {
  ban: (vid: string) => `mt:ban:${vid}`, // 존재=밴, TTL=기간
  warn: (vid: string) => `mt:warn:${vid}`, // 경고 누적
  nick: (vid: string) => `mt:nick:${vid}`, // 마지막 닉네임
  rate: (vid: string, bucket: number) => `mt:rate:${vid}:${bucket}`, // 10초 윈도 레이트
};

export const ak = {
  session: (token: string) => `mt:admin:session:${token}`, // 어드민 세션
  loginFail: (ipHash: string) => `mt:admin:loginfail:${ipHash}`, // 로그인 실패 카운트(IP 해시)
};

/** 로그인 무차별 대입 차단 — IP당 실패 허용 횟수 */
export const LOGIN_MAX_FAILS = 5;

/* ---------- TTL(초) ---------- */
export const TTL = {
  chats: 60 * 60 * 24 * 7, // 화면 버퍼 7일
  adminChats: 60 * 60 * 24 * 7, // 어드민 로그 7일
  dayBucket: 60 * 60 * 24 * 60, // 일별 통계 60일
  presenceZday: 60 * 60 * 24, // presence ZSET 키 자체 1일
  warn: 60 * 60 * 24 * 30, // 경고 30일 감쇠
  nick: 60 * 60 * 24 * 30, // 닉네임 30일 슬라이딩
  rateWindow: 10, // 레이트 윈도 10초
  adminSession: 60 * 60 * 24, // 어드민 세션 24시간
  loginLock: 60 * 15, // 로그인 실패 잠금 15분
  cmds: 60 * 60 * 24 * 2, // 명령 카운터 2일
};

/* ---------- 기본 운영값 (어드민 mt:admincfg HASH로 덮어쓰기 가능) ---------- */
export const DEFAULTS = {
  chatSampleK: 16, // snapshot이 내려주는 최대 채팅 수
  displayBufferMax: 200, // mt:chats 링버퍼 상한
  adminLogMax: 1000, // mt:adminchats 상한
  rateLimitN: 7, // 10초 윈도 내 채팅 허용 상한 (초과 시 소프트 차단)
  autoBlockSec: 10, // 휴리스틱 트립 시 자동 차단(초)
  maxMsgLen: 40, // 채팅 길이 상한 (입력칸 maxLength와 일치)
  pollMs: 2500, // 클라 폴링 기본 간격 (서버가 throttle 가능)
  presenceWindowMs: 35_000, // 동접 = 최근 N ms 안에 본 vid 수 (beacon ~29s보다 길게)
  presenceMaxAgeMs: 90_000, // ZSET 가지치기 기준 (창보다 넉넉히)
  botBaseTarget: 60, // 봇이 채우려는 목표 방 인원(한산할 때)
  botCutoffPresence: 100, // 실접속 이 이상이면 봇 거의 0
  chatDisabled: false, // 킬스위치
};

export type AdminConfig = typeof DEFAULTS;
