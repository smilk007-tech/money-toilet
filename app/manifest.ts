import type { MetadataRoute } from "next";

// PWA 매니페스트 — "홈 화면에 추가" 시 앱처럼 풀스크린으로 뜨게 한다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "돈버는 화장실",
    short_name: "돈화장실",
    description: "근무시간에 앉아서 돈 버는 0.5평의 짜릿함 🚽",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#141d18",
    theme_color: "#1c2620",
    lang: "ko",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
