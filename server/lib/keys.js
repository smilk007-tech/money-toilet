/* Redis 키 · 상수 · KST 날짜 헬퍼 (소켓서버)
   설계:
   - mt:today        : 오늘 러닝 합계 JSON {date,visits,newVisitors,chat,flush,money,share,donate,brag} (TTL 없음, 자정 0 리셋)
   - mt:hours:<date> : 시간별 HASH (field=0~23, value=bucket) — 하루합계·일단위 카드는 여기서 합산 (95일)
   - mt:min:<date>   : 분단위 HASH (field=0~1439=분of하루, value=bucket+presence) — 어드민 차트/테이블 상세조회 (30일)
   - mt:chatlog:<date>: 채팅 LIST (배치 append, 5일 TTL)
   - 밴/세션은 변경 시에만 write
   라이브(메모리)에서 누적하고 persistMs(기본 10초)마다 위 키에 '변경분만' 배치 기록 → Upstash 무료 보호. */

const KST = 9 * 3600 * 1000;
export function kstDateKey(at = Date.now()) {
  const d = new Date(at + KST);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function kstHour(at = Date.now()) {
  return new Date(at + KST).getUTCHours();
}
// 분of하루(0~1439) — 분단위 통계 버킷 필드. hour = Math.floor(minuteOfDay/60).
export function kstMinuteOfDay(at = Date.now()) {
  const d = new Date(at + KST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
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
export const minKey = (date) => `mt:min:${date}`;
export const chatLogKey = (date) => `mt:chatlog:${date}`;
export const vk = { ban: (vid) => `mt:ban:${vid}` };
export const ak = {
  session: (token) => `mt:admin:session:${token}`,
  loginFail: (ipHash) => `mt:admin:loginfail:${ipHash}`,
};

export const TTL = {
  hours: 60 * 60 * 24 * 95, // 시간별 95일 보관
  minutes: 60 * 60 * 24 * 30, // 분단위 상세 30일 보관 (그 이전은 시간단위로만 조회)
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

/** 빈 통계 버킷 — share: 공유하기 클릭, donate: 후원하기 클릭, brag: 자랑하기 클릭(URL 생성과 무관한 단순 클릭)
    dwellSec: 체류시간 집계 = Σ(동접 인원 × 흐른 초). '총 체류(사용자-초)'이자 평균세션(=dwellSec/visits)의 분자.
    (분단위 버킷은 여기에 presence 게이지 샘플을 추가로 얹는다 — 카운터가 아니므로 tick 합산 시 max로 집계) */
export const emptyBucket = () => ({ visits: 0, newVisitors: 0, chat: 0, flush: 0, money: 0, share: 0, donate: 0, brag: 0, dwellSec: 0 });
// 카운터 필드(합산 대상) — presence는 게이지라 제외(max로 별도 집계)
export const COUNTER_FIELDS = ["visits", "newVisitors", "chat", "flush", "money", "share", "donate", "brag", "dwellSec"];

export const DEFAULTS = {
  rateLimitN: 7,
  rateWindowMs: 10_000,
  autoBlockSec: 10,
  chatMinIntervalMs: 700, // 같은 사람 연속 채팅 최소 간격(연타/도배 1차 방어) — 미만이면 조용히 무시
  maxMsgLen: 40,
  presenceBroadcastMs: 2000, // 일반 유저 presence 브로드캐스트 + 어드민 라이브 push 디바운스 공용
  persistMs: 10_000, // 10초마다 Redis 영속(변경분만 write) — 초기 소규모라 파격적으로 단축. 유휴 시엔 write 0.
  chatDisabled: false,
  notices: [], // 시스템 공지 배너. 어드민에서 관리. Notice[] JSON.
  presenceFloorAuto: true, // 접속자 바닥값 자동 드리프트(오픈초기 기본 ON). 어드민은 항상 실제 presence를 본다.
  presenceFloorMax: 10, // 드리프트 최대 추가 인원(0~99). 시간대 패턴으로 0~이 값 사이를 자동 조절
};
// 자동 차단 상한 — 누적 위반(strike)으로 차단 시간이 늘어나도 이 값을 넘지 않음
export const MAX_AUTOBLOCK_SEC = 600;

/* ===== 접속자 표시 바닥값(자동 드리프트) =====
   빈 방 이탈 방지용 최소 표시 인원. 실제 presence가 이보다 크면 실제값을 그대로 쓴다(패딩만).
   - 어드민이 정한 presenceFloorMax(0~99) = 드리프트 '천장'.
   - auto ON: 0~천장 사이를, 시간대 목표치(=천장×활발도)를 따라 ±1씩 '부드럽게' 랜덤워크.
     (매 틱 독립 재추첨=순간이동이라 가짜 티가 남 → 한 걸음씩 드리프트라 실제 입·퇴장처럼 보임)
   - 활발도(0..1) = 한국 직장인(20~50대) '화장실 월루' 패턴: 평일 오전/오후 집중근무=피크(몰래 화장실),
     점심=저조(다들 밥), 밤·심야=최저, 주말=완만·저조. */
export const PRESENCE_FLOOR_MAX = 99; // 어드민이 설정 가능한 천장의 상한
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

/* ===== 시간대별 드리프트 파라미터 =====
   [ceilRatio, biasUp]
   · ceilRatio: max 설정값 대비 실효 상한 비율 (예: max=10, ratio=0.3 → 상한=3)
   · biasUp: 이번 틱에서 올라갈 확률 (0.5=중립, >0.5=상승 경향, <0.5=하락 경향)
   20-50대 한국 직장인 평일/주말 화장실 패턴 기준 */
// 평일 (Mon-Fri)
const WD = [
  [0.25, 0.35], // 00 자정 — 새벽 시작, 하락
  [0.20, 0.33], // 01
  [0.20, 0.33], // 02 심야 최저
  [0.20, 0.33], // 03
  [0.22, 0.38], // 04 이른 기상
  [0.28, 0.43], // 05
  [0.40, 0.53], // 06 출근준비
  [0.55, 0.60], // 07 출근길
  [0.72, 0.63], // 08 오전업무 시작
  [0.88, 0.65], // 09 오전집중
  [1.00, 0.58], // 10 오전 피크
  [0.95, 0.52], // 11
  [0.55, 0.28], // 12 점심 — 급락
  [0.80, 0.63], // 13 오후 시작
  [1.00, 0.63], // 14 오후 피크
  [1.00, 0.55], // 15
  [0.88, 0.47], // 16 퇴근 준비
  [0.72, 0.37], // 17 퇴근
  [0.55, 0.38], // 18 저녁
  [0.45, 0.40], // 19
  [0.38, 0.40], // 20
  [0.32, 0.38], // 21
  [0.27, 0.36], // 22
  [0.25, 0.35], // 23
];
// 주말 (Sat-Sun) — 출퇴근 패턴 없음, 전반적으로 완만·저조
const WE = [
  [0.25, 0.35], // 00
  [0.20, 0.33], // 01
  [0.20, 0.33], // 02
  [0.20, 0.33], // 03
  [0.22, 0.37], // 04
  [0.25, 0.40], // 05
  [0.28, 0.43], // 06
  [0.35, 0.48], // 07 늦은 기상
  [0.45, 0.52], // 08
  [0.55, 0.52], // 09
  [0.60, 0.50], // 10
  [0.62, 0.50], // 11
  [0.58, 0.48], // 12
  [0.58, 0.50], // 13
  [0.62, 0.50], // 14
  [0.60, 0.50], // 15
  [0.58, 0.48], // 16
  [0.50, 0.45], // 17
  [0.44, 0.42], // 18
  [0.38, 0.40], // 19
  [0.33, 0.38], // 20
  [0.30, 0.37], // 21
  [0.26, 0.36], // 22
  [0.22, 0.35], // 23
];
function timeBand(at = Date.now()) {
  const d = new Date(at + KST);
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  return (weekend ? WE : WD)[d.getUTCHours()];
}

/** 랜덤 드리프트 1스텝 — 시간대별 실효 상한·방향 가중치 적용.
 *  - 6%:  범위 내 임의 위치로 점프 (갑작스러운 변동)
 *  - 15%: 큰 이동 ±2~4 (biasUp 방향 경향)
 *  - 79%: ±1 (biasUp 확률로 상승, 1-biasUp으로 하락) */
export function driftPresenceFloor(cur, max) {
  const m = clampMax(max);
  if (m === 0) return 0;
  const [ceilRatio, biasUp] = timeBand();
  const ceiling = Math.max(0, Math.min(m, Math.round(m * ceilRatio)));
  if (ceiling === 0) return 0;
  let v = Math.max(0, Math.min(ceiling, Math.floor(Number(cur)) || 0));
  const r = Math.random();
  if (r < 0.06) {
    return Math.floor(Math.random() * (ceiling + 1));               // 점프
  }
  if (r < 0.21) {
    const s = 2 + Math.floor(Math.random() * 3);                   // 큰 이동 ±2~4
    v += Math.random() < biasUp ? s : -s;
  } else {
    v += Math.random() < biasUp ? 1 : -1;                         // ±1
  }
  return Math.max(0, Math.min(ceiling, v));
}
/** 초기값 — 부팅 시각의 시간대 실효 상한 내 임의 위치 */
export function initialPresenceFloor(max) {
  const m = clampMax(max);
  if (m === 0) return 0;
  const [ceilRatio] = timeBand();
  const ceiling = Math.max(0, Math.min(m, Math.round(m * ceilRatio)));
  return Math.floor(Math.random() * (ceiling + 1));
}
