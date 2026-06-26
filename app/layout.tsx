import type { Metadata, Viewport } from "next";
import { SITE_NAME } from "@/lib/ogMeta";
import { resolveSiteUrl } from "@/lib/siteUrl";
import { STAGE_MAX_W, STAGE_REF_H, MAX_SCALE } from "@/lib/stage";
import "./globals.css";

// 첫 페인트 전에 무대 확대율을 미리 세팅(FOUC/팝 방지). stage.js와 동일 공식.
const stageBootstrap = `(function(){try{var d=document.documentElement,w=innerWidth,h=innerHeight,` +
  `s=Math.max(1,Math.min(Math.min(w/${STAGE_MAX_W},h/${STAGE_REF_H}),${MAX_SCALE}));` +
  `d.style.setProperty('--stage-scale',String(s));` +
  `d.style.setProperty('--app-h',(h/s)+'px');}catch(e){}})();`;

const siteUrl = resolveSiteUrl();

const title = `${SITE_NAME}`;
const description =
  "실시간 1초마다 번 돈 인증 · 돈버는 화장실에서 너도 벌어봐 👇";
const ogDescription =
  "실시간 1초마다 번 돈 인증 · 돈버는 화장실에서 너도 벌어봐 👇";

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
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: stageBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
