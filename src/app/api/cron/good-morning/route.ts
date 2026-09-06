import { greetChats } from "@/services/schedule";
import { cronAuthorized, withinTehranHours } from "@/lib/cron";
import { describeError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * پیام صبحگاهی + یادآوری قالب گزارش — هر روز ۷:۰۰ به وقت تهران
 * (۳:۳۰ UTC در vercel.json).
 */
export async function GET(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) {
    return new Response("unauthorized", { status: 401 });
  }
  // اجرای دیرهنگام نباید ظهر یا شب پیام «صبح بخیر» بفرستد
  if (!withinTehranHours(5, 11)) {
    return Response.json({ skipped: "خارج از بازه‌ی مجاز" });
  }

  try {
    const res = await greetChats();
    console.log(`[cron] پیام صبحگاهی به ${res.chats} گروه فرستاده شد.`);
    return Response.json({ ok: true, ...res });
  } catch (e) {
    console.error("[cron] پیام صبحگاهی ناموفق:", describeError(e));
    return Response.json({ ok: false }, { status: 200 });
  }
}
