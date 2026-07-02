/* GET  /api/admin/receipts?date=YYYY-MM-DD           — 해당 날짜 자랑 URL 목록(과거조회)
   DELETE /api/admin/receipts?date=YYYY-MM-DD&id=xxxxxx — 자랑 URL 수동 삭제(콘텐츠+목록)
   인증: Bearer 세션 토큰(공유 Redis 검증). */
import { NextResponse } from "next/server";
import { isAdminToken, isValidDate, readReceipts, deleteReceipt } from "@/lib/adminRead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHORT_ID_RE = /^[A-Za-z0-9]{6}$/;

export async function GET(req: Request) {
  if (!(await isAdminToken(req)))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const date = new URL(req.url).searchParams.get("date") || "";
  if (!isValidDate(date)) return NextResponse.json({ ok: false, error: "bad date" }, { status: 400 });
  return NextResponse.json({ ok: true, date, receipts: await readReceipts(date) });
}

export async function DELETE(req: Request) {
  if (!(await isAdminToken(req)))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || "";
  const id = url.searchParams.get("id") || "";
  if (!isValidDate(date)) return NextResponse.json({ ok: false, error: "bad date" }, { status: 400 });
  if (!SHORT_ID_RE.test(id)) return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  await deleteReceipt(date, id);
  return NextResponse.json({ ok: true });
}
