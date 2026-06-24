/** OG 메타·공유 링크용 canonical origin (trailing slash 없음) */
export function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;

  // Vercel 프로덕션 alias (money-toilet.vercel.app) — VERCEL_URL 배포 URL보다 우선
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;

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
