/* game.js ↔ React 컴포넌트 간 커스텀 이벤트 — 한 곳에서 관리 */
export const APP_EVENTS = {
  payslipOpen: "mt:payslip-open",
  toast: "mt:toast",
  payslipStamped: "mt:payslip-stamped",
  // 자랑하기 클릭 — URL 신규 생성 여부와 무관한 '단순 클릭' 집계.
  // 모달(React)이 소켓에 직접 접근하지 못하므로 이 이벤트로 game.js에 넘겨 서버 emit(clicked:brag).
  brag: "mt:brag",
};
