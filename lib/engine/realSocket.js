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

// 공유/후원/자랑 클릭 연타 방어 — kind별 이 간격 미만의 반복 클릭은 서버로 안 보냄(js단 1차 게이트)
const CLICK_DEBOUNCE_MS = 800;

// 연결 상태 UI 임계값 — "연결 끊김"은 최대한 보수적으로만 노출한다.
//  · RECONNECT_UI_DELAY_MS: 이보다 짧은 끊김(블립)은 아무것도 안 띄우고 마지막 카운트 유지(깜빡임 방지)
//  · OFFLINE_GRACE_MS: 이만큼 '연속 재시도 실패'해야 비로소 "연결 끊김". 그 전까진 "연결 중…"
//    (기기가 navigator.onLine=false로 진짜 오프라인이면 이 유예 없이 즉시 "연결 끊김")
const RECONNECT_UI_DELAY_MS = 1500;
const OFFLINE_GRACE_MS = 30000;

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
    this._offlineTimer = null; // 하드 '연결 끊김' 에스컬레이션 타이머
    this._connectingTimer = null; // '연결 중…' 노출 지연 타이머(짧은 블립 억제)
    this._netState = "connecting"; // "connecting" | "online" | "offline" (중복 emit 방지)
    this._clickAt = {}; // kind -> 마지막 클릭 emit ts(ms) (연타 디바운스용)
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

  /* ---- 연결 상태 전이(연결 중 / 온라인 / 끊김) ----
     끊김 노출은 보수적으로: 짧은 블립은 무시, 재시도 중엔 '연결 중', 오래(또는 진짜 오프라인)일 때만 '끊김'. */
  _enterConnecting(immediate = false) {
    if (this._stopped) return;
    // 하드 '끊김' 유예 (재)시작 — 이 시간 동안 복구 못 하면 그때 offline
    clearTimeout(this._offlineTimer);
    this._offlineTimer = setTimeout(() => {
      if (!this._connected && !this._stopped) this._goOffline();
    }, OFFLINE_GRACE_MS);
    if (this._netState === "connecting") return; // 이미 '연결 중' UI면 유예만 갱신
    const show = () => {
      this._connectingTimer = null;
      if (this._connected || this._stopped) return;
      this._netState = "connecting";
      this._emit("connecting", {});
    };
    clearTimeout(this._connectingTimer);
    if (immediate) show();
    else this._connectingTimer = setTimeout(show, RECONNECT_UI_DELAY_MS); // 짧은 블립은 UI 억제
  }
  _goOnline() {
    clearTimeout(this._offlineTimer); this._offlineTimer = null;
    clearTimeout(this._connectingTimer); this._connectingTimer = null;
    this._wasOffline = false;
    if (this._netState === "online") return;
    this._netState = "online";
    this._emit("online", {});
  }
  _goOffline() {
    clearTimeout(this._connectingTimer); this._connectingTimer = null;
    if (this._netState === "offline") return;
    this._netState = "offline";
    this._wasOffline = true;
    this._emit("offline", {});
  }

  /* ---- 내가 보낸 채팅: 낙관적 에코(터미널) + 서버 전송 ---- */
  send(text) {
    this._emit("chat", { name: "나", text, kind: "me" });
    this._sock?.emit("chat", { text, nick: this._getNick() });
  }

  /* ---- 공유/후원/자랑 클릭 집계 ---- 클릭 즉시 fire-and-forget로 서버에 알림(집계 누수 방지).
     kind: 'share' | 'donate' | 'brag'. kind별로 CLICK_DEBOUNCE_MS 안의 연타는 js에서 삼켜 서버로 안 보냄
     (서버는 이벤트루프 보호용 rateOk 백스톱만 둠). 끊긴 상태여도 socket.io가 버퍼링 후 재연결 시 전송. */
  clicked(kind) {
    if (kind !== "share" && kind !== "donate" && kind !== "brag") return;
    const now = Date.now();
    if (now - (this._clickAt[kind] || 0) < CLICK_DEBOUNCE_MS) return; // 연타 차단
    this._clickAt[kind] = now;
    this._sock?.emit("clicked", { kind });
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

    // 탭 백그라운드/복귀 처리 — 모바일은 백그라운드에서 타이머가 얼었다가 복귀 즉시 터져
    // '연결 끊김'이 갑툭튀하는 게 문제. 백그라운드 동안엔 에스컬레이션을 멈추고, 복귀 시 유예를 새로 시작한다.
    this._onVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        // 화면 내림 — 얼어붙은 타이머가 복귀 즉시 '끊김'으로 터지지 않게 에스컬레이션 정지(상태는 유지)
        clearTimeout(this._offlineTimer); this._offlineTimer = null;
        clearTimeout(this._connectingTimer); this._connectingTimer = null;
        return;
      }
      // 화면 복귀(visible) — 이미 연결돼 있으면 그대로. 아니면 '연결 중'으로 두고 유예를 새로 시작해
      // 장시간 백그라운드 후에도 바로 '끊김'이 안 뜨고 재연결 시간을 충분히 준다.
      if (this._connected || this._stopped) return;
      this._enterConnecting();
    };
    // 기기 자체가 오프라인이면(신뢰 가능한 신호) 즉시 '연결 끊김', 네트워크 복귀 시 다시 '연결 중'
    this._onWinOffline = () => { if (!this._stopped) this._goOffline(); };
    this._onWinOnline = () => { if (!this._connected && !this._stopped) this._enterConnecting(true); };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this._onVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("offline", this._onWinOffline);
      window.addEventListener("online", this._onWinOnline);
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

    // 최초 연결 시도 — 즉시 '연결 중' 표시 + 하드 끊김 유예 시작(OFFLINE_GRACE_MS 지나도록 못 붙으면 끊김)
    this._enterConnecting(true);

    this._sock.on("connect", () => {
      this._connected = true;
      this._goOnline();
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
      // 끊김 → '연결 중'(짧은 블립은 UI 억제). OFFLINE_GRACE_MS 동안 재연결 실패해야 '연결 끊김'.
      this._enterConnecting();
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
    clearTimeout(this._connectingTimer);
    if (this._onVisibilityChange && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
    }
    if (typeof window !== "undefined") {
      if (this._onWinOffline) window.removeEventListener("offline", this._onWinOffline);
      if (this._onWinOnline) window.removeEventListener("online", this._onWinOnline);
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
