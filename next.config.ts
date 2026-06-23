import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 게임 엔진이 마운트 시 DOM 이벤트 리스너를 1회 부착하는 명령형 구조라,
  // StrictMode의 개발 모드 이중 호출이 리스너를 중복 부착하는 문제를 막기 위해 비활성화.
  reactStrictMode: false,
};

export default nextConfig;
