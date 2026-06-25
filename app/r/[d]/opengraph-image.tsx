import { ImageResponse } from "next/og";
import {
  decodeReceipt,
  fmtWon,
  heroAmount,
  resolveReceiptSlogan,
  type ReceiptData,
} from "@/lib/receiptShare";
import { SITE_NAME } from "@/lib/ogMeta";
import { SHORT_ID_RE, loadReceipt } from "@/lib/receiptStore";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${SITE_NAME} · 화장실에서 번 돈 인증`;

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

type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700 | 800;
  style: "normal";
};

async function loadFonts(glyphs: string): Promise<OgFont[]> {
  const [w400, w700, w800] = await Promise.all([
    loadKoreanFont(400, glyphs),
    loadKoreanFont(700, glyphs),
    loadKoreanFont(800, glyphs),
  ]);
  return [
    w400 && { name: "Noto Sans KR", data: w400, weight: 400, style: "normal" },
    w700 && { name: "Noto Sans KR", data: w700, weight: 700, style: "normal" },
    w800 && { name: "Noto Sans KR", data: w800, weight: 800, style: "normal" },
  ].filter(Boolean) as OgFont[];
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

const canvas: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  background: "radial-gradient(120% 120% at 50% 0%, #1b2a22 0%, #0d120f 65%)",
  fontFamily: '"Noto Sans KR"',
};

function OgImage({
  nick,
  amount,
  headline,
  slogan,
  fonts,
}: {
  nick?: string;
  amount?: string;
  headline: string;
  slogan?: string;
  fonts: OgFont[];
}) {
  return new ImageResponse(
    <div style={canvas}>
      <div
        style={{
          display: "flex",
          fontSize: 40,
          fontWeight: 800,
          color: "#ffd84d",
          marginBottom: 28,
        }}
      >
        🚽 {SITE_NAME}
      </div>

      {nick && (
        <div
          style={{
            display: "flex",
            fontSize: 48,
            fontWeight: 700,
            color: "#eafff5",
            marginBottom: 8,
          }}
        >
          {nick}님이
        </div>
      )}

      {amount && (
        <div
          style={{
            display: "flex",
            fontSize: 100,
            fontWeight: 800,
            color: "#9fdcc9",
            lineHeight: 1,
            letterSpacing: -2,
          }}
        >
          {amount}
        </div>
      )}

      <div
        style={{
          display: "flex",
          fontSize: 52,
          fontWeight: 800,
          color: "#eafff5",
          marginTop: amount ? 12 : 24,
        }}
      >
        {headline}
      </div>

      {slogan && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 36,
            fontSize: 48,
            fontWeight: 800,
            color: "#9fdcc9",
            lineHeight: 1.35,
          }}
        >
          &quot;{slogan}&quot;
        </div>
      )}
    </div>,
    { ...size, fonts, emoji: "twemoji" },
  );
}

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
  const amount = fmtWon(hero);
  const slogan = resolveReceiptSlogan(data.sl);

  if (expired) {
    const glyphs = `🚽${SITE_NAME}만료된링크${slogan}0123456789`;
    const fonts = await loadFonts(glyphs);
    return OgImage({ headline: "만료된 링크", slogan, fonts });
  }

  const glyphs =
    `🚽${SITE_NAME}0123456789,.` +
    data.n +
    "님이" +
    amount +
    "벌었다ㅋㅋ" +
    slogan;
  const fonts = await loadFonts(glyphs);

  return OgImage({
    nick: data.n,
    amount,
    headline: "벌었다ㅋㅋ",
    slogan,
    fonts,
  });
}
