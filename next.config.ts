import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 게임 엔진이 마운트 시 DOM 이벤트 리스너를 1회 부착하는 명령형 구조라,
  // StrictMode의 개발 모드 이중 호출이 리스너를 중복 부착하는 문제를 막기 위해 비활성화.
  reactStrictMode: false,
  // 같은 와이파이의 폰 등에서 LAN IP로 개발 서버에 접속할 때
  // Next의 cross-origin 차단으로 클라이언트 요청이 막히는 것을 허용.
  allowedDevOrigins: ["192.168.0.91"],
  // 검색엔진 비노출 — /admin 에 헤더로도 noindex.
  async headers() {
    return [
      {
        source: "/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/admin",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
