/* ===================================================================
   모바일 ↔ PC 전환 기준 (단일 소스)
   - PC 판정: 마우스 등 "정밀 포인터(pointer:fine)"와 hover가 있는 기기.
     · 데스크톱/노트북 → PC (창 너비와 무관)
     · 폰·태블릿(터치=coarse pointer, hover 없음) → 모바일(네이티브 공유시트 사용)
   - 공유/자랑하기 클립보드 복사, 무대 device 속성 등에서 공용으로 쓴다.
   - 참고: 레이아웃 확대는 가로 520px(stage.js)를 기준으로 별도 동작한다.
   =================================================================== */

/** (참고용) 모바일↔PC 폭 경계. 판정엔 쓰지 않고 문서/참조용으로 둔다. */
export const PC_MIN_WIDTH = 1024;

/** 마우스(정밀 포인터)+hover가 있는 PC인지. SSR/구형 브라우저에선 false. */
export function isPC() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return (
    window.matchMedia("(pointer: fine)").matches &&
    window.matchMedia("(hover: hover)").matches
  );
}
