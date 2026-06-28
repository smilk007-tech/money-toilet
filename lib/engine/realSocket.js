/* ===================================================================
   RealToiletSocket — 진짜 백엔드 어댑터
   -------------------------------------------------------------------
   FakeToiletSocket과 동일한 인터페이스(on/send/flush/connect/disconnect)와
   이벤트(presence/global/chat/flush)를 그대로 구현 → game.js는 거의 안 바뀜.

   전송 방식: HTTP 짧은 폴링(읽기) + POST(쓰기).
     · GET  /api/snapshot  presence/global/최근채팅(커서) — CDN 캐시
     · POST /api/beacon    presence 하트비트 + 순방문자
     · POST /api/chat      채팅 전송
     · POST /api/flush     물내림 정산(서버가 누적 소유)

   봇: 큐레이션 콘텐츠 재활용을 위해 내부에 FakeToiletSocket을 "봇 엔진"으로
       돌리되, presence/global은 무시하고 chat/flush만 실접속수에 반비례로
       다운샘플링해 재방출(화면 연출 전용 · 서버 누적은 절대 안 건드림).
   =================================================================== */

import { FakeToiletSocket } from "@/lib/engine/fakeSocket";
import { getVid } from "@/lib/engine/identity";

export class RealToiletSocket {
  constructor(opts = {}) {
    this._handlers = {};
    this._timers = [];
    this._getNick = typeof opts.getNick === "function" ? opts.getNick : () => "";
    this._vid = getVid();
    this._global = 0;
    this._presence = 0;
    this._lastSeenId = 0;
    this._pollMs = 2500;
    this._graceEnd = 0;
    this._stopped = false;
    this._bots = new FakeToiletSocket(); // 봇 엔진(콘텐츠 재활용)
    this._sentEcho = []; // 최근 내가 보낸 텍스트(중복 버블 방지 보조)
  }

  /* ---- 이벤트 ---- */
  on(type, cb) {
    (this._handlers[type] ||= []).push(cb);
    return this;
  }
  _emit(type, payload) {
    (this._handlers[type] || []).forEach((cb) => cb(payload));
  }

  /* ---- 봇 다운샘플 비율: 실접속 많을수록 0에 수렴 ---- */
  _botFactor() {
    const p = this._presence;
    if (p <= 20) return 1;
    if (p >= 100) return 0.03;
    return (100 - p) / 80; // 20→1.0, 100→0.0 근처
  }
  _inGrace() {
    return Date.now() < this._graceEnd;
  }

  /* ---- 내가 보낸 채팅 ---- 낙관적 에코(터미널) + 서버 POST ---- */
  send(text) {
    // 로컬 에코는 "최종"으로 처리 — 서버 확인을 기대하지 않음(섀도밴 무탐지).
    this._emit("chat", { name: "나", text, kind: "me" });
    this._sentEcho.push(text);
    if (this._sentEcho.length > 8) this._sentEcho.shift();
    this._post("/api/chat", {
      vid: this._vid,
      nick: this._getNick(),
      text,
    });
  }

  /* ---- 내가 물내림 ---- 낙관적 += 후 POST, 서버 권위값으로 화해(monotonic) ---- */
  flush(amount, broadcast = true, text = null) {
    this._global += amount;
    this._emit("flush", {
      name: "나",
      amount,
      total: this._global,
      me: true,
      chat: broadcast,
      text,
    });
    this._post("/api/flush", {
      vid: this._vid,
      nick: this._getNick(),
      amount,
      broadcast,
      text,
    }).then((res) => {
      if (res && typeof res.total === "number") {
        this._global = Math.max(this._global, res.total); // 뒤로 안 감
        this._emit("global", { total: this._global });
      }
    });
  }

