import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 게임 엔진이 마운트 시 DOM 이벤트 리스너를 1회 부착하는 명령형 구조라,
  // StrictMode의 개발 모드 이중 호출이 리스너를 중복 부착하는 문제를 막기 위해 비활성화.
  reactStrictMode: false,
  // 같은 와이파이의 폰 등에서 LAN IP로 개발 서버에 접속할 때
  // Next의 cross-origin 차단으로 클라이언트 요청이 막히는 것을 허용.
  allowedDevOrigins: ["192.168.0.91"],
  // 검색엔진 비노출 belt-and-suspenders(질문 20) — 어드민/어드민API에 헤더로도 차단.
  async headers() {
    return [
      {
        // 어드민 비밀 경로 — 헤더로도 noindex(슬러그는 robots.txt에 노출 안 함)
        source: "/ctrl-9x7k2p3f/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/ctrl-9x7k2p3f",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/api/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
