import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/ogMeta";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${SITE_NAME} · 변기위의 월급루팡`;

const TAGLINE = "#변기위의 월급루팡";

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

export default async function Image() {
  const glyphs = `🚽${SITE_NAME}${TAGLINE}`;
  const [w700, w800] = await Promise.all([
    loadKoreanFont(700, glyphs),
    loadKoreanFont(800, glyphs),
  ]);
  const fonts = [
    w700 && { name: "Noto Sans KR", data: w700, weight: 700, style: "normal" },
    w800 && { name: "Noto Sans KR", data: w800, weight: 800, style: "normal" },
  ].filter(Boolean) as OgFont[];

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        background:
          "radial-gradient(120% 120% at 50% 0%, #1b2a22 0%, #0d120f 65%)",
        fontFamily: '"Noto Sans KR"',
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 100,
          fontWeight: 800,
          color: "#ffd84d",
          lineHeight: 1.1,
          letterSpacing: -2,
          textShadow: "0 4px 24px rgba(255, 216, 77, 0.35)",
        }}
      >
        🚽 {SITE_NAME}
      </div>
      <div
        style={{
          marginTop: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 52,
          fontWeight: 800,
          color: "#9fdcc9",
          lineHeight: 1.2,
          letterSpacing: -1,
        }}
      >
        {TAGLINE}
      </div>
    </div>,
    { ...size, fonts, emoji: "twemoji" },
  );
}
