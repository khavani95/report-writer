import { closeAllDays } from "@/services/schedule";
import { cronAuthorized, withinTehranHours } from "@/lib/cron";
import { describeError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * بستنِ خودکار روزِ همه‌ی اعضا — هر شب ۲۳:۳۰ به وقت تهران.
 * (در vercel.json روی ۲۰:۰۰ UTC تنظیم شده؛ تهران +۳:۳۰ است و ایران
 * ساعت تابستانی ندارد.)
 */
export async function GET(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) {
    return new Response("unauthorized", { status: 401 });
  }
  // اگر Cron دیر اجرا شد، نباید وسط روز روزِ کسی را ببندد
  if (!withinTehranHours(22, 23)) {
    return Response.json({ skipped: "خارج از بازه‌ی مجاز" });
  }

  try {
    const res = await closeAllDays();
    console.log(`[cron] ${res.days} روز در ${res.chats} گروه بسته شد.`);
    return Response.json({ ok: true, ...res });
  } catch (e) {
    console.error("[cron] بستن روزها ناموفق:", describeError(e));
    return Response.json({ ok: false }, { status: 200 });
  }
}
