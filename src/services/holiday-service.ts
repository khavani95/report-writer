import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { holidays } from "@/db/schema";
import { config } from "@/lib/config";
import { monthDays, type JalaliDayInfo } from "@/lib/jalali";

export interface HolidayInfo {
  isHoliday: boolean;
  /** عنوان تعطیل رسمی؛ برای جمعه‌ها null است */
  title: string | null;
}

const TIMEOUT_MS = 8000;

/**
 * شناسه‌ی منبعِ فعلی. با تغییر سرویس تقویم باید عوض شود تا ردیف‌های
 * کش‌شده‌ی سرویس قبلی (که ممکن است داده‌ی نادرست داشته باشند) نادیده گرفته شوند.
 */
const SOURCE = "pnldev-v1";

/**
 * رویدادهای «روز جهانیِ ...» که در براکت نام ماه میلادی دارند، مناسبت‌اند
 * نه تعطیل رسمی؛ برای انتخاب عنوان تعطیلی کنار گذاشته می‌شوند.
 * مثال: «روز جهانی جهانگردی [ 27 September ]»
 */
const INTERNATIONAL_DAY = /\[\s*\d{1,2}\s+[A-Za-z]+\s*\]/;

/**
 * تعطیلات مذهبی، تاریخ قمری را با ارقام عربی در براکت دارند
 * (مثل «عاشورای حسینی [ ١٠ محرم ]») و بر بقیه اولویت دارند.
 */
const LUNAR_DATE = /\[[^\]]*[٠-٩]+[^\]]*\]/;

/** انتخاب عنوان تعطیلی از میان مناسبت‌های یک روز */
function pickTitle(events: unknown[]): string {
  const named = events
    .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
    .map((e) => e.trim())
    .filter((e) => !INTERNATIONAL_DAY.test(e));
  return named.find((e) => LUNAR_DATE.test(e)) ?? named[0] ?? "تعطیل رسمی";
}

/**
 * تعطیلات رسمیِ یک ماه شمسی را برمی‌گرداند.
 * ترتیب: کشِ دیتابیس → سرویس تقویم (یک درخواست برای کل ماه) → تعطیلات ثابتِ داخلی.
 * هیچ خطایی به بیرون پرتاب نمی‌شود؛ در بدترین حالت به fallback می‌رسیم.
 */
export async function getMonthHolidays(
  month: string,
): Promise<Map<string, HolidayInfo>> {
  const days = monthDays(month);
  const result = new Map<string, HolidayInfo>();
  if (!days.length) return result;

  const keys = days.map((d) => d.key);
  const db = getDb();

  // ۱) کشِ موجود
  try {
    const cached = await db
      .select({
        jalaliDate: holidays.jalaliDate,
        isHoliday: holidays.isHoliday,
        title: holidays.title,
      })
      .from(holidays)
      // فقط ردیف‌های همین منبع؛ کشِ سرویس‌های قبلی نادیده گرفته می‌شود
      .where(
        and(inArray(holidays.jalaliDate, keys), eq(holidays.source, SOURCE)),
      );
    for (const c of cached) {
      result.set(c.jalaliDate, { isHoliday: c.isHoliday, title: c.title });
    }
  } catch (e) {
    console.error("[holidays] cache read failed:", e);
  }

  // ۲) اگر کشِ ماه کامل نبود، کل ماه را یک‌جا از سرویس بگیر
  if (result.size < days.length) {
    const fetched = await fetchMonth(month, days);
    if (fetched) {
      for (const [key, info] of fetched) result.set(key, info);
      try {
        await db
          .insert(holidays)
          .values(
            [...fetched.entries()].map(([jalaliDate, info]) => ({
              jalaliDate,
              isHoliday: info.isHoliday,
              title: info.title,
              source: SOURCE,
            })),
          )
          // ردیف‌های منبع قدیمی باید بازنویسی شوند، نه نادیده گرفته
          .onConflictDoUpdate({
            target: holidays.jalaliDate,
            set: {
              isHoliday: sql`excluded.is_holiday`,
              title: sql`excluded.title`,
              source: SOURCE,
              fetchedAt: new Date(),
            },
          });
      } catch (e) {
        console.error("[holidays] cache write failed:", e);
      }
    } else {
      console.warn(
        `[holidays] سرویس تقویم برای ${month} در دسترس نبود؛ استفاده از فهرست داخلی.`,
      );
    }
  }

  // ۳) هر روزِ باقی‌مانده → تعطیلات ثابتِ داخلی + جمعه‌ها
  for (const d of days) {
    if (result.has(d.key)) continue;
    result.set(d.key, {
      isHoliday: Boolean(d.holiday) || d.isFriday,
      title: d.holiday,
    });
  }

  return result;
}

/** دریافت کل ماه از سرویس تقویم؛ در صورت خطا null */
async function fetchMonth(
  month: string,
  days: JalaliDayInfo[],
): Promise<Map<string, HolidayInfo> | null> {
  const [jy, jm] = month.split("/").map(Number);
  if (!jy || !jm) return null;

  const base = config.holidayApiUrl;
  const url = `${base}${base.includes("?") ? "&" : "?"}year=${jy}&month=${jm}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      console.error(`[holidays] HTTP ${res.status} از ${url}`);
      return null;
    }
    return parseMonthResponse(await res.json(), days);
  } catch (e) {
    console.error("[holidays] fetch failed:", e);
    return null;
  }
}

interface ApiDay {
  holiday?: unknown;
  event?: unknown;
}

/**
 * تبدیل پاسخِ سرویس تقویم به نگاشت تاریخ→تعطیلی.
 * ساختار انتظار: { status: true, result: { "1": { holiday: bool, event: string[] }, ... } }
 * (تابع خالص است تا مستقل قابل تست باشد.)
 */
export function parseMonthResponse(
  json: unknown,
  days: JalaliDayInfo[],
): Map<string, HolidayInfo> | null {
  if (!json || typeof json !== "object") return null;
  const root = json as { status?: unknown; result?: unknown };
  if (root.status !== true) return null;
  if (!root.result || typeof root.result !== "object") return null;
  const result = root.result as Record<string, ApiDay>;

  const out = new Map<string, HolidayInfo>();
  for (const d of days) {
    const entry = result[String(d.day)];
    // با holiday=false سرویس فقط تعطیلات را برمی‌گرداند؛ نبودِ روز یعنی غیرتعطیل
    if (!entry || typeof entry !== "object") {
      out.set(d.key, { isHoliday: d.isFriday, title: null });
      continue;
    }
    const isHoliday =
      typeof entry.holiday === "boolean" ? entry.holiday : d.isFriday;

    // جمعه‌ها تعطیل هفتگی‌اند و عنوان نمی‌گیرند
    const title =
      isHoliday && !d.isFriday
        ? pickTitle(Array.isArray(entry.event) ? entry.event : [])
        : null;
    out.set(d.key, { isHoliday, title });
  }

  // اگر هیچ روزی تطبیق نداشت، پاسخ نامعتبر تلقی می‌شود
  return out.size ? out : null;
}
