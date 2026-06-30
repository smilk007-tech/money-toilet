/* ===================================================================
   RealToiletSocket — socket.io 기반 실시간 어댑터
   -------------------------------------------------------------------
   FakeToiletSocket과 동일 인터페이스(on/send/flush/connect/disconnect)와
   이벤트(presence/global/chat/flush)를 그대로 구현 → game.js 무변경.

   전송: socket.io (지속연결 + 자동 재연결). 폴링 없음.
   서버 이벤트:
     'presence' {count}                현재 동접
     'global'   {total}                누적 '다같이 번 돈'(서버 소유)
     'chat'     {name,text,kind}        남의 채팅 (서버가 보낸 사람 제외하고 전송)
     'flush'    {name,amount,total,...} 남의 물내림
     'backfill' {chats}                 입장 시 최근 채팅(현재는 미사용 — 진입 깔끔하게)
   봇: 내부 FakeToiletSocket을 봇 엔진으로 돌려 chat/flush만 실접속 반비례로 재방출.
   =================================================================== */

import { io } from "socket.io-client";
import { FakeToiletSocket } from "@/lib/engine/fakeSocket";
import { getVid, wasVidCreated } from "@/lib/engine/identity";

export function socketUrl() {
  const u = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (u) return u.replace(/\/$/, "");
  // 개발 폴백
  if (typeof window !== "undefined" && window.location.hostname === "localhost")
    return "http://localhost:4000";
  return "";
}

export class RealToiletSocket {
  constructor(opts = {}) {
    this._handlers = {};
    this._timers = [];
    this._getNick = typeof opts.getNick === "function" ? opts.getNick : () => "";
    this._vid = getVid();
    this._global = 0;
    this._presence = 0;
    this._graceEnd = 0;
    this._stopped = false;
    this._sock = null;
    this._firstConnect = true; // 첫 연결=방문(fresh), 재연결은 방문 카운트 제외
    this._bots = new FakeToiletSocket();
    this._connected = false;
    this._wasOffline = false;
    this._offlineTimer = null;
  }

  on(type, cb) {
    (this._handlers[type] ||= []).push(cb);
    return this;
  }
  _emit(type, payload) {
    (this._handlers[type] || []).forEach((cb) => cb(payload));
  }

  _botFactor() {
    const p = this._presence;
    if (p <= 20) return 1;
    if (p >= 100) return 0.03;
    return (100 - p) / 80;
  }
  _inGrace() {
    return Date.now() < this._graceEnd;
  }
  // 서버 누적값 수용 — 초기화(0)는 그대로, 그 외엔 monotonic(뒤로 안 감)
  _applyGlobal(total) {
    this._global = total === 0 ? 0 : Math.max(this._global, total);
    this._emit("global", { total: this._global });
  }

  /* ---- 내가 보낸 채팅: 낙관적 에코(터미널) + 서버 전송 ---- */
  send(text) {
    this._emit("chat", { name: "나", text, kind: "me" });
    this._sock?.emit("chat", { text, nick: this._getNick() });
  }

  /* ---- 내가 물내림: 낙관적 += → 서버 전송 → 서버가 모두에게 global 동기화 ---- */
  flush(amount, broadcast = true, text = null, kind = null) {
    this._global += amount;
    this._emit("flush", {
      name: "나",
      amount,
      total: this._global,
      me: true,
      chat: broadcast,
      text,
      kind,
    });
    this._sock?.emit("flush", {
      amount,
      broadcast,
      text,
      kind,
      nick: this._getNick(),
    });
  }

  connect(graceMs = 7000) {
    this._graceEnd = Date.now() + graceMs;

    // 탭 재활성화 시 오프라인 표시 억제 — 소켓이 재연결될 시간을 충분히 줌
    this._onVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        // 화면 내림 — 오프라인 타이머 클리어(복귀 시 재설정, 끊김 갑툭튀 방지)
        clearTimeout(this._offlineTimer);
        this._offlineTimer = null;
        return;
      }
      // 화면 복귀(visible)
      if (this._connected || this._wasOffline || this._stopped) return;
      // 재활성화 시 재연결 시간 충분히 확보(20초)
      clearTimeout(this._offlineTimer);
      this._offlineTimer = setTimeout(() => {
        if (!this._connected) {
          this._wasOffline = true;
          this._emit("offline", {});
        }
      }, 20000);
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this._onVisibilityChange);
    }

    // 봇 엔진(콘텐츠 재활용) — chat/flush만 재방출, presence/global은 버림
    this._bots.on("chat", (msg) => {
      if (this._stopped || this._inGrace() || msg.kind === "me") return;
      if (Math.random() > this._botFactor()) return;
      this._emit("chat", { name: msg.name, text: msg.text, kind: msg.kind });
    });
    this._bots.on("flush", (f) => {
      if (this._stopped || this._inGrace() || f.me) return;
      if (Math.random() > this._botFactor()) return;
      this._emit("flush", {
        name: f.name,
        amount: f.amount,
        total: this._global, // 누적 안 건드림
        me: false,
        chat: true,
        text: f.text,
        kind: "bot",
      });
    });
    this._bots.connect(graceMs);

    // 소켓 연결
    const url = socketUrl();
    this._sock = io(url || undefined, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 8000,
    });

    // 8초 후에도 연결 안 됐으면 오프라인 배지 표시
    this._offlineTimer = setTimeout(() => {
      if (!this._connected) {
        this._wasOffline = true;
        this._emit("offline", {});
      }
    }, 8000);

    this._sock.on("connect", () => {
      this._connected = true;
      clearTimeout(this._offlineTimer);
      if (this._wasOffline) {
        this._wasOffline = false;
        this._emit("online", {});
      }
      const fresh = this._firstConnect;
      this._firstConnect = false;
      this._sock.emit("hello", {
        vid: this._vid,
        nick: this._getNick(),
        fresh, // 첫 연결만 방문(visits)로 집계 — 재연결 중복 방지
        isNew: fresh && wasVidCreated(), // 최초 채번 vid = 신규 방문자
      });
    });

    this._sock.on("disconnect", () => {
      this._connected = false;
      clearTimeout(this._offlineTimer);
      // 15초 이상 복구 없을 때 오프라인 배지 표시 (폰 브라우저 내렸다올릴 때 재연결 시간 확보)
      this._offlineTimer = setTimeout(() => {
        this._wasOffline = true;
        this._emit("offline", {});
      }, 15000);
    });
    this._sock.on("presence", ({ count }) => {
      this._presence = count || 0;
      this._emit("presence", { count: this._presence });
    });
    this._sock.on("global", ({ total }) => this._applyGlobal(total || 0));
    this._sock.on("chat", (m) => {
      if (this._stopped || this._inGrace()) return;
      this._emit("chat", { name: m.name, text: m.text, kind: m.kind || "bot" });
    });
    this._sock.on("flush", (f) => {
      this._applyGlobal(f.total || 0);
      if (this._inGrace()) return;
      this._emit("flush", {
        name: f.name,
        amount: f.amount,
        total: this._global,
        me: false,
        chat: true,
        text: f.text,
      });
    });
    // backfill 은 현재 미사용(진입 그레이스 깔끔하게). 필요 시 여기서 재생.
    this._sock.on("backfill", () => {});
  }

  disconnect() {
    this._stopped = true;
    clearTimeout(this._offlineTimer);
    if (this._onVisibilityChange && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
    }
    this._timers.forEach(clearTimeout);
    this._timers = [];
    try {
      this._sock?.close();
    } catch {
      /* noop */
    }
    try {
      this._bots.disconnect();
    } catch {
      /* noop */
    }
  }
}
