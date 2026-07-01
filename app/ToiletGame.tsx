"use client";

import { useEffect } from "react";
import { DONATE_KAKAO_URL, donateQrUrl } from "@/lib/constants";
import { initGame } from "@/lib/engine/game";
import { initStage } from "@/lib/engine/stage";
import PayslipModal from "@/components/PayslipModal";
import NoticeBanner from "@/components/NoticeBanner";

export default function ToiletGame() {
  useEffect(() => {
    // 무대 스케일러(고정 비율 + 레터박스) — 리사이즈 추적.
    const stopStage = initStage();
    // 게임 엔진(명령형 DOM/canvas 로직)을 마운트 후 1회 실행. 반환값은 cleanup.
    const cleanup = initGame();
    return () => {
      cleanup();
      stopStage();
    };
  }, []);

  return (
    <div id="app">
      {/* 시스템 공지(서버점검·이벤트 등) — 활성 공지가 있을 때만 상단 까만 마퀴 배너 렌더 */}
      <NoticeBanner />
      {/* 네트워크 끊김 표시는 볼일 중 영역에 통합 (networkBadge 미사용) */}
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
                <span className="hud__val" id="stallsVal" hidden>
                  <b id="stallCount">0</b>명
                </span>
                <span
                  className="hud__stalls-loading"
                  id="loadingBadge"
                  aria-label="연결 중"
                >
                  ···
                </span>
                <span className="hud__offline-badge" id="offlineBadge" hidden>
                  연결 끊김
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
                <span className="hud__val" id="globalVal" hidden>
                  <b id="globalEarned">0원</b>
                </span>
                <span
                  className="hud__stalls-loading"
                  id="globalLoading"
                  aria-label="연결 중"
                >
                  ···
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
          <img
            className="skin-light"
            id="skinLight"
            src="/skin/ceiling-light.svg"
            alt=""
          />
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
          {/* 문 잠금 — 인라인 SVG(이스터에그: 클릭 시 스위치 세로로 + 우측 걸쇠 슬라이드아웃) */}
          <svg
            className="skin-latch"
            id="skinLatch"
            viewBox="0 0 44 32"
            overflow="visible"
            role="button"
            aria-label="문 잠금 토글"
          >
            <rect x="-16" y="-16" width="76" height="64" fill="transparent" />
            <rect x="1" y="1" width="30" height="30" rx="6" fill="#989da0" />
            <circle cx="16" cy="16" r="9" fill="#c1c4c5" />
            <rect
              className="latch__switch"
              x="8"
              y="13.6"
              width="16"
              height="4.8"
              rx="2.4"
              fill="#62676a"
            />
            <rect
              className="latch__catch"
              x="31"
              y="7"
              width="12"
              height="18"
              rx="2"
              fill="#92979a"
            />
          </svg>
        </div>

        {/* 천장 형광등 이스터에그 클릭 오버레이 — scene 직계 자식, z-index 높여 상단 UI 위에서 탭 수신 */}
        <div id="ceilingLightTap" className="ceiling-light-tap" aria-hidden />

        {/* 좌측 휴지걸이 — 인라인 SVG(이스터에그: 클릭 시 한 장 뜯겨 바닥으로, 몇 초 후 재충전) */}
        <svg
          className="skin-tp"
          id="skinTp"
          viewBox="0 0 96 132"
          overflow="visible"
          role="button"
          aria-label="휴지 한 장 뜯기"
        >
          <rect x="0" y="-55" width="96" height="209" fill="transparent" />
          <defs>
            <linearGradient id="tpMetal" x1="0" y1="0" x2="1" y2=".2">
              <stop offset="0" stopColor="#55585b" />
              <stop offset=".24" stopColor="#d4d6d7" />
              <stop offset=".54" stopColor="#8c9093" />
              <stop offset=".8" stopColor="#e3e4e4" />
              <stop offset="1" stopColor="#686c6f" />
            </linearGradient>
            <filter id="tpShadow" x="-50%" y="-40%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2" />
            </filter>
          </defs>
          <path
            d="M10 34 61 12 87 28 84 105 25 127 9 84Z"
            fill="#1e2022"
            opacity=".12"
            filter="url(#tpShadow)"
          />
          <path
            d="M8 23 56 5Q79 5 89 27L89 61 53 83 8 68Z"
            fill="url(#tpMetal)"
          />
          <circle className="tp__roll" cx="46" cy="61" r="27" fill="#efeeeb" />
          <circle className="tp__core" cx="46" cy="61" r="9" fill="#76797b" />
          <path d="M8 23 46 52Q55 59 46 67L8 95Z" fill="#7e8285" />
          <path
            className="tp__hang"
            d="M68 55H90V108L85 104 80 114 75 108 70 118 64 111V69Z"
            fill="#f3f2ef"
          />
        </svg>

        {/* 바닥(1점 투시) — clip-path 사다리꼴(globals.css .skin-floor) */}
        <div className="skin-floor" aria-hidden></div>

        {/* 동적 A4 광고 — 문 가운데 포스터 자리(게임 로직 유지) */}
        {/* AD_CREATIVES[0] 은 항상 brand — 초기 HTML을 brand 상태로 맞춰 레이아웃 쉬프트 방지 */}
        <a className="ad-a4 ad-a4--brand" id="adA4" href="#" target="_blank" rel="noopener">
          <img
            className="ad-a4__brand"
            id="adBrand"
            src="/brand-icon.png"
            alt=""
            width={66}
            height={66}
          />
          <div className="ad-a4__emoji" id="adEmoji" hidden>
            📢
          </div>
          <div className="ad-a4__head" id="adHead">
            돈버는 화장실
          </div>
          <div className="ad-a4__sub" id="adSub">
            #변기위의 월급루팡
          </div>
          <span className="ad-a4__tag" id="adTag">
            문의
          </span>
        </a>

        {/* 좌우 실시간 말풍선 (봇) */}
        <div className="bubbles bubbles--left" id="bubblesLeft"></div>
        <div className="bubbles bubbles--right" id="bubblesRight"></div>
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
              <span
                className="ctrl-salary__badge"
                id="salaryChangeHint"
                aria-hidden
                hidden
              >
                👈
              </span>
              <span className="ctrl-salary__cap">내 월급</span>
              <b id="salaryLabel">300만원</b>
            </button>
          </div>
          <div className="deckcol deckcol--mid">
            {/* 내 채팅/정산 말풍선 — 적립칸 바로 위 */}
            <div className="myfeed" id="myFeed"></div>
            <div className="readout">
              <span className="readout__amt" id="personalEarned">
                0원
              </span>
              <span className="readout__rate" id="rateLabel">
                실시간 1초에 5원 버는중
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
                className="receipt-hint"
                id="receiptHint"
                aria-hidden
                hidden
              >
                👉
              </span>
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
              placeholder="옆 칸 모두에게 한마디..."
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
        <div className="salary-panel__left">
          <span className="salary-panel__cap">내 월급 대충</span>
          <b id="salaryBig">300만원</b>
          <span className="salary-panel__rate" id="salaryRate">1초에 약 4.7원</span>
        </div>
        {/* 눈금 라벨 + 슬라이더 — 인덱스 0·4·9·14·17(휴식·250만·500만·1천만·1억).
            thumb 는 반지름만큼 안쪽에서 움직이므로 라벨·틱도 같은 위치로 보정한다. */}
        <div className="salary-panel__meter">
          <div className="salary-panel__scale" aria-hidden="true">
            <span style={{ left: "calc(0% + (0.5 * var(--thumb)))" }}>휴식</span>
            <span style={{ left: "calc(23.529% + (0.2647 * var(--thumb)))" }}>
              250만
            </span>
            <span style={{ left: "calc(52.941% + (-0.0294 * var(--thumb)))" }}>
              500만
            </span>
            <span style={{ left: "calc(82.353% + (-0.3235 * var(--thumb)))" }}>
              1천만
            </span>
            <span style={{ left: "calc(100% + (-0.5 * var(--thumb)))" }}>1억</span>
          </div>
          <div className="salary-panel__slider-wrap">
            <div className="salary-panel__ticks" aria-hidden="true">
              {Array.from({ length: 18 }, (_, i) => {
                const f = i / 17;
                return (
                  <span
                    key={i}
                    style={{
                      left: `calc(${(f * 100).toFixed(3)}% + (${(
                        0.5 - f
                      ).toFixed(4)} * var(--thumb)))`,
                    }}
                  />
                );
              })}
            </div>
            <input
              type="range"
              id="salaryRange"
              min="0"
              max="17"
              step="1"
              defaultValue="5"
            />
          </div>
        </div>
      </div>

      {/* 설정 팝오버 */}
      <div className="settings-panel" id="settingsPanel" hidden>
        {/* 닉네임 */}
        <div className="settings__group">
          <div className="settings__group-title">닉네임</div>
          <div className="settings__nick-row">
            <button
              className="nick-random"
              id="nickRandomBtn"
              type="button"
              aria-label="닉네임 랜덤 생성"
            >
              <span id="nickRandomIcon">🎲</span>
            </button>
            <input
              type="text"
              id="nickInput"
              maxLength={10}
              placeholder="닉네임"
            />
            <label
              className="nick-save-label"
              title="켜면 닉네임을 이 기기에 저장합니다"
            >
              <input
                type="checkbox"
                id="nickPinChk"
                className="nick-save-chk"
              />
              <span className="nick-save-text">저장</span>
            </label>
          </div>
        </div>

        {/* 내 기록 — 총 N원 노출(mt_total_visible) 시에만 표시 */}
        <div className="settings__group" id="settingsHistoryGroup">
          <div className="settings__group-title">내 기록</div>
          <div className="settings__actions">
            <button
              className="settings__btn settings__btn--share"
              id="receiptBtnSettings"
              type="button"
            >
              🧾 급여명세서
            </button>
            <button
              className="settings__btn settings__btn--reset"
              id="resetTotalBtn"
              type="button"
            >
              초기화
            </button>
          </div>
        </div>

        <div className="settings__divider"></div>

        <div className="settings__links">
          <button
            className="settings__link"
            type="button"
            id="settingsShareBtn"
          >
            <span className="settings__link-ico" aria-hidden>
              🔗
            </span>
            공유하기
          </button>
          <button className="settings__link" type="button" id="donateBtn">
            <span className="settings__link-ico" aria-hidden>
              💜
            </span>
            개발자 후원하기
          </button>
          {/* <button className="settings__link" type="button" data-action="ad">
            <span className="settings__link-ico" aria-hidden>
              📢
            </span>
            광고문의
          </button> */}
        </div>

        {/* 개발자 도구 — 일반 사용자에겐 숨김. 우상단 '오늘 다같이' 영역 20번 빠르게 탭으로만 노출됨 */}
        <div id="devTools" hidden>
          <div className="settings__divider"></div>
          <div className="settings__links">
            <button
              className="settings__link settings__link--danger"
              type="button"
              id="devWipeAllBtn"
            >
              <span className="settings__link-ico" aria-hidden>
                🧨
              </span>
              기기 데이터 초기화
            </button>
            <button
              className="settings__link"
              type="button"
              id="devSetTimer5950Btn"
            >
              <span className="settings__link-ico" aria-hidden>
                🧪
              </span>
              59분 50초로 변경 (테스트)
            </button>
            <button
              className="settings__link"
              type="button"
              id="devAddMinBtn"
            >
              <span className="settings__link-ico" aria-hidden>
                ⏩
              </span>
              +1분 추가 (테스트)
            </button>
          </div>
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
          <h2 className="reset-confirm__title">자랑스러운 내 기록 👏👏</h2>
          <dl className="reset-confirm__stats">
            <div className="reset-confirm__stat">
              <dt>물내림</dt>
              <dd id="resetConfirmFlushes">0회</dd>
            </div>
            <div className="reset-confirm__stat">
              <dt>번 돈</dt>
              <dd id="resetConfirmTotal">0원</dd>
            </div>
            <div className="reset-confirm__stat">
              <dt>화장실 체류시간</dt>
              <dd id="resetConfirmTime">0초</dd>
            </div>
          </dl>
          <p className="reset-confirm__msg">초기화 할까요?</p>
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

      {/* 개발자 후원 — PC 카카오페이 QR */}
      <div className="donate-modal" id="donateModal" hidden>
        <div className="donate-modal__backdrop" id="donateBackdrop"></div>
        <div
          className="donate-modal__sheet"
          role="dialog"
          aria-label="개발자 후원하기"
        >
          <button
            className="donate-modal__close"
            id="donateCloseBtn"
            type="button"
            aria-label="닫기"
          >
            ✕
          </button>
          <h2 className="donate-modal__title">💜 개발자 후원하기</h2>
          <p className="donate-modal__sub">화장실이 더 쾌적해져요</p>
          <div className="donate-qr">
            <div className="donate-qr__wrap">
              <img
                className="donate-qr__code"
                src={donateQrUrl(DONATE_KAKAO_URL)}
                alt="카카오페이 송금 QR"
                width={200}
                height={200}
              />
              <img
                className="donate-qr__logo"
                src="/assets/kakaobank-symbol-100.svg"
                alt=""
                aria-hidden
                width={26}
                height={26}
              />
            </div>
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
