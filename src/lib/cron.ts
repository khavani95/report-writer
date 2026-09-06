import { tehranTime } from "./jalali";

/**
 * محافظِ مسیرهای زمان‌بندی‌شده.
 *
 * Vercel هنگام اجرای Cron هدر `Authorization: Bearer $CRON_SECRET` می‌فرستد.
 * اگر CRON_SECRET تنظیم نشده باشد مسیر باز می‌ماند (برای تست محلی)، ولی در
 * production حتماً باید تنظیم شود وگرنه هر کسی می‌تواند روزها را ببندد.
 */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * آیا ساعتِ تهران در بازه‌ی مجاز است؟
 *
 * ⚠️ لازم است چون بعضی پلن‌های Vercel زمانِ دقیقِ Cron را تضمین نمی‌کنند و
 * ممکن است تا یک ساعت دیرتر اجرا شود. بدون این بررسی، «بستن روز» می‌توانست
 * وسط بعدازظهر اجرا شود و روزِ همه را نصفه ببندد.
 */
export function withinTehranHours(
  from: number,
  to: number,
  now: Date = new Date(),
): boolean {
  const hour = Number(tehranTime(now).slice(0, 2));
  return hour >= from && hour <= to;
}
