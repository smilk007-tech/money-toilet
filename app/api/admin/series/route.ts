/* GET /api/admin/series?start=YYYY-MM-DD&end=YYYY-MM-DD&tick=15
   조회기간[start,end]의 분단위 통계를 tick(분)으로 합산해 시계열로 반환(빈 슬롯 0채움).
   tick ∈ {1,3,5,10,15,30,60}. 분단위 원본은 30일 보관 → 그 이전은 데이터 0.
   인증: Bearer 세션 토큰(공유 Redis 검증). */
import { NextResponse } from "next/server";
import { isAdminToken, isValidDate, readSeries, ALLOWED_TICKS } from "@/lib/adminRead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAdminToken(req)))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const start = url.searchParams.get("start") || "";
  const end = url.searchParams.get("end") || start;
  const tick = Number(url.searchParams.get("tick") || "15");
  if (!isValidDate(start) || !isValidDate(end))
    return NextResponse.json({ ok: false, error: "bad date" }, { status: 400 });
  if (start > end)
    return NextResponse.json({ ok: false, error: "start after end" }, { status: 400 });
  if (!ALLOWED_TICKS.includes(tick))
    return NextResponse.json({ ok: false, error: "bad tick" }, { status: 400 });

  const res = await readSeries(start, end, tick);
  if (!res.ok)
    return NextResponse.json(
      { ok: false, error: "too many points", count: res.count, hint: "기간을 줄이거나 틱 간격을 늘리세요" },
      { status: 413 },
    );
  return NextResponse.json({ ok: true, start, end, tick: res.tick, points: res.points });
}
