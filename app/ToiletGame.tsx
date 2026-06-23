"use client";

import { useEffect } from "react";
import { initGame } from "@/lib/game";

export default function ToiletGame() {
  useEffect(() => {
    // 게임 엔진(명령형 DOM/canvas 로직)을 마운트 후 1회 실행. 반환값은 cleanup.
    const cleanup = initGame();
    return cleanup;
  }, []);

  return (
    <div id="app">
      {/* ===== 상단 HUD ===== */}
      <header className="hud">
        <div className="hud__left">
          <button className="gear" id="gearBtn" type="button" aria-label="설정">⚙️</button>
          <button className="gear hud__receipt" id="receiptBtn" type="button" aria-label="영수증 공유">🧾</button>
          <div className="hud__chip hud__stalls">
            <span className="dot"></span>🚽 <b id="stallCount">--</b> <span className="hud__unit">명 볼일중</span>
          </div>
        </div>
        <div className="hud__chip hud__global">
          💰 <span className="hud__global-label">오늘 다같이</span> <b id="globalEarned">0원</b>
        </div>
      </header>

      {/* ===== 1인칭 공중화장실 칸 (1점 투시) ===== */}
      <div className="scene" id="scene">
        <div className="ceil"></div>
        <div className="floor"></div>

        {/* 좌측 가벽 + 선반형 스텐 휴지걸이 */}
        <div className="wall wall--left">
          <div className="fixture tp">
            <div className="tp__bracket"></div>
            <div className="tp__shelf"></div>
            <div className="tp__roll">
              <div className="tp__core"></div>
              <div className="tp__peg"></div>
            </div>
          </div>
        </div>

        {/* 우측 가벽 + 상단 스텐 옷걸이(로브훅) */}
        <div className="wall wall--right">
          <div className="fixture hook">
            <div className="hook__base"></div>
            <div className="hook__peg"></div>
            <div className="hook__cap"></div>
          </div>
        </div>

        {/* 정면 가벽 문 */}
        <div className="door">
          <div className="door__panel">
            <a className="ad-a4" id="adA4" href="#" target="_blank" rel="noopener">
              <span className="ad-a4__tag">광고</span>
              <div className="ad-a4__emoji" id="adEmoji">📢</div>
              <div className="ad-a4__head" id="adHead">여기에 광고</div>
              <div className="ad-a4__sub" id="adSub">A4 광고 영역 · 문의 환영</div>
              <div className="ad-a4__foot">tap</div>
            </a>
          </div>
          <div className="door__under"></div>
        </div>

        {/* 좌/우 벽 회색 외곽선 */}
        <svg className="edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,0 20,9 20,73 0,100 Z" fill="none" stroke="#8f948b" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
          <path d="M100,0 80,9 80,73 100,100 Z" fill="none" stroke="#8f948b" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        </svg>

        {/* 좌우 실시간 말풍선 (봇) */}
        <div className="bubbles bubbles--left" id="bubblesLeft"></div>
        <div className="bubbles bubbles--right" id="bubblesRight"></div>
      </div>

      {/* ===== 전경: 내 무릎(랩) ===== */}
      <div className="foreground">
        <div className="thigh thigh--l"></div>
        <div className="thigh thigh--r"></div>
      </div>

      {/* ===== 하단 스택 ===== */}
      <div className="bottom">
        {/* 1row: [시계/내 월급] | [내 채팅/적립] | [총/물내리기] */}
        <div className="deck">
          <div className="deckcol deckcol--salary">
            <div className="deckcol__top deckcol__timer" id="timer" hidden>⏰ <span id="timerVal">00:00</span></div>
            <button className="ctrl-salary" id="salaryToggle" type="button">
              <span className="ctrl-salary__cap">내 월급</span>
              <b id="salaryLabel">300만원</b>
            </button>
          </div>
          <div className="deckcol deckcol--mid">
            <div className="myfeed" id="myFeed"></div>
            <div className="readout">
              <span className="readout__amt" id="personalEarned">0원</span>
              <span className="readout__rate" id="rateLabel">1초에 5원 버는중</span>
            </div>
          </div>
          <div className="deckcol deckcol--flush">
            <div className="deckcol__top deckcol__total" id="totalEarned" hidden>총 0원</div>
            <button className="flush" id="flushBtn" type="button"><div className="flush__fill" id="flushFill"></div><span className="flush__icon">🚽</span><span id="flushLabel">물내리기</span></button>
          </div>
        </div>

        {/* 2row: 채팅 */}
        <form className="chat" id="chatForm" autoComplete="off">
          <input type="text" id="chatInput" placeholder="옆 칸 모두에게 한마디..." maxLength={40} />
          <button type="submit">전송</button>
        </form>
      </div>

      {/* 월급 설정 팝오버 */}
      <div className="salary-panel" id="salaryPanel" hidden>
        <div className="salary-panel__row">
          <div className="salary-panel__left">
            <span className="salary-panel__cap">내 월급 대충</span>
            <b id="salaryBig">300만원</b>
          </div>
          <span className="salary-panel__rate" id="salaryRate">1초에 약 4.7원</span>
        </div>
        <input type="range" id="salaryRange" min="0" max="13" step="1" defaultValue="3" />
      </div>

      {/* 설정 팝오버 */}
      <div className="settings-panel" id="settingsPanel" hidden>
        <div className="settings__title">⚙️ 설정</div>

        <div className="settings__section">
          <div className="settings__row settings__nick">
            <span>닉네임</span>
            <button className="nick-random" id="nickRandomBtn" type="button" aria-label="닉네임 랜덤 생성"><span id="nickRandomIcon">🎲</span></button>
            <input type="text" id="nickInput" maxLength={10} />
            <label className="settings__pin" title="체크하면 닉네임을 기기에 저장합니다">
              <input type="checkbox" id="nickPinChk" />고정
            </label>
          </div>
          <label className="settings__row">
            <span>타이머 표시</span>
            <input type="checkbox" id="timerToggle" className="sw" />
          </label>
          <label className="settings__row">
            <span>내가 번 돈 표시</span>
            <input type="checkbox" id="totalToggle" className="sw" />
          </label>
          <button className="settings__reset" id="resetTotalBtn" type="button" hidden>내가 번 돈 초기화</button>
          <button className="settings__share" id="receiptBtnSettings" type="button">🧾 영수증 자랑하기</button>
        </div>

        <div className="settings__divider"></div>

        <div className="settings__section settings__links">
          <button className="settings__link" type="button" data-action="donate">개발자 후원하기</button>
          <button className="settings__link" type="button" data-action="ad">광고문의</button>
        </div>
      </div>

      {/* 영수증 공유 모달 */}
      <div className="receipt-modal" id="receiptModal" hidden>
        <div className="receipt-modal__backdrop" id="receiptBackdrop"></div>
        <div className="receipt-modal__sheet" role="dialog" aria-label="영수증 공유">
          <button className="receipt-modal__close" id="receiptClose" type="button" aria-label="닫기">✕</button>
          <div className="receipt-modal__preview" id="receiptPreview"></div>
          <div className="receipt-modal__actions">
            <button className="receipt-btn receipt-btn--share" id="receiptShare" type="button">🔗 공유하기</button>
            <button className="receipt-btn receipt-btn--save" id="receiptSave" type="button">📷 저장</button>
          </div>
          <p className="receipt-modal__hint">내 월급·시간은 영수증에 안 나와요 🙈</p>
        </div>
      </div>

      {/* 물내림 컨페티 */}
      <div className="confettiLayer" id="confettiLayer"></div>
      {/* 토스트 */}
      <div className="toast" id="toast" hidden></div>
    </div>
  );
}
