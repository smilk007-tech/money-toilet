import type { Metadata, Viewport } from "next";
import { SITE_NAME } from "@/lib/ogMeta";
import { resolveSiteUrl } from "@/lib/siteUrl";
import "./globals.css";

const siteUrl = resolveSiteUrl();

const title = `${SITE_NAME}`;
const description =
  "근무시간에 싸서 번 돈 인증 · 돈버는 화장실에서 너도 벌어봐 👇";
const ogDescription =
  "근무시간에 싸서 번 돈 인증 · 돈버는 화장실에서 너도 벌어봐 👇";

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
