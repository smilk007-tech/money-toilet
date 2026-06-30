"use client";

import { useState } from "react";
import { activeNotice } from "@/lib/notices";

/* 시스템 공지 배너 — 인게임 상단의 까만 바, 흰 글씨가 왼쪽으로 무한 반복 스크롤(마퀴).
   url이 있으면 클릭 시 새 탭 이동, 없으면 클릭 무반응(일반 div). */
export default function NoticeBanner() {
  // 마운트 시점(KST)의 활성 공지 1건 확정 — 세션 중 윈도우 경과 반영은 새로고침으로 충분.
  const [notice] = useState(() => activeNotice());
  if (!notice) return null;

  const hasUrl = !!notice.url;
  // 끊김 없는 마퀴: N벌 복사 → translate(-1/N * 100%) 반복. 많은 복사본으로 PC 넓은 화면도 커버.
  const COPIES = 12;
  const track = (
    <div className="notice-bar__track" aria-hidden>
      {Array.from({ length: COPIES }).map((_, i) => (
        <span key={i}>{notice.text} · </span>
      ))}
    </div>
  );

  if (hasUrl) {
    return (
      <a
        className="notice-bar notice-bar--link"
        href={notice.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={notice.text}
      >
        {track}
      </a>
    );
  }
  return (
    <div className="notice-bar" role="status" aria-label={notice.text}>
      {track}
    </div>
  );
}
