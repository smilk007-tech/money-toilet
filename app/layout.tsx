import type { Metadata, Viewport } from "next";
import { SITE_NAME } from "@/lib/ogMeta";
import { resolveSiteUrl } from "@/lib/siteUrl";
import "./globals.css";

const siteUrl = resolveSiteUrl();

const title = `${SITE_NAME} · 변기 위에서 앉아 돈 버는 실시간 월급루팡 게임, 무료로 지금 바로 시작`;
const description =
  "근무 시간에 화장실에서 돈을 모으는 실시간 월급루팡 게임, 돈버는 화장실. 변기 위에 앉아 초마다 수입이 쌓이고, 실시간 접속자와 함께 급여명세서로 수입을 인증하고 친구에게 자랑하세요. 무료로 지금 접속해서 나도 같이 벌어보세요!";
const ogDescription =
  "변기 위에 앉아 실시간으로 돈을 모으는 월급루팡! 급여명세서로 수입을 인증하고 친구에게 자랑하세요. 돈버는 화장실에 지금 접속해서 나도 같이 벌어보세요 👇";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    title,
    description: ogDescription,
    siteName: SITE_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: ogDescription,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1c2620",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
