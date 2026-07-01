/* GET /api/admin/receipts?date=YYYY-MM-DD — 해당 날짜에 생성된 자랑 URL 목록(과거조회)
   인증: Bearer 세션 토큰(공유 Redis 검증). */
import { NextResponse } from "next/server";
import { isAdminToken, isValidDate, readReceipts } from "@/lib/adminRead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAdminToken(req)))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const date = new URL(req.url).searchParams.get("date") || "";
  if (!isValidDate(date)) return NextResponse.json({ ok: false, error: "bad date" }, { status: 400 });
  return NextResponse.json({ ok: true, date, receipts: await readReceipts(date) });
}
