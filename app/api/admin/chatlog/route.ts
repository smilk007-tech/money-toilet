/* GET /api/admin/chatlog?date=YYYY-MM-DD — 해당 날짜 채팅로그(과거조회, 최대 3일 보관)
   인증: Bearer 세션 토큰(공유 Redis 검증). date 명시 전달(yesterday 캐시 꼬임 방지). */
import { NextResponse } from "next/server";
import { isAdminToken, isValidDate, readChatLog } from "@/lib/adminRead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAdminToken(req)))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const date = new URL(req.url).searchParams.get("date") || "";
  if (!isValidDate(date)) return NextResponse.json({ ok: false, error: "bad date" }, { status: 400 });
  return NextResponse.json({ ok: true, date, chats: await readChatLog(date) });
}
