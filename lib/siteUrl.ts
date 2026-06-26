/** OG 메타·공유 링크용 canonical origin (trailing slash 없음) */
const CANONICAL_SITE_ORIGIN = "https://moneytoilet.kr";

export function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;

  // Vercel 프로덕션 — 커스텀 도메인 고정 (구 money-toilet.vercel.app 대체)
  if (process.env.VERCEL_ENV === "production") {
    return CANONICAL_SITE_ORIGIN;
  }

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

/** 클라이언트 공유 링크 — NEXT_PUBLIC_SITE_URL 우선, 없으면 현재 origin */
export function resolveShareOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  if (typeof window !== "undefined") return window.location.origin;
  return resolveSiteUrl();
}
