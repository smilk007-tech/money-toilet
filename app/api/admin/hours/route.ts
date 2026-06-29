/* GET /api/admin/hours?date=YYYY-MM-DD — 해당 날짜 시간별 통계(과거조회)
   인증: Bearer 세션 토큰(공유 Redis 검증). 하루합계는 클라가 24시간 합산. */
import { NextResponse } from "next/server";
import { isAdminToken, isValidDate, readHours } from "@/lib/adminRead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAdminToken(req)))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const date = new URL(req.url).searchParams.get("date") || "";
  if (!isValidDate(date)) return NextResponse.json({ ok: false, error: "bad date" }, { status: 400 });
  return NextResponse.json({ ok: true, date, hours: await readHours(date) });
}
