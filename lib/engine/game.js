/* ===================================================================
   돈버는 화장실 · game.js  — 앉아서 돈 버는 메인 로직
   Next.js 포팅: 전체 로직을 initGame()으로 감싸고, 마운트 후 클라이언트에서 1회 실행.
   반환값은 cleanup(인터벌/가짜소켓 정리) 함수.
   =================================================================== */

import { FakeToiletSocket } from "@/lib/engine/fakeSocket";
import { RealToiletSocket } from "@/lib/engine/realSocket";
import {
  WORK_CONFIG,
  SALARY_STEPS,
  DEFAULT_SALARY,
  NICK_FRONT_WORDS,
  SURNAMES,
  SURNAME_TIER_WEIGHT,
  RANK_GROUPS,
  REST_LINES,
  CONSTIPATION_LINES,
  FLUSH_BRAGS,
  ABUSE_TOAST_LINES,
  SETTINGS_LINK_MESSAGES,
  AD_CREATIVES,
  AD_ROTATE_MS,
  AD_ROTATE_START_DELAY,
  AD_INQUIRY_EMAIL,
  DONATE_KAKAO_URL,
  MAX_SESSION_SECONDS,
  maxSessionEarnCap,
  tierPercentFor,
  jitterTierPercent,
} from "@/lib/constants";
import { getVid } from "@/lib/engine/identity";
import { LS as STORAGE_KEY } from "@/lib/storageKeys";
import { isPC } from "@/lib/engine/device";
import { APP_EVENTS } from "@/lib/appEvents";
import {
  ensureReceiptSlogan,
  getReceiptSloganIndex,
  rotateReceiptSlogan,
} from "@/lib/receipt/receiptSlogan";

