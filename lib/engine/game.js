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
} from "@/lib/constants";
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
  const perSec = (salary) =>
    salary /
    (WORK_CONFIG.workDaysPerMonth * WORK_CONFIG.workHoursPerDay * 3600);

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
    offlineBadge: $("offlineBadge"),
    globalEarned: $("globalEarned"),
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
    salaryPanel: $("salaryPanel"),
    salaryRange: $("salaryRange"),
    salaryBig: $("salaryBig"),
    salaryRate: $("salaryRate"),
    gearBtn: $("gearBtn"),
    settingsPanel: $("settingsPanel"),
    nickInput: $("nickInput"),
    nickRandomBtn: $("nickRandomBtn"),
    nickPinChk: $("nickPinChk"),
    timerToggle: $("timerToggle"),
    resetTotalBtn: $("resetTotalBtn"),
    receiptBtnSettings: $("receiptBtnSettings"),
    settingsHistoryGroup: $("settingsHistoryGroup"),
    settingsShareBtn: $("settingsShareBtn"),
    resetConfirmModal: $("resetConfirmModal"),
    resetConfirmBackdrop: $("resetConfirmBackdrop"),
    resetConfirmFlushes: $("resetConfirmFlushes"),
    resetConfirmTotal: $("resetConfirmTotal"),
    resetConfirmCancel: $("resetConfirmCancel"),
    resetConfirmYes: $("resetConfirmYes"),
    donateModal: $("donateModal"),
    donateBackdrop: $("donateBackdrop"),
    donateCloseBtn: $("donateCloseBtn"),
    donateBtn: $("donateBtn"),
    devWipeAllBtn: $("devWipeAllBtn"),
    devSetTimer5950Btn: $("devSetTimer5950Btn"),
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
    adHead: $("adHead"),
    adSub: $("adSub"),
    settingsLinks: document.querySelectorAll(".settings__link[data-action]"),
  };

  /* ---------- 상태 ---------- */
  const state = {
    salary: DEFAULT_SALARY,
    earnRate: perSec(DEFAULT_SALARY),
    satSeconds: 0, // 앉아있는 시간(초) — 적립은 earnPerSecCeil() × satSeconds(올림 기준)
    personal: 0,
    global: 0, // 오늘 다같이(서버 소유)
    totalEarned: 0, // 내가 번 돈 합계(누적, 물내릴 때만 +)
    nick: "",
    nickPinned: false, // 닉네임 기기 저장 여부("고정" 체크)
    timer: false, // 타이머 표시
    stalls: 0, // 지금 볼일 중인 사람 수(서버) — 영수증용
    flushCount: 0, // 내 물내림 누적 횟수 — 영수증용(시간/월급 유추 불가)
    flushHistory: [], // 최근 물내림 Queue(최대 10건) — { n: 회차, amount: 벌은 금액, ts: 물내림 시각 }
    receiptRevealed: false, // 영수증 버튼 등장 여부(최초 1회 등장 후 로컬스토리지 영속)
    totalVisible: false, // "총 N원" 영역 표시 여부
    salaryHintDismissed: false, // 구버전 플래그(마이그레이션)
    salaryClicked: false, // 내 월급 버튼 1회 이상 클릭
  };

  // localStorage 키 — lib/storageKeys.js
  const KEY = STORAGE_KEY;
  const FLUSH_HISTORY_MAX = 10; // 명세서 표시/저장 상한
  const SALARY_HINT_DELAY = 40_000; // 최초 진입 40초 후, 미클릭 시 👈 노출
  const RECEIPT_REVEAL_DELAY = 30_000; // 세션 진입 후 30초 지나야 영수증 노출대상
  const RECEIPT_SHOW_DELAY = 5000; // 노출대상 된 물내림 후 5초 뒤 최초 등장
  const TOTAL_REVEAL_DELAY = 5000; // 첫 물내림 후 5초 뒤 "총 N원" 등장
  const FLUSH_NUDGE_DELAY = 5000; // 물내림 후 영수증 버튼 흔들기까지 지연
  const ADAPTATION_TIME = 3000; // 진입 후 최초 적응시간(ms)
  const ENTRY_GRACE_FIRST_VISIT = 15000; // 완전 처음 들어오는 사람
  const ENTRY_GRACE_RETURNING = 10000; // 조작하다 이탈했던(미완수) 사람
  const ENTRY_GRACE_COMPLETED = 5000; // 모든 넛지를 다 완수한 사람
  const CHAT_SPAM_WINDOW_MS = 3000; // 도배 판정 시간창: 최근 3초만 본다
  const CHAT_SPAM_MUTE_MS = 10_000; // 도배 시 10초 채팅 금지
  const CHAT_REPEAT_LIMIT = 5; // 같은 문장/비슷한 웃음·감탄류 반복 허용 상한
  const CHAT_BURST_LIMIT = 7; // 3초 안 총 채팅 허용 상한
  const CHAT_RECENT_MAX = CHAT_BURST_LIMIT; // burst 판정용으로 최근 N개까지만 기억
  let sessionStartAt = 0; // 세션 시작 시각 — 1분 경과 판정용(LS 미사용)
  let receiptRevealScheduled = false; // 영수증 최초 등장 예약 여부(중복 방지)
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
    state.nick =
      state.nickPinned && savedNick ? savedNick.slice(0, 10) : randomNickname();
    // 합계 / 토글
    state.totalEarned = Math.max(0, Number(LS.get(KEY.total, 0)) || 0);
    state.flushCount = Math.max(
      0,
      parseInt(LS.get(KEY.flushCount, "0"), 10) || 0,
    );
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
    [el.receiptBtnSettings, el.resetTotalBtn].forEach((btn) => {
      btn.disabled = noRecord;
      btn.classList.toggle("settings__btn--no-record", noRecord);
    });
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
  function showReceiptBtn(reveal) {
    if (!el.receiptBtn) return;
    el.receiptBtn.hidden = false;
    if (reveal) {
      replayAnim(el.receiptBtn, "flush-receipt--reveal");
      nudgeReceiptBtn();
    }
  }
  // 물내림 1회 초과(2회째)부터만 노출대상 — 그 안에서 3회째(flushCount > 2) 이거나
  // 세션 진입 30초 이상 지난 상태에서 물내렸으면 노출대상.
  // 노출대상이 되면 물내림 5초 후 애니메이션으로 최초 등장(이후 KEY.receiptRevealed로 영속).
  function maybeRevealReceipt() {
    if (state.receiptRevealed || receiptRevealScheduled) return;
    const eligible =
      state.flushCount > 1 &&
      (state.flushCount > 2 ||
        Date.now() - sessionStartAt >= RECEIPT_REVEAL_DELAY);
    if (!eligible) return;
    receiptRevealScheduled = true;
    setTimeout(() => {
      state.receiptRevealed = true;
      LS.setBool(KEY.receiptRevealed, true);
      showReceiptBtn(true);
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
      if (!wasCapped) state.satSeconds += 1;
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

    if (awaySec < AWAY_CREDIT_MIN_SEC) {
      state.satSeconds = storedSat; // 새로고침 등 — 보상 없이 그대로 이어서 표시
      state.personal = earnPerSecCeil() * state.satSeconds;
      // 동결 중에 새로고침한 경우 — 틱의 false→true 전환 감지로는 안 잡히니 직접 복원
      if (storedSat >= MAX_SESSION_SECONDS) setTimerCapped(true);
      return;
    }

    const newSat = Math.min(storedSat + awaySec, MAX_SESSION_SECONDS);
    const creditedSec = newSat - storedSat;
    state.satSeconds = newSat;
    state.personal = earnPerSecCeil() * state.satSeconds;
    if (creditedSec <= 0) return;

    if (newSat >= MAX_SESSION_SECONDS) {
      setTimerCapped(true);
      toast("⏰ 자리를 비운 사이 내 시급이 꽉 찼습니다!");
    } else if (awaySec >= 300) {
      // 5분 이상 자리비움 시에만 토스트
      const awayMin = Math.max(1, Math.round(awaySec / 60));
      toast(`🚪 부재중에도 자동 적립이 됐습니다! +${awayMin}분`);
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
    if (
      amount > cap ||
      state.totalEarned + amount > cap * (state.flushCount + 1)
    ) {
      handleAbuse();
      return;
    }
    const isFirstFlush = state.flushCount === 0;
    state.totalEarned += amount;
    LS.set(KEY.total, state.totalEarned);
    renderTotal();
    state.flushCount += 1;
    LS.set(KEY.flushCount, state.flushCount);
    if (isFirstFlush) renderHistoryBtns(); // 첫 물내림 — disabled 해제
    LS.remove(KEY.payslipConfirmed); // 새 명세서 버전 — 도장 연출 다시 필요
    maybeRevealReceipt(); // 증가된 flushCount(완료 누적) 기준으로 2회 조건 판정
    recordFlush(amount);
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
    toast("⏰ 1시간을 꽉 채웠습니다!");
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

  function showBubble(msg, forceSide) {
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
      ? `<b style="display:flex;justify-content:flex-start;align-items:center;gap:3px">${label}<span style="font-size:1em; opacity:0.65">🤖</span></b>`
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

  /* ---------- 토스트: 5초 후 자동 사라짐, 클릭 시 즉시 사라짐 ---------- */
  const TOAST_DURATION = 5000;
  let toastTimer;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), TOAST_DURATION);
  }
  function hideToast() {
    el.toast.hidden = true;
    clearTimeout(toastTimer);
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
  const chatSubmitBtn =
    el.chatForm?.querySelector('button[type="submit"]') || null;

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
    el.chatInput.disabled = muted;
    if (chatSubmitBtn) chatSubmitBtn.disabled = muted;
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
    setChatMuted(true, `물 내리고 ${leftSec}초만 진정 😌`);
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

  /* ---------- 소켓 ----------
     NEXT_PUBLIC_RT=1 이면 진짜 백엔드(RealToiletSocket), 아니면 가짜(개발/오프라인). */
  const useReal = process.env.NEXT_PUBLIC_RT === "1";
  const socket = useReal
    ? new RealToiletSocket({ getNick: () => state.nick })
    : new FakeToiletSocket();
  socket.on("presence", ({ count }) => {
    state.stalls = count;
    el.stallCount.textContent = count;
  });
  socket.on("global", ({ total }) => {
    state.global = total;
    renderGlobal();
  });
  socket.on("dayReset", ({ total }) => {
    // 자정 롤오버 — 'global' 단독 푸시로는 스냅처럼 보이므로 안내 토스트와 함께 초기화
    state.global = total;
    renderGlobal();
    toast("🌙 자정이 지나 오늘의 합계가 초기화됐어요");
  });
  socket.on("chat", (msg) => {
    if (msg.kind === "system") return; // 입장 알림: 기능만 유지, 표시 보류
    if (msg.kind === "me") {
      showMyMessage(msg.text, "chat");
      return;
    } // 내 채팅 → 덱 위 피드(민트)
    if (msg.kind !== "admin" && isFocusPaused()) return; // 팝퍼 집중 모드 — 관리자 공지는 예외
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
    }
    if (f.me) {
      if (f.chat) showMyMessage(f.text || flushBrag(f.amount), "flush");
      return;
    } // 내 정산 → 피드(노랑)
    if (isFocusPaused()) return; // 팝퍼 집중 모드 — 백그라운드 채팅 보류
    showBubble({
      name: f.name,
      text: f.text || flushBrag(f.amount),
      kind: f.kind === "capped" ? "capped" : "flush",
      isBot: f.kind === "bot",
    });
  });
  // 소켓 연결 실패/복구 — 볼일 중 영역에 오프라인 상태 표시 (RealToiletSocket에서만 발생)
  socket.on("offline", () => {
    if (el.stallsVal) el.stallsVal.hidden = true;
    if (el.offlineBadge) el.offlineBadge.hidden = false;
  });
  socket.on("online", () => {
    if (el.stallsVal) el.stallsVal.hidden = false;
    if (el.offlineBadge) el.offlineBadge.hidden = true;
  });

  /* ---------- 닉네임 확정 (팝오버 닫힐 때) ----------
   trim, 공백만 입력된 경우 랜덤 닉네임으로 대체, "고정" 체크 여부에 따라 저장/미저장 ---------- */
  function finalizeNickname() {
    let v = el.nickInput.value.trim();
    if (!v) v = randomNickname();
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

  /* ---------- 팝오버 ---------- */
  function closeSalaryPanel() {
    const wasOpen = !el.salaryPanel.hidden;
    el.salaryPanel.hidden = true;
    if (wasOpen) {
      maybeAutoShowTimer();
      if (focusReasons.delete("salary")) LS.setBool(KEY.salaryFocusDone, true);
    }
  }

  // 내 월급 팝퍼를 최초로 닫는 순간, 타이머 표시를 자동 ON(최초 1회만, 수동 조작 이력 없을 때만)
  function maybeAutoShowTimer() {
    if (state.timer) return;
    if (LS.getBool(KEY.timerAutoShown) || LS.getBool(KEY.timerTouched)) return;
    LS.setBool(KEY.timerAutoShown, true);
    state.timer = true;
    LS.setBool(KEY.timer, true);
    el.timerToggle.checked = true;
    el.timer.hidden = false;
    renderTimer();
    replayAnim(el.timer, "deckcol__timer--auto-reveal");
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
      // 최초 1회 진입에 집중할 수 있게, 아직 소진 안 된 팝퍼라면 백그라운드 활동 정지
      if (name === "salary" && !LS.getBool(KEY.salaryFocusDone))
        focusReasons.add("salary");
      if (name === "settings" && !LS.getBool(KEY.settingsFocusDone))
        focusReasons.add("settings");
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
  });
  el.nickRandomBtn.addEventListener("click", () => {
    state.nick = randomNickname();
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
  el.timerToggle.addEventListener("change", (e) => {
    state.timer = e.target.checked;
    LS.setBool(KEY.timer, state.timer);
    LS.setBool(KEY.timerTouched, true);
    el.timer.hidden = !state.timer;
    if (state.timer) renderTimer();
  });
  function performReset() {
    wipeGameStats();
    renderTotal();
    renderHistoryBtns();
    toast("내 기록 초기화 완료 🧹");
  }
  function openResetConfirm() {
    el.resetConfirmFlushes.textContent = `${state.flushCount || 0}회`;
    el.resetConfirmTotal.textContent = formatWon(state.totalEarned);
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

  function openAdInquiry() {
    const subject = encodeURIComponent("돈버는 화장실 광고 문의");
    window.location.href = `mailto:${AD_INQUIRY_EMAIL}?subject=${subject}`;
  }

  el.donateBtn.addEventListener("click", openDonate);
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
      if (state.timer) renderTimer();
      toast("🧪 타이머를 59:50으로 변경했어요");
    });
  }

  el.settingsShareBtn.addEventListener("click", async () => {
    const url = window.location.origin;
    const text = url;
    // PC는 네이티브 공유시트 대신 클립보드 복사. 모바일은 공유시트 우선.
    if (!isPC() && navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("공유 링크를 복사했어요! SNS에 붙여넣기 🔗");
      return;
    } catch {}
    window.open(url, "_blank");
  });

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
    // 제휴링크(url)가 채워져 있으면 그걸 연다(광고 모드). 비어있으면 기존 후원/문의 동작.
    const adUrl = (currentAdCreative.url || "").trim();
    if (adUrl) {
      window.open(adUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (currentAdCreative.category === "ad") openAdInquiry();
    else openDonate();
  });

  /* ---------- 이스터에그: 휴지 뜯기 / 문고리 잠금 토글 ---------- */
  const sceneEl = $("scene");
  const skinTp = $("skinTp");
  const skinLatch = $("skinLatch");
  const TP_RECHARGE_MS = 2600; // 휴지 재충전(다시 자라남)까지
  const TP_SHEET_FALL_MS = 1700; // 떨어지는 한 장이 사라지기까지
  let tpRecharging = false;
  let tpRechargeTimer = null;
  const tpSheetTimers = new Set();

  // 휴지 한 장 뜯기: 걸린 휴지가 짧아지고(스텁), 한 장이 바닥으로 떨어진 뒤 몇 초 후 재충전
  function tearToiletPaper() {
    if (!sceneEl || !skinTp || tpRecharging) return;
    tpRecharging = true;
    skinTp.classList.add("skin-tp--torn");
    const sheet = document.createElement("div");
    sheet.className = "tp-sheet";
    sheet.style.left = "34px"; // 휴지걸이 살짝 오른쪽에서 시작
    sheet.style.top = "63%";
    sceneEl.appendChild(sheet);
    const fallT = setTimeout(() => {
      sheet.remove();
      tpSheetTimers.delete(fallT);
    }, TP_SHEET_FALL_MS);
    tpSheetTimers.add(fallT);
    tpRechargeTimer = setTimeout(() => {
      skinTp.classList.remove("skin-tp--torn");
      tpRecharging = false;
    }, TP_RECHARGE_MS);
  }
  // 문고리: 클릭하면 가로 스위치 → 세로(잠금해제) + 우측 걸쇠 슬라이드아웃, 다시 누르면 복귀
  const toggleLatch = () => skinLatch.classList.toggle("skin-latch--open");
  // 명명 핸들러로 등록(StrictMode 이중 마운트 시 cleanup에서 제거 → 리스너 중복 방지)
  if (skinTp) skinTp.addEventListener("click", tearToiletPaper);
  if (skinLatch) skinLatch.addEventListener("click", toggleLatch);

  /* =====================================================================
   화장실 급여명세서 공유 (SNS 바이럴)
   - 미리보기는 React ReceiptCard(공유 페이지와 동일 컴포넌트)로 렌더.
   - 명세서에는 "내 월급"과 "누적시간"을 절대 넣지 않는다.
   ===================================================================== */
  function buildReceiptData() {
    const stalls = state.stalls || parseInt(el.stallCount.textContent, 10) || 0;
    const lastFlushTs =
      state.flushHistory[state.flushHistory.length - 1]?.ts || Date.now();
    return {
      n: (state.nick || "익명의 볼일러").slice(0, 16),
      h: state.flushHistory.slice(-FLUSH_HISTORY_MAX).map((it) => it.amount),
      t: Math.max(0, state.totalEarned),
      g: Math.max(0, state.global),
      p: stalls,
      f: state.flushCount || 0,
      ts: lastFlushTs,
      sl: getReceiptSloganIndex(),
    };
  }

  function openReceipt() {
    closePanels();
    window.dispatchEvent(
      new CustomEvent(APP_EVENTS.payslipOpen, { detail: buildReceiptData() }),
    );
  }

  const onPayslipToast = (e) => {
    if (e instanceof CustomEvent && typeof e.detail === "string")
      toast(e.detail);
  };
  window.addEventListener(APP_EVENTS.toast, onPayslipToast);
  window.addEventListener(APP_EVENTS.payslipStamped, revealReceiptFromStamp);

  // 탭 숨김/복귀 처리
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // 탭 숨김 직전 — 최대 1초 오차 방지를 위해 즉시 영속
      persistSatSeconds();
    } else {
      // 탭 재활성화 — 비활성 동안 흐른 시간을 satSeconds에 반영
      const lastSeenAt = Number(LS.get(KEY.lastSeenAt, "0")) || 0;
      if (lastSeenAt > 0) {
        const awaySec = Math.floor((Date.now() - lastSeenAt) / 1000);
        if (awaySec > 0 && state.satSeconds < MAX_SESSION_SECONDS) {
          const newSat = Math.min(state.satSeconds + awaySec, MAX_SESSION_SECONDS);
          state.satSeconds = newSat;
          state.personal =
            earnPerSecCeil() * Math.min(state.satSeconds, MAX_SESSION_SECONDS);
          if (isPersonalAbuse()) {
            handleAbuse();
          } else {
            renderPersonal();
            if (state.timer) renderTimer();
            if (newSat >= MAX_SESSION_SECONDS && !state.timerCapped) {
              setTimerCapped(true);
              toast("⏰ 자리를 비운 사이 내 시급이 꽉 찼습니다!");
            } else if (awaySec >= 300) {
              // 5분 이상 자리비움 시 토스트
              const awayMin = Math.max(1, Math.round(awaySec / 60));
              toast(`🚪 부재중에도 자동 적립이 됐습니다! +${awayMin}분`);
            }
          }
        }
      }
      persistSatSeconds();
      startTicker(); // 틱 위상 리셋
    }
  });
  window.addEventListener("pagehide", persistSatSeconds);

  $("receiptBtn").addEventListener("click", openReceipt);
  el.receiptBtnSettings.addEventListener("click", openReceipt);

  /* ---------- 시작 ---------- */
  loadAll();
  initSalaryHint();
  if (isStoredAbuse()) handleAbuse();
  sessionStartAt = Date.now();
  adaptationEndTime = sessionStartAt + ADAPTATION_TIME;
  // 이전에 이미 등장했던 브라우저면 바로 표시(연출 없이)
  if (state.receiptRevealed) showReceiptBtn(false);
  applySalary(state.salary);
  restoreAwayProgress(); // earnRate가 맞춰진 뒤에 계산해야 보상 멘트의 원화 금액이 정확함
  renderPersonal();

  // 공유 페이지에서 넘어온 경우 — 소켓 첫 이벤트 전까지 마지막 알려진 값으로 즉시 표시 (0 깜빡임 방지)
  try {
    const _hg = sessionStorage.getItem("mt_handoff_global");
    const _hs = sessionStorage.getItem("mt_handoff_stalls");
    if (_hg !== null) {
      sessionStorage.removeItem("mt_handoff_global");
      const v = parseFloat(_hg);
      if (isFinite(v) && v > 0) {
        state.global = v;
        renderGlobal();
      }
    }
    if (_hs !== null) {
      sessionStorage.removeItem("mt_handoff_stalls");
      const n = parseInt(_hs, 10);
      if (isFinite(n) && n > 0) el.stallCount.textContent = String(n);
    }
  } catch {}
  // 설정 UI 초기화
  el.nickInput.value = state.nick;
  updateChatPlaceholder();
  el.nickPinChk.checked = state.nickPinned;
  el.timerToggle.checked = state.timer;
  renderTotal();
  renderHistoryBtns();
  el.timer.hidden = !state.timer;
  renderTimer();
  rotateAd();
  let adInterval = null;
  const adStartTimer = setTimeout(() => {
    adInterval = setInterval(rotateAd, AD_ROTATE_MS);
  }, AD_ROTATE_START_DELAY);
  socket.connect(computeEntryGraceMs());

  /* ---------- cleanup (언마운트 시 인터벌/가짜소켓 정리) ---------- */
  return () => {
    if (tickInterval) clearInterval(tickInterval);
    clearTimeout(adStartTimer);
    clearTimeout(salaryHintTimer);
    clearTimeout(chatMuteTimer);
    if (chatMuteTick) clearInterval(chatMuteTick);
    if (adInterval) clearInterval(adInterval);
    if (tpRechargeTimer) clearTimeout(tpRechargeTimer);
    tpSheetTimers.forEach(clearTimeout);
    if (bottomRO) bottomRO.disconnect();
    document.removeEventListener("pointerdown", dismissToastOnUserAction, true);
    document.removeEventListener("keydown", dismissToastOnUserAction, true);
    if (skinTp) skinTp.removeEventListener("click", tearToiletPaper);
    if (skinLatch) skinLatch.removeEventListener("click", toggleLatch);
    window.removeEventListener(APP_EVENTS.toast, onPayslipToast);
    window.removeEventListener(
      APP_EVENTS.payslipStamped,
      revealReceiptFromStamp,
    );
    try {
      socket.disconnect();
    } catch (e) {}
  };
} // end initGame
