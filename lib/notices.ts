/* 시스템 공지(서버점검·이벤트·안내) — Vercel 환경변수(NEXT_PUBLIC_NOTICES)로 관리.
   Redis/소켓 불필요(상시·저빈도·실시간 아님). 시작/종료일 윈도우로 노출 제어.
   형식: NEXT_PUBLIC_NOTICES = JSON 배열
   [
     { "text": "25일 오전 10시~16시 서버점검 예정", "start": "2026-06-20", "end": "2026-06-25T16:00", "url": "" },
     { "text": "신규 이벤트 오픈 🎉", "start": "2026-06-01", "url": "https://example.com" }
   ]
   - start 생략: 즉시 시작 / end 생략: 무한 노출
   - 날짜·시각은 KST 기준. 날짜만 주면 start=그날 00:00, end=그날 23:59:59
   - url 있으면 클릭 시 이동, 없으면 클릭 무반응 */

export type Notice = {
  text: string;
  start?: string;
  end?: string;
  url?: string;
};

const KST_OFFSET = "+09:00";

// 타임존 표기가 없으면 KST로 간주. 날짜만(YYYY-MM-DD)이면 시작=자정, 종료=그날 끝.
function parseKst(s: string | undefined, isEnd: boolean): number | null {
  if (!s) return null;
  const v = s.trim();
  if (!v) return null;
  const hasTz = /(z|[+-]\d{2}:?\d{2})$/i.test(v);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  let iso = v.replace(" ", "T");
  if (dateOnly) iso += isEnd ? "T23:59:59" : "T00:00:00";
  if (!hasTz) iso += KST_OFFSET;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** 주어진 배열에서 현재 시각(KST) 기준 노출할 첫 공지. 없으면 null. */
export function activeNoticeFrom(list: Notice[], now: number = Date.now()): Notice | null {
  for (const n of list) {
    if (!n || typeof n.text !== "string" || !n.text.trim()) continue;
    const start = parseKst(n.start, false);
    const end = parseKst(n.end, true);
    if (start !== null && now < start) continue;
    if (end !== null && now > end) continue;
    const url = typeof n.url === "string" && n.url.trim() ? n.url.trim() : undefined;
    return { text: n.text.trim(), url };
  }
  return null;
}

/** @deprecated NEXT_PUBLIC_NOTICES 환경변수 기반. 어드민 관리 방식으로 전환됨. */
export function activeNotice(now: number = Date.now()): Notice | null {
  try {
    const raw = process.env.NEXT_PUBLIC_NOTICES;
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? activeNoticeFrom(arr, now) : null;
  } catch { return null; }
}
