/* ===================================================================
   똥탐 · app.js  — 공중화장실에서 돈 버는 메인 로직
   =================================================================== */

const CONFIG = { workDaysPerMonth: 22, workHoursPerDay: 8 };

// 월급(원) → 초당 수입
const perSec = (salary) =>
  salary / (CONFIG.workDaysPerMonth * CONFIG.workHoursPerDay * 3600);

// 월급 슬라이더 스텝 (원): 0(참는중) → 100~1000만(100만 단위) → 2000 → 5000 → 1억
const SALARY_STEPS = [
  0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 5000, 10000,
].map((m) => m * 10000);
const DEFAULT_SALARY = 3_000_000;
// 월급 0원 = "참는 중" — 회사 가서 싸야 돈 번다는 B급 뉘앙스
const REST_LINES = [
  "지금 싸면 손해!",
  "참고 회사가서 싸야 돈벌지 ㅋㅋ",
  "너무 아깝다",
];
const CONSTIPATION_LINES = [
  "60분째 같은 자세... 변비 확정! 강제 물내림 ㅠㅠ",
  "1시간 버티다 결국 변비 인증, 강제 퇴장합니다",
  "다리에 쥐나서 강제 물내림... 이쯤되면 그냥 변비",
  "한 시간 앉아있었더니 의자가 됨. 강제 물내림 ㅋㅋ",
];

/* ---------- 닉네임 자동생성 데이터 (앞단어 + 성씨 + 직급) ----------
   닉네임 = pick(FRONT_WORDS) + pickSurname() + pickRank()
   각 배열/가중치는 아래에서 자유롭게 수정 가능 ---------- */

const uniqueFrontWords = [
  "3사로",
  "2층끝칸",
  "5분지난",
  "4층둘째칸",
  "갈곳잃은",
  "날로먹는",
  "삘받은",
  "1층화장실",
  "심심한",
  "기름진",
  "기도하는",
  "기척없는",
  "긴급상황",
  "과민대장",
  "데이터다쓴",
  "방귀대장",
  "김밥먹는",
  "꽉막힌",
  "숙면중인",
  "내려놓은",
  "넷플보는",
  "노캔중인",
  "농땡이",
  "장염걸린",
  "눈치보는",
  "느낌좋은",
  "뉴스보는",
  "단골손님",
  "단타왕",
  "매우급한",
  "오래참은",
  "뛰어온",
  "댓글다는",
  "드러누운",
  "뚜껑내린",
  "과음한",
  "엄청쌓인",
  "많이모은",
  "표류중인",
  "매일출석",
  "해탈한",
  "멍때리는",
  "시끄러운",
  "못끊는",
  "피곤한",
  "몰래나온",
  "반응없는",
  "무아지경",
  "퇴사각",
  "물티슈왕",
  "밥값하는",
  "방금온",
  "변기위의",
  "부끄러운",
  "자랑하는",
  "귀밝은",
  "진심인",
  "목숨건",
  "부여잡은",
  "불경외는",
  "비데필수",
  "사람냄새",
  "십분초과",
  "고액연봉",
  "최저임금",
  "상쾌한",
  "색깔좋은",
  "소설읽는",
  "숏폼중독",
  "숙취심한",
  "숨바꼭질",
  "노래하는",
  "통화중인",
  "시말서쓴",
  "시원한",
  "쑥내려간",
  "안나가는",
  "에어팟낀",
  "집가고픈",
  "지박령",
  "영혼없는",
  "월급루팡",
  "현자가된",
  "딱걸린",
  "누리고픈",
  "흥분한",
  "웹툰주행",
  "유급휴가",
  "변기막힌",
  "사라진",
  "유튜브시청",
  "융단폭격",
  "응원단장",
  "이어폰낀",
  "인생무상",
  "인스타중",
  "일퀘하는",
  "자리비운",
  "자체복지",
  "잠수중인",
  "중독된",
  "적립왕",
  "전설이된",
  "전세낸",
  "넘쳐버린",
  "조퇴각",
  "식곤증온",
  "원격근무",
  "존버타는",
  "주식보는",
  "배아픈",
  "외근나간",
  "출장중인",
  "업비트중",
  "차트보는",
  "천둥치는",
  "천만원번",
  "밤샘근무",
  "추노한",
  "칼퇴고픈",
  "커뮤중인",
  "뚜껑덮은",
  "커피값번",
  "조난당한",
  "양심적인",
  "물내리는",
  "파업예고",
  "과자먹는",
  "쾌변달인",
  "쿠키충전",
  "큰일난",
  "절박한",
  "투명인간",
  "루틴강박",
  "평생회원",
  "엉뜨필수",
  "풀배터리",
  "변비걸린",
  "향기로운",
  "무색무취",
  "황금빛깔",
  "황홀한",
  "뛰쳐나온",
  "즉흥적인",
  "휴지없는",
  "그냥와본",
  "싹다비운",
  "잘만드는",
  "한발늦은",
  "사장라인",
  "특급닌자",
  "다크템플러",
  "불법체류",
  "모범직원",
  "백두혈통",
  "뻔뻔한",
  "진급대상",
  "못참는",
  "도망자",
];
const FRONT_WORDS = uniqSortKo(uniqueFrontWords);

