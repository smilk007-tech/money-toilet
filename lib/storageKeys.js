/* localStorage 키 — 한 곳에서 관리(인라인 문자열 금지) */
export const LS = {
  salary: "mt_salary",
  nick: "mt_nick",
  nickPin: "mt_nick_pin",
  total: "mt_total",
  flushCount: "mt_flush_count",
  flushHistory: "mt_flush_history",
  timer: "mt_timer",
  timerAutoShown: "mt_timer_auto_shown",
  timerTouched: "mt_timer_touched",
  salaryFocusDone: "mt_salary_focus_done",
  settingsFocusDone: "mt_settings_focus_done",
  payslipConfirmed: "mt_payslip_confirmed",
  payslipStampEver: "mt_payslip_stamp_ever", // 브라우저에서 도장 1회 이상 찍음(기록 초기화와 무관)
  everVisited: "mt_ever_visited",
  receiptRevealed: "mt_receipt_revealed",
  totalVisible: "mt_total_visible",
  salaryHintDismissed: "mt_salary_hint_dismissed",
  salaryClicked: "mt_salary_clicked",
  sloganIndex: "mt_slogan_index",
  sloganSeen: "mt_slogan_seen",
  vid: "mt_vid", // 방문자 고유키(랜덤 UUID) — 채팅/통계/밴 식별자
};
