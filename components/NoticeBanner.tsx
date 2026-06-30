"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { activeNoticeFrom, type Notice } from "@/lib/notices";

const SOCKET_BASE = (
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost" ? "http://localhost:4000" : "")
).replace(/\/$/, "");

const COPIES = 12;

/* 시스템 공지 배너 — 어드민에서 관리.
   초기: REST fetch. 이후: socket "notices" 이벤트로 실시간 갱신. */
export default function NoticeBanner() {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!SOCKET_BASE) return;

    // 초기 로드
    fetch(`${SOCKET_BASE}/notices`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.notices)) setNotice(activeNoticeFrom(d.notices)); })
      .catch(() => {});

    // 실시간 갱신 — socket.io-client가 같은 URL의 기존 연결을 재사용(새 WS 연결 없음)
    const sock = io(SOCKET_BASE, { transports: ["websocket", "polling"] });
    sock.on("notices", (d: { notices: Notice[] }) => {
      setNotice(Array.isArray(d?.notices) ? activeNoticeFrom(d.notices) : null);
    });
    return () => { sock.disconnect(); };
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