export function initGame() {
  // 월급(원) → 초당 수입
  const perSec = (salary) => {
    if (salary === 0) return 0;
    // 100만~500만: 50만 단위로 정확히 +1원/초(100만=1, 150만=2, ..., 500만=9)
    if (salary <= 5_000_000) return salary / 500_000 - 1;
    // 600만 이상: 기존 근무시간 기반 공식 유지
    return (
      salary /
      (WORK_CONFIG.workDaysPerMonth * WORK_CONFIG.workHoursPerDay * 3600)
    );
  };

  function weightedPick(items) {
    const total = items.reduce((s, it) => s + it.weight, 0);
    let r = Math.random() * total;
    for (const it of items) {
      if (r < it.weight) return it.value;
      r -= it.weight;
    }
    return items[items.length - 1].value;
  }
  const ALL_RANKS = RANK_GROUPS.flatMap((g) => g.ranks);
  function surnameRankCollides(surname, rank) {
    const max = Math.min(surname.length, rank.length);
    for (let len = max; len >= 1; len--) {
      if (surname.slice(-len) === rank.slice(0, len)) return true;
    }
    return false;
  }
  const pickSurname = () =>
    weightedPick(
      SURNAMES.map((s) => ({
        value: s.name,
        weight: SURNAME_TIER_WEIGHT[s.tier],
      })),
    );
  const pickRankForSurname = (surname) => {
    const candidates = ALL_RANKS.filter(
      (r) => !surnameRankCollides(surname, r),
    );
    return pick(candidates.length > 0 ? candidates : ALL_RANKS);
  };
  const randomNickname = () => {
    const surname = pickSurname();
    return `${pick(NICK_FRONT_WORDS)} ${surname}${pickRankForSurname(surname)}`.slice(
      0,
      10,
    );
  };

  /* ---------- 포맷 ---------- */
  const formatWon = (n) => Math.ceil(n).toLocaleString("ko-KR") + "원"; // n원 (₩ 없음)
  function formatDwellTime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}시간 ${m}분`;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
  }
  const formatSalary = (v) =>
    v === 0 ? "휴식중" : v >= 100_000_000 ? "1억원" : v / 10000 + "만원"; // 쉼표 없이 짧게
  const formatClock = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  function pick(a) {
    return a[Math.floor(Math.random() * a.length)];
  }
  let lastRestLineIdx = -1;
  function pickRestLine() {
    const n = REST_LINES.length;
    if (n === 0) return "";
    if (n === 1) return REST_LINES[0];
    const candidates = REST_LINES.map((_, i) => i).filter(
      (i) => i !== lastRestLineIdx,
    );
    const idx = candidates[Math.floor(Math.random() * candidates.length)];
    lastRestLineIdx = idx;
    return REST_LINES[idx];
  }
  const earnPerSecCeil = () => Math.ceil(state.earnRate); // "1초에 N원" (정수, 올림)

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    stallCount: $("stallCount"),
    stallsVal: $("stallsVal"),
    loadingBadge: $("loadingBadge"),
    offlineBadge: $("offlineBadge"),
    globalEarned: $("globalEarned"),
    globalVal: $("globalVal"),
    globalLoading: $("globalLoading"),
    globalChip: document.querySelector(".hud__global"),
    personalEarned: $("personalEarned"),
    rateLabel: $("rateLabel"),
    timer: $("timer"),
    timerVal: $("timerVal"),
    totalEarned: $("totalEarned"),
    receiptBtn: $("receiptBtn"),
    flushBtn: $("flushBtn"),
    salaryToggle: $("salaryToggle"),
    salaryLabel: $("salaryLabel"),
    salaryChangeHint: $("salaryChangeHint"),
    receiptHint: $("receiptHint"),
    salaryPanel: $("salaryPanel"),
    salaryRange: $("salaryRange"),
    salaryBig: $("salaryBig"),
    salaryRate: $("salaryRate"),
    gearBtn: $("gearBtn"),
    settingsPanel: $("settingsPanel"),
    nickInput: $("nickInput"),
    nickRandomBtn: $("nickRandomBtn"),
    nickPinChk: $("nickPinChk"),
    resetTotalBtn: $("resetTotalBtn"),
    receiptBtnSettings: $("receiptBtnSettings"),
    settingsHistoryGroup: $("settingsHistoryGroup"),
    settingsShareBtn: $("settingsShareBtn"),
    resetConfirmModal: $("resetConfirmModal"),
    resetConfirmBackdrop: $("resetConfirmBackdrop"),
    resetConfirmFlushes: $("resetConfirmFlushes"),
    resetConfirmTotal: $("resetConfirmTotal"),
    resetConfirmTime: $("resetConfirmTime"),
    resetConfirmCancel: $("resetConfirmCancel"),
    resetConfirmYes: $("resetConfirmYes"),
    donateModal: $("donateModal"),
    donateBackdrop: $("donateBackdrop"),
    donateCloseBtn: $("donateCloseBtn"),
    donateBtn: $("donateBtn"),
    devWipeAllBtn: $("devWipeAllBtn"),
    devSetTimer5950Btn: $("devSetTimer5950Btn"),
    devAddMinBtn: $("devAddMinBtn"),
    devTools: $("devTools"),
    chatForm: $("chatForm"),
    chatInput: $("chatInput"),
    chatNick: $("chatNick"),
    bubblesLeft: $("bubblesLeft"),
    bubblesRight: $("bubblesRight"),
    myFeed: $("myFeed"),
    confettiLayer: $("confettiLayer"),
    toast: $("toast"),
    adA4: $("adA4"),
    adTag: $("adTag"),
    adEmoji: $("adEmoji"),
    adBrand: $("adBrand"),
    adHead: $("adHead"),
    adSub: $("adSub"),
    settingsLinks: document.querySelectorAll(".settings__link[data-action]"),
  };

  /* ---------- 상태 ---------- */
  const state = {
    salary: DEFAULT_SALARY,
    earnRate: perSec(DEFAULT_SALARY),
    satSeconds: 0, // 앉아있는 시간(초) — 적립은 earnPerSecCeil() × satSeconds(올림 기준)
    todayDwellSec: 0, // 오늘(KST) 누적 체류(초) — 루팡 티어 산정용, 자정 리셋(물내림과 무관하게 누적)
    todayFlushCount: 0, // 오늘(KST) 물내림 횟수 — 온보딩 사다리(천장 70%)용, 자정 리셋
    personal: 0,
    global: 0, // 오늘 다같이(서버 소유)
    totalEarned: 0, // 내가 번 돈 합계(누적, 물내릴 때만 +)
    nick: "",
    nickIsAuto: true, // 자동생성 닉네임 여부(직접 입력 시 false → chatNick 클릭 재생성 비활성)
    nickPinned: false, // 닉네임 기기 저장 여부("고정" 체크)
    timer: false, // 타이머 표시
    stalls: 0, // 지금 볼일 중인 사람 수(서버) — 영수증용
    flushCount: 0, // 내 물내림 누적 횟수 — 영수증용(시간/월급 유추 불가)
    flushLifetime: 0, // 최초 접속 이후 누적 물내림 횟수(기록 초기화와 무관) — 급여명세서 버튼 최초 노출 판정용
    flushHistory: [], // 최근 물내림 Queue(최대 10건) — { n: 회차, amount: 벌은 금액, ts: 물내림 시각 }
    receiptRevealed: false, // 영수증 버튼 등장 여부(최초 1회 등장 후 로컬스토리지 영속)
    totalVisible: false, // "총 N원" 영역 표시 여부
    salaryHintDismissed: false, // 구버전 플래그(마이그레이션)
    salaryClicked: false, // 내 월급 버튼 1회 이상 클릭
  };

  // localStorage 키 — lib/storageKeys.js
  const KEY = STORAGE_KEY;
  const FLUSH_HISTORY_MAX = 10; // 명세서 표시/저장 상한
  const SALARY_HINT_DELAY = 10_000; // 최초 진입 10초 후, 미클릭 시 👈 노출
  const RECEIPT_SHOW_DELAY = 5000; // 노출대상 된 물내림 후 5초 뒤 최초 등장
  const TOTAL_REVEAL_DELAY = 5000; // 첫 물내림 후 5초 뒤 "총 N원" 등장
  const FLUSH_NUDGE_DELAY = 5000; // 물내림 후 영수증 버튼 흔들기까지 지연
  const ADAPTATION_TIME = 3000; // 진입 후 최초 적응시간(ms)
  const ENTRY_GRACE_FIRST_VISIT = 15000; // 완전 처음 들어오는 사람
  const ENTRY_GRACE_RETURNING = 10000; // 조작하다 이탈했던(미완수) 사람
  const ENTRY_GRACE_COMPLETED = 5000; // 모든 넛지를 다 완수한 사람
  const WELCOME_DELAY_MS = 3200; // 첫 방문자에게 입장 직후 따뜻한 인사 말풍선 1개를 띄우기까지 지연
  const WELCOME_LINES = [
    "오 새 사람 왔다ㅋㅋ 어서와요~",
    "옆 칸 누구 왔네ㅋㅋ 환영합니다",
    "새 월루 등장ㅋㅋ 편하게 앉으셈",
    "반가워요~ 같이 앉아서 벌어요ㅋㅋ",
  ];
  // ===== 이스터에그: 천장 형광등 =====
  const LIGHT_EASTER_TAPS = 6;
  const LIGHT_EASTER_WINDOW_MS = 10000;
  const LIGHT_EASTER_COOLDOWN_MS = 10000;
  const LIGHT_BLACKOUT_DURATION = 7000; // 암전 지속 시간
  const LIGHT_BLACKOUT_REACTION_DELAY = 2000; // 암전 후 옆 칸 놀람 반응
  const LIGHT_RECOVERY_REACTION_DELAY = 400; // 복구 후 옆 칸 안도 반응
  const LIGHT_BLACKOUT_MESSAGES = [
    "화장실 불 고장났나?",
    "형광등 꺼지면 큰 일인데",
    "왜 이렇게 형광등이 깜빡거려",
    "화장실 불이 이상하네",
  ];
  const LIGHT_RECOVERY_MESSAGES = [
    "오 다행 불 들어왔다",
    "아 깜짝 놀랐었네",
    "불꺼져서 깜빡 잠들음ㅋㅋ",
  ];
  // ===== 이스터에그: 문고리 =====
  const LATCH_EASTER_TAPS = 4; // 잠김 시작 → 짝수 4번 → 잠김 상태에서 박살
  const LATCH_EASTER_WINDOW_MS = 10000;
  const LATCH_BREAK_REACTION_DELAY = 1000; // 박살 후 옆 칸 반응
  const LATCH_BREAK_MESSAGES = [
    "왜 그래요 옆 칸 괜찮아요?",
    "옆 칸 무슨 소리났는데ㅋㅋ",
    "문고리 고장나면 못 나가~",
  ];
  // ===== 이스터에그: 휴지 =====
  const TP_MAX_PULLS = 20; // 20번 소진 시 빈 상태
  const TP_REFILL_MS = 3000; // 3초 후 리필
  const TP_FULL_R = 27; // 꽉 찬 롤 반지름
  const TP_CORE_R = 12; // 심(cardboard) 반지름
  // 물내림 후 봇 리액션 — 케이스 4분류(시간×금액)

  const TP_REFILL_MESSAGES = [
    "옆 칸님 휴지 배달왔습니다ㅋㅋ",
    "좀 아껴쓰세요ㅋㅋ 불쌍해서 휴지 드림",
    "휴지 떨어졌다길래 드립니다~",
    "휴지 아래로 전달해드려요ㅋㅋ",
    "긴급 휴지 보급 완료!",
    "다음엔 두 줄 드릴게요 걱정마세요",
  ];
  const TP_REFILL_NICKS = [
    "경영지원팀",
    "보급병",
    "구원자",
    "휴지전사",
    "와우회원",
  ];
  // ===== 개발자 도구 진입: 우상단 '오늘 다같이' 영역 20번 빠르게 클릭 =====
  const DEV_UNLOCK_TAPS = 10;
  const DEV_TAP_RESET_MS = 2000;
  const AD_TOASTS = ["떡상하면 광고 예정!", "돈버는 화장실 · moneytoilet.kr"];

  const CHAT_SPAM_WINDOW_MS = 3000; // 도배 판정 시간창: 최근 3초만 본다
  const CHAT_SPAM_MUTE_MS = 10_000; // 도배 시 10초 채팅 금지
  const CHAT_REPEAT_LIMIT = 5; // 같은 문장/비슷한 웃음·감탄류 반복 허용 상한
  const CHAT_BURST_LIMIT = 7; // 3초 안 총 채팅 허용 상한
  const CHAT_RECENT_MAX = CHAT_BURST_LIMIT; // burst 판정용으로 최근 N개까지만 기억
  let sessionStartAt = 0; // 세션 시작 시각 — 1분 경과 판정용(LS 미사용)
  // 이스터에그 상태
  let lightEasterTaps = [];
  let lightEasterLastTrigger = 0;
  let lightBlackoutMsgPool = [...LIGHT_BLACKOUT_MESSAGES];
  let lightRecoveryMsgPool = [...LIGHT_RECOVERY_MESSAGES];
  let lightBlackout = false;
  let lightBlackoutTimer = null;
  let lightReactionTimer = null;
  let lightRecoveryReactionTimer = null;
  let latchEasterTaps = [];
  let latchBroken = false;
  let latchPendingBreak = false;
  let latchRattleTimers = [];
  let latchBreakTimer = null;
  let latchReactionTimer = null;
  let latchBreakMsgPool = [...LATCH_BREAK_MESSAGES];
  let tpPullCount = 0;
  let tpEmpty = false;
  let tpRefillTimer = null;
  let tpRefillMsgPool = [...TP_REFILL_MESSAGES];
  let tpRefillNickPool = [...TP_REFILL_NICKS];

  // 개발자 도구 탭 카운터
  let devUnlockTaps = 0;
  let devUnlockTapAt = 0;
  let adToastIdx = 0;
  let adToastActive = false;
  let adToastActiveTimer = null;
  let receiptRevealScheduled = false; // 영수증 최초 등장 예약 여부(중복 방지)
  let receiptRevealQuiet = false; // 버튼 등장 전후 3초씩 봇 채팅 억제
  let receiptRevealQuietTimer = null;
  let adaptationEndTime = 0; // 최초 적응시간 종료 시각
  let salaryHintTimer = null; // 30초 후 힌트 노출 예약
  let chatMuteTimer = null;
  let chatMuteTick = null;
  // 최초 1회 내 월급/설정 팝퍼 집중 모드 — 열려있는 동안 백그라운드 채팅/글로벌 반짝임 정지
  const focusReasons = new Set();
  const isFocusPaused = () => focusReasons.size > 0;

  /* ---------- 저장/로드 ---------- */
  const LS = {
    get: (k, d) => {
      const v = localStorage.getItem(k);
      return v === null ? d : v;
    },
    set: (k, v) => localStorage.setItem(k, v),
    remove: (k) => localStorage.removeItem(k),
    getBool: (k, d = false) => LS.get(k, d ? "1" : "0") === "1",
    setBool: (k, v) => LS.set(k, v ? "1" : "0"),
  };
  function parseFlushHistory(raw) {
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .map((item) => ({
          n: Math.max(1, parseInt(item?.n, 10) || 0),
          amount: Math.max(0, Math.ceil(Number(item?.amount) || 0)),
          ts: Math.max(0, Math.floor(Number(item?.ts) || 0)),
        }))
        .filter((item) => item.n > 0)
        .slice(-FLUSH_HISTORY_MAX);
    } catch {
      return [];
    }
  }
  function saveFlushHistory() {
    LS.set(KEY.flushHistory, JSON.stringify(state.flushHistory));
  }
  function recordFlush(amount) {
    state.flushHistory.push({ n: state.flushCount, amount, ts: Date.now() });
    if (state.flushHistory.length > FLUSH_HISTORY_MAX)
      state.flushHistory.shift();
    saveFlushHistory();
  }
  function clearFlushHistory() {
    state.flushHistory = [];
    saveFlushHistory();
  }
  function loadAll() {
    // 월급
    const sv = Number(LS.get(KEY.salary, NaN));
    state.salary = SALARY_STEPS.includes(sv) ? sv : DEFAULT_SALARY;
    // 닉네임 ("고정" 체크되어 저장된 값이 있으면 그걸, 없으면 매번 새 랜덤)
    state.nickPinned = LS.getBool(KEY.nickPin);
    const savedNick = (LS.get(KEY.nick, "") || "").trim();
    state.nickIsAuto = !(state.nickPinned && savedNick);
    state.nick =
      state.nickPinned && savedNick ? savedNick.slice(0, 10) : randomNickname();
    // 합계 / 토글
    state.totalEarned = Math.max(0, Number(LS.get(KEY.total, 0)) || 0);
    state.flushCount = Math.max(
      0,
      parseInt(LS.get(KEY.flushCount, "0"), 10) || 0,
    );
    // 누적(lifetime) 물내림 — 기록 초기화로 flushCount가 0이 되어도 유지된다.
    // 구버전 유실 보정: lifetime 키가 없거나 현재 flushCount보다 작으면 flushCount로 seeding.
    const storedLifetime = parseInt(LS.get(KEY.flushLifetime, "0"), 10) || 0;
    state.flushLifetime = Math.max(0, storedLifetime, state.flushCount);
    if (state.flushLifetime !== storedLifetime) {
      LS.set(KEY.flushLifetime, state.flushLifetime);
    }
    state.flushHistory = parseFlushHistory(LS.get(KEY.flushHistory, "[]"));
    state.timer = LS.getBool(KEY.timer, false);
    state.receiptRevealed = LS.getBool(KEY.receiptRevealed);
    state.totalVisible = LS.getBool(KEY.totalVisible);
    state.salaryHintDismissed = LS.getBool(KEY.salaryHintDismissed);
    state.salaryClicked =
      LS.getBool(KEY.salaryClicked) || state.salaryHintDismissed;
    if (state.salaryClicked && !LS.getBool(KEY.salaryClicked)) {
      LS.setBool(KEY.salaryClicked, true);
    }
    // 보정: 이미 물내림 이력이 있는데 총액 노출 플래그가 빠졌으면(구버전/유실) 켜서 영속
    if (state.flushCount > 0 && !state.totalVisible) {
      state.totalVisible = true;
      LS.setBool(KEY.totalVisible, true);
    }
    loadTodayDwell(); // 오늘 루팡시간 복원(날짜 다르면 0)
    ensureReceiptSlogan();
  }

  // 1조 이상 / 물내림 10만 이상 / 히스토리 > 물내림 횟수 / 상한선 초과는 비정상
  function isStoredAbuse() {
    const cap = maxSessionEarnCap();
    const { totalEarned, flushCount, flushHistory } = state;
    if (!isFinite(totalEarned) || totalEarned < 0) return true;
    if (!isFinite(flushCount) || flushCount < 0 || flushCount > 100_000)
      return true;
    if (flushCount === 0 && totalEarned > 0) return true;
    if (flushCount > 0 && totalEarned > cap * flushCount) return true;
    if (flushHistory.length > flushCount) return true;
    for (const item of flushHistory) {
      if (item.amount > cap || item.n > flushCount) return true;
    }
    return false;
  }

  function isPersonalAbuse() {
    const cap = maxSessionEarnCap();
    if (state.personal > cap) return true;
    if (state.salary > 0) {
      const allowed =
        earnPerSecCeil() * Math.min(state.satSeconds, MAX_SESSION_SECONDS);
      if (state.personal > allowed) return true;
    }
    return false;
  }

  function handleAbuse() {
    wipeGameStats();
    resetTimer();
    renderTotal();
    renderPersonal();
    toast(pick(ABUSE_TOAST_LINES));
  }

  // 게임 기록만 초기화 (월급·닉네임·타이머 설정은 유지)
  function wipeGameStats() {
    state.totalEarned = 0;
    state.flushCount = 0;
    LS.set(KEY.total, 0);
    LS.set(KEY.flushCount, 0);
    clearFlushHistory();
    LS.remove(KEY.payslipConfirmed); // 기록 초기화 시 지급완료 도장도 다시 찍어야 함
    // 오늘 루팡시간·물내림·티어 스냅샷도 함께 삭제 — "기록 초기화"인데 등급만 살아남으면 이상하다
    state.todayDwellSec = 0;
    state.todayFlushCount = 0;
    LS.remove(KEY.todayDwell);
    LS.remove(KEY.tierSnap);
    rotateReceiptSlogan();
  }

  /* ---------- 월급 ---------- */
  function nearestStepIndex(v) {
    let bi = 0,
      bd = Infinity;
    SALARY_STEPS.forEach((s, i) => {
      const d = Math.abs(s - v);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    return bi;
  }
  function applySalary(v) {
    const idx = nearestStepIndex(v);
    v = SALARY_STEPS[idx];
    state.salary = v;
    state.earnRate = perSec(v);
    el.salaryLabel.textContent = formatSalary(v);
    el.salaryBig.textContent = formatSalary(v);
    if (v === 0) {
      el.salaryRate.textContent = "수입 0원 😌";
      el.rateLabel.textContent = "실시간 손해보는 중";
    } else {
      el.salaryRate.textContent = `1초에 약 ${earnPerSecCeil()}원`;
      el.rateLabel.textContent = `실시간 1초에 ${earnPerSecCeil().toLocaleString("ko-KR")}원 버는중`;
    }
    el.salaryRange.value = idx;
    // 커스텀 트랙 채움 비율(webkit) — thumb 위치와 정확히 맞춘다
    el.salaryRange.style.setProperty("--f", String(idx / 17));
    // thumb 위 틱은 숨기고, 지나온 구간은 짙은 녹색·남은 구간은 옅은 회색으로
    // (둘 다 투명도를 크게 줘서 흐릿하게)
    if (!el.salaryTicks || !el.salaryTicks.length)
      el.salaryTicks = document.querySelectorAll(".salary-panel__ticks span");
    el.salaryTicks.forEach((s, i) => {
      if (i === idx) {
        s.style.visibility = "hidden";
        return;
      }
      s.style.visibility = "visible";
      s.style.background =
        i < idx ? "rgba(4, 30, 20, 0.28)" : "rgba(233, 244, 238, 0.2)";
    });
    recomputePersonal(); // 지나간 시간만큼 다시 계산
    LS.set(KEY.salary, v);
  }
  function recomputePersonal() {
    state.personal = earnPerSecCeil() * state.satSeconds; // 올림된 초당 수입 기준으로 누적
    if (isPersonalAbuse()) {
      handleAbuse();
      return;
    }
    renderPersonal();
  }

  /* ---------- 표시 ---------- */
  // 애니메이션 재생(클래스 제거→리플로우→추가). clear=true면 끝난 뒤 클래스 제거.
  function replayAnim(node, cls, clear = true) {
    if (!node) return;
    node.classList.remove(cls);
    void node.offsetWidth; // 리플로우 강제 → 애니메이션 재시작
    node.classList.add(cls);
    if (clear)
      node.addEventListener("animationend", () => node.classList.remove(cls), {
        once: true,
      });
  }
  const wrapDigits = (s) =>
    s.replace(/[0-9]/g, (d) => `<span class="digit">${d}</span>`);
  let lastPersonalHtml = "";
  function renderPersonal(tick) {
    // 값이 바뀐 경우에만 innerHTML 재작성(쉬는 중 등 변화 없을 땐 reflow 생략)
    const html = wrapDigits(formatWon(state.personal)); // ₩ 대신 N원, 숫자만 고정폭
    if (html !== lastPersonalHtml) {
      el.personalEarned.innerHTML = html;
      lastPersonalHtml = html;
    }
    if (tick) replayAnim(el.personalEarned, "tick", false);
  }
  function renderGlobal(flash) {
    el.globalEarned.textContent = formatWon(state.global);
    // 최초 적응시간이 지난 후에만 애니메이션 실행
    if (flash && Date.now() >= adaptationEndTime)
      replayAnim(el.globalChip, "flash", false);
  }
  function renderTimer() {
    el.timerVal.textContent = formatClock(state.satSeconds);
  }
  function renderHistoryBtns() {
    const noRecord = state.flushCount === 0;
    el.receiptBtnSettings.disabled = noRecord;
    el.receiptBtnSettings.classList.toggle(
      "settings__btn--no-record",
      noRecord,
    );
    // 기록 초기화는 링크형(settings__link--danger) — disabled 시 CSS가 흐리게 처리
    el.resetTotalBtn.disabled = noRecord;
  }
  function renderTotal() {
    const text = `총 ${formatWon(state.totalEarned)}`;
    el.totalEarned.textContent = text;
    // 글자 수에 따라 폰트 크기 축소 (개행 방지)
    const len = text.length;
    el.totalEarned.style.fontSize =
      len <= 8 ? "11px" : len <= 10 ? "10px" : len <= 12 ? "9px" : "8px";
    // 이미 등장한 상태면 애니메이션 없이 즉시 표시
    if (state.totalVisible) {
      el.totalEarned.classList.add("deckcol__total--visible");
    }
  }
  function revealTotal() {
    if (state.totalVisible) return;
    state.totalVisible = true;
    LS.setBool(KEY.totalVisible, true);
    renderTotal(); // --visible 부여(최종 상태 opacity 1)
    replayAnim(el.totalEarned, "deckcol__total--pop"); // 최초 1회성 팝업
  }
  function nudgeReceiptBtn() {
    replayAnim($("receiptBtnIcon"), "flush-receipt__icon--nudge");
  }
  // 영수증 버튼 노출. reveal=true 면 최초 등장 연출(팝인+글로우, 토스트는 띄우지 않음)
  function updateReceiptBtnDisabled() {
    if (!el.receiptBtn || el.receiptBtn.hidden) return;
    const wasDisabled = el.receiptBtn.disabled;
    el.receiptBtn.disabled = state.totalEarned === 0;
    if (!wasDisabled && el.receiptBtn.disabled) hideReceiptHint(false);
  }
  function showReceiptBtn(reveal) {
    if (!el.receiptBtn) return;
    el.receiptBtn.hidden = false;
    updateReceiptBtnDisabled();
    if (reveal) {
      replayAnim(el.receiptBtn, "flush-receipt--reveal");
      nudgeReceiptBtn();
      setTimeout(showReceiptHint, 1200);
    }
  }
  // 최초 접속 이후 누적 물내림 2회째에 노출대상이 된다(기록 초기화로 리셋되지 않는 flushLifetime 기준).
  // 노출대상이 되면 물내림 5초 후 애니메이션으로 최초 등장(이후 KEY.receiptRevealed로 영속).
  function maybeRevealReceipt() {
    if (state.receiptRevealed || receiptRevealScheduled) return;
    if (state.flushLifetime < 2) return;
    receiptRevealScheduled = true;
    // 버튼 등장 3초 전부터 봇 채팅 억제 — 클릭 유도 넛지를 조용한 화면에서 노출
    setTimeout(
      () => {
        receiptRevealQuiet = true;
      },
      Math.max(0, RECEIPT_SHOW_DELAY - 2000),
    );
    setTimeout(() => {
      state.receiptRevealed = true;
      LS.setBool(KEY.receiptRevealed, true);
      showReceiptBtn(true);
      // 버튼이 작아 그냥 두면 못 보고 지나치기 쉬움 — 최초 등장 시 1회 안내(가독성 토스트)
      toast(
        '🧾 <span class="toast-em toast-em--gain">급여명세서</span> 버튼이 생겼어요!',
        true,
      );
      // 토스트 노출 후 3초 더 억제
      clearTimeout(receiptRevealQuietTimer);
      receiptRevealQuietTimer = setTimeout(() => {
        receiptRevealQuiet = false;
      }, 3000);
    }, RECEIPT_SHOW_DELAY);
  }
  // 급여명세서 도장을 한 번이라도 찍으면 그 즉시 영수증 버튼 노출(대기 없이)
  // 아직 안 뜬 "총 N원"이 있다면 기다리지 말고 바로 프리패스 처리한다.
  // (내 월급 👈 힌트는 salaryClicked — 사용자가 직접 눌러야 완수)
  function revealReceiptFromStamp() {
    revealTotal();
    maybeAutoShowTimer();
    focusReasons.delete("salary"); // 혹시 열려있어도 더 이상 집중모드로 막지 않음
    focusReasons.delete("settings");
    LS.setBool(KEY.salaryFocusDone, true);
    LS.setBool(KEY.settingsFocusDone, true);
    if (state.receiptRevealed || receiptRevealScheduled) return;
    receiptRevealScheduled = true;
    state.receiptRevealed = true;
    LS.setBool(KEY.receiptRevealed, true);
    showReceiptBtn(true);
  }

  /* ---------- 적립: 1초마다 ---------- */
  let tickInterval = null;
  function startTicker() {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
      const wasCapped = state.satSeconds >= MAX_SESSION_SECONDS;
      if (!wasCapped) {
        state.satSeconds += 1;
        creditTodayDwell(1); // 오늘 루팡시간 동행 — 60분 동결 중엔 함께 멈춤(수동 물내림 유도 유지)
      }
      // 60분 도달 시 타이머/적립 동결(59:59 고정) — 강제 물내림 대신 수동 물내림 유도
      const capped = state.satSeconds >= MAX_SESSION_SECONDS;
      state.personal =
        earnPerSecCeil() * Math.min(state.satSeconds, MAX_SESSION_SECONDS);
      if (isPersonalAbuse()) {
        handleAbuse();
        return;
      }
      renderPersonal(state.salary > 0 && state.satSeconds % 5 === 0); // 5초에 한 번만 심장박동(틱)
      if (state.timer) renderTimer();
      if (capped && !wasCapped) onTimerCapped(); // 60분 경계 진입 — 경고 UI 켜기
      persistSatSeconds(); // 자리비움 보상 계산용 — 매 틱 영속
    }, 1000);
  }
  startTicker();

  // 자리비움 보상 계산용 영속 — satSeconds(적립 기준 경과초)와 마지막 활동 시각
  function persistSatSeconds() {
    LS.set(KEY.satSeconds, String(state.satSeconds));
    LS.set(KEY.lastSeenAt, String(Date.now()));
  }

  /* ---------- 오늘 루팡시간(KST 자정 리셋) — 루팡 티어 산정용 누산기 ----------
     satSeconds(세션 타이머·물내림 시 0)와 별개로, satSeconds가 늘어난 만큼 같이 늘고
     물내림에도 유지된다. 날짜(KST)가 바뀌면 0부터 다시 — "오늘의 월급루팡 상위 N%". */
  const DAY_MAX_DWELL_SEC = 86_400; // 위조 방어용 상한(하루는 24시간)
  const kstDateKey = () =>
    new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  let todayKey = kstDateKey();

  function loadTodayDwell() {
    todayKey = kstDateKey();
    try {
      const raw = JSON.parse(LS.get(KEY.todayDwell, "null"));
      if (raw && raw.d === todayKey) {
        state.todayDwellSec = Math.min(
          DAY_MAX_DWELL_SEC,
          Math.max(0, Math.floor(Number(raw.s) || 0)),
        );
        state.todayFlushCount = Math.max(0, Math.floor(Number(raw.f) || 0));
        return;
      }
    } catch {}
    state.todayDwellSec = 0;
    state.todayFlushCount = 0;
  }
  function persistTodayDwell() {
    LS.set(
      KEY.todayDwell,
      JSON.stringify({
        d: todayKey,
        s: state.todayDwellSec,
        f: state.todayFlushCount,
      }),
    );
  }
  // 자정(KST) 경과 시 오늘 누산기 리셋 — 세션을 걸쳐도 조용히 끊는다(델타는 상승 시에만 표시라 무해)
  function rolloverTodayIfNeeded() {
    const nowKey = kstDateKey();
    if (nowKey === todayKey) return;
    todayKey = nowKey;
    state.todayDwellSec = 0;
    state.todayFlushCount = 0;
  }
  // satSeconds가 늘어나는 모든 지점(틱/부재보상/가시성 복귀)에서 같은 양만큼 호출
  function creditTodayDwell(sec) {
    if (sec <= 0) return;
    rolloverTodayIfNeeded();
    state.todayDwellSec = Math.min(
      DAY_MAX_DWELL_SEC,
      state.todayDwellSec + sec,
    );
    persistTodayDwell();
  }
  // 물내림 1회 — 온보딩 사다리 카운터(commitFlush에서 스냅샷 직전에 호출해 이번 물내림도 포함)
  function bumpTodayFlush() {
    rolloverTodayIfNeeded();
    state.todayFlushCount += 1;
    persistTodayDwell();
  }

  /* ---------- 루팡 티어 스냅샷 — 물내림 시점에 고정(명세서 도장·델타의 단일 근거) ---------- */
  // 시드된 ±1 오차 — 같은 사람·같은 날·같은 기본값이면 항상 같은 결과(렌더 간 흔들림 없음).
  // 시드에 base를 포함해 동일 base가 항상 동일 오차를 받아 단조 감소(역전 불가)가 보장된다.
  function tierWithJitter() {
    const base = tierPercentFor(state.todayDwellSec, state.todayFlushCount);
    return jitterTierPercent(base, `${getVid()}|${todayKey}|${base}`);
  }
  function readTierSnap() {
    try {
      const raw = JSON.parse(LS.get(KEY.tierSnap, "null"));
      if (raw && typeof raw.p === "number") return raw;
    } catch {}
    return null;
  }
  function snapshotTier() {
    const p = tierWithJitter();
    const prev = readTierSnap();
    const prevP = prev && prev.d === todayKey ? prev.p : null;
    LS.set(KEY.tierSnap, JSON.stringify({ d: todayKey, p, prevP }));
  }
  // 명세서용 현재 티어 — 오늘 스냅샷이 있으면 그 값(도장 버전과 동기),
  // 없으면(새 날 첫 조회·구버전 이력) 현재 체류 기준 즉석 산정 + 델타 없음
  function currentTierInfo() {
    const snap = readTierSnap();
    if (snap && snap.d === kstDateKey())
      return { p: snap.p, prevP: snap.prevP ?? null };
    return { p: tierWithJitter(), prevP: null };
  }

  // 부팅 시 1회 — 마지막 활동 시각 이후 흐른 시간을 자리비움 보상으로 satSeconds에 반영.
  // 1분 미만은 새로고침 등 즉시 재진입으로 보고 보상 없이 그대로 이어감(기존 satSeconds 유지).
  const AWAY_CREDIT_MIN_SEC = 60;
  function restoreAwayProgress() {
    const storedSat = Math.min(
      MAX_SESSION_SECONDS,
      Math.max(0, parseInt(LS.get(KEY.satSeconds, "0"), 10) || 0),
    );
    const lastSeenAt = Number(LS.get(KEY.lastSeenAt, "0")) || 0;
    const awaySec =
      lastSeenAt > 0 ? Math.floor((Date.now() - lastSeenAt) / 1000) : 0;

    // 부재중 적립은 '물내림 1회 이상' 경험자에게만 적용한다. 뉴비가 깜빡하고 나갔다
    // 다시 들어왔는데 시간이 MAX로 차 있으면 이상하므로, 미경험자는 보상 없이 그대로 이어감.
    if (state.flushCount < 1 || awaySec < AWAY_CREDIT_MIN_SEC) {
      state.satSeconds = storedSat; // 새로고침/미경험자 — 보상 없이 그대로 이어서 표시
      state.personal = earnPerSecCeil() * state.satSeconds;
      // 동결 중에 새로고침한 경우 — 틱의 false→true 전환 감지로는 안 잡히니 직접 복원
      if (storedSat >= MAX_SESSION_SECONDS) setTimerCapped(true);
      return;
    }

    const newSat = Math.min(storedSat + awaySec, MAX_SESSION_SECONDS);
    const creditedSec = newSat - storedSat;
    state.satSeconds = newSat;
    state.personal = earnPerSecCeil() * state.satSeconds;
    creditTodayDwell(creditedSec); // 부재중 적립분만큼 오늘 루팡시간도 반영
    if (creditedSec <= 0) return;

    if (newSat >= MAX_SESSION_SECONDS) {
      setTimerCapped(true);
      revealTimer();
      toast(
        '⏰ 자리 비운 사이 <span class="toast-em toast-em--max">MAX</span> 달성!',
        true,
      );
    } else if (awaySec >= 300) {
      // 5분 이상 자리비움 시에만 토스트
      const awayMin = Math.max(1, Math.round(awaySec / 60));
      revealTimer();
      toast(
        `💰 부재중 자동 적립! <span class="toast-em toast-em--gain">+${awayMin}분</span>`,
        true,
      );
    }
  }

  /* ---------- 물내리기 = 정산 ---------- */
  function meName() {
    return `${state.nick} (나)`;
  }

  function resetTimer() {
    state.satSeconds = 0;
    state.personal = 0;
    renderPersonal();
    if (state.timer) renderTimer();
    startTicker(); // 물내린 시점을 새 0초 기준으로 다시 맞춤 (틱 위상 리셋)
    persistSatSeconds(); // 물내림으로 0초가 됐다는 걸 즉시 영속(자리비움 보상이 옛 값을 다시 살리지 않게)
  }

  /* ---------- 물내리기 연타 방지 (5초 쿨다운, 수위 차오름) ---------- */
  const FLUSH_COOLDOWN = 5000;
  const flushFill = $("flushFill");
  const flushLabel = $("flushLabel");
  function startFlushCooldown() {
    el.flushBtn.disabled = true;
    el.flushBtn.classList.add("flush--cooldown");
    flushLabel.textContent = "";
    const start = Date.now();
    const iv = setInterval(() => {
      const ratio = Math.min(1, (Date.now() - start) / FLUSH_COOLDOWN);
      flushFill.style.height = `${ratio * 100}%`;
      if (ratio >= 1) {
        clearInterval(iv);
        el.flushBtn.disabled = false;
        el.flushBtn.classList.remove("flush--cooldown");
        flushFill.style.height = "0%";
        flushLabel.textContent = "물내리기";
      }
    }, 100);
  }

  // 물내림 정산 공통 — 적립액(amount)을 누적/저장하고 연출까지 처리.
  // chatText: 내 채팅 피드에 띄울 멘트(null이면 기본 자랑 멘트). capped: 60분 동결 후 물내림이면 true(연출 강화).
  function commitFlush(amount, chatText, capped) {
    const cap = maxSessionEarnCap();
    const devMode = LS.getBool(KEY.devToolsUnlocked);
    if (
      !devMode &&
      (amount > cap ||
        state.totalEarned + amount > cap * (state.flushCount + 1))
    ) {
      handleAbuse();
      return;
    }
    const isFirstFlush = state.flushCount === 0;
    state.totalEarned += amount;
    LS.set(KEY.total, state.totalEarned);
    renderTotal();
    updateReceiptBtnDisabled();
    state.flushCount += 1;
    LS.set(KEY.flushCount, state.flushCount);
    // 누적(lifetime) 물내림 — 기록 초기화와 무관하게 계속 증가(급여명세서 버튼 노출 판정용)
    state.flushLifetime += 1;
    LS.set(KEY.flushLifetime, state.flushLifetime);
    if (isFirstFlush) renderHistoryBtns(); // 첫 물내림 — disabled 해제
    LS.remove(KEY.payslipConfirmed); // 새 명세서 버전 — 도장 연출 다시 필요
    maybeRevealReceipt(); // 최초 접속 이후 누적 2회 물내림이면 노출
    recordFlush(amount);
    bumpTodayFlush(); // 이번 물내림을 온보딩 카운터에 반영(스냅샷보다 먼저 — 1회차부터 92% 보장)
    rotateReceiptSlogan();
    setTimerCapped(false); // 동결 해제(있었다면)
    resetTimer();
    confettiBurst(capped ? { count: 60, duration: 3600 } : undefined);
    flushSound();
    socket.flush(
      amount,
      true,
      chatText || (capped ? pick(CONSTIPATION_LINES)(formatWon(amount)) : null),
      capped ? "capped" : undefined,
    );
    startFlushCooldown();
    // 첫 물내림 5초 후 "총 N원" 영역 표시
    if (isFirstFlush) setTimeout(revealTotal, TOTAL_REVEAL_DELAY);
    // 물내릴 때마다 급여명세서 버튼 흔들기 (버튼이 보여지는 경우에만, 5초 후)
    if (!el.receiptBtn.hidden) setTimeout(nudgeReceiptBtn, FLUSH_NUDGE_DELAY);
  }

  // 수동 물내림(버튼)
  function flush() {
    if (el.flushBtn.disabled) return;
    if (state.salary === 0) return void toast(pickRestLine());
    const amount = Math.ceil(state.personal);
    if (amount < 1) return;
    const capped = state.satSeconds >= MAX_SESSION_SECONDS;
    commitFlush(amount, null, capped);
  }

  // 60분 도달 — 강제 물내림 대신 타이머/적립 동결 + 경고 UI로 수동 물내림 유도
  function onTimerCapped() {
    setTimerCapped(true);
    toast(
      '⏰ <span class="toast-em toast-em--max">1시간</span>을 꽉 채웠습니다!',
      true,
    );
  }
  function setTimerCapped(on) {
    state.timerCapped = on;
    el.timerVal?.parentElement?.classList.toggle("deckcol__timer--warning", on);
    el.flushBtn?.classList.toggle("flush-btn--urgent", on);
  }

  /* ---------- 물내림 컨페티 (돈/돈다발/💸 쏟아짐) ---------- */
  const CONFETTI_DURATION = 2000;
  const CONFETTI_EMOJIS = ["💰", "💵", "🪙"];
  const CONFETTI_EMOJIS_CAPPED = ["💰", "💵", "🪙", "🎉", "🚽", "✨"]; // 1시간 동결 후 물내림 — 더 화려하게
  function confettiBurst(opts) {
    const count = opts?.count ?? 18;
    const duration = opts?.duration ?? CONFETTI_DURATION;
    const emojis = opts?.count ? CONFETTI_EMOJIS_CAPPED : CONFETTI_EMOJIS;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const c = document.createElement("div");
      c.className = "confetti";
      c.textContent = pick(emojis);
      c.style.left = Math.random() * 100 + "%";
      c.style.animationDuration = 1 + Math.random() * 1.1 + "s";
      c.style.animationDelay = Math.random() * (duration - 800) + "ms";
      frag.appendChild(c);
    }
    el.confettiLayer.appendChild(frag);
    setTimeout(() => {
      el.confettiLayer.innerHTML = "";
    }, duration + 1200);
  }

  /* ---------- 물내림 자랑 멘트 ---------- */
  const flushBrag = (amount) => pick(FLUSH_BRAGS)(formatWon(amount));

  /* ---------- 공통 ---------- */
  const safe = (s) =>
    String(s).replace(
      /[<>&]/g,
      (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c],
    );

  /* ---------- 옆칸 말풍선 — 좌/우 벽, 꼬리, 겹침 회피, 방향 기억, 슬롯 관리 ---------- */
  const BUBBLE_DURATION = 5200;
  const ADMIN_BUBBLE_DURATION = 8000; // 관리자 공지는 더 오래 노출
  const BUBBLE_SIDE_TTL = 3 * 60 * 1000; // 3분간 동일 방향 유지
  const userSideMap = {}; // name -> { side, ts } — 같은 사람은 같은 쪽에서 나오게
  const userBubbles = {}; // name -> { flush: el|undefined, chat: el|undefined }

  // 도배 방어(표시단): 같은 사람이 BUBBLE_MICRO_TICK_MS보다 빨리 연타하면 '앞엣것은 버리고'
  // 윈도우 끝에 최신 1건만 렌더한다. 연타로 인한 버블 깜빡임/도배를 흡수.
  const BUBBLE_MICRO_TICK_MS = 450;
  const bubbleLastShownAt = {}; // name -> 마지막 실제 렌더 시각
  const bubblePending = {}; // name -> { msg, forceSide, timer } (대기 중 최신 메시지)

  // 유저별 방향 결정 — 기억된 방향 우선, 해당 레이어 꽉 찼으면 반대쪽 허용(기억은 유지)
  function getSideForUser(name) {
    const now = Date.now();
    const entry = userSideMap[name];
    if (entry && now - entry.ts < BUBBLE_SIDE_TTL) {
      const preferred = entry.side;
      const prefLayer = preferred === "left" ? el.bubblesLeft : el.bubblesRight;
      if (prefLayer.children.length < 3) return preferred;
      const other = preferred === "left" ? "right" : "left";
      const otherLayer = other === "left" ? el.bubblesLeft : el.bubblesRight;
      return otherLayer.children.length < 3 ? other : preferred;
    }
    // 새로 배정 — 덜 붐비는 쪽
    const lc = el.bubblesLeft.children.length;
    const rc = el.bubblesRight.children.length;
    const side =
      lc < rc
        ? "left"
        : rc < lc
          ? "right"
          : Math.random() < 0.5
            ? "left"
            : "right";
    userSideMap[name] = { side, ts: now };
    return side;
  }

  // 말풍선 슬롯 — flush/capped 는 "flush", 그 외는 "chat". 같은 유저의 두 슬롯은 공존하도록
  // 설계돼 있으므로(renderBubble 참조) 코얼레싱도 슬롯별로 분리해야 한쪽이 사라지지 않는다.
  const bubbleSlotOf = (msg) =>
    msg.kind === "flush" || msg.kind === "capped" ? "flush" : "chat";
  const bubbleKeyOf = (msg) => msg.name + "\u0000" + bubbleSlotOf(msg);

  // 도배 방어 래퍼 — 같은 사람·같은 슬롯의 미세 연타는 앞엣것을 버리고 최신만 윈도우 끝에 1회 렌더.
  // 관리자 공지는 중요·드물어서 코얼레싱 없이 즉시 렌더.
  function showBubble(msg, forceSide) {
    if (msg.kind === "admin") return renderBubble(msg, forceSide);
    const key = bubbleKeyOf(msg);
    const pending = bubblePending[key];
    if (pending) {
      // 이미 대기 중 — 같은 슬롯의 앞엣것만 무시하고 최신 메시지로 교체
      pending.msg = msg;
      pending.forceSide = forceSide;
      return;
    }
    const gap = Date.now() - (bubbleLastShownAt[key] || 0);
    if (gap < BUBBLE_MICRO_TICK_MS) {
      bubblePending[key] = {
        msg,
        forceSide,
        timer: setTimeout(() => {
          const p = bubblePending[key];
          delete bubblePending[key];
          if (p) renderBubble(p.msg, p.forceSide);
        }, BUBBLE_MICRO_TICK_MS - gap),
      };
      return;
    }
    renderBubble(msg, forceSide);
  }

  function renderBubble(msg, forceSide) {
    bubbleLastShownAt[bubbleKeyOf(msg)] = Date.now();
    let side;
    if (forceSide) {
      side = forceSide;
      userSideMap[msg.name] = { side, ts: Date.now() };
    } else {
      side = getSideForUser(msg.name);
    }
    const layer = side === "left" ? el.bubblesLeft : el.bubblesRight;

    // 슬롯: flush/capped → "flush", 나머지 → "chat"
    // 같은 유저는 슬롯당 1개만 — 새 것이 오면 기존 것 먼저 제거
    const slot =
      msg.kind === "flush" || msg.kind === "capped" ? "flush" : "chat";
    const prev = userBubbles[msg.name]?.[slot];
    if (prev && prev.parentNode) prev.remove();

    const kindCls =
      msg.kind === "capped"
        ? " bubble--capped"
        : msg.kind === "flush"
          ? " bubble--flush"
          : msg.kind === "admin"
            ? " bubble--admin"
            : "";
    const b = document.createElement("div");
    b.className = "bubble" + kindCls;
    const label =
      msg.kind === "capped"
        ? "💩 " + safe(msg.name)
        : msg.kind === "admin"
          ? "⚠️ " + safe(msg.name)
          : safe(msg.name);
    const nameRow = msg.isBot
      ? `<b style="display:flex;align-items:center;gap:3px">${label}<span style="font-size:.95em;line-height:1;opacity:.62;filter:grayscale(1)">🤖</span></b>`
      : `<b>${label}</b>`;
    b.innerHTML = `${nameRow}${safe(msg.text)}`;

    if (!userBubbles[msg.name]) userBubbles[msg.name] = {};
    userBubbles[msg.name][slot] = b;

    layer.appendChild(b);
    while (layer.children.length > 3) layer.removeChild(layer.firstChild);
    placeBubble(layer, b); // 높이(1~2줄) 측정 후 안 겹치게 배치

    const duration =
      msg.kind === "admin" ? ADMIN_BUBBLE_DURATION : BUBBLE_DURATION;
    setTimeout(() => {
      b.remove();
      if (userBubbles[msg.name]?.[slot] === b)
        delete userBubbles[msg.name][slot];
    }, duration);
  }
  // 같은 쪽에 이미 떠있는 말풍선과 최대한 안 겹치는 top(px) 찾기
  function placeBubble(layer, b) {
    const H = layer.clientHeight,
      h = b.offsetHeight,
      maxTop = Math.max(0, H - h);
    const occ = [...layer.children]
      .filter((x) => x !== b && x.style.top)
      .map((x) => {
        const t = parseFloat(x.style.top) || 0;
        return [t, t + x.offsetHeight];
      });
    let best = 0,
      bestOv = Infinity;
    for (let t = 0; t <= maxTop; t += 6) {
      let ov = 0;
      for (const [a, c] of occ) {
        const o = Math.min(t + h, c) - Math.max(t, a);
        if (o > 0) ov += o;
      }
      if (ov === 0) {
        best = t;
        bestOv = 0;
        break;
      }
      if (ov < bestOv) {
        bestOv = ov;
        best = t;
      }
    }
    b.style.top = best + "px";
  }

  /* ---------- 내 채팅/정산 피드 (덱 바로 위, 1개 유지·밀려 사라짐, 기본 5초 노출)
   kind: 'chat'(직접 채팅, 민트) | 'flush'(물내림, 노랑) ---------- */
  const MY_MSG_DURATION = 5000;
  function showMyMessage(text, kind = "chat") {
    // 기존 것 위로 밀어내기
    [...el.myFeed.children].forEach((old) => {
      old.classList.add("myfeed__msg--out");
      setTimeout(() => old.remove(), 500);
    });
    const m = document.createElement("div");
    m.className = "myfeed__msg myfeed__msg--" + kind;
    m.innerHTML = `<b>${safe(meName())}</b>${safe(text)}`;
    el.myFeed.appendChild(m);
    setTimeout(() => {
      m.classList.add("myfeed__msg--out");
      setTimeout(() => m.remove(), 500);
    }, MY_MSG_DURATION);
  }

  /* ---------- 토스트: 부드럽게 등장/퇴장, 5초 후 자동 사라짐, 클릭 시 즉시 사라짐 ----------
     hidden 토글은 즉시 사라져 '딱' 끊기므로, 표시는 .toast--show 클래스로 트랜지션을 태우고
     숨길 땐 클래스를 떼 퇴장 애니메이션을 재생한 뒤 한 박자 늦게 hidden 처리한다. */
  const TOAST_DURATION = 5000;
  const TOAST_EXIT_MS = 320; // CSS transition 시간과 맞춤
  let toastTimer, toastExitTimer;
  // asHtml=true면 색상 강조 스팬 등 마크업 허용(전부 내부 하드코딩 문자열이라 안전).
  function toast(text, asHtml = false) {
    clearTimeout(toastTimer);
    clearTimeout(toastExitTimer);
    if (asHtml) el.toast.innerHTML = text;
    else el.toast.textContent = text;
    el.toast.hidden = false;
    // display 복귀 직후 리플로우를 강제해야 opacity/transform 트랜지션이 처음부터 재생됨
    void el.toast.offsetWidth;
    el.toast.classList.add("toast--show");
    toastTimer = setTimeout(hideToast, TOAST_DURATION);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    if (el.toast.hidden) return;
    el.toast.classList.remove("toast--show"); // 퇴장 트랜지션 재생
    clearTimeout(toastExitTimer);
    toastExitTimer = setTimeout(() => {
      el.toast.hidden = true;
    }, TOAST_EXIT_MS);
  }
  // 토스트가 떠 있을 때 사용자가 "스스로 액션"을 하면 사라진다:
  //  - 어디든 클릭/탭 (모바일·태블릿·PC 공통: pointerdown)
  //  - 키 입력(채팅 타이핑/엔터 전송 등: keydown)
  // 캡처 단계로 듣고, 토스트를 띄우는 그 클릭 시점엔 아직 toast.hidden===true 라
  // 자기 자신 때문에 즉시 닫히지 않는다(다음 액션부터 닫힘).
  const dismissToastOnUserAction = () => {
    if (el.toast && !el.toast.hidden) hideToast();
  };
  document.addEventListener("pointerdown", dismissToastOnUserAction, true);
  document.addEventListener("keydown", dismissToastOnUserAction, true);
  // 토스트는 .bottom(덱+채팅) 바로 위에 뜨도록 .bottom 높이를 CSS 변수로 추적
  const bottomEl = document.querySelector(".bottom");
  let bottomRO;
  if (bottomEl && "ResizeObserver" in window) {
    const setBottomH = () =>
      document.documentElement.style.setProperty(
        "--bottom-h",
        bottomEl.offsetHeight + "px",
      );
    setBottomH();
    bottomRO = new ResizeObserver(setBottomH);
    bottomRO.observe(bottomEl);
  }

  /* ---------- 채팅 도배 방지 ---------- */
  const chatGuard = {
    mutedUntil: 0,
    recentMessages: [], // [{ text, norm, at }]
    defaultPlaceholder: el.chatInput?.placeholder || "옆 칸 모두에게 한마디...",
  };
  // 공백 장난 / 구두점 / 과한 반복문자를 눌러서 같은 말로 묶기 쉽게 만든다.
  function normalizeChatText(text) {
    return String(text)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[!?.~,^"'`]/g, "")
      .replace(/([가-힣a-z0-9])\s+([가-힣a-z0-9])/gi, "$1$2")
      .replace(/(.)\1{2,}/g, "$1")
      .trim();
  }

  // 짧은 웃음/감탄류는 일반 문장과 따로 묶어서 본다.
  function classifyShortPattern(text) {
    const norm = normalizeChatText(text);
    if (!norm || norm.length > 6) return "";
    if (/^[ㅋㅎ]+$/.test(norm)) return "laugh";
    if (/^[ㄷㅌ]+$/.test(norm)) return "react";
    if (/^(하)+$/.test(norm)) return "laugh";
    if (/^(오|와|헐)+$/.test(norm)) return "react";
    return "";
  }

  function setChatMuted(muted, message) {
    if (muted) {
      el.chatInput.value = "";
      el.chatInput.placeholder = message;
      return;
    }
    el.chatInput.placeholder = chatGuard.defaultPlaceholder;
  }

  function renderChatMutePlaceholder() {
    const leftMs = Math.max(0, chatGuard.mutedUntil - Date.now());
    const leftSec = Math.max(1, Math.ceil(leftMs / 1000));
    setChatMuted(true, `${leftSec}초 후 채팅 가능 😌`);
  }

  // 도배가 걸리면 입력창/전송 버튼을 10초간 잠근다.
  function muteChat() {
    const now = Date.now();
    chatGuard.mutedUntil = now + CHAT_SPAM_MUTE_MS;
    clearTimeout(chatMuteTimer);
    clearInterval(chatMuteTick);
    renderChatMutePlaceholder();
    chatMuteTick = setInterval(renderChatMutePlaceholder, 1000);
    chatMuteTimer = setTimeout(() => {
      chatGuard.mutedUntil = 0;
      clearInterval(chatMuteTick);
      chatMuteTick = null;
      setChatMuted(false);
    }, CHAT_SPAM_MUTE_MS);
  }

  // 최근 3초 내 직접 입력한 채팅만 짧게 유지한다.
  function rememberChatMessage(text, at) {
    chatGuard.recentMessages.push({
      text,
      norm: normalizeChatText(text),
      kind: classifyShortPattern(text),
      at,
    });
    chatGuard.recentMessages = chatGuard.recentMessages
      .filter((item) => at - item.at <= CHAT_SPAM_WINDOW_MS)
      .slice(-CHAT_RECENT_MAX);
  }

  // 도배 기준은 딱 두 가지:
  // 1) 3초 안에 채팅 CHAT_BURST_LIMIT번
  // 2) 3초 안에 같은 문장 또는 비슷한 웃음/감탄류 CHAT_REPEAT_LIMIT번
  function shouldBlockChat(text) {
    const now = Date.now();
    if (chatGuard.mutedUntil > now) {
      return {
        blocked: true,
        mute: false,
      };
    }

    const norm = normalizeChatText(text);
    const kind = classifyShortPattern(text);
    const recent3s = chatGuard.recentMessages.filter(
      (item) => now - item.at <= CHAT_SPAM_WINDOW_MS,
    );

    if (recent3s.length >= CHAT_BURST_LIMIT - 1) {
      return {
        blocked: true,
        reason: `3초 안에 채팅을 ${CHAT_BURST_LIMIT}번 보내서 10초간 채팅 금지예요`,
        mute: true,
      };
    }

    const sameCount =
      recent3s.filter((item) => item.norm && item.norm === norm).length + 1;
    const sameKindCount =
      kind === ""
        ? 0
        : recent3s.filter((item) => item.kind && item.kind === kind).length + 1;
    if (sameCount >= CHAT_REPEAT_LIMIT || sameKindCount >= CHAT_REPEAT_LIMIT) {
      return {
        blocked: true,
        reason: `3초 안에 같은 문장이나 비슷한 웃음/감탄을 ${CHAT_REPEAT_LIMIT}번 반복해서 10초간 채팅 금지예요`,
        mute: true,
      };
    }

    return { blocked: false };
  }

  /* ---------- 효과음 (물내림 시 현금 사운드 1종만) ---------- */
  let flushAudio;
  function flushSound() {
    try {
      if (!flushAudio) {
        flushAudio = new Audio("/sound/moneytoilet-cash-sound.mp3");
        flushAudio.preload = "auto";
      }
      flushAudio.currentTime = 0; // 연속 물내림에도 처음부터 재생
      const p = flushAudio.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) {}
  }

  /* ---------- A4 광고 데모 ---------- */
  let adIdx = 0;
  let currentAdCreative = AD_CREATIVES[0];
  function rotateAd() {
    currentAdCreative = AD_CREATIVES[adIdx++ % AD_CREATIVES.length];
    // 브랜드 포스터(광고 공석)일 땐 이모지 대신 로고 이미지를 가운데 노출.
    const isBrand = !!currentAdCreative.brand;
    el.adA4.classList.toggle("ad-a4--brand", isBrand);
    if (el.adBrand) el.adBrand.hidden = !isBrand;
    el.adEmoji.hidden = isBrand;
    // 제휴링크(url)가 걸린 크리에이티브는 "광고"로 표시(대가성 고지). 그 외엔 기존 태그.
    el.adTag.textContent = (currentAdCreative.url || "").trim()
      ? "광고"
      : currentAdCreative.tag;
    el.adEmoji.textContent = currentAdCreative.emoji;
    el.adHead.textContent = currentAdCreative.head;
    el.adSub.innerHTML = currentAdCreative.sub.replace(/\n/g, "<br>");
  }

  // 진입 그레이스 타임 산정 — 완전 처음(15s) / 조작하다 이탈한 미완수자(10s) / 핵심 액션을 다 완수한 사람(5s)
  function computeEntryGraceMs() {
    const firstVisitEver = !LS.getBool(KEY.everVisited);
    LS.setBool(KEY.everVisited, true);
    if (firstVisitEver) return ENTRY_GRACE_FIRST_VISIT;
    // "위 사실이 틀림없음을 확인합니다"(심화과정)는 제외 — 나머지는 부수적으로 따라옴
    const completedAll =
      state.totalVisible && state.receiptRevealed && state.salaryClicked;
    return completedAll ? ENTRY_GRACE_COMPLETED : ENTRY_GRACE_RETURNING;
  }

  /* ---------- 볼일 중 영역 — 3단계 상태 관리 ----------
     loading : 초기 진입 또는 재연결 대기 중 (···)
     count   : 정상 연결, 실제 인원 표시
     offline : 8초 이상 복구 없을 때 (연결 끊김)  */
  let stallsOfflineTimer = null;
  function showStallsLoading() {
    if (stallsOfflineTimer) {
      clearTimeout(stallsOfflineTimer);
      stallsOfflineTimer = null;
    }
    if (el.stallsVal) el.stallsVal.hidden = true;
    if (el.offlineBadge) el.offlineBadge.hidden = true;
    if (el.loadingBadge) el.loadingBadge.hidden = false;
  }
  function showStallsCount() {
    if (stallsOfflineTimer) {
      clearTimeout(stallsOfflineTimer);
      stallsOfflineTimer = null;
    }
    if (el.loadingBadge) el.loadingBadge.hidden = true;
    if (el.offlineBadge) el.offlineBadge.hidden = true;
    if (el.stallsVal) el.stallsVal.hidden = false;
  }
  function showStallsOffline() {
    stallsOfflineTimer = null;
    if (el.loadingBadge) el.loadingBadge.hidden = true;
    if (el.stallsVal) el.stallsVal.hidden = true;
    if (el.offlineBadge) el.offlineBadge.hidden = false;
  }

  /* ---------- 오늘 다같이(global) 영역 — 첫 값 도착 전엔 로딩(···), 도착 시 1회 페이드인 ----------
     "0원"을 먼저 보여줬다가 실제값으로 튀는 갑툭튀를 없애기 위해 로딩→값 전환을 부드럽게. */
  function showGlobalLoading() {
    if (el.globalVal) el.globalVal.hidden = true;
    if (el.globalLoading) el.globalLoading.hidden = false;
  }
  function showGlobalValue() {
    if (el.globalLoading) el.globalLoading.hidden = true;
    if (el.globalVal) el.globalVal.hidden = false;
  }
  // 최초 등장 1회만 hud-reveal 페이드인 재생(이후엔 숫자만 제자리 갱신)
  function playRevealOnce(node) {
    if (!node) return;
    node.classList.add("hud-reveal");
  }
  let firstPresenceShown = false;
  let firstGlobalShown = false;
  function revealStallsOnce() {
    if (firstPresenceShown) return;
    firstPresenceShown = true;
    playRevealOnce(el.stallsVal);
  }
  function revealGlobalOnce() {
    if (firstGlobalShown) return;
    firstGlobalShown = true;
    showGlobalValue();
    playRevealOnce(el.globalVal);
  }

  /* ---------- 소켓 ----------
     NEXT_PUBLIC_RT=1 이면 진짜 백엔드(RealToiletSocket), 아니면 가짜(개발/오프라인). */
  const useReal = process.env.NEXT_PUBLIC_RT === "1";
  const socket = useReal
    ? new RealToiletSocket({ getNick: () => state.nick })
    : new FakeToiletSocket();
  socket.on("presence", ({ count }) => {
    state.stalls = count;
    el.stallCount.textContent = count;
    showStallsCount();
    revealStallsOnce();
  });
  socket.on("global", ({ total }) => {
    state.global = total;
    renderGlobal();
    revealGlobalOnce();
  });
  socket.on("dayReset", ({ total }) => {
    // 자정 롤오버 — 'global' 단독 푸시로는 스냅처럼 보이므로 안내 토스트와 함께 초기화
    state.global = total;
    renderGlobal();
    revealGlobalOnce();
    toast("🌙 자정이 지나 오늘의 합계가 초기화됐어요");
  });
  socket.on("chat", (msg) => {
    if (msg.kind === "system") return; // 입장 알림: 기능만 유지, 표시 보류
    if (msg.kind === "me") {
      showMyMessage(msg.text, "chat");
      return;
    } // 내 채팅 → 덱 위 피드(민트)
    if (msg.kind !== "admin" && isFocusPaused()) return; // 팝퍼 집중 모드 — 관리자 공지는 예외
    if (msg.kind === "bot" && receiptRevealQuiet) return; // 영수증 넛지 조용히
    showBubble({
      name: msg.name,
      text: msg.text,
      kind: msg.kind === "bot" ? undefined : msg.kind, // 봇은 스타일 없이 일반 말풍선과 동일
      isBot: msg.kind === "bot",
    });
  });
  socket.on("flush", (f) => {
    // 봇 물내림은 실제 적립이 아니므로 "오늘 다같이" 갱신/반짝임 둘 다 생략
    if (f.kind !== "bot") {
      state.global = f.total;
      renderGlobal(!isFocusPaused()); // 집중 모드 중엔 반짝임 생략(숫자는 갱신)
      revealGlobalOnce(); // 첫 동기화가 flush로 먼저 올 수도 있으니 여기서도 등장 보장
    }
    if (f.me) {
      if (f.chat) showMyMessage(f.text || flushBrag(f.amount), "flush");
      return;
    } // 내 정산 → 피드(노랑)
    if (isFocusPaused()) return; // 팝퍼 집중 모드 — 백그라운드 채팅 보류
    if (f.kind === "bot" && receiptRevealQuiet) return; // 영수증 넛지 조용히
    showBubble({
      name: f.name,
      text: f.text || flushBrag(f.amount),
      kind: f.kind === "capped" ? "capped" : "flush",
      isBot: f.kind === "bot",
    });
  });
  // 소켓 연결 상태 — 에스컬레이션(언제 '끊김'으로 볼지)은 RealToiletSocket이 판단해 3가지로 통지.
  //  connecting: 재연결 시도 중 → "연결 중…"(로딩)   online: 연결됨 → 실제 카운트
  //  offline: 진짜 오프라인이거나 오래 재시도 실패 → "연결 끊김"(보수적으로만 도달)
  socket.on("connecting", () => {
    showStallsLoading();
  });
  socket.on("offline", () => {
    showStallsOffline();
  });
  socket.on("online", () => {
    showStallsCount();
  });

  /* ---------- 닉네임 확정 (팝오버 닫힐 때) ----------
   trim, 공백만 입력된 경우 랜덤 닉네임으로 대체, "고정" 체크 여부에 따라 저장/미저장 ---------- */
  function finalizeNickname() {
    let v = el.nickInput.value.trim();
    if (!v) {
      v = randomNickname();
      state.nickIsAuto = true;
    }
    v = v.slice(0, 10);
    state.nick = v;
    el.nickInput.value = v;
    if (state.nickPinned) LS.set(KEY.nick, v);
    else LS.remove(KEY.nick);
    updateChatPlaceholder();
  }

  function updateChatPlaceholder() {
    el.chatNick.textContent = state.nick;
  }

  function hideSalaryHint(animate = false) {
    if (!el.salaryChangeHint) return;
    clearTimeout(salaryHintTimer);
    salaryHintTimer = null;
    const badge = el.salaryChangeHint;
    badge.classList.remove(
      "ctrl-salary__badge--show",
      "ctrl-salary__badge--bounce",
    );
    badge.style.opacity = "";
    if (animate && !badge.hidden) {
      badge.classList.add("ctrl-salary__badge--hide");
      badge.addEventListener(
        "animationend",
        () => {
          badge.hidden = true;
          badge.classList.remove("ctrl-salary__badge--hide");
        },
        { once: true },
      );
      return;
    }
    badge.classList.remove("ctrl-salary__badge--hide");
    badge.hidden = true;
  }

  function showSalaryHint() {
    if (state.salaryClicked || !el.salaryChangeHint) return;
    const badge = el.salaryChangeHint;
    badge.hidden = false;
    badge.classList.remove(
      "ctrl-salary__badge--hide",
      "ctrl-salary__badge--bounce",
    );
    requestAnimationFrame(() => {
      badge.classList.add("ctrl-salary__badge--show");
      badge.addEventListener(
        "animationend",
        () => {
          if (state.salaryClicked || badge.hidden) return;
          badge.classList.remove("ctrl-salary__badge--show");
          badge.style.opacity = "1";
          badge.classList.add("ctrl-salary__badge--bounce");
        },
        { once: true },
      );
    });
  }

  function scheduleSalaryHint() {
    if (state.salaryClicked) return;
    clearTimeout(salaryHintTimer);
    salaryHintTimer = setTimeout(() => {
      if (!state.salaryClicked) showSalaryHint();
    }, SALARY_HINT_DELAY);
  }

  function markSalaryClicked() {
    if (state.salaryClicked) return;
    state.salaryClicked = true;
    LS.setBool(KEY.salaryClicked, true);
    hideSalaryHint(true);
  }

  function initSalaryHint() {
    if (state.salaryClicked) hideSalaryHint(false);
    else scheduleSalaryHint();
  }

  function hideReceiptHint(animate = false) {
    if (!el.receiptHint) return;
    const badge = el.receiptHint;
    badge.classList.remove("receipt-hint--show", "receipt-hint--bounce");
    badge.style.opacity = "";
    if (animate && !badge.hidden) {
      badge.classList.add("receipt-hint--hide");
      badge.addEventListener(
        "animationend",
        () => {
          badge.hidden = true;
          badge.classList.remove("receipt-hint--hide");
        },
        { once: true },
      );
      return;
    }
    badge.classList.remove("receipt-hint--hide");
    badge.hidden = true;
  }

  function showReceiptHint() {
    if (!el.receiptHint || el.receiptBtn.disabled) return;
    const badge = el.receiptHint;
    badge.hidden = false;
    badge.classList.remove("receipt-hint--hide", "receipt-hint--bounce");
    requestAnimationFrame(() => {
      badge.classList.add("receipt-hint--show");
      badge.addEventListener(
        "animationend",
        () => {
          if (badge.hidden) return;
          badge.classList.remove("receipt-hint--show");
          badge.style.opacity = "1";
          badge.classList.add("receipt-hint--bounce");
        },
        { once: true },
      );
    });
  }

  /* ---------- 팝오버 ---------- */
  function closeSalaryPanel() {
    const wasOpen = !el.salaryPanel.hidden;
    el.salaryPanel.hidden = true;
    if (wasOpen) {
      maybeAutoShowTimer();
      if (focusReasons.delete("salary")) LS.setBool(KEY.salaryFocusDone, true);
    }
  }

  function revealTimer() {
    if (state.timer) return;
    state.timer = true;
    LS.setBool(KEY.timer, true);
    el.timer.hidden = false;
    renderTimer();
    replayAnim(el.timer, "deckcol__timer--auto-reveal");
  }
  function maybeAutoShowTimer() {
    if (state.timer) return;
    if (LS.getBool(KEY.timerAutoShown)) return;
    LS.setBool(KEY.timerAutoShown, true);
    revealTimer();
  }
  function closeSettingsPanel() {
    if (el.settingsPanel.hidden) return;
    finalizeNickname();
    el.settingsPanel.hidden = true;
    $("nickRandomIcon").classList.remove("nick-random--spin");
    if (focusReasons.delete("settings"))
      LS.setBool(KEY.settingsFocusDone, true);
  }
  function closePanels(except) {
    if (except !== "salary") closeSalaryPanel();
    if (except !== "settings") closeSettingsPanel();
  }
  // 팝오버 토글: 닫혀 있으면 다른 것 닫고 이걸 열고, 열려 있으면 전부 닫기
  function togglePanel(name) {
    const panel = name === "salary" ? el.salaryPanel : el.settingsPanel;
    if (panel.hidden) {
      closePanels(name);
      panel.hidden = false;

      const isSalaryFirst =
        name === "salary" && !LS.getBool(KEY.salaryFocusDone);
      if (isSalaryFirst) {
        // 최초 오픈: 항목 순차 등장 (패널 자체 애니 없음, 자식이 직접 떠오름)
        panel.classList.add("salary-panel--stagger");
        setTimeout(() => panel.classList.remove("salary-panel--stagger"), 2000);
      } else {
        // 이후 오픈: 패널 자체 미세 등장
        replayAnim(
          panel,
          name === "salary" ? "salary-panel--in" : "settings-panel--in",
        );
      }

      // 최초 1회 진입에 집중할 수 있게, 아직 소진 안 된 팝퍼라면 백그라운드 활동 정지
      if (name === "salary" && !LS.getBool(KEY.salaryFocusDone))
        focusReasons.add("salary");
      if (name === "settings" && !LS.getBool(KEY.settingsFocusDone))
        focusReasons.add("settings");
      // 주사위 넛지: 물내림 1회 이상 + 닉네임 자동 상태 + 평생 1회만
      if (
        name === "settings" &&
        state.nickIsAuto &&
        !state.nickPinned &&
        !LS.getBool(KEY.nickDiceShown)
      ) {
        setTimeout(() => {
          replayAnim($("nickRandomIcon"), "nick-random--nudge");
          LS.setBool(KEY.nickDiceShown, true);
        }, 900);
      }
    } else {
      closePanels();
    }
  }

  /* ---------- 이벤트 ---------- */
  el.flushBtn.addEventListener("click", flush);

  el.salaryToggle.addEventListener("click", () => {
    markSalaryClicked();
    togglePanel("salary");
  });
  el.salaryRange.addEventListener("input", (e) =>
    applySalary(SALARY_STEPS[Number(e.target.value)]),
  );
  el.salaryRange.addEventListener("change", (e) => {
    applySalary(SALARY_STEPS[Number(e.target.value)]);
    closeSalaryPanel();
  });

  el.gearBtn.addEventListener("click", () => togglePanel("settings"));
  // 팝오버 외 영역 클릭 시 닫기 (단, 기록 초기화 확인창이 떠 있을 때는 그 창 클릭으로 뒷 팝오버가 닫히지 않게 한다)
  document.addEventListener("click", (e) => {
    if (el.resetConfirmModal.contains(e.target)) return;
    if (el.donateModal.contains(e.target)) return;
    if (
      !el.salaryPanel.hidden &&
      !el.salaryPanel.contains(e.target) &&
      !el.salaryToggle.contains(e.target)
    )
      closeSalaryPanel();
    if (
      !el.settingsPanel.hidden &&
      !el.settingsPanel.contains(e.target) &&
      !el.gearBtn.contains(e.target)
    )
      closeSettingsPanel();
  });

  el.nickInput.addEventListener("input", (e) => {
    state.nick = e.target.value.slice(0, 10);
    state.nickIsAuto = false;
    updateChatPlaceholder();
  });
  el.nickRandomBtn.addEventListener("click", () => {
    state.nick = randomNickname();
    state.nickIsAuto = true;
    el.nickInput.value = state.nick;
    updateChatPlaceholder();
    if (state.nickPinned) LS.set(KEY.nick, state.nick);
    replayAnim($("nickRandomIcon"), "nick-random--spin");
  });
  el.nickPinChk.addEventListener("change", (e) => {
    state.nickPinned = e.target.checked;
    LS.setBool(KEY.nickPin, state.nickPinned);
    if (state.nickPinned) LS.set(KEY.nick, state.nick);
    else LS.remove(KEY.nick);
  });
  function performReset() {
    wipeGameStats();
    renderTotal();
    renderHistoryBtns();
    updateReceiptBtnDisabled();
    toast("내 기록 초기화 완료 🧹");
  }
  function openResetConfirm() {
    el.resetConfirmFlushes.textContent = `${state.flushCount || 0}회`;
    el.resetConfirmTotal.textContent = formatWon(state.totalEarned);
    el.resetConfirmTime.textContent = formatDwellTime(
      Math.round(Math.min(state.satSeconds, MAX_SESSION_SECONDS)),
    );
    el.resetConfirmModal.hidden = false;
  }
  function closeResetConfirm() {
    el.resetConfirmModal.hidden = true;
  }

  el.resetTotalBtn.addEventListener("click", openResetConfirm);
  el.resetConfirmCancel.addEventListener("click", closeResetConfirm);
  el.resetConfirmBackdrop.addEventListener("click", closeResetConfirm);
  el.resetConfirmYes.addEventListener("click", () => {
    performReset();
    closeResetConfirm();
    closeSettingsPanel();
  });

  function closeDonateModal() {
    el.donateModal.hidden = true;
  }
  function openDonateModal() {
    el.donateModal.hidden = false;
  }
  function isDonateDesktop() {
    return window.matchMedia("(min-width: 641px)").matches;
  }

  function openDonate() {
    if (isDonateDesktop()) openDonateModal();
    else window.open(DONATE_KAKAO_URL, "_blank", "noopener,noreferrer");
  }

  async function showDonateToast() {
    try {
      await navigator.clipboard.writeText("https://moneytoilet.kr");
    } catch {}
    toast("링크 복사됨!<br>공유하기가 곧 후원입니다 😌", true);
  }

  function openAdInquiry() {
    if (!adToastActive) adToastIdx = 0;
    toast(AD_TOASTS[adToastIdx % AD_TOASTS.length]);
    adToastIdx++;
    adToastActive = true;
    clearTimeout(adToastActiveTimer);
    adToastActiveTimer = setTimeout(() => {
      adToastActive = false;
    }, TOAST_DURATION + 100);
  }

  // 설정 '개발자 후원하기' — '후원' 버킷 집계 + 토스트.
  el.donateBtn.addEventListener("click", () => {
    socket.clicked("donate");
    showDonateToast();
  });
  el.donateCloseBtn.addEventListener("click", closeDonateModal);
  el.donateBackdrop.addEventListener("click", closeDonateModal);

  // 개발용 — 이 기기의 mt_* 로컬스토리지를 전부 비우고 새로고침(넛지/진행도 전부 리셋)
  if (el.devWipeAllBtn) {
    el.devWipeAllBtn.addEventListener("click", () => {
      if (!window.confirm("로컬스토리지를 전부 초기화하고 새로고침할까요?"))
        return;
      // 현재 누적 중인 시간도 즉시 0으로 초기화 후 localStorage 전체 삭제
      state.satSeconds = 0;
      state.personal = 0;
      if (tickInterval) clearInterval(tickInterval);
      localStorage.clear();
      window.location.reload();
    });
  }

  // 개발용 — 60분 동결 테스트: 타이머를 59:50으로 점프
  if (el.devSetTimer5950Btn) {
    el.devSetTimer5950Btn.addEventListener("click", () => {
      state.satSeconds = MAX_SESSION_SECONDS - 10;
      state.personal = earnPerSecCeil() * state.satSeconds;
      renderPersonal();
      renderTimer();
      toast("🧪 타이머를 59:50으로 변경했어요");
    });
  }

  if (el.devAddMinBtn) {
    el.devAddMinBtn.addEventListener("click", () => {
      const added = Math.min(60, MAX_SESSION_SECONDS - state.satSeconds);
      state.satSeconds = Math.min(state.satSeconds + 60, MAX_SESSION_SECONDS);
      creditTodayDwell(added); // 티어 테스트를 위해 오늘 루팡시간도 같이 점프
      state.personal = earnPerSecCeil() * state.satSeconds;
      renderPersonal();
      renderTimer();
      if (state.satSeconds >= MAX_SESSION_SECONDS && !state.timerCapped)
        onTimerCapped();
      toast(`🧪 +${added}초 추가 → ${formatClock(state.satSeconds)}`);
    });
  }

  // 사이트 링크 공유(설정 공유하기 버튼 + 광고공석 브랜드 포스터) — '공유' 버킷 집계.
  // 클릭 즉시(await 이전) emit, 연타는 소켓 어댑터가 kind별 디바운스로 삼킨다.
  async function doSiteShare() {
    socket.clicked("share");
    const url = window.location.origin;
    if (!isPC() && navigator.share) {
      try {
        await navigator.share({ text: url });
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast("링크 복사됨!");
      } catch {}
    }
  }

  if (el.settingsShareBtn) {
    el.settingsShareBtn.addEventListener("click", () => doSiteShare());
  }

  el.settingsLinks.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "ad") {
        openAdInquiry();
        return;
      }
      toast(SETTINGS_LINK_MESSAGES[btn.dataset.action] || "준비중입니다");
    });
  });

  el.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;
    const guard = shouldBlockChat(text);
    if (guard.blocked) {
      if (guard.mute) muteChat();
      return;
    }
    socket.send(text);
    rememberChatMessage(text, Date.now());
    el.chatInput.value = "";
  });
  el.adA4.addEventListener("click", (e) => {
    e.preventDefault();
    const adUrl = (currentAdCreative.url || "").trim();
    if (adUrl) {
      // 제휴/광고 링크가 붙어있으면 그걸 연다(집계 버킷 없음 — 순수 광고 클릭).
      window.open(adUrl, "_blank", "noopener,noreferrer");
      return;
    }
    // 브랜드 포스터(광고 공석) — 공유하기로 바이럴 유도
    if (currentAdCreative.brand) {
      doSiteShare();
      return;
    }
    if (currentAdCreative.category === "ad") openAdInquiry();
    else {
      socket.clicked("donate"); // 메인배너 후원 크리에이티브 → '후원' 버킷
      showDonateToast();
    }
  });

  /* ---------- 이스터에그: 휴지 뜯기 ---------- */
  const sceneEl = $("scene");
  const skinTp = $("skinTp");
  const skinLatch = $("skinLatch");
  const TP_SHEET_FALL_MS = 1700;
  const tpSheetTimers = new Set();

  // 롤 원 요소 참조 (흰색 롤 = tp__roll, 꼬랑지 = tp__hang)
  const tpRollCircle =
    skinTp?.querySelector(".tp__roll") ?? skinTp?.querySelector("circle");
  const tpHangEl = skinTp?.querySelector(".tp__hang");

  // 뽑힌 횟수에 따라 롤 크기 갱신
  function updateTpRoll() {
    if (!tpRollCircle) return;
    const ratio = tpPullCount / TP_MAX_PULLS;
    const r = Math.max(
      TP_CORE_R,
      Math.round(TP_FULL_R - ratio * (TP_FULL_R - TP_CORE_R)),
    );
    tpRollCircle.setAttribute("r", r);
  }

  // 뽑힌 횟수에 따라 꼬랑지(늘어진 종이) 길이·좌표 갱신
  function updateTpHang() {
    if (!tpHangEl) return;
    const ratio = Math.max(0.08, 1 - tpPullCount / TP_MAX_PULLS);
    tpHangEl.style.scale = `1 ${ratio.toFixed(3)}`;
    // 롤이 줄어들수록 꼬랑지가 왼쪽으로 이동 (SVG 좌표 기준)
    const dx = -(tpPullCount / TP_MAX_PULLS) * (TP_FULL_R - TP_CORE_R);
    tpHangEl.setAttribute("transform", `translate(${dx.toFixed(2)}, 0)`);
  }

  // 한 장 떨어지는 연출
  function dropTpSheet() {
    if (!sceneEl) return;
    const sheet = document.createElement("div");
    sheet.className = "tp-sheet";
    sheet.style.left = "34px";
    sheet.style.top = "63%";
    sceneEl.appendChild(sheet);
    const fallT = setTimeout(() => {
      sheet.remove();
      tpSheetTimers.delete(fallT);
    }, TP_SHEET_FALL_MS);
    tpSheetTimers.add(fallT);
  }

  // 소모 순환 풀에서 랜덤 메시지 뽑기
  function pickFromPool(pool, source) {
    if (pool.length === 0) pool.push(...source);
    const idx = Math.floor(Math.random() * pool.length);
    return pool.splice(idx, 1)[0];
  }

  function tearToiletPaper() {
    if (!sceneEl || !skinTp || tpEmpty) return;
    tpPullCount++;
    updateTpRoll();
    updateTpHang();

    if (tpPullCount >= TP_MAX_PULLS) {
      // 150번째 뽑기 → 빈 상태(밝은 갈색 심만 남음)
      tpEmpty = true;
      skinTp.classList.add("skin-tp--torn", "skin-tp--empty");
      dropTpSheet();
      tpRefillTimer = setTimeout(() => {
        tpEmpty = false;
        tpPullCount = 0;
        skinTp.classList.remove("skin-tp--torn", "skin-tp--empty");
        updateTpRoll();
        updateTpHang();
        skinTp.classList.add("skin-tp--refill");
        setTimeout(() => skinTp.classList.remove("skin-tp--refill"), 1200);
        // 봇이 왼쪽 하단에서 리필 채팅
        showBubble(
          {
            name: pickFromPool(tpRefillNickPool, TP_REFILL_NICKS),
            text: pickFromPool(tpRefillMsgPool, TP_REFILL_MESSAGES),
            isBot: true,
          },
          "left",
        );
      }, TP_REFILL_MS);
      return;
    }

    // 일반 뽑기 — 클릭마다 즉시 얇아짐, 직접 클릭해야 다음 장 뽑힘
    dropTpSheet();
  }

  /* ---------- 이스터에그: 문고리 박살 (10초 안에 5번 → 잠김 후 손잡이 낙하, 세션 영구 고장) ---------- */
  function dropLatchKnob() {
    if (!sceneEl || !skinLatch) return;
    const svgRect = skinLatch.getBoundingClientRect();
    const sceneRect = sceneEl.getBoundingClientRect();
    // circle은 viewBox(0 0 44 32) 기준 cx=16, cy=16 — 렌더된 SVG 크기로 환산
    const knobX = svgRect.left - sceneRect.left + (16 / 44) * svgRect.width;
    const knobY = svgRect.top - sceneRect.top + (16 / 32) * svgRect.height;
    const knob = document.createElement("div");
    knob.className = "latch-knob-fall";
    knob.style.left = knobX + "px";
    knob.style.top = knobY + "px";
    sceneEl.appendChild(knob);
    setTimeout(() => knob.remove(), 2000);
    // 손잡이 떨어진 자리 — 음각 소켓
    const socket = document.createElement("div");
    socket.className = "latch-knob-socket";
    socket.style.left = knobX + "px";
    socket.style.top = knobY + "px";
    sceneEl.appendChild(socket);
  }

  function triggerLatchBreak() {
    latchPendingBreak = true;
    skinLatch.classList.remove("skin-latch--open");
    // 1초 간격 3회 요동
    [0, 1000, 2000].forEach((delay) => {
      latchRattleTimers.push(
        setTimeout(() => replayAnim(skinLatch, "skin-latch--rattle"), delay),
      );
    });
    // 마지막 요동(2000ms) + 500ms 후 박살
    latchBreakTimer = setTimeout(() => {
      latchBroken = true;
      latchPendingBreak = false;
      skinLatch.classList.add("skin-latch--broken");
      latchBreakTimer = null;
      dropLatchKnob();
      latchReactionTimer = setTimeout(() => {
        showBubble({
          name: randomNickname(),
          text: pickFromPool(latchBreakMsgPool, LATCH_BREAK_MESSAGES),
          isBot: true,
        });
        latchReactionTimer = null;
      }, LATCH_BREAK_REACTION_DELAY);
    }, 2500);
  }

  function handleLatchClick() {
    if (latchBroken || latchPendingBreak) return;
    skinLatch.classList.toggle("skin-latch--open");
    const now = Date.now();
    latchEasterTaps = latchEasterTaps.filter(
      (t) => now - t < LATCH_EASTER_WINDOW_MS,
    );
    latchEasterTaps.push(now);
    if (latchEasterTaps.length >= LATCH_EASTER_TAPS) {
      latchEasterTaps = [];
      triggerLatchBreak();
    }
  }

  if (skinTp) skinTp.addEventListener("click", tearToiletPaper);
  if (skinLatch) skinLatch.addEventListener("click", handleLatchClick);

  /* ---------- 이스터에그: 천장 형광등 (10초 안에 6번 → 암전 7초 + 옆 칸 반응 2회) ---------- */
  const skinLight = $("skinLight");
  const ceilingLightTap = $("ceilingLightTap");

  function recoverFromBlackout() {
    lightBlackout = false;
    lightBlackoutTimer = null;
    skinLight.classList.remove("skin-light--off");
    sceneEl.classList.remove("scene--blackout");
    lightRecoveryReactionTimer = setTimeout(() => {
      showBubble({
        name: randomNickname(),
        text: pickFromPool(lightRecoveryMsgPool, LIGHT_RECOVERY_MESSAGES),
        isBot: true,
      });
      lightRecoveryReactionTimer = null;
    }, LIGHT_RECOVERY_REACTION_DELAY);
  }

  function triggerBlackout() {
    lightBlackout = true;
    lightEasterLastTrigger = Date.now();
    sceneEl.classList.add("scene--blackout");
    skinLight.classList.add("skin-light--off");
    lightReactionTimer = setTimeout(() => {
      showBubble({
        name: randomNickname(),
        text: pickFromPool(lightBlackoutMsgPool, LIGHT_BLACKOUT_MESSAGES),
        isBot: true,
      });
      lightReactionTimer = null;
    }, LIGHT_BLACKOUT_REACTION_DELAY);
    lightBlackoutTimer = setTimeout(
      recoverFromBlackout,
      LIGHT_BLACKOUT_DURATION,
    );
  }

  function tapCeilingLight() {
    if (lightBlackout) return; // 암전 중 탭 무시
    const now = Date.now();
    replayAnim(skinLight, "skin-light--blink");
    lightEasterTaps = lightEasterTaps.filter(
      (t) => now - t < LIGHT_EASTER_WINDOW_MS,
    );
    lightEasterTaps.push(now);
    if (
      lightEasterTaps.length >= LIGHT_EASTER_TAPS &&
      now - lightEasterLastTrigger >= LIGHT_EASTER_COOLDOWN_MS
    ) {
      lightEasterTaps = [];
      triggerBlackout();
    }
  }

  // 오버레이가 있으면 오버레이로, 없으면 skinLight 직접으로 폴백
  if (ceilingLightTap)
    ceilingLightTap.addEventListener("click", tapCeilingLight);
  else if (skinLight) skinLight.addEventListener("click", tapCeilingLight);

  /* ---------- 개발자 도구 진입: 우상단 '오늘 다같이' 영역 20번 빠르게 클릭 ---------- */
  function tapGlobalChip() {
    if (LS.getBool(KEY.devToolsUnlocked)) return;
    const now = Date.now();
    devUnlockTaps =
      now - devUnlockTapAt <= DEV_TAP_RESET_MS ? devUnlockTaps + 1 : 1;
    devUnlockTapAt = now;
    if (devUnlockTaps >= DEV_UNLOCK_TAPS) {
      LS.setBool(KEY.devToolsUnlocked, true);
      if (el.devTools) el.devTools.hidden = false;
      toast("🛠 개발자 도구가 켜졌어요");
      devUnlockTaps = 0;
    }
  }
  if (el.globalChip) el.globalChip.addEventListener("click", tapGlobalChip);

  // 이미 해제된 기기면 처음부터 노출
  if (LS.getBool(KEY.devToolsUnlocked)) {
    if (el.devTools) el.devTools.hidden = false;
  }

  /* =====================================================================
   화장실 급여명세서 공유 (SNS 바이럴)
   - 미리보기는 React ReceiptCard(공유 페이지와 동일 컴포넌트)로 렌더.
   - 명세서에는 "내 월급"과 "누적시간"을 절대 넣지 않는다.
   ===================================================================== */
  function buildReceiptData() {
    const lastFlushTs =
      state.flushHistory[state.flushHistory.length - 1]?.ts || Date.now();
    return {
      n: (state.nick || "익명의 볼일러").slice(0, 16),
      h: state.flushHistory.slice(-FLUSH_HISTORY_MAX).map((it) => it.amount),
      t: Math.max(0, state.totalEarned),
      f: state.flushCount || 0,
      ts: lastFlushTs,
      sl: getReceiptSloganIndex(),
      p: currentTierInfo().p, // 루팡 티어(상위 %) — 물내림 시점 스냅샷, 공유 URL에 포함
    };
  }

  function openReceipt() {
    hideReceiptHint(true);
    closePanels();
    window.dispatchEvent(
      new CustomEvent(APP_EVENTS.payslipOpen, {
        detail: buildReceiptData(),
      }),
    );
  }

  const onPayslipToast = (e) => {
    if (e instanceof CustomEvent && typeof e.detail === "string")
      toast(e.detail);
  };
  // 자랑하기 클릭 집계 — 모달(React)은 소켓에 직접 접근하지 못하므로 이 이벤트로 받아 서버 emit.
  // URL 신규 생성 여부와 무관한 '단순 클릭' → '자랑' 버킷(연타는 소켓 어댑터가 디바운스).
  const onBragClick = () => socket.clicked("brag");
  window.addEventListener(APP_EVENTS.toast, onPayslipToast);
  window.addEventListener(APP_EVENTS.payslipStamped, revealReceiptFromStamp);
  window.addEventListener(APP_EVENTS.brag, onBragClick);

  // 탭 숨김/복귀 처리
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // 탭 숨김 직전 — 최대 1초 오차 방지를 위해 즉시 영속
      persistSatSeconds();
      persistGlobalForShare();
    } else {
      // 탭 재활성화 — 비활성 동안 흐른 시간을 satSeconds에 반영
      const lastSeenAt = Number(LS.get(KEY.lastSeenAt, "0")) || 0;
      if (lastSeenAt > 0) {
        const awaySec = Math.floor((Date.now() - lastSeenAt) / 1000);
        // 부재중 적립은 물내림 1회 이상 경험자만(뉴비 MAX 방지)
        if (
          awaySec > 0 &&
          state.flushCount >= 1 &&
          state.satSeconds < MAX_SESSION_SECONDS
        ) {
          const prevSat = state.satSeconds;
          const newSat = Math.min(prevSat + awaySec, MAX_SESSION_SECONDS);
          state.satSeconds = newSat;
          creditTodayDwell(newSat - prevSat); // 비활성 동안 적립분만큼 오늘 루팡시간도 반영
          state.personal =
            earnPerSecCeil() * Math.min(state.satSeconds, MAX_SESSION_SECONDS);
          if (isPersonalAbuse()) {
            handleAbuse();
          } else {
            renderPersonal();
            if (state.timer) renderTimer();
            if (newSat >= MAX_SESSION_SECONDS && !state.timerCapped) {
              setTimerCapped(true);
              revealTimer();
              toast(
                '⏰ 자리 비운 사이 <span class="toast-em toast-em--max">MAX</span> 달성!',
                true,
              );
            } else if (awaySec >= 300) {
              // 5분 이상 자리비움 시 토스트
              const awayMin = Math.max(1, Math.round(awaySec / 60));
              revealTimer();
              toast(
                `💰 부재중 자동 적립! <span class="toast-em toast-em--gain">+${awayMin}분</span>`,
                true,
              );
            }
          }
        }
      }
      persistSatSeconds();
      startTicker(); // 틱 위상 리셋
    }
  });
  function persistGlobalForShare() {
    // 공유 페이지로 뒤로가기 시 게임에서 봤던 최신 global 값을 유지하기 위해 저장
    try {
      if (state.global > 0)
        sessionStorage.setItem(
          "mt_game_global",
          String(Math.round(state.global)),
        );
    } catch {}
  }
  window.addEventListener("pagehide", () => {
    // 10초 안에 이탈 → 다음 방문 시 뉴비로 취급(everVisited 제거 + satSeconds 0으로 초기화)
    if (Date.now() - sessionStartAt < 10000) {
      LS.remove(KEY.everVisited);
      LS.set(KEY.satSeconds, "0");
      LS.remove(KEY.lastSeenAt);
    } else {
      persistSatSeconds();
    }
    persistGlobalForShare();
  });

  $("receiptBtn").addEventListener("click", openReceipt);
  el.receiptBtnSettings.addEventListener("click", openReceipt);

  /* ---------- 시작 ---------- */
  loadAll();
  // 문고리 초기 상태: 잠김(기본) — 짝수 탭으로 잠기고 4번째에 박살
  initSalaryHint();
  if (isStoredAbuse()) handleAbuse();
  sessionStartAt = Date.now();
  adaptationEndTime = sessionStartAt + ADAPTATION_TIME;
  // 이전에 이미 등장했던 브라우저면 바로 표시(연출 없이)
  if (state.receiptRevealed) showReceiptBtn(false);
  applySalary(state.salary);
  restoreAwayProgress(); // earnRate가 맞춰진 뒤에 계산해야 보상 멘트의 원화 금액이 정확함
  renderPersonal();

  // 설정 UI 초기화
  el.nickInput.value = state.nick;
  updateChatPlaceholder();
  el.nickPinChk.checked = state.nickPinned;
  renderTotal();
  renderHistoryBtns();
  el.timer.hidden = !state.timer;
  if (state.timer) renderTimer();
  rotateAd();
  let adInterval = null;
  const adStartTimer =
    AD_CREATIVES.length > 1
      ? setTimeout(() => {
          adInterval = setInterval(rotateAd, AD_ROTATE_MS);
        }, AD_ROTATE_START_DELAY)
      : null;
  // 첫 페인트는 로딩(···)으로 — 소켓 첫 값 도착 시 부드럽게 등장(0명/0원 갑툭튀 방지)
  showStallsLoading();
  showGlobalLoading();
  // computeEntryGraceMs()가 everVisited 플래그를 소비(true로 세팅)하므로 그 전에 첫방문 여부를 읽는다.
  const isFirstEverVisit = !LS.getBool(KEY.everVisited);
  socket.connect(computeEntryGraceMs());

  // 첫 방문자에게만: 입장 직후 화면이 썰렁하지 않도록 따뜻한 인사 말풍선 1개를 시드한다.
  // (그레이스 동안 봇이 조용한 구간의 '죽은 느낌'을 없애는 1회성 환영 — 이후엔 평소 흐름)
  let welcomeTimer = null;
  if (isFirstEverVisit) {
    welcomeTimer = setTimeout(() => {
      showBubble({
        name: randomNickname(),
        text: pick(WELCOME_LINES),
        isBot: true,
      });
    }, WELCOME_DELAY_MS);
  }

  /* ---------- cleanup (언마운트 시 인터벌/가짜소켓 정리) ---------- */
  return () => {
    if (tickInterval) clearInterval(tickInterval);
    clearTimeout(adStartTimer);
    clearTimeout(salaryHintTimer);
    clearTimeout(chatMuteTimer);
    if (chatMuteTick) clearInterval(chatMuteTick);
    clearTimeout(toastTimer);
    clearTimeout(toastExitTimer);
    if (welcomeTimer) clearTimeout(welcomeTimer);
    if (adInterval) clearInterval(adInterval);
    if (stallsOfflineTimer) clearTimeout(stallsOfflineTimer);
    if (tpRefillTimer) clearTimeout(tpRefillTimer);

    if (lightBlackoutTimer) clearTimeout(lightBlackoutTimer);
    if (lightReactionTimer) clearTimeout(lightReactionTimer);
    if (lightRecoveryReactionTimer) clearTimeout(lightRecoveryReactionTimer);
    sceneEl.classList.remove("scene--blackout");
    latchRattleTimers.forEach(clearTimeout);
    if (latchBreakTimer) clearTimeout(latchBreakTimer);
    if (latchReactionTimer) clearTimeout(latchReactionTimer);
    if (adToastActiveTimer) clearTimeout(adToastActiveTimer);
    if (receiptRevealQuietTimer) {
      clearTimeout(receiptRevealQuietTimer);
      receiptRevealQuiet = false;
    }
    tpSheetTimers.forEach(clearTimeout);
    Object.values(bubblePending).forEach((p) => clearTimeout(p.timer));
    if (bottomRO) bottomRO.disconnect();
    document.removeEventListener("pointerdown", dismissToastOnUserAction, true);
    document.removeEventListener("keydown", dismissToastOnUserAction, true);
    if (skinTp) skinTp.removeEventListener("click", tearToiletPaper);
    if (skinLatch) skinLatch.removeEventListener("click", handleLatchClick);
    if (ceilingLightTap)
      ceilingLightTap.removeEventListener("click", tapCeilingLight);
    else if (skinLight) skinLight.removeEventListener("click", tapCeilingLight);
    if (el.globalChip)
      el.globalChip.removeEventListener("click", tapGlobalChip);
    window.removeEventListener(APP_EVENTS.toast, onPayslipToast);
    window.removeEventListener(
      APP_EVENTS.payslipStamped,
      revealReceiptFromStamp,
    );
    window.removeEventListener(APP_EVENTS.brag, onBragClick);
    try {
      socket.disconnect();
    } catch (e) {}
  };
} // end initGame
