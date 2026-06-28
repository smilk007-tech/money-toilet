/* GET /api/snapshot — 읽기 전용 스냅샷 (presence/global/최근채팅/커서)
   · vid·쿼리파라미터 없음 → 모든 클라가 같은 캐시 키를 공유.
   · Cache-Control s-maxage=2 + SWR=4 → Vercel CDN이 수천 폴러를 ~1 오리진 히트로 압축.
   · 절대 쓰기 금지(캐시 히트 시 함수 미실행). 방문자/presence 쓰기는 POST에서만. */
import { loadConfig, getSnapshot } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await loadConfig();
  const snap = await getSnapshot(cfg);
  return new Response(JSON.stringify(snap), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, s-maxage=2, stale-while-revalidate=4",
    },
  });
}
