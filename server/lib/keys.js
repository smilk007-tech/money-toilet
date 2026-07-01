/* Redis 키 · 상수 · KST 날짜 헬퍼 (소켓서버)
   설계:
   - mt:today        : 오늘 러닝 합계 JSON {date,visits,newVisitors,chat,flush,money,share,bragUrl} (TTL 없음, 자정 0 리셋)
   - mt:hours:<date> : 시간별 HASH (field=0~23, value={visits,newVisitors,chat,flush,money,share,bragUrl}) — 하루합계는 화면에서 합산
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
  chatLog: 60 * 60 * 24 * 5, // 채팅로그 5일 — 어드민 [오늘~그끄저께](3일 전)까지 안전 조회용 여유
  adminSession: 60 * 60 * 24, // 어드민 세션 24시간
  loginLock: 60 * 15,
};

export const LOGIN_MAX_FAILS = 5;
export const DURATION_SEC = { "1d": 86400, "3d": 259200, "7d": 604800, "30d": 2592000, perm: null };
// 분모는 클라이언트 lib/constants.js WORK_CONFIG(월 20.6일 × 8시간)와 동일해야 함 — 불일치 시
// 클라가 계산한 초당 적립을 서버 accrued 상한이 도로 깎아낸다.
export const MAX_PER_SEC = Math.ceil(100_000_000 / (20.6 * 8 * 3600)); // 169원/초
export const FLUSH_CAP = MAX_PER_SEC * 3600; // 608,400
export const CHATLOG_MAX = 6000;

/** 빈 시간 버킷 — share: 공유하기 클릭, bragUrl: 자랑(명세서) URL 신규 생성 */
export const emptyBucket = () => ({ visits: 0, newVisitors: 0, chat: 0, flush: 0, money: 0, share: 0, bragUrl: 0 });

export const DEFAULTS = {
  rateLimitN: 7,
  rateWindowMs: 10_000,
  autoBlockSec: 10,
  chatMinIntervalMs: 700, // 같은 사람 연속 채팅 최소 간격(연타/도배 1차 방어) — 미만이면 조용히 무시
  maxMsgLen: 40,
  presenceBroadcastMs: 2000, // 일반 유저 presence 브로드캐스트 + 어드민 라이브 push 디바운스 공용
  persistMs: 300_000, // 5분마다 Redis 영속 + 어드민 시간별 통계 push 주기
  chatDisabled: false,
  notices: [], // 시스템 공지 배너. 어드민에서 관리. Notice[] JSON.
  presenceFloorAuto: true, // 접속자 바닥값 자동 드리프트(오픈초기 기본 ON). 어드민은 항상 실제 presence를 본다.
  presenceFloorMax: 3, // 바닥값 상한(0~9). auto ON=이 값을 천장으로 시간대 패턴 드리프트, OFF=이 값으로 고정
};
// 자동 차단 상한 — 누적 위반(strike)으로 차단 시간이 늘어나도 이 값을 넘지 않음
export const MAX_AUTOBLOCK_SEC = 600;

/* ===== 접속자 표시 바닥값(자동 드리프트) =====
   빈 방 이탈 방지용 최소 표시 인원. 실제 presence가 이보다 크면 실제값을 그대로 쓴다(패딩만).
   - 어드민이 정한 presenceFloorMax(0~9) = 드리프트 '천장'.
   - auto ON: 0~천장 사이를, 시간대 목표치(=천장×활발도)를 따라 ±1씩 '부드럽게' 랜덤워크.
     (매 틱 독립 재추첨=순간이동이라 가짜 티가 남 → 한 걸음씩 드리프트라 실제 입·퇴장처럼 보임)
   - 활발도(0..1) = 한국 직장인(20~50대) '화장실 월루' 패턴: 평일 오전/오후 집중근무=피크(몰래 화장실),
     점심=저조(다들 밥), 밤·심야=최저, 주말=완만·저조. */
export const PRESENCE_FLOOR_MAX = 9; // 어드민이 설정 가능한 천장의 상한
// 시(0~23)별 활발도 — 평일
const FLOOR_WEEKDAY = [
  0.02, 0.02, 0.01, 0.01, 0.02, 0.04, // 0-5 심야(거의 없음)
  0.10, 0.22, 0.42, 0.70, 0.95, 0.90, // 6-11 출근→오전 집중근무(피크)
  0.35, 0.48, 0.92, 1.00, 0.88, 0.72, // 12 점심(저조)→오후 집중근무(피크)→퇴근직전
  0.50, 0.34, 0.26, 0.18, 0.12, 0.06, // 18-23 퇴근→저녁→밤
];
// 시(0~23)별 활발도 — 주말(근무 안 하니 전반적으로 낮고 완만, 피크 없음)
const FLOOR_WEEKEND = [
  0.02, 0.01, 0.01, 0.01, 0.01, 0.02, // 0-5
  0.04, 0.07, 0.13, 0.24, 0.34, 0.38, // 6-11 늦은 기상
  0.34, 0.34, 0.40, 0.42, 0.40, 0.36, // 12-17 낮 완만
  0.34, 0.30, 0.26, 0.20, 0.13, 0.06, // 18-23
];
const clampMax = (max) => Math.max(0, Math.min(PRESENCE_FLOOR_MAX, Math.floor(Number(max)) || 0));
/** 현재 시각(KST)의 상대 활발도 0..1 */
export function presencePattern(at = Date.now()) {
  const d = new Date(at + KST);
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  return (weekend ? FLOOR_WEEKEND : FLOOR_WEEKDAY)[d.getUTCHours()] ?? 0;
}
/** 부드러운 드리프트 1스텝 — cur에서 시간대 목표치(천장×활발도)로 ±1씩 이동, [0,max] 유지. */
export function driftPresenceFloor(cur, max, at = Date.now()) {
  const m = clampMax(max);
  if (m === 0) return 0;
  let v = Math.max(0, Math.min(m, Math.floor(Number(cur)) || 0));
  const target = m * presencePattern(at); // 실수 목표치 0..m
  if (v < target - 0.5) { if (Math.random() < 0.75) v++; } // 목표보다 낮으면 대체로 +1
  else if (v > target + 0.5) { if (Math.random() < 0.75) v--; } // 높으면 대체로 -1
  else if (Math.random() < 0.35) v += Math.random() < 0.5 ? 1 : -1; // 목표 근처면 가벼운 지터
  return Math.max(0, Math.min(m, v));
}
/** 초기값 — 부팅 직후 0에서 기어오르지 않게 지금 시간대 목표치 근처에서 시작 */
export function initialPresenceFloor(max, at = Date.now()) {
  return Math.round(clampMax(max) * presencePattern(at));
}
