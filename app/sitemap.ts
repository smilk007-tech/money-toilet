import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "@/lib/siteUrl";

// 홈만 노출 — 공유페이지(/r)·어드민은 색인 대상이 아니다.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: resolveSiteUrl(), changeFrequency: "daily", priority: 1 }];
}
