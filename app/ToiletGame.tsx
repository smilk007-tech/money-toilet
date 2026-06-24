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
                  <span className="hud__cap">볼일 중</span>
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

      {/* ===== 1인칭 공중화장실 칸 (SVG 스킨) ===== */}
      <div className="scene" id="scene">
        {/* 좌/우 가벽 */}
        <img
          className="skin-side skin-side--left"
          src="/skin/left-wall.svg"
          alt=""
          aria-hidden
        />
        <img
          className="skin-side skin-side--right"
          src="/skin/right-wall.svg"
          alt=""
          aria-hidden
        />

        {/* 정면 문 + 천장등/경첩/잠금 */}
        <div className="skin-center" aria-hidden>
          <img
            className="skin-center__base"
            src="/skin/center-door.svg"
            alt=""
          />
          <img className="skin-light" src="/skin/ceiling-light.svg" alt="" />
          <img
            className="skin-hinge skin-hinge--1"
            src="/skin/hinge.svg"
            alt=""
          />
          <img
            className="skin-hinge skin-hinge--2"
            src="/skin/hinge.svg"
            alt=""
          />
          <img
            className="skin-hinge skin-hinge--3"
            src="/skin/hinge.svg"
            alt=""
          />
          <img className="skin-latch" src="/skin/latch.svg" alt="" />
        </div>

        {/* 좌측 휴지걸이 */}
        <img
          className="skin-tp"
          src="/skin/toilet-paper.svg"
          alt=""
          aria-hidden
        />

        {/* 바닥(좌/중앙/우 원근) */}
        <div className="skin-floor" aria-hidden>
          <img
            className="skin-floor__side skin-floor__side--left"
            src="/skin/floor-left.svg"
            alt=""
          />
          <img
            className="skin-floor__center"
            src="/skin/floor-center.svg"
            alt=""
          />
          <img
            className="skin-floor__side skin-floor__side--right"
            src="/skin/floor-right.svg"
            alt=""
          />
        </div>

        {/* 동적 A4 광고 — 문 가운데 포스터 자리(게임 로직 유지) */}
        <a className="ad-a4" id="adA4" href="#" target="_blank" rel="noopener">
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

        {/* 좌우 실시간 말풍선 (봇) */}
        <div className="bubbles bubbles--left" id="bubblesLeft"></div>
        <div className="bubbles bubbles--right" id="bubblesRight"></div>
      </div>

      {/* ===== 하단 스택 ===== */}
      <div className="bottom">
        {/* 내 채팅/정산 말풍선 — 덱 바로 위 가운데(덱과 겹치지 않음) */}
        <div className="myfeed" id="myFeed"></div>
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
              hidden
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
            <button className="flush btn-yellow" id="flushBtn" type="button">
              <div className="flush__fill" id="flushFill"></div>
              <span className="flush__icon">🚽</span>
              <span id="flushLabel">물내리기</span>
            </button>
          </div>
        </div>

        {/* 2row: 채팅 */}
        <form className="chat" id="chatForm" autoComplete="off">
          <div className="chat__field">
            <span className="chat__nick" id="chatNick"></span>
            <input
              type="text"
              id="chatInput"
              placeholder="옆 칸 모두에게 한마디"
              maxLength={40}
            />
          </div>
          <button type="submit" className="chat__send">
            전송
          </button>
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
            시원한 내 기록
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
