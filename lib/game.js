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
  RECEIPT_SLOGANS,
  SETTINGS_LINK_MESSAGES,
  AD_CREATIVES,
} from "@/lib/constants";

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
  const pickSurname = () =>
    weightedPick(
      SURNAMES.map((s) => ({
        value: s.name,
        weight: SURNAME_TIER_WEIGHT[s.tier],
      })),
    );
  const pickRank = () =>
    pick(
      weightedPick(
        RANK_GROUPS.map((g) => ({ value: g.ranks, weight: g.weight })),
      ),
    );
  const randomNickname = () =>
    `${pick(NICK_FRONT_WORDS)} ${pickSurname()}${pickRank()}`.slice(0, 10);

  /* ---------- 포맷 ---------- */
  const wonNum = (n) => Math.ceil(n).toLocaleString("ko-KR") + "원"; // n원 (₩ 없음)
  const salaryText = (v) =>
    v === 0 ? "휴식중" : v >= 100_000_000 ? "1억원" : v / 10000 + "만원"; // 쉼표 없이 짧게
  const mmss = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  function pick(a) {
    return a[Math.floor(Math.random() * a.length)];
  }
  function uniqSortKo(arr) {
    return [...new Set(arr)].sort((a, b) => a.localeCompare(b, "ko"));
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
    resetConfirmModal: $("resetConfirmModal"),
    resetConfirmBackdrop: $("resetConfirmBackdrop"),
    resetConfirmFlushes: $("resetConfirmFlushes"),
    resetConfirmTotal: $("resetConfirmTotal"),
    resetConfirmCancel: $("resetConfirmCancel"),
    resetConfirmYes: $("resetConfirmYes"),
    chatForm: $("chatForm"),
    chatInput: $("chatInput"),
    chatNick: $("chatNick"),
    bubblesLeft: $("bubblesLeft"),
    bubblesRight: $("bubblesRight"),
    myFeed: $("myFeed"),
    confettiLayer: $("confettiLayer"),
    toast: $("toast"),
    adA4: $("adA4"),
    adEmoji: $("adEmoji"),
    adHead: $("adHead"),
    adSub: $("adSub"),
    settingsLinks: document.querySelectorAll(".settings__link"),
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
    flushHistory: [], // 최근 물내림 Queue(최대 10건) — { n: 회차, amount: 벌은 금액 }
  };

  const FLUSH_HISTORY_KEY = "ddong_flush_history";
  const FLUSH_HISTORY_MAX = 10;

  /* ---------- 저장/로드 ---------- */
  const LS = {
    get: (k, d) => {
      const v = localStorage.getItem(k);
      return v === null ? d : v;
    },
    set: (k, v) => localStorage.setItem(k, v),
    remove: (k) => localStorage.removeItem(k),
  };
  function parseFlushHistory(raw) {
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .map((item) => ({
          n: Math.max(1, parseInt(item?.n, 10) || 0),
          amount: Math.max(0, Math.ceil(Number(item?.amount) || 0)),
        }))
        .filter((item) => item.n > 0)
        .slice(-FLUSH_HISTORY_MAX);
    } catch {
      return [];
    }
  }
  function saveFlushHistory() {
    LS.set(FLUSH_HISTORY_KEY, JSON.stringify(state.flushHistory));
  }
  function recordFlush(amount) {
    state.flushHistory.push({ n: state.flushCount, amount });
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
    const sv = Number(LS.get("ddong_salary", NaN));
    state.salary = SALARY_STEPS.includes(sv) ? sv : DEFAULT_SALARY;
    // 닉네임 ("고정" 체크되어 저장된 값이 있으면 그걸, 없으면 매번 새 랜덤)
    state.nickPinned = LS.get("ddong_nickpin", "0") === "1";
    const savedNick = (LS.get("ddong_nick", "") || "").trim();
    state.nick =
      state.nickPinned && savedNick ? savedNick.slice(0, 10) : randomNickname();
    // 합계 / 토글
    state.totalEarned = Math.max(0, Number(LS.get("ddong_total", 0)) || 0);
    state.flushCount = Math.max(
      0,
      parseInt(LS.get("ddong_flushcount", "0"), 10) || 0,
    );
    state.flushHistory = parseFlushHistory(LS.get(FLUSH_HISTORY_KEY, "[]"));
    state.timer = LS.get("ddong_timer", "1") === "1";
  }

  // 1조 이상 / 물내림 10만 이상 / 히스토리 > 물내림 횟수는 비정상으로 판단
  function isStateValid() {
    if (!isFinite(state.totalEarned) || state.totalEarned > 1e12) return false;
    if (!isFinite(state.flushCount) || state.flushCount > 100_000) return false;
    if (state.flushHistory.length > state.flushCount) return false;
    return true;
  }

  // 게임 기록만 초기화 (월급·닉네임·타이머 설정은 유지)
  function wipeGameStats() {
    state.totalEarned = 0;
    state.flushCount = 0;
    state.flushHistory = [];
    LS.set("ddong_total", 0);
    LS.set("ddong_flushcount", 0);
    LS.set(FLUSH_HISTORY_KEY, "[]");
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
    LS.set("ddong_salary", v);
  }
  function recomputePersonal() {
    state.personal = perSecInt() * state.satSeconds; // 올림된 초당 수입 기준으로 누적
    renderPersonal();
  }

  /* ---------- 표시 ---------- */
  const tabularWon = (s) =>
    s.replace(/[0-9]/g, (d) => `<span class="digit">${d}</span>`);
  function renderPersonal(tick) {
    el.personalEarned.innerHTML = tabularWon(wonNum(state.personal)); // ₩ 대신 N원, 숫자만 고정폭
    if (tick) {
      el.personalEarned.classList.remove("tick");
      void el.personalEarned.offsetWidth;
      el.personalEarned.classList.add("tick");
    }
  }
  function renderGlobal(flash) {
    el.globalEarned.textContent = wonNum(state.global);
    if (flash) {
      el.globalChip.classList.remove("flash");
      void el.globalChip.offsetWidth;
      el.globalChip.classList.add("flash");
    }
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
  }
  function nudgeReceiptBtn() {
    const icon = $("receiptBtnIcon");
    if (!icon) return;
    icon.classList.remove("flush-receipt__icon--nudge");
    void icon.offsetWidth;
    icon.classList.add("flush-receipt__icon--nudge");
    icon.addEventListener(
      "animationend",
      () => icon.classList.remove("flush-receipt__icon--nudge"),
      { once: true },
    );
  }
  let receiptNudgeTimer = null;
  function scheduleReceiptNudge() {
    if (receiptNudgeTimer) clearTimeout(receiptNudgeTimer);
    receiptNudgeTimer = setTimeout(() => {
      receiptNudgeTimer = null;
      nudgeReceiptBtn();
    }, 5000);
  }

  /* ---------- 적립: 1초마다 ---------- */
  let tickInterval = null;
  function startTicker() {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
      state.satSeconds += 1;
      state.personal = perSecInt() * state.satSeconds; // 올림된 초당 수입 기준으로 누적
      renderPersonal(state.salary > 0 && state.satSeconds % 5 === 0); // 5초에 한 번만 심장박동(틱)
      if (state.timer) renderTimer();
      if (state.satSeconds >= 3600) autoFlush(); // 60분 경과 → 강제 물내림
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

  function flush() {
    if (el.flushBtn.disabled) return;
    if (state.salary === 0) {
      toast(pick(REST_LINES));
      return;
    }
    const amount = Math.ceil(state.personal);
    if (amount < 1) return;
    state.totalEarned += amount;
    LS.set("ddong_total", state.totalEarned);
    renderTotal();
    scheduleReceiptNudge();
    state.flushCount += 1;
    LS.set("ddong_flushcount", state.flushCount);
    recordFlush(amount);
    resetTimer();
    confettiBurst();
    flushSound();
    socket.flush(amount, true); // 물내리면 항상 내 채팅에 자랑 멘트 노출
    startFlushCooldown();
  }

  /* ---------- 60분 자동 물내림 (변비 B급 멘트) ---------- */
  function autoFlush() {
    const amount = Math.ceil(state.personal);
    resetTimer();
    if (state.salary === 0 || amount < 1) {
      toast(pick(REST_LINES));
      return;
    } // 무수입이면 그냥 리셋만
    state.totalEarned += amount;
    LS.set("ddong_total", state.totalEarned);
    renderTotal();
    scheduleReceiptNudge();
    state.flushCount += 1;
    LS.set("ddong_flushcount", state.flushCount);
    recordFlush(amount);
    confettiBurst();
    flushSound();
    socket.flush(amount, true, pick(CONSTIPATION_LINES)); // 변비 멘트는 항상 노출
    startFlushCooldown();
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
    while (layer.children.length > 5) layer.removeChild(layer.firstChild);
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
  function rotateAd() {
    const a = AD_CREATIVES[adIdx++ % AD_CREATIVES.length];
    el.adEmoji.textContent = a.emoji;
    el.adHead.textContent = a.head;
    el.adSub.innerHTML = a.sub.replace(/\n/g, "<br>");
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
    showBubble({ name: msg.name, text: msg.text, kind: msg.kind });
  });
  socket.on("flush", (f) => {
    state.global = f.total;
    renderGlobal(true);
    if (f.me) {
      if (f.chat) showMyMessage(f.text || flushBrag(f.amount), "flush");
      return;
    } // 내 정산 → 피드(노랑)
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
    if (state.nickPinned) LS.set("ddong_nick", v);
    else LS.remove("ddong_nick");
    updateChatPlaceholder();
  }

  function updateChatPlaceholder() {
    el.chatNick.textContent = `${state.nick}`;
  }

  /* ---------- 팝오버 ---------- */
  function closeSalaryPanel() {
    el.salaryPanel.hidden = true;
  }
  function closeSettingsPanel() {
    if (el.settingsPanel.hidden) return;
    finalizeNickname();
    el.settingsPanel.hidden = true;
    document
      .getElementById("nickRandomIcon")
      .classList.remove("nick-random--spin");
  }
  function closePanels(except) {
    if (except !== "salary") closeSalaryPanel();
    if (except !== "settings") closeSettingsPanel();
  }

  /* ---------- 이벤트 ---------- */
  el.flushBtn.addEventListener("click", flush);

  el.salaryToggle.addEventListener("click", () => {
    const willOpen = el.salaryPanel.hidden;
    if (willOpen) {
      closePanels("salary");
      el.salaryPanel.hidden = false;
    } else {
      closeSalaryPanel();
    }
  });
  el.salaryRange.addEventListener("input", (e) =>
    applySalary(SALARY_STEPS[Number(e.target.value)]),
  );
  el.salaryRange.addEventListener("change", (e) => {
    applySalary(SALARY_STEPS[Number(e.target.value)]);
    closeSalaryPanel();
  });

  el.gearBtn.addEventListener("click", () => {
    const willOpen = el.settingsPanel.hidden;
    if (willOpen) {
      closePanels("settings");
      el.settingsPanel.hidden = false;
    } else {
      closeSettingsPanel();
    }
  });
  // 팝오버 외 영역 클릭 시 닫기 (단, 기록 초기화 확인창이 떠 있을 때는 그 창 클릭으로 뒷 팝오버가 닫히지 않게 한다)
  document.addEventListener("click", (e) => {
    if (el.resetConfirmModal.contains(e.target)) return;
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
    if (state.nickPinned) LS.set("ddong_nick", state.nick);
    const icon = document.getElementById("nickRandomIcon");
    icon.classList.remove("nick-random--spin");
    void icon.offsetWidth;
    icon.classList.add("nick-random--spin");
    icon.addEventListener(
      "animationend",
      () => icon.classList.remove("nick-random--spin"),
      { once: true },
    );
  });
  el.nickPinChk.addEventListener("change", (e) => {
    state.nickPinned = e.target.checked;
    LS.set("ddong_nickpin", state.nickPinned ? "1" : "0");
    if (state.nickPinned) LS.set("ddong_nick", state.nick);
    else LS.remove("ddong_nick");
  });
  el.timerToggle.addEventListener("change", (e) => {
    state.timer = e.target.checked;
    LS.set("ddong_timer", state.timer ? "1" : "0");
    el.timer.hidden = !state.timer;
    if (state.timer) renderTimer();
  });
  function performReset() {
    state.totalEarned = 0;
    state.flushCount = 0;
    clearFlushHistory();
    LS.set("ddong_total", 0);
    LS.set("ddong_flushcount", 0);
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

  el.settingsLinks.forEach((btn) => {
    btn.addEventListener("click", () =>
      toast(SETTINGS_LINK_MESSAGES[btn.dataset.action] || "준비중입니다"),
    );
  });

  el.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;
    socket.send(text);
    el.chatInput.value = "";
  });
  el.adA4.addEventListener("click", (e) => {
    e.preventDefault();
    toast("광고 문의: 이 자리에 실광고 연결 📢");
  });

  /* =====================================================================
   화장실 급여명세서 공유 (SNS 바이럴)
   - 미리보기는 React ReceiptCard(공유 페이지와 동일 컴포넌트)로 렌더.
   - 명세서에는 "내 월급"과 "누적시간"을 절대 넣지 않는다.
   ===================================================================== */
  function buildReceiptData() {
    const stalls = state.stalls || parseInt(el.stallCount.textContent, 10) || 0;
    return {
      n: (state.nick || "익명의 볼일러").slice(0, 16),
      h: state.flushHistory.slice(-FLUSH_HISTORY_MAX).map((it) => it.amount),
      t: Math.max(0, state.totalEarned),
      g: Math.max(0, state.global),
      p: stalls,
      f: state.flushCount || 0,
      ts: Date.now(),
      sl: Math.floor(Math.random() * RECEIPT_SLOGANS.length),
    };
  }

  function openReceipt() {
    closePanels();
    window.dispatchEvent(
      new CustomEvent("ddong:payslip-open", { detail: buildReceiptData() }),
    );
  }

  const onPayslipToast = (e) => {
    if (e instanceof CustomEvent && typeof e.detail === "string")
      toast(e.detail);
  };
  window.addEventListener("ddong:toast", onPayslipToast);

  $("receiptBtn").addEventListener("click", openReceipt);
  $("receiptBtnSettings").addEventListener("click", openReceipt);

  /* ---------- 시작 ---------- */
  loadAll();
  if (!isStateValid()) {
    wipeGameStats();
    toast("저장된 기록이 손상돼 초기화했어요 🧹");
  }
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
    adInterval = setInterval(rotateAd, 6000);
  }, 3000);
  socket.connect();

  /* ---------- cleanup (언마운트 시 인터벌/가짜소켓 정리) ---------- */
  return () => {
    if (tickInterval) clearInterval(tickInterval);
    clearTimeout(adStartTimer);
    if (adInterval) clearInterval(adInterval);
    if (receiptNudgeTimer) clearTimeout(receiptNudgeTimer);
    window.removeEventListener("ddong:toast", onPayslipToast);
    try {
      socket.disconnect();
    } catch (e) {}
  };
} // end initGame
