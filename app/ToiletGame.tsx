"use client";

import { useEffect } from "react";
import { initGame } from "@/lib/game";
import PayslipModal from "@/components/PayslipModal";

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
        <div className="hud__bar">
          <button
            className="hud__icon-btn"
            id="gearBtn"
            type="button"
            aria-label="설정"
          >
            ⚙️
          </button>
          <div className="hud__panel">
            <span className="hud__stalls">
              <span className="hud__stack hud__stack--right">
                <span className="hud__label">
                  <span className="hud__emoji" aria-hidden>
                    🚽
                  </span>
                  <span className="hud__cap">볼일중</span>
                </span>
                <span className="hud__val">
                  <b id="stallCount">--</b>명
                </span>
              </span>
            </span>
            <div className="hud__global">
              <span className="hud__stack hud__stack--right">
                <span className="hud__label">
                  <span className="hud__emoji" aria-hidden>
                    💰
                  </span>
                  <span className="hud__cap">오늘 다같이</span>
                </span>
                <span className="hud__val">
                  <b id="globalEarned">0원</b>
                </span>
              </span>
            </div>
          </div>
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
            <a
              className="ad-a4"
              id="adA4"
              href="#"
              target="_blank"
              rel="noopener"
            >
              <span className="ad-a4__tag">광고</span>
              <div className="ad-a4__emoji" id="adEmoji">
                📢
              </div>
              <div className="ad-a4__head" id="adHead">
                여기에 광고
              </div>
              <div className="ad-a4__sub" id="adSub">
                A4 광고 영역 · 문의 환영
              </div>
              <div className="ad-a4__foot">tap</div>
            </a>
          </div>
          <div className="door__under"></div>
        </div>

        {/* 좌/우 벽 회색 외곽선 */}
        <svg
          className="edges"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0,0 20,9 20,73 0,100 Z"
            fill="none"
            stroke="#8f948b"
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M100,0 80,9 80,73 100,100 Z"
            fill="none"
            stroke="#8f948b"
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
          />
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
            <div className="deckcol__top deckcol__timer" id="timer" hidden>
              ⏰ <span id="timerVal">00:00</span>
            </div>
            <button className="ctrl-salary" id="salaryToggle" type="button">
              <span className="ctrl-salary__cap">내 월급</span>
              <b id="salaryLabel">300만원</b>
            </button>
          </div>
          <div className="deckcol deckcol--mid">
            <div className="myfeed" id="myFeed"></div>
            <div className="readout">
              <span className="readout__amt" id="personalEarned">
                0원
              </span>
              <span className="readout__rate" id="rateLabel">
                1초에 5원 버는중
              </span>
            </div>
          </div>
          <div className="deckcol deckcol--flush">
            <button
              className="flush-receipt"
              id="receiptBtn"
              type="button"
              aria-label="화장실 급여명세서 공유"
            >
              <span
                className="flush-receipt__icon"
                id="receiptBtnIcon"
                aria-hidden
              >
                🧾
              </span>
            </button>
            <div className="deckcol__top deckcol__total" id="totalEarned">
              총 0원
            </div>
            <button className="flush" id="flushBtn" type="button">
              <div className="flush__fill" id="flushFill"></div>
              <span className="flush__icon">🚽</span>
              <span id="flushLabel">물내리기</span>
            </button>
          </div>
        </div>

        {/* 2row: 채팅 */}
        <form className="chat" id="chatForm" autoComplete="off">
          <input
            type="text"
            id="chatInput"
            placeholder="옆 칸 모두에게 한마디"
            maxLength={40}
          />
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
          <span className="salary-panel__rate" id="salaryRate">
            1초에 약 4.7원
          </span>
        </div>
        <input
          type="range"
          id="salaryRange"
          min="0"
          max="13"
          step="1"
          defaultValue="3"
        />
      </div>

      {/* 설정 팝오버 */}
      <div className="settings-panel" id="settingsPanel" hidden>
        <div className="settings__section">
          <div className="settings__row settings__nick">
            <span>닉네임</span>
            <button
              className="nick-random"
              id="nickRandomBtn"
              type="button"
              aria-label="닉네임 랜덤 생성"
            >
              <span id="nickRandomIcon">🎲</span>
            </button>
            <input type="text" id="nickInput" maxLength={10} />
            <label
              className="settings__pin"
              title="체크하면 닉네임을 기기에 저장합니다"
            >
              <input type="checkbox" id="nickPinChk" />
              고정
            </label>
          </div>
          <label className="settings__row">
            <span>타이머 표시</span>
            <input type="checkbox" id="timerToggle" className="sw" />
          </label>
          <div className="settings__actions">
            <button
              className="settings__reset"
              id="resetTotalBtn"
              type="button"
            >
              내 기록 초기화
            </button>
            <button
              className="settings__share"
              id="receiptBtnSettings"
              type="button"
            >
              내가 번 돈 자랑하기 🧾
            </button>
          </div>
        </div>

        <div className="settings__divider"></div>

        <div className="settings__section settings__links">
          <button className="settings__link" type="button" data-action="donate">
            개발자 후원하기
          </button>
          <button className="settings__link" type="button" data-action="ad">
            광고문의
          </button>
        </div>
      </div>

      {/* 기록 초기화 확인 모달 */}
      <div className="reset-confirm" id="resetConfirmModal" hidden>
        <div
          className="reset-confirm__backdrop"
          id="resetConfirmBackdrop"
        ></div>
        <div
          className="reset-confirm__sheet"
          role="dialog"
          aria-label="기록 초기화 확인"
        >
          <h2 className="reset-confirm__title">
            자랑스러운 내 기록
            <span className="reset-confirm__title-emoji" aria-hidden>
              👏👏
            </span>
          </h2>
          <dl className="reset-confirm__stats">
            <div className="reset-confirm__stat">
              <dt>물내림</dt>
              <dd id="resetConfirmFlushes">0회</dd>
            </div>
            <div className="reset-confirm__stat">
              <dt>내가 번 돈</dt>
              <dd id="resetConfirmTotal">0원</dd>
            </div>
          </dl>
          <div className="reset-confirm__actions">
            <button
              className="reset-confirm__btn reset-confirm__btn--cancel"
              id="resetConfirmCancel"
              type="button"
            >
              유지하기
            </button>
            <button
              className="reset-confirm__btn reset-confirm__btn--yes"
              id="resetConfirmYes"
              type="button"
            >
              초기화
            </button>
          </div>
        </div>
      </div>

      {/* 물내림 컨페티 */}
      <div className="confettiLayer" id="confettiLayer"></div>
      {/* 토스트 */}
      <div className="toast" id="toast" hidden></div>
      {/* 급여명세서 미리보기 (ReceiptCard — 공유 페이지와 동일) */}
      <PayslipModal />
    </div>
  );
}
