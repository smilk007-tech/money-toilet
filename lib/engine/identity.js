/* ===================================================================
   방문자 고유키(vid) — IP 대신 쓰는 비식별 랜덤 ID
   -------------------------------------------------------------------
   · 첫 방문 시 1회 생성 후 localStorage(mt_vid)에 영속.
   · IP가 아니므로 PIPA(개인정보처리방침) 부담 없음.
   · 브라우저/스토리지 초기화 시 새 사람으로 취급 — 의도된 한계(수용).
   =================================================================== */

import { LS } from "@/lib/storageKeys";

// crypto.randomUUID는 보안 컨텍스트(https/localhost)에서만 동작.
// 카카오톡 인앱 등 일부 webview 폴백 포함.
function genUuid() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID)
      return crypto.randomUUID();
  } catch {
    /* noop */
  }
  // RFC4122 v4 형태 폴백 (getRandomValues → Math.random 순)
  let rnd;
  try {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    rnd = (i) => a[i];
  } catch {
    rnd = () => Math.floor(Math.random() * 256);
  }
  const b = Array.from({ length: 16 }, (_, i) => rnd(i));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, "0"));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

let _cached = null;

/** 이 기기의 vid를 반환(없으면 생성·저장). SSR 안전(브라우저 밖이면 빈 문자열). */
export function getVid() {
  if (_cached) return _cached;
  if (typeof window === "undefined" || typeof localStorage === "undefined")
    return "";
  let v;
  try {
    v = localStorage.getItem(LS.vid);
    if (!v) {
      v = genUuid();
      localStorage.setItem(LS.vid, v);
      _created = true; // 이 브라우저 최초 채번 = 신규 방문자
    }
  } catch {
    // 스토리지 차단(시크릿/설정) — 세션 한정 vid라도 발급
    v = genUuid();
    _created = true;
  }
  _cached = v;
  return v;
}

let _created = false;
/** 이번 로드에서 vid가 처음 채번됐는지(= 신규 UUID 방문자). getVid() 호출 후 유효. */
export function wasVidCreated() {
  return _created;
}
