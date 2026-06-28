/* POST /api/flush — 물내림 정산 (캐시 안 됨)
   서버가 mt:global의 단일 소유자. 금액은 서버측 절대 클램프로 그리핑 방지.
   권위 있는 total을 반환 → 클라가 낙관값을 이 값으로 화해(monotonic). */
import { loadConfig, postFlush } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    vid?: string;
    nick?: string;
    amount?: number;
    broadcast?: boolean;
    text?: string | null;
  } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: true, total: 0 });
  }
  const vid = String(body.vid ?? "").slice(0, 64);
  const cfg = await loadConfig();
  const res = await postFlush(
    vid,
    String(body.nick ?? ""),
    Number(body.amount ?? 0),
    body.broadcast !== false,
    body.text ?? null,
    cfg,
  );
  return Response.json({ ok: true, total: res.total });
}