// 우리나라 상위 100개 성씨 (2015 인구주택총조사 기준 점유율 추정) — 상(흔함)/중(보통)/하(희귀) 3단계
const SURNAMES = [
  ...[
    "김",
    "이",
    "박",
    "최",
    "정",
    "강",
    "조",
    "윤",
    "장",
    "임",
    "한",
    "오",
    "서",
    "신",
    "권",
    "황",
    "안",
    "송",
    "전",
    "홍",
    "유",
    "고",
  ].map((name) => ({ name, tier: "상" })),
  ...[
    "문",
    "양",
    "손",
    "배",
    "백",
    "허",
    "남",
    "심",
    "노",
    "하",
    "곽",
    "성",
    "차",
    "주",
    "우",
    "구",
    "나",
    "민",
    "진",
    "지",
    "엄",
    "채",
    "원",
    "천",
    "방",
    "공",
    "현",
    "함",
    "변",
    "염",
    "여",
    "추",
    "동",
    "석",
    "선",
    "설",
    "마",
    "길",
  ].map((name) => ({ name, tier: "중" })),
  ...[
    "표",
    "명",
    "기",
    "반",
    "왕",
    "금",
    "옥",
    "육",
    "맹",
    "모",
    "탁",
    "은",
    "편",
    "봉",
    "예",
  ].map((name) => ({ name, tier: "하" })),
];
// 성씨 흔한 정도별 가중치 — 숫자만 바꾸면 등장 비율이 조정됨
const SURNAME_TIER_WEIGHT = { 상: 6, 중: 3, 하: 1 };

// 직급 그룹 — 그룹을 먼저 weight(%)로 뽑고, 그 안에서 균등 랜덤
const RANK_GROUPS = [
  { weight: 40, ranks: ["전무", "상무", "부장", "차장"] },
  { weight: 60, ranks: ["과장", "대리", "사원", "주임", "인턴"] },
];

function weightedPick(items) {
  // items: [{value, weight}]
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
  `${pick(FRONT_WORDS)} ${pickSurname()}${pickRank()}`.slice(0, 10);

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
  totalToggle: $("totalToggle"),
  timerToggle: $("timerToggle"),
  resetTotalBtn: $("resetTotalBtn"),
  chatForm: $("chatForm"),
  chatInput: $("chatInput"),
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
  showTotal: false, // 합계 표시
  timer: false, // 타이머 표시
  stalls: 0, // 지금 볼일 중인 사람 수(서버) — 영수증용
  flushCount: 0, // 내 물내림 누적 횟수 — 영수증용(시간/월급 유추 불가)
};

/* ---------- 저장/로드 ---------- */
const LS = {
  get: (k, d) => {
    const v = localStorage.getItem(k);
    return v === null ? d : v;
  },
  set: (k, v) => localStorage.setItem(k, v),
  remove: (k) => localStorage.removeItem(k),
};
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
  state.showTotal = LS.get("ddong_showtotal", "1") === "1";
  state.timer = LS.get("ddong_timer", "1") === "1";
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
    el.salaryRate.textContent = `1초에 약 ${state.earnRate.toFixed(1)}원`; // 소수 1자리
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
  el.totalEarned.textContent = `총 ${wonNum(state.totalEarned)}`;
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
  state.flushCount += 1;
  LS.set("ddong_flushcount", state.flushCount);
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
  state.flushCount += 1;
  LS.set("ddong_flushcount", state.flushCount);
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

