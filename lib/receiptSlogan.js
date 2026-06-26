import { RECEIPT_SLOGANS } from "@/lib/constants";
import { LS as STORAGE_KEY } from "@/lib/storageKeys";

function sloganLen() {
  return RECEIPT_SLOGANS.length;
}

function loadSeen() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY.sloganSeen);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const n = sloganLen();
    return [
      ...new Set(
        arr
          .map((i) => Math.floor(Number(i)))
          .filter((i) => i >= 0 && i < n),
      ),
    ];
  } catch {
    return [];
  }
}

function loadIndex() {
  const raw = localStorage.getItem(STORAGE_KEY.sloganIndex);
  if (raw === null) return null;
  const idx = parseInt(raw, 10);
  const n = sloganLen();
  if (!Number.isFinite(idx) || idx < 0 || idx >= n) return null;
  return idx;
}

function save(index, seen) {
  localStorage.setItem(STORAGE_KEY.sloganIndex, String(index));
  localStorage.setItem(STORAGE_KEY.sloganSeen, JSON.stringify(seen));
}

function pickRandom(candidates) {
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** 현재 회차와 다르고, 이번 순환에서 아직 안 본 명언 중 랜덤 선택 */
function pickNextIndex(current, seen) {
  const n = sloganLen();
  if (n === 0) return { index: 0, seen: [] };
  if (n === 1) return { index: 0, seen: [0] };

  const seenSet = new Set(seen);
  let unseen = [];
  for (let i = 0; i < n; i++) {
    if (!seenSet.has(i)) unseen.push(i);
  }

  // 배열 길이만큼 모두 한 번씩 본 뒤에만 다음 순환 시작
  if (unseen.length === 0) {
    unseen = [...Array(n).keys()];
    seenSet.clear();
  }

  let candidates = unseen.filter((i) => i !== current);
  if (candidates.length === 0) {
    candidates = [...Array(n).keys()].filter((i) => i !== current);
  }

  const next = pickRandom(candidates);
  seenSet.add(next);
  return { index: next, seen: [...seenSet] };
}

/** 저장된 명언이 없으면 최초 1회 랜덤으로 고정 */
export function ensureReceiptSlogan() {
  const existing = loadIndex();
  if (existing !== null) return existing;

  const n = sloganLen();
  if (n === 0) return 0;
  const idx = pickRandom([...Array(n).keys()]);
  save(idx, [idx]);
  return idx;
}

export function getReceiptSloganIndex() {
  return ensureReceiptSlogan();
}

/** 물내리기·기록 초기화 시 — 직전 명언과 다르게, 순환 미완료 시 미공개 명언만 */
export function rotateReceiptSlogan() {
  const current = ensureReceiptSlogan();
  const seen = loadSeen();
  if (!seen.includes(current)) seen.push(current);
  const { index, seen: newSeen } = pickNextIndex(current, seen);
  save(index, newSeen);
  return index;
}
