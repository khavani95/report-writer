import { webhookCallback } from "grammy";
import { getBot } from "@/bot";
import { config } from "@/lib/config";
import { describeError } from "@/lib/log";

// این مسیر باید روی رانتایم Node اجرا شود (نیاز به دیتابیس و exceljs)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * نقطه‌ی ورود وبهوک تلگرام.
 * تلگرام آپدیت‌ها را با POST به این آدرس می‌فرستد.
 */
export async function POST(req: Request): Promise<Response> {
  const handler = webhookCallback(getBot(), "std/http", {
    secretToken: config.telegram.webhookSecret || undefined,
    timeoutMilliseconds: 55_000,
    // پیش‌فرض «throw» است و پاسخ ۵۰۰ می‌دهد؛ آن‌وقت تلگرام همان آپدیت را
    // بی‌پایان دوباره می‌فرستد. فقط لاگ می‌کنیم و ۲۰۰ برمی‌گردانیم.
    onTimeout: () => {
      console.error("[webhook] پردازش آپدیت از ۵۵ ثانیه گذشت");
    },
  });

  try {
    return await handler(req);
  } catch (e) {
    // ⚠️ حیاتی: هر پاسخ غیر ۲۰۰ یعنی تلگرام همان آپدیت را دوباره می‌فرستد و
    // چون خطا تکرارشدنی است، حلقه‌ی بی‌پایانی از درخواست ساخته می‌شود که
    // هم بات را کند می‌کند و هم داده‌ی روز را چندباره بازنویسی می‌کند.
    console.error("[webhook] خطای پردازش آپدیت:", describeError(e));
    return new Response("ok", { status: 200 });
  }
}

// برای بررسی سلامت از مرورگر
export async function GET(): Promise<Response> {
  return new Response("بات گزارش فعالیت هیئت‌مدیره فعال است ✅", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
