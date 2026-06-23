import { ImageResponse } from "next/og";
import { decodeReceipt, fmtWon, heroAmount, type ReceiptData } from "@/lib/receiptShare";
import ReceiptCard from "@/components/ReceiptCard";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "똥탐 화장실 영수증";

// 오래된 Safari UA → Google Fonts가 woff2 대신 ttf(satori 호환)를 내려준다.
const TTF_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.3 (KHTML, like Gecko) Version/8.0 Mobile/12A4345d Safari/600.1.4";

async function loadKoreanFont(weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(url, { headers: { "User-Agent": TTF_UA } })).text();
    const m = css.match(/src:\s*url\((https:\/\/[^)]+?\.ttf)\)/) || css.match(/url\((https:\/\/[^)]+)\)/);
    if (!m) return null;
    return await (await fetch(m[1])).arrayBuffer();
  } catch {
    return null;
  }
}

const FALLBACK: ReceiptData = {
  n: "익명의 볼일러", s: 0, l: 0, g: 0, p: 0, f: 0, ts: Date.now(), sl: "회사에서 싸야 이득 💸",
};

export default async function Image({ params }: { params: Promise<{ d: string }> }) {
  const { d } = await params;
  const data = decodeReceipt(d) ?? FALLBACK;
  const hero = heroAmount(data);

  // 이미지에 등장하는 모든 글자를 모아 서브셋 폰트를 받는다(작고 빠름, 한글 깨짐 방지).
  const glyphs =
    "💩똥탐화장실영수증발행손님품목금액근무수당시간적립진행중합계오늘다같이번돈지금볼일명내물내림회너도와서벌어봐근무시간에싸돈paidtoilet원" +
    "0123456789,. :·()TOTAL" +
    data.n + data.sl + fmtWon(hero) + fmtWon(data.g);

  const [w400, w800] = await Promise.all([
    loadKoreanFont(400, glyphs),
    loadKoreanFont(800, glyphs),
  ]);
  const fonts = [
    w400 && { name: "Noto Sans KR", data: w400, weight: 400 as const, style: "normal" as const },
    w800 && { name: "Noto Sans KR", data: w800, weight: 800 as const, style: "normal" as const },
  ].filter(Boolean) as { name: string; data: ArrayBuffer; weight: 400 | 800; style: "normal" }[];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0d120f",
          fontFamily: '"Noto Sans KR"',
        }}
      >
        {/* 왼쪽: 자랑 카피 */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: 600,
            padding: "0 56px",
            color: "#eafff5",
          }}
        >
          <div style={{ display: "flex", fontSize: 27, fontWeight: 800, color: "#7fe6c2" }}>
            💩 똥탐 · 화장실 영수증
          </div>
          <div style={{ display: "flex", fontSize: 34, marginTop: 24, color: "#cfeee2" }}>
            {data.n}님이 화장실에서
          </div>
          <div style={{ display: "flex", fontSize: 88, fontWeight: 800, color: "#ffd84d", marginTop: 2 }}>
            {fmtWon(hero)}
          </div>
          <div style={{ display: "flex", fontSize: 34, color: "#cfeee2" }}>벌었다 ㅋㅋ</div>
          <div style={{ display: "flex", fontSize: 22, color: "#9fdcc9", marginTop: 32 }}>
            근무시간에 싸서 번 돈
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#9fdcc9", marginTop: 6 }}>
            너도 와서 벌어봐 👉 paid-toilet
          </div>
        </div>

        {/* 오른쪽: 영수증 카드 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 600,
            padding: "24px 56px 24px 0",
          }}
        >
          <div style={{ display: "flex", width: 470 }}>
            <ReceiptCard d={data} />
          </div>
        </div>
      </div>
    ),
    { ...size, fonts, emoji: "twemoji" },
  );
}
