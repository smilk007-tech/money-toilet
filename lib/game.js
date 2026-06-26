/* ===================================================================
   돈버는 화장실 · game.js  — 앉아서 돈 버는 메인 로직
   Next.js 포팅: 전체 로직을 initGame()으로 감싸고, 마운트 후 클라이언트에서 1회 실행.
   반환값은 cleanup(인터벌/가짜소켓 정리) 함수.
   =================================================================== */

import { FakeToiletSocket } from "@/lib/fakeSocket";
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
import { APP_EVENTS } from "@/lib/appEvents";
import {
  ensureReceiptSlogan,
  getReceiptSloganIndex,
  rotateReceiptSlogan,
} from "@/lib/receiptSlogan";

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
    const candidates = ALL_RANKS.filter((r) => !surnameRankCollides(surname, r));
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
  const wonNum = (n) => Math.ceil(n).toLocaleString("ko-KR") + "원"; // n원 (₩ 없음)
  const salaryText = (v) =>
    v === 0 ? "휴식중" : v >= 100_000_000 ? "1억원" : v / 10000 + "만원"; // 쉼표 없이 짧게
  const mmss = (s) =>
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
  const perSecInt = () => Math.ceil(state.earnRate); // "1초에 N원" (정수, 올림)

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    stallCount: $("stallCount"),
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
    satSeconds: 0, // 앉아있는 시간(초) — 적립은 perSecInt() × satSeconds(올림 기준)
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
        perSecInt() * Math.min(state.satSeconds, MAX_SESSION_SECONDS);
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
    el.salaryLabel.textContent = salaryText(v);
    el.salaryBig.textContent = salaryText(v);
    if (v === 0) {
      el.salaryRate.textContent = "수입 0원 😌";
      el.rateLabel.textContent = "실시간 손해보는 중";
    } else {
      el.salaryRate.textContent = `1초에 약 ${perSecInt()}원`;
      el.rateLabel.textContent = `실시간 1초에 ${perSecInt().toLocaleString("ko-KR")}원 버는중`;
    }
    el.salaryRange.value = idx;
    recomputePersonal(); // 지나간 시간만큼 다시 계산
    LS.set(KEY.salary, v);
  }
  function recomputePersonal() {
    state.personal = perSecInt() * state.satSeconds; // 올림된 초당 수입 기준으로 누적
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
  const tabularWon = (s) =>
    s.replace(/[0-9]/g, (d) => `<span class="digit">${d}</span>`);
  function renderPersonal(tick) {
    el.personalEarned.innerHTML = tabularWon(wonNum(state.personal)); // ₩ 대신 N원, 숫자만 고정폭
    if (tick) replayAnim(el.personalEarned, "tick", false);
  }
  function renderGlobal(flash) {
    el.globalEarned.textContent = wonNum(state.global);
    // 최초 적응시간이 지난 후에만 애니메이션 실행
    if (flash && Date.now() >= adaptationEndTime)
      replayAnim(el.globalChip, "flash", false);
  }
  function renderTimer() {
    el.timerVal.textContent = mmss(state.satSeconds);
  }
  function renderTotal() {
    const text = `총 ${wonNum(state.totalEarned)}`;
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
  // 도장을 한 번 찍었다는 건 이미 모든 넛지를 거칠 만큼 깊이 참여했다는 뜻 —
  // 아직 안 뜬 "총 N원"/내 월급 👈 힌트가 있다면 기다리지 말고 바로 프리패스 처리한다.
  function revealReceiptFromStamp() {
    revealTotal();
    markSalaryClicked();
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
      state.satSeconds += 1;
      state.personal = perSecInt() * state.satSeconds; // 올림된 초당 수입 기준으로 누적
      if (isPersonalAbuse()) {
        handleAbuse();
        return;
      }
      renderPersonal(state.salary > 0 && state.satSeconds % 5 === 0); // 5초에 한 번만 심장박동(틱)
      if (state.timer) renderTimer();
      if (state.satSeconds >= MAX_SESSION_SECONDS) autoFlush(); // 60분 경과 → 강제 물내림
    }, 1000);
  }
  startTicker();

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
  // chatText: 내 채팅 피드에 띄울 멘트(null이면 기본 자랑 멘트 사용 — 자동 물내림의 변비 멘트용)
  function commitFlush(amount, chatText) {
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
    maybeRevealReceipt(); // 증가된 flushCount(완료 누적) 기준으로 2회 조건 판정
    recordFlush(amount);
    rotateReceiptSlogan();
    resetTimer();
    confettiBurst();
    flushSound();
    socket.flush(amount, true, chatText); // 물내리면 항상 내 채팅에 자랑 멘트 노출
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
    commitFlush(amount, null);
  }

  // 60분 경과 자동 물내림 (변비 B급 멘트)
  function autoFlush() {
    const amount = Math.ceil(state.personal);
    if (state.salary === 0 || amount < 1) {
      resetTimer(); // 무수입이면 그냥 리셋만
      toast(pickRestLine());
      return;
    }
    commitFlush(amount, pick(CONSTIPATION_LINES));
  }

  /* ---------- 물내림 컨페티 (돈/박수 쏟아짐) ---------- */
  const CONFETTI_DURATION = 2000;
  function confettiBurst() {
    const emojis = ["💰", "💵", "👏"];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 18; i++) {
      const c = document.createElement("div");
      c.className = "confetti";
      c.textContent = pick(emojis);
      c.style.left = Math.random() * 100 + "%";
      c.style.animationDuration = 1 + Math.random() * 1.1 + "s";
      c.style.animationDelay = Math.random() * (CONFETTI_DURATION - 800) + "ms";
      frag.appendChild(c);
    }
    el.confettiLayer.appendChild(frag);
    setTimeout(() => {
      el.confettiLayer.innerHTML = "";
    }, CONFETTI_DURATION + 1200);
  }

  /* ---------- 물내림 자랑 멘트 ---------- */
  const flushBrag = (amount) => pick(FLUSH_BRAGS)(wonNum(amount));

  /* ---------- 공통 ---------- */
  const safe = (s) =>
    String(s).replace(
      /[<>&]/g,
      (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c],
    );

  /* ---------- 옆칸(봇) 말풍선 — 좌/우 벽, 꼬리, 겹침 회피 ---------- */
  function showBubble(msg, forceSide) {
    const side = forceSide || (Math.random() < 0.5 ? "left" : "right");
    const layer = side === "left" ? el.bubblesLeft : el.bubblesRight;
    const b = document.createElement("div");
    b.className = "bubble" + (msg.kind === "flush" ? " bubble--flush" : "");
    b.innerHTML = `<b>${safe(msg.name)}</b>${safe(msg.text)}`;
    layer.appendChild(b);
    while (layer.children.length > 3) layer.removeChild(layer.firstChild);
    placeBubble(layer, b); // 높이(1~2줄) 측정 후 안 겹치게 배치
    setTimeout(() => b.remove(), 5200);
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

  /* ---------- 토스트 (기본 5초 고정) ---------- */
  const TOAST_DURATION = 5000;
  let toastTimer;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), TOAST_DURATION);
  }

  /* ---------- 채팅 도배 방지 ---------- */
  const chatGuard = {
    mutedUntil: 0,
    recentMessages: [], // [{ text, norm, at }]
    defaultPlaceholder: el.chatInput?.placeholder || "옆 칸 모두에게 한마디",
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

  /* ---------- 효과음 ---------- */
  let actx;
  function flushSound() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      // 동전 여러 개가 떨어져 부딪히는 "딸그랑" 소리
      const clinks = 5;
      for (let i = 0; i < clinks; i++) {
        const start = t + i * 0.06 + Math.random() * 0.02;
        const freq = 1700 + Math.random() * 1500;
        const o = actx.createOscillator();
        o.type = "triangle";
        o.frequency.setValueAtTime(freq, start);
        o.frequency.exponentialRampToValueAtTime(freq * 0.82, start + 0.09);
        const g = actx.createGain();
        const vol = 0.24 * (1 - (i / clinks) * 0.55);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(vol, start + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
        o.connect(g).connect(actx.destination);
        o.start(start);
        o.stop(start + 0.15);
      }
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

  /* ---------- 소켓 ---------- */
  const socket = new FakeToiletSocket();
  socket.on("presence", ({ count }) => {
    state.stalls = count;
    el.stallCount.textContent = count;
  });
  socket.on("global", ({ total }) => {
    state.global = total;
    renderGlobal();
  });
  socket.on("chat", (msg) => {
    if (msg.kind === "system") return; // 입장 알림: 기능만 유지, 표시 보류
    if (msg.kind === "me") {
      showMyMessage(msg.text, "chat");
      return;
    } // 내 채팅 → 덱 위 피드(민트)
    if (isFocusPaused()) return; // 팝퍼 집중 모드 — 백그라운드 채팅 보류
    showBubble({ name: msg.name, text: msg.text, kind: msg.kind });
  });
  socket.on("flush", (f) => {
    state.global = f.total;
    renderGlobal(!isFocusPaused()); // 집중 모드 중엔 반짝임 생략(숫자는 갱신)
    if (f.me) {
      if (f.chat) showMyMessage(f.text || flushBrag(f.amount), "flush");
      return;
    } // 내 정산 → 피드(노랑)
    if (isFocusPaused()) return; // 팝퍼 집중 모드 — 백그라운드 채팅 보류
    showBubble({
      name: f.name,
      text: f.text || flushBrag(f.amount),
      kind: "flush",
    });
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
    toast("내 기록 초기화 완료 🧹");
  }
  function openResetConfirm() {
    el.resetConfirmFlushes.textContent = `${state.flushCount || 0}회`;
    el.resetConfirmTotal.textContent = wonNum(state.totalEarned);
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
      localStorage.clear();
      window.location.reload();
    });
  }

  el.settingsShareBtn.addEventListener("click", async () => {
    const url = window.location.origin;
    const text = url;
    if (navigator.share) {
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

  $("receiptBtn").addEventListener("click", openReceipt);
  $("receiptBtnSettings").addEventListener("click", openReceipt);

  /* ---------- 시작 ---------- */
  loadAll();
  initSalaryHint();
  if (isStoredAbuse()) handleAbuse();
  sessionStartAt = Date.now();
  adaptationEndTime = sessionStartAt + ADAPTATION_TIME;
  // 이전에 이미 등장했던 브라우저면 바로 표시(연출 없이)
  if (state.receiptRevealed) showReceiptBtn(false);
  applySalary(state.salary);
  renderPersonal();
  // 설정 UI 초기화
  el.nickInput.value = state.nick;
  updateChatPlaceholder();
  el.nickPinChk.checked = state.nickPinned;
  el.timerToggle.checked = state.timer;
  renderTotal();
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
    if (skinTp) skinTp.removeEventListener("click", tearToiletPaper);
    if (skinLatch) skinLatch.removeEventListener("click", toggleLatch);
    window.removeEventListener(APP_EVENTS.toast, onPayslipToast);
    window.removeEventListener(APP_EVENTS.payslipStamped, revealReceiptFromStamp);
    try {
      socket.disconnect();
    } catch (e) {}
  };
} // end initGame