/* ---------- 물내림 자랑 멘트 (4종 랜덤) ---------- */
const FLUSH_BRAGS = [
  (n) => `${n} 벌고 물내림 ㅋㅋ 짝짝`,
  (n) => `방금 ${n} 적립하고 시원하게 내림 ㅋㅋ`,
  (n) => `${n} 벌었다 물내린다~ 부럽지 ㅋㅋ`,
  (n) => `오늘도 ${n} 벌고 물내림 ㅋㅋㅋ 짝짝`,
];
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
const AD_CREATIVES = [
  { emoji: "📢", head: "여기에 광고", sub: "A4 광고 영역\n문의 환영" },
  { emoji: "🍗", head: "야근엔 치킨", sub: "지금 주문하면\n10분 컷" },
  { emoji: "☕", head: "졸음엔 카페인", sub: "사무실 옆\n무인카페" },
  { emoji: "💊", head: "변비엔 OO유산균", sub: "광고주를\n기다립니다" },
];
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
// 팝오버 외 영역 클릭 시 닫기
document.addEventListener("click", (e) => {
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
el.totalToggle.addEventListener("change", (e) => {
  state.showTotal = e.target.checked;
  LS.set("ddong_showtotal", state.showTotal ? "1" : "0");
  el.totalEarned.hidden = !state.showTotal;
  el.resetTotalBtn.hidden = !state.showTotal;
  renderTotal();
});
el.timerToggle.addEventListener("change", (e) => {
  state.timer = e.target.checked;
  LS.set("ddong_timer", state.timer ? "1" : "0");
  el.timer.hidden = !state.timer;
  if (state.timer) renderTimer();
});
el.resetTotalBtn.addEventListener("click", () => {
  state.totalEarned = 0;
  LS.set("ddong_total", 0);
  renderTotal();
  toast("내가 번 돈 합계 초기화 완료 🧹");
});

const SETTINGS_LINK_MESSAGES = {
  donate: "후원 페이지 연결 예정입니다 ☕",
  guide: "사용가이드 준비중입니다 📖",
  ad: "광고 문의: 이 자리에 실광고 연결 📢",
  feedback: "의견 보내기 기능은 준비중입니다 ✉️",
  privacy: "개인정보처리방침 페이지 연결 예정입니다 🔒",
};
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
   영수증 공유 (SNS 바이럴)
   - 영수증에는 "내 월급"과 "누적시간(앉아있던 시간)"을 절대 넣지 않는다.
     → 월급(초당수입)은 personal/satSeconds 로만 역산 가능한데, 시간을 안 보이므로 역산 불가.
   - canvas로 직접 그려 미리보기=공유 이미지가 100% 일치하게 한다.
   ===================================================================== */
const RECEIPT_SLOGANS = [
  "회사에서 싸야 이득 💸",
  "근무시간에 싸면 월급 루팡 완성",
  "오늘도 황금 같은 휴식 🪙",
  "변기 위에서도 돈은 쌓인다",
  "쌀 때마다 적립, 인생은 한 방 ㅋㅋ",
];
const SHARE_URL = location.origin + location.pathname;
let currentReceiptCanvas = null;

function buildReceiptCanvas() {
  const W = 400,
    PAD = 30;
  const INK = "#20271f",
    SUB = "#717a6f",
    LINE = "#c9ccc0",
    PAPER = "#fbfaf3",
    GOLD = "#a9760a";
  const font = (s, w = "400") =>
    `${w} ${s}px "Courier New","Apple SD Gothic Neo","Pretendard",monospace`;
  const f = (n) => Math.max(0, Math.ceil(n)).toLocaleString("ko-KR") + "원";

  // ---- 영수증에 들어갈 값 (월급·시간 제외) ----
  const now = new Date(),
    z = (n) => String(n).padStart(2, "0");
  const issued = `${now.getFullYear()}.${z(now.getMonth() + 1)}.${z(now.getDate())}  ${z(now.getHours())}:${z(now.getMinutes())}`;
  const settled = Math.max(0, state.totalEarned); // 이미 물내린 누적
  const live = Math.max(0, Math.ceil(state.personal)); // 진행중(아직 안 내린) 금액
  const hero = settled + live; // 합계 = 두 항목의 합
  const global = Math.max(0, state.global);
  const stalls = state.stalls || parseInt(el.stallCount.textContent, 10) || 0;
  const flushes = state.flushCount || 0;
  const nick = (state.nick || "익명의 볼일러").slice(0, 12);
  const slogan = pick(RECEIPT_SLOGANS);

  const text = (ctx, s, x, y, ft, col, align) => {
    if (!ctx) return;
    ctx.font = ft;
    ctx.fillStyle = col;
    ctx.textAlign = align || "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x, y);
  };
  const dash = (ctx, y) => {
    if (!ctx) return;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const solid = (ctx, y, w, col) => {
    if (!ctx) return;
    ctx.strokeStyle = col || INK;
    ctx.lineWidth = w || 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
  };
  const barcode = (ctx, yTop, h) => {
    if (!ctx) return;
    ctx.fillStyle = INK;
    let x = PAD,
      seed = (hero * 2654435761 + 12345) >>> 0;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    while (x < W - PAD) {
      const bw = 1 + Math.floor(rnd() * 3);
      if (rnd() > 0.34) ctx.fillRect(x, yTop, Math.min(bw, W - PAD - x), h);
      x += bw + 1 + Math.floor(rnd() * 2);
    }
  };

  // ctx === null 이면 높이만 측정(레이아웃 1회) → 캔버스 크기 확정 후 실제 그림
  function paint(ctx) {
    let y = 14; // 상단 톱니 여백
    y += 32;
    text(ctx, "💩 똥탐", W / 2, y, font(32, "800"), INK, "center");
    y += 20;
    text(ctx, "화 장 실  영 수 증", W / 2, y, font(13, "700"), SUB, "center");
    y += 12;
    dash(ctx, y);
    y += 22;
    text(ctx, "발행", PAD, y, font(12), SUB);
    text(ctx, issued, W - PAD, y, font(12), INK, "right");
    y += 20;
    text(ctx, "손님", PAD, y, font(12), SUB);
    text(ctx, nick, W - PAD, y, font(12, "700"), INK, "right");
    y += 12;
    dash(ctx, y);
    y += 22;
    text(ctx, "품목", PAD, y, font(11), SUB);
    text(ctx, "금액", W - PAD, y, font(11), SUB, "right");
    y += 25;
    text(ctx, "화장실 근무수당", PAD, y, font(13), INK);
    text(ctx, f(settled), W - PAD, y, font(13), INK, "right");
    y += 25;
    text(ctx, "실시간 적립(진행중)", PAD, y, font(13), INK);
    text(ctx, f(live), W - PAD, y, font(13), INK, "right");
    y += 12;
    solid(ctx, y, 1.6, INK);
    y += 24;
    text(ctx, "합계", PAD, y, font(15, "800"), INK);
    text(ctx, "TOTAL", PAD + 48, y, font(10), SUB);
    y += 42;
    text(ctx, f(hero), W / 2, y, font(38, "800"), INK, "center");
    y += 18;
    solid(ctx, y, 1.2, INK);
    solid(ctx, y + 3, 1.2, INK);
    y += 28;
    text(ctx, "오늘 다 같이 번 돈", W / 2, y, font(12, "700"), SUB, "center");
    y += 26;
    text(ctx, f(global), W / 2, y, font(20, "800"), GOLD, "center");
    y += 24;
    text(
      ctx,
      `지금 볼일 중  ${stalls}명   ·   내 물내림  ${flushes}회`,
      W / 2,
      y,
      font(11, "600"),
      SUB,
      "center",
    );
    y += 14;
    dash(ctx, y);
    y += 28;
    text(ctx, `"${slogan}"`, W / 2, y, font(13, "700"), INK, "center");
    y += 22;
    barcode(ctx, y, 38);
    y += 38 + 20;
    text(ctx, "똥탐 · paid-toilet", W / 2, y, font(12, "700"), INK, "center");
    y += 18;
    text(
      ctx,
      SHARE_URL.replace(/^https?:\/\//, ""),
      W / 2,
      y,
      font(10),
      SUB,
      "center",
    );
    y += 16;
    return y;
  }

  const H = Math.ceil(paint(null)) + 14; // +하단 톱니 여백
  const dpr = Math.max(2, window.devicePixelRatio || 1);
  const c = document.createElement("canvas");
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);

  // 종이(상·하단 톱니 모양) — 어두운 배경이 톱니 사이로 비쳐 진짜 영수증 느낌
  const tooth = 14,
    d = 7;
  ctx.beginPath();
  ctx.moveTo(0, d);
  for (let x = 0; x < W; x += tooth) {
    ctx.lineTo(x + tooth / 2, 0);
    ctx.lineTo(x + tooth, d);
  }
  ctx.lineTo(W, H - d);
  for (let x = W; x > 0; x -= tooth) {
    ctx.lineTo(x - tooth / 2, H);
    ctx.lineTo(x - tooth, H - d);
  }
  ctx.closePath();
  ctx.fillStyle = PAPER;
  ctx.fill();

  paint(ctx);
  return c;
}

function openReceipt() {
  closePanels();
  currentReceiptCanvas = buildReceiptCanvas();
  const prev = $("receiptPreview");
  prev.innerHTML = "";
  prev.appendChild(currentReceiptCanvas);
  $("receiptModal").hidden = false;
}
function closeReceipt() {
  $("receiptModal").hidden = true;
}

const f0 = (n) => Math.max(0, Math.ceil(n)).toLocaleString("ko-KR") + "원";
function receiptShareText() {
  const hero =
    Math.max(0, state.totalEarned) + Math.max(0, Math.ceil(state.personal));
  return `💩 화장실에서 ${f0(hero)} 벌었다 ㅋㅋ\n#똥탐 너도 와서 벌어봐 👇\n${SHARE_URL}`;
}

function canvasToBlob(c) {
  return new Promise((res) => {
    try {
      c.toBlob((b) => res(b), "image/png");
    } catch (e) {
      res(null);
    }
  });
}
function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
async function shareReceipt() {
  const c = currentReceiptCanvas || buildReceiptCanvas();
  const blob = await canvasToBlob(c);
  const txt = receiptShareText();
  const file = blob
    ? new File([blob], "ddongtam-receipt.png", { type: "image/png" })
    : null;
  // 1) 이미지까지 공유 (모바일 Web Share Level 2)
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: txt });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  // 2) 텍스트/링크만이라도 공유
  if (navigator.share) {
    try {
      await navigator.share({ text: txt, url: SHARE_URL });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  // 3) 폴백: 이미지 저장 + 텍스트 클립보드(있으면, 비동기 best-effort)
  if (blob) downloadBlob(blob, "ddongtam-receipt.png");
  toast("영수증을 저장했어요. SNS에 올려보세요! 🧾");
  try {
    navigator.clipboard?.writeText(txt).catch(() => {});
  } catch (e) {}
}
async function saveReceipt() {
  const c = currentReceiptCanvas || buildReceiptCanvas();
  const blob = await canvasToBlob(c);
  if (blob) {
    downloadBlob(blob, "ddongtam-receipt.png");
    toast("영수증 이미지를 저장했어요 🧾");
  }
}

$("receiptBtn").addEventListener("click", openReceipt);
$("receiptBtnSettings").addEventListener("click", openReceipt);
$("receiptShare").addEventListener("click", shareReceipt);
$("receiptSave").addEventListener("click", saveReceipt);
$("receiptClose").addEventListener("click", closeReceipt);
$("receiptBackdrop").addEventListener("click", closeReceipt);

/* ---------- 시작 ---------- */
loadAll();
applySalary(state.salary);
renderPersonal();
// 설정 UI 초기화
el.nickInput.value = state.nick;
el.nickPinChk.checked = state.nickPinned;
el.totalToggle.checked = state.showTotal;
el.timerToggle.checked = state.timer;
el.totalEarned.hidden = !state.showTotal;
el.resetTotalBtn.hidden = !state.showTotal;
renderTotal();
el.timer.hidden = !state.timer;
renderTimer();
rotateAd();
setInterval(rotateAd, 6000);
socket.connect();
