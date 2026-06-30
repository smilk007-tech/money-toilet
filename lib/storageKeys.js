/* localStorage 키 — 한 곳에서 관리(인라인 문자열 금지) */
export const LS = {
  salary: "mt_salary",
  nick: "mt_nick",
  nickPin: "mt_nick_pin",
  total: "mt_total",
  flushCount: "mt_flush_count",
  flushHistory: "mt_flush_history",
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
  satSeconds: "mt_sat_seconds", // 타이머 적립 기준 경과초 — 복귀 시 자리비움 보상 계산용
  lastSeenAt: "mt_last_seen_at", // 마지막으로 살아있던 시각(ms epoch) — 복귀 시 자리비움 보상 계산용
  devToolsUnlocked: "mt_dev_tools_unlocked", // 형광등 30탭 이스터에그로 개발자 도구 노출
};
