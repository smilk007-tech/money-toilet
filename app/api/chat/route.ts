/* POST /api/chat — 채팅 전송 (캐시 안 됨)
   순서: 밴 EXISTS → 레이트리밋 → 버퍼/카운터 기록.
   밴/도배/킬스위치는 200 정상 응답으로 위장(섀도밴) — 클라는 차단을 모름. */
import { loadConfig, postChat } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (req.headers.get("content-type")?.includes("application/json") !== true)
    return Response.json({ ok: true }, { status: 200 });
  let body: { vid?: string; nick?: string; text?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: true }); // 깨진 바디도 조용히 무시
  }
  const vid = String(body.vid ?? "").slice(0, 64);
  const text = String(body.text ?? "");
  if (!vid || !text.trim()) return Response.json({ ok: true });
  const cfg = await loadConfig();
  const res = await postChat(vid, String(body.nick ?? ""), text, cfg);
  // shadow 여부는 응답에 노출하지 않는다(클라가 차단을 눈치채지 못하게).
  return Response.json({ ok: true, id: res.shadow ? null : res.id });
}