  /* ---- 연결 ---- */
  connect(graceMs = 7000) {
    this._graceEnd = Date.now() + graceMs;

    // 봇 엔진 구독: presence/global은 버리고 chat/flush만 재방출(연출 전용)
    this._bots.on("chat", (msg) => {
      if (this._stopped || this._inGrace()) return;
      if (msg.kind === "me") return; // 봇 엔진엔 me가 없지만 방어
      if (Math.random() > this._botFactor()) return; // 실접속 많으면 봇 침묵
      this._emit("chat", { name: msg.name, text: msg.text, kind: msg.kind });
    });
    this._bots.on("flush", (f) => {
      if (this._stopped || this._inGrace() || f.me) return;
      if (Math.random() > this._botFactor()) return;
      // 누적(global)은 절대 안 건드림 — 현재 표시값을 그대로 동봉.
      this._emit("flush", {
        name: f.name,
        amount: f.amount,
        total: this._global,
        me: false,
        chat: true,
        text: f.text,
      });
    });
    this._bots.connect(graceMs);

    // 첫 스냅샷 — 히스토리 리플레이 없이 기준선만 설정
    this._fetchSnapshot(true);
    this._beat(); // 입장 하트비트
    this._scheduleSnapshot();
    this._scheduleBeacon();
  }

  disconnect() {
    this._stopped = true;
    this._timers.forEach(clearTimeout);
    this._timers = [];
    try {
      this._bots.disconnect();
    } catch {
      /* noop */
    }
  }

  /* ---- 폴링 루프 ---- */
  _scheduleSnapshot() {
    const hidden =
      typeof document !== "undefined" && document.visibilityState === "hidden";
    const base = hidden ? Math.max(this._pollMs * 2, 5000) : this._pollMs;
    const delay = base + Math.random() * 600; // 지터(동기화 폭주 방지)
    this._after(delay, () => {
      this._fetchSnapshot(false);
      this._scheduleSnapshot();
    });
  }
  _scheduleBeacon() {
    // 25~33초 간격(평균 ~29s). presence 창(35s)보다 짧아 비트 사이에도 계속 집계됨.
    // 입장 시엔 connect()가 즉시 1회 호출하므로 새 접속자는 바로 반영.
    this._after(25000 + Math.random() * 8000, () => {
      this._beat();
      this._scheduleBeacon();
    });
  }

  async _fetchSnapshot(first) {
    try {
      const res = await fetch("/api/snapshot", { cache: "no-store" });
      if (!res.ok) return;
      const s = await res.json();
      if (this._stopped) return;
      if (typeof s.pollMs === "number" && s.pollMs > 0) this._pollMs = s.pollMs;
      this._presence = s.presence || 0;
      this._emit("presence", { count: this._presence });

      const serverGlobal = s.global || 0;
      this._global = Math.max(this._global, serverGlobal); // monotonic
      this._emit("global", { total: this._global });

      const rows = Array.isArray(s.chats) ? s.chats : [];
      if (first) {
        this._lastSeenId = s.cursor || 0; // 기준선 — 과거 채팅 한꺼번에 안 뿌림
        return;
      }
      // id 오름차순으로 새 행만 방출
      const fresh = rows
        .filter((r) => r && r.id > this._lastSeenId)
        .sort((a, b) => a.id - b.id);
      for (const r of fresh) {
        this._lastSeenId = Math.max(this._lastSeenId, r.id);
        if (r.vid === this._vid) continue; // 내 메시지는 이미 로컬 에코됨
        if (this._inGrace()) continue; // 진입 그레이스 — 버블 보류
        if (r.kind === "flush") {
          this._emit("flush", {
            name: r.nick,
            amount: r.amount || 0,
            total: this._global,
            me: false,
            chat: true,
            text: r.text,
          });
        } else {
          // 일반 채팅·공지(system) 모두 버블로 노출(others = bot 스타일)
          this._emit("chat", { name: r.nick, text: r.text, kind: "bot" });
        }
      }
    } catch {
      /* 네트워크 일시 오류 — 다음 폴에서 회복 */
    }
  }

  _beat() {
    this._post("/api/beacon", { vid: this._vid, nick: this._getNick() });
  }

  async _post(url, body) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    }
  }

  _after(ms, fn) {
    const t = setTimeout(fn, ms);
    this._timers.push(t);
  }
}
