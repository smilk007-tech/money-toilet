import { ImageResponse } from "next/og";
import {
  decodeReceipt,
  fmtWon,
  heroAmount,
  RECEIPT_HISTORY_MAX_SHARE,
  resolveReceiptSlogan,
  type ReceiptData,
} from "@/lib/receiptShare";
import { SHORT_ID_RE, loadReceipt } from "@/lib/receiptStore";
import ReceiptCard from "@/components/ReceiptCard";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "돈버는 화장실 급여명세서";

// 오래된 Safari UA → Google Fonts가 woff2 대신 ttf(satori 호환)를 내려준다.
const TTF_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.3 (KHTML, like Gecko) Version/8.0 Mobile/12A4345d Safari/600.1.4";

async function loadKoreanFont(
  weight: number,
  text: string,
): Promise<ArrayBuffer | null> {
  try {
    const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await (
      await fetch(url, { headers: { "User-Agent": TTF_UA } })
    ).text();
    const m =
      css.match(/src:\s*url\((https:\/\/[^)]+?\.ttf)\)/) ||
      css.match(/url\((https:\/\/[^)]+)\)/);
    if (!m) return null;
    return await (await fetch(m[1])).arrayBuffer();
  } catch {
    return null;
  }
}

const FALLBACK: ReceiptData = {
  n: "익명의 볼일러",
  h: [],
  t: 0,
  g: 0,
  p: 0,
  f: 0,
  ts: Date.now(),
  sl: 0,
};

export default async function Image({
  params,
}: {
  params: Promise<{ d: string }>;
}) {
  const { d } = await params;
  const resolved = SHORT_ID_RE.test(d)
    ? await loadReceipt(d)
    : decodeReceipt(d);
  const expired = resolved === null && SHORT_ID_RE.test(d);
  const data = resolved ?? FALLBACK;
  const hero = heroAmount(data);

  // 만료된 링크 전용 이미지
  if (expired) {
    const expiredGlyphs =
      "돈버는화장실급여명세서만료된링크입니다너도와서벌어봐money-toilet🚽💸";
    const [w400exp, w800exp] = await Promise.all([
      loadKoreanFont(400, expiredGlyphs),
      loadKoreanFont(800, expiredGlyphs),
    ]);
    const expFonts = [
      w400exp && {
        name: "Noto Sans KR",
        data: w400exp,
        weight: 400 as const,
        style: "normal" as const,
      },
      w800exp && {
        name: "Noto Sans KR",
        data: w800exp,
        weight: 800 as const,
        style: "normal" as const,
      },
    ].filter(Boolean) as {
      name: string;
      data: ArrayBuffer;
      weight: 400 | 800;
      style: "normal";
    }[];

    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d120f",
          fontFamily: '"Noto Sans KR"',
          gap: 0,
        }}
      >
        <div style={{ display: "flex", fontSize: 96 }}>🚽</div>
        <div
          style={{
            display: "flex",
            fontSize: 48,
            fontWeight: 800,
            color: "#7fe6c2",
            marginTop: 24,
          }}
        >
          만료된 급여명세서예요
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "#9fdcc9",
            marginTop: 16,
          }}
        >
          나도 화장실에서 돈 벌어볼까? 💸
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 22,
            color: "#4a7c65",
            marginTop: 12,
          }}
        >
          money-toilet
        </div>
      </div>,
      { ...size, fonts: expFonts, emoji: "twemoji" },
    );
  }

  // 이미지에 등장하는 모든 글자를 모아 서브셋 폰트를 받는다(작고 빠름, 한글 깨짐 방지).
  const glyphs =
    "돈버는화장실급여명세서발급일성명지급항목금액회차물내림수당실수령액원이전종이모자라생략벌었어요총회물내림paidtoilet" +
    "0123456789,. :·()⋮·💸👉" +
    data.n +
    resolveReceiptSlogan(data.sl) +
    data.h.map((a) => `${a}`).join("") +
    fmtWon(hero) +
    `총${data.f}회`;

  const [w400, w800] = await Promise.all([
    loadKoreanFont(400, glyphs),
    loadKoreanFont(800, glyphs),
  ]);
  const fonts = [
    w400 && {
      name: "Noto Sans KR",
      data: w400,
      weight: 400 as const,
      style: "normal" as const,
    },
    w800 && {
      name: "Noto Sans KR",
      data: w800,
      weight: 800 as const,
      style: "normal" as const,
    },
  ].filter(Boolean) as {
    name: string;
    data: ArrayBuffer;
    weight: 400 | 800;
    style: "normal";
  }[];

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#0b1510",
        fontFamily: '"Noto Sans KR"',
      }}
    >
      {/* 왼쪽 녹색 액센트 바 */}
      <div
        style={{
          display: "flex",
          width: 8,
          background: "linear-gradient(180deg,#36e0a0 0%,#1a7a57 100%)",
        }}
      />

      {/* 왼쪽: 카피 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: 558,
          padding: "48px 44px",
        }}
      >
        {/* 브랜드 */}
        <div
          style={{
            display: "flex",
            fontSize: 20,
            fontWeight: 800,
            color: "#36e0a0",
          }}
        >
          🚽 돈버는 화장실 · 급여명세서
        </div>

        {/* 메인 금액 */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              fontWeight: 500,
              color: "#9fdcc9",
            }}
          >
            {data.n}님이 화장실에서
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 82,
              fontWeight: 800,
              color: "#ffd84d",
              lineHeight: 1.05,
              marginTop: 6,
            }}
          >
            {fmtWon(hero)}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 25,
              fontWeight: 600,
              color: "#cfeee2",
              marginTop: 10,
            }}
          >
            벌었어요 · 총 {data.f}회 물내림
          </div>
        </div>

        {/* 하단: 명언 + CTA */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 17,
              color: "#5aab87",
              borderLeft: "3px solid #2a5c42",
              paddingLeft: 12,
            }}
          >
            &quot;{resolveReceiptSlogan(data.sl)}&quot;
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 19,
              fontWeight: 700,
              color: "#36e0a0",
              marginTop: 14,
            }}
          >
            너도 와서 벌어봐 👉
          </div>
        </div>
      </div>

      {/* 오른쪽: 급여명세서 카드 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          padding: "32px 44px 32px 8px",
        }}
      >
        <div
          style={{
            display: "flex",
            width: 432,
            borderRadius: 20,
            boxShadow: "0 24px 64px rgba(0,0,0,0.65)",
          }}
        >
          <ReceiptCard
            d={data}
            footerMode="snapshot"
            maxHistoryRows={RECEIPT_HISTORY_MAX_SHARE}
          />
        </div>
      </div>
    </div>,
    { ...size, fonts, emoji: "twemoji" },
  );
}
