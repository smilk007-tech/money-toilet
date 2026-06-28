/* POST /api/beacon — presence 하트비트 + 순방문자 기록 (캐시 안 됨, vid 사용)
   입장 시 1회 + 폴링 중 주기적(약 12초)으로 호출. 라커(채팅 안 하는 사람)도 집계. */
import { recordPresence } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { vid?: string; nick?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const vid = String(body.vid ?? "").slice(0, 64);
  if (!vid) return Response.json({ ok: false }, { status: 400 });
  await recordPresence(vid, body.nick);
  return Response.json({ ok: true });
}
