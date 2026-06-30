"use client";

import { useEffect, useState } from "react";
import { activeNoticeFrom, type Notice } from "@/lib/notices";

const SOCKET_BASE = (
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost" ? "http://localhost:4000" : "")
).replace(/\/$/, "");

const COPIES = 12;

/* 시스템 공지 배너 — 어드민에서 관리. 서버 /notices 에서 fetch 후 활성 공지 표시. */
export default function NoticeBanner() {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!SOCKET_BASE) return;
    fetch(`${SOCKET_BASE}/notices`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.notices)) setNotice(activeNoticeFrom(d.notices));
      })
      .catch(() => {});
  }, []);

  if (!notice) return null;

  const track = (
    <div className="notice-bar__track" aria-hidden>
      {Array.from({ length: COPIES }).map((_, i) => (
        <span key={i}>{notice.text} · </span>
      ))}
    </div>
  );

  if (notice.url) {
    return (
      <a className="notice-bar notice-bar--link" href={notice.url} target="_blank" rel="noopener noreferrer" aria-label={notice.text}>
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
