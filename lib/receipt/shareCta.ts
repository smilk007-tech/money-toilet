import type { CSSProperties } from "react";

/** 공유 CTA 노란 버튼 — PayslipShare / PayslipModal 자랑하기 공통 */
export const shareCtaLook: Pick<
  CSSProperties,
  "background" | "color" | "boxShadow"
> = {
  background: "linear-gradient(180deg,#ffe98a,#ffc726)",
  color: "#3a2600",
  boxShadow: "0 6px 18px rgba(0,0,0,.45)",
};
