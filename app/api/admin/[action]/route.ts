/* /api/admin/[action] — 쿠키 게이트된 어드민 전용 라우트(질문 6의 "특권 루트").
   GET  : stats | chats | bans | warned | me
   POST : ban | unban | warn | clearchat | reset | config | broadcast | logout
   모든 액션은 isAdmin(쿠키→Redis 세션) 통과 필수. */
import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  isAdmin,
  getAdminToken,
  destroySession,
} from "@/lib/server/adminAuth";
import {
  loadConfig,
  getStats,
  getAdminChats,
  listBans,
  listWarned,
  banVid,
  unbanVid,
  warnVid,
  clearChats,
  resetServer,
  setConfig,
  broadcast,
} from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deny() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ action: string }> },
) {
  if (!(await isAdmin(req))) return deny();
  const { action } = await ctx.params;
  switch (action) {
    case "me":
      return NextResponse.json({ ok: true });
    case "stats":
      return NextResponse.json({ ok: true, stats: await getStats() });
    case "chats": {
      const url = new URL(req.url);
      const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
      return NextResponse.json({
        ok: true,
        chats: await getAdminChats(offset, 100),
      });
    }
    case "bans":
      return NextResponse.json({ ok: true, bans: await listBans() });
    case "warned":
      return NextResponse.json({ ok: true, warned: await listWarned() });
    default:
      return NextResponse.json({ ok: false }, { status: 404 });
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ action: string }> },
) {
  if (!(await isAdmin(req))) return deny();
  const { action } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const vid = String(body.vid ?? "");

  switch (action) {
    case "ban":
      return NextResponse.json({
        ok: await banVid(vid, String(body.duration ?? "1d")),
      });
    case "unban":
      return NextResponse.json({ ok: await unbanVid(vid) });
    case "warn":
      return NextResponse.json({ ok: true, count: await warnVid(vid) });
    case "clearchat":
      await clearChats();
      return NextResponse.json({ ok: true });
    case "reset": {
      const scope = String(body.scope ?? "");
      if (!["global", "stats", "all"].includes(scope))
        return NextResponse.json({ ok: false }, { status: 400 });
      await resetServer(scope as "global" | "stats" | "all");
      return NextResponse.json({ ok: true });
    }
    case "config":
      await setConfig(body);
      return NextResponse.json({ ok: true, config: await loadConfig() });
    case "broadcast":
      await broadcast(String(body.text ?? ""), await loadConfig());
      return NextResponse.json({ ok: true });
    case "logout": {
      await destroySession(getAdminToken(req));
      const res = NextResponse.json({ ok: true });
      res.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
      return res;
    }
    default:
      return NextResponse.json({ ok: false }, { status: 404 });
  }
}
