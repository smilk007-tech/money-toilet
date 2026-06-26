/* ===================================================================
   게임 무대(stage) 스케일러 — "큰 PC에서만" 확대
   - 가로 ≤ 520px(STAGE_MAX_W): 손대지 않는다. 기존 그대로(가변·세로 꽉참).
   - 가로 > 520px(태블릿/PC): 기존 max-width 520 고정 때문에 세로로만 늘어나던
     문제를 막기 위해, 뷰포트 크기로 무대를 통째로 "확대"한다.
       · 폭(=실효 max-width)과 글자/요소가 함께 커진다.
       · 세로는 항상 화면을 꽉 채운다(상하 레터박스 없음).
       · 큰 모니터에선 좌우 검정 여백이 남는다.
   - 비율을 항상 고정하는 게 아니다: 창을 넓힐수록 폭이 먼저 커지며 늘어짐이
     풀리고, 보기 좋은 비율(≈520:STAGE_REF_H)에 도달하면 그 크기로 확대된다.
   - CSS 변수 --stage-scale(확대율), --app-h(무대 실제 높이 px)를 :root에 세팅.
   =================================================================== */
import { isPC } from "@/lib/device";

// 기존 max-width(=확대 시작 기준 폭). 이 폭까지는 기존 동작 유지.
export const STAGE_MAX_W = 520;
// 확대가 수렴하는 "보기 좋은" 기준 높이(px). 520:950 ≈ 세로비 0.55.
export const STAGE_REF_H = 950;
// 초대형 모니터 과확대 상한.
export const MAX_SCALE = 2.1;

/** 뷰포트(vw,vh) → 무대 확대율. ≤520 영역에선 1(=확대 안 함). */
export function computeStageScale(vw, vh) {
  const s = Math.min(vw / STAGE_MAX_W, vh / STAGE_REF_H);
  return Math.max(1, Math.min(s, MAX_SCALE));
}

/** 무대 변수/device 속성 적용 + 리사이즈 추적. 반환값은 cleanup. */
export function initStage() {
  const root = document.documentElement;
  let raf = 0;

  const apply = () => {
    raf = 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = computeStageScale(vw, vh);
    root.style.setProperty("--stage-scale", String(scale));
    // 확대된 무대가 세로를 꽉 채우도록, 무대 높이 = 뷰포트높이 / 확대율.
    root.style.setProperty("--app-h", vh / scale + "px");
    root.dataset.device = isPC() ? "pc" : "mobile";
  };

  const onResize = () => {
    if (raf) return;
    raf = requestAnimationFrame(apply);
  };

  apply();
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("orientationchange", onResize, { passive: true });

  return () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    if (raf) cancelAnimationFrame(raf);
  };
}
