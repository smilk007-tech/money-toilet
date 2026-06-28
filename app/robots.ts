import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "@/lib/siteUrl";

// 홈(/)만 색인 허용. API·공유페이지(/r)는 차단(질문 20).
// 어드민 비밀 경로는 여기 적지 않는다 — robots.txt는 공개라 슬러그가 노출되기 때문.
// 어드민은 page의 robots:{index:false} 메타 + X-Robots-Tag 헤더로 비노출 처리.
export default function robots(): MetadataRoute.Robots {
  const site = resolveSiteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/r/"],
    },
    host: site,
    sitemap: `${site}/sitemap.xml`,
  };
}
