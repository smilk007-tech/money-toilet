/* POST /api/admin/login {password} — 비번 검증 후 HttpOnly 세션 쿠키 발급 */
import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  passwordMatches,
  createSession,
  isLoginLocked,
  recordLoginFail,
  clearLoginFail,
} from "@/lib/server/adminAuth";
import { TTL } from "@/lib/server/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 무차별 대입 차단 — IP당 5회 실패 시 15분 잠금
  if (await isLoginLocked(req))
    return NextResponse.json(
      { ok: false, error: "locked" },
      { status: 429 },
    );

  let body: { password?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const pw = String(body.password ?? "");
  if (!pw || !passwordMatches(pw)) {
    await recordLoginFail(req);
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  await clearLoginFail(req); // 성공 시 카운트 리셋

  const token = await createSession();
  if (!token)
    return NextResponse.json(
      { ok: false, error: "no-store" },
      { status: 500 },
    );

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL.adminSession,
  });
  return res;
}
