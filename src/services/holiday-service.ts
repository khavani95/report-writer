import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { holidays } from "@/db/schema";
import { config } from "@/lib/config";
import { monthDays } from "@/lib/jalali";

export interface HolidayInfo {
  isHoliday: boolean;
  title: string | null;
}

/** تعداد درخواست هم‌زمان به سرویس تعطیلات */
const CONCURRENCY = 6;
const TIMEOUT_MS = 6000;

/**
 * تعطیلات رسمیِ یک ماه شمسی را برمی‌گرداند.
 * ابتدا از کشِ دیتابیس می‌خواند، روزهای نبود را از سرویس بیرونی می‌گیرد و کش می‌کند.
 * اگر سرویس در دسترس نباشد، به تعطیلاتِ ثابتِ داخلی برمی‌گردد (بدون خطا).
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
  let cached: Array<{ jalaliDate: string; isHoliday: boolean; title: string | null }> = [];
  try {
    cached = await db
      .select({
        jalaliDate: holidays.jalaliDate,
        isHoliday: holidays.isHoliday,
        title: holidays.title,
      })
      .from(holidays)
      .where(inArray(holidays.jalaliDate, keys));
  } catch (e) {
    console.error("holiday cache read failed:", e);
  }
  for (const c of cached) {
    result.set(c.jalaliDate, { isHoliday: c.isHoliday, title: c.title });
  }

  // ۲) روزهای نبود را از سرویس بگیر
  const missing = keys.filter((k) => !result.has(k));
  if (missing.length) {
    const fetched = await fetchDays(missing);
    for (const [key, info] of fetched) result.set(key, info);

    if (fetched.size) {
      try {
        await db
          .insert(holidays)
          .values(
            [...fetched.entries()].map(([jalaliDate, info]) => ({
              jalaliDate,
              isHoliday: info.isHoliday,
              title: info.title,
            })),
          )
          .onConflictDoNothing();
      } catch (e) {
        console.error("holiday cache write failed:", e);
      }
    }
  }

  // ۳) هر روزی که هنوز مشخص نشده → تعطیلاتِ ثابتِ داخلی (fallback)
  for (const d of days) {
    if (result.has(d.key)) continue;
    result.set(d.key, { isHoliday: Boolean(d.holiday), title: d.holiday });
  }

  return result;
}

/** دریافت دسته‌ای روزها از سرویس بیرونی (با محدودیت هم‌زمانی) */
async function fetchDays(keys: string[]): Promise<Map<string, HolidayInfo>> {
  const out = new Map<string, HolidayInfo>();
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const chunk = keys.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(fetchDay));
    results.forEach((info, idx) => {
      if (info) out.set(chunk[idx], info);
    });
  }
  return out;
}

/** دریافت یک روز؛ در صورت هر خطایی null برمی‌گرداند */
async function fetchDay(key: string): Promise<HolidayInfo | null> {
  const [y, m, d] = key.split("/").map(Number);
  if (!y || !m || !d) return null;
  const url = `${config.holidayApiUrl.replace(/\/$/, "")}/${y}/${m}/${d}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return parseResponse(json);
  } catch {
    return null; // شبکه/تایم‌اوت — بی‌صدا رد می‌شویم تا گزارش خراب نشود
  }
}

interface ApiEvent {
  description?: unknown;
  is_holiday?: unknown;
  is_religious?: unknown;
}

/** تبدیل پاسخ سرویس به ساختار داخلی، با اعتبارسنجی سخت‌گیرانه */
function parseResponse(json: unknown): HolidayInfo | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as { is_holiday?: unknown; events?: unknown };
  if (typeof obj.is_holiday !== "boolean") return null;

  let title: string | null = null;
  if (Array.isArray(obj.events)) {
    const named = (obj.events as ApiEvent[]).find(
      (e) => e && e.is_holiday === true && typeof e.description === "string",
    );
    if (named) title = String(named.description).trim() || null;
  }
  return { isHoliday: obj.is_holiday, title };
}
