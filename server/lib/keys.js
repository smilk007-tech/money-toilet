/* Redis 키 · 상수 · KST 날짜 헬퍼 (소켓서버)
   설계:
   - mt:today        : 오늘 러닝 합계 JSON {date,visits,newVisitors,chat,flush,money} (TTL 없음, 자정 0 리셋)
   - mt:hours:<date> : 시간별 HASH (field=0~23, value={visits,newVisitors,chat,flush,money}) — 하루합계는 화면에서 합산
   - mt:chatlog:<date>: 채팅 LIST (5분 배치 append, 3일 TTL)
   - 밴/세션은 변경 시에만 write
   라이브(메모리)에서 누적하고 5분마다 위 키에 배치 기록 → Upstash 무료 보호. */

const KST = 9 * 3600 * 1000;
export function kstDateKey(at = Date.now()) {
  const d = new Date(at + KST);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function kstHour(at = Date.now()) {
  return new Date(at + KST).getUTCHours();
}
export function lastDateKeys(n, at = Date.now()) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(kstDateKey(at - i * 86400_000));
  return out;
}

export const K = {
  today: "mt:today", // 오늘 러닝 합계(TTL 없음)
  adminCfg: "mt:admincfg",
  bansIndex: "mt:bans:index",
};
export const hoursKey = (date) => `mt:hours:${date}`;
export const chatLogKey = (date) => `mt:chatlog:${date}`;
export const vk = { ban: (vid) => `mt:ban:${vid}` };
export const ak = {
  session: (token) => `mt:admin:session:${token}`,
  loginFail: (ipHash) => `mt:admin:loginfail:${ipHash}`,
};

export const TTL = {
  hours: 60 * 60 * 24 * 95, // 시간별 95일 보관
  chatLog: 60 * 60 * 24 * 3, // 채팅로그 3일
  adminSession: 60 * 60 * 24, // 어드민 세션 24시간
  loginLock: 60 * 15,
};

export const LOGIN_MAX_FAILS = 5;
export const DURATION_SEC = { "1d": 86400, "3d": 259200, "7d": 604800, "30d": 2592000, perm: null };
export const MAX_PER_SEC = Math.ceil(100_000_000 / (22 * 8 * 3600)); // 158원/초
export const FLUSH_CAP = MAX_PER_SEC * 3600; // 568,800
export const CHATLOG_MAX = 6000;

/** 빈 시간 버킷 */
export const emptyBucket = () => ({ visits: 0, newVisitors: 0, chat: 0, flush: 0, money: 0 });

export const DEFAULTS = {
  rateLimitN: 7,
  rateWindowMs: 10_000,
  autoBlockSec: 10,
  maxMsgLen: 40,
  presenceBroadcastMs: 2000, // 일반 유저 presence 브로드캐스트 + 어드민 라이브 push 디바운스 공용
  persistMs: 300_000, // 5분마다 Redis 영속 + 어드민 시간별 통계 push 주기
  chatDisabled: false,
};
