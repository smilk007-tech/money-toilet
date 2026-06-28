import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "@/lib/siteUrl";

// 홈(/)만 색인 허용. 어드민·API·공유페이지(/r)는 차단.
export default function robots(): MetadataRoute.Robots {
  const site = resolveSiteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/r/"],
    },
    host: site,
    sitemap: `${site}/sitemap.xml`,
  };
}
