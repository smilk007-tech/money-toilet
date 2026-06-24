import type { Metadata, Viewport } from "next";
import { resolveSiteUrl } from "@/lib/siteUrl";
import "./globals.css";

const siteUrl = resolveSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "돈버는 화장실 · 변기위의 월급루팡",
  description: "변기 위에 앉아서 돈을 벌자!",
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
