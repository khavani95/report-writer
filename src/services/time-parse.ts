/**
 * تحلیل قطعیِ زمان از متن فارسی (بدون هوش مصنوعی).
 * «۵ عصر» → 17:00 ، «۸ شب» → 20:00 ، «۷ تا ۵» → 07:00 و 17:00 ، «۸ و نیم» → 08:30.
 */

/** تبدیل ارقام فارسی/عربی به لاتین */
export function normalizeDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => {
    const c = d.charCodeAt(0);
    if (c >= 0x06f0 && c <= 0x06f9) return String(c - 0x06f0);
    if (c >= 0x0660 && c <= 0x0669) return String(c - 0x0660);
    return d;
  });
}

/**
 * عددهای فارسی به‌حروف.
 *
 * ⚠️ متنِ پیاده‌شده‌ی ویس تقریباً همیشه عدد را با حرف می‌نویسد («ساعت هشت»
 * نه «ساعت ۸»). بدون این جدول، هیچ ساعتی از هیچ پیام صوتی خوانده نمی‌شد.
 */
const NUMBER_WORDS: Record<string, number> = {
  صفر: 0, یک: 1, دو: 2, سه: 3, چهار: 4, چار: 4, پنج: 5, پنچ: 5,
  شش: 6, شیش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10, یازده: 11, دوازده: 12,
  سیزده: 13, چهارده: 14, چارده: 14, پانزده: 15, پونزده: 15,
  شانزده: 16, شونزده: 16, هفده: 17, هیفده: 17, هجده: 18, هیجده: 18,
  نوزده: 19, بیست: 20, سی: 30, چهل: 40, پنجاه: 50,
};

/** واژه‌هایی که می‌توانند نیمه‌ی دومِ عددِ مرکب باشند: «بیست و یک» */
const TENS = new Set(["بیست", "سی", "چهل", "پنجاه"]);

/** کسرهای رایج ساعت */
const FRACTIONS: Record<string, number> = { نیم: 30, ربع: 15 };

/**
 * حذف نویسه‌های زینتی برای مقایسه‌ی واژه‌ی عددی.
 * ⚠️ «:» حذف نمی‌شود، وگرنه «۹:۳۰» به «۹۳۰» تبدیل و از الگوی ساعت رد می‌شود.
 */
function plainWord(t: string): string {
  return t
    .replace(/[ىيﻱﻲ]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌‍‎‏]/g, "")
    .replace(/[.,،؛;!؟?"'«»()]/g, "")
    .replace(/^:+|:+$/g, "")
    .trim();
}

/** آیا این واژه می‌تواند شروع یک عدد باشد (رقمی یا حرفی)؟ */
export function isNumberWord(token?: string): boolean {
  if (!token) return false;
  const t = plainWord(normalizeDigits(token));
  return /^\d{1,2}(:\d{2})?$/.test(t) || t in NUMBER_WORDS;
}

/** آیا این واژه کسرِ ساعت است؟ («نیم»، «ربع») */
export function isFractionWord(token?: string): boolean {
  if (!token) return false;
  return plainWord(token) in FRACTIONS;
}

export interface NumberRead {
  /** مقدار به‌صورت رشته‌ی رقمی، مثل «8» یا «9:30» */
  text: string;
  /** چند واژه مصرف شد */
  consumed: number;
}

/**
 * یک عدد را از `tokens[i]` می‌خواند — چه رقمی باشد چه حرفی، چه مرکب
 * («بیست و یک»). خروجی رشته‌ی رقمی است تا بقیه‌ی مسیر دست‌نخورده بماند.
 */
export function readNumber(tokens: string[], i: number): NumberRead | null {
  const first = plainWord(normalizeDigits(tokens[i] ?? ""));
  if (/^\d{1,2}(:\d{2})?$/.test(first)) return { text: first, consumed: 1 };

  const base = NUMBER_WORDS[first];
  if (base === undefined) return null;

  // «بیست و یک» → ۲۱
  if (TENS.has(first) && plainWord(tokens[i + 1] ?? "") === "و") {
    const second = NUMBER_WORDS[plainWord(tokens[i + 2] ?? "")];
    if (second !== undefined && second < 10) {
      return { text: String(base + second), consumed: 3 };
    }
  }
  return { text: String(base), consumed: 1 };
}

/** «و نیم» → ۳۰ دقیقه، «و ربع» → ۱۵ دقیقه، «و ده دقیقه» → ۱۰ دقیقه */
export function readMinutes(tokens: string[], i: number): NumberRead | null {
  if (plainWord(tokens[i] ?? "") !== "و") return null;

  const frac = FRACTIONS[plainWord(tokens[i + 1] ?? "")];
  if (frac !== undefined) return { text: String(frac), consumed: 2 };

  const num = readNumber(tokens, i + 1);
  if (num && /^\d{1,2}$/.test(num.text)) {
    const after = plainWord(tokens[i + 1 + num.consumed] ?? "");
    if (after === "دقیقه") {
      return { text: num.text, consumed: 1 + num.consumed + 1 };
    }
  }
  return null;
}

const AM_WORDS = /صبح|بامداد/;
const PM_WORDS = /عصر|بعد ?از ?ظهر|بعدازظهر|غروب|شب|بعد ?ظهر/;
const NOON_WORDS = /ظهر/;

export function hhmm(h: number, m: number): string {
  const hh = ((h % 24) + 24) % 24;
  return `${String(hh).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** «08:30» → ۵۱۰ دقیقه (null اگر معتبر نباشد) */
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = normalizeDigits(t).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** ۵۱۰ دقیقه → «08:30» */
export function minutesToTime(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return hhmm(Math.floor(m / 60), m % 60);
}

/**
 * یک زمان تکی را تحلیل می‌کند. kind تعیین می‌کند اگر صبح/عصر مشخص نشد،
 * پیش‌فرض چه باشد ("entry"=صبح، "exit"=عصر).
 */
export function parseSingleTime(
  text: string,
  kind: "entry" | "exit",
): string | null {
  const t = normalizeDigits(text);
  const m = t.match(/(\d{1,2})(?::(\d{2}))?/);
  if (!m) {
    // «ظهر» بدون عدد
    if (NOON_WORDS.test(t) && !PM_WORDS.test(t)) return "12:00";
    return null;
  }
  let h = parseInt(m[1], 10);
  let min = m[2] ? parseInt(m[2], 10) : 0;
  if (/و ?نیم/.test(t)) min = 30;
  if (h > 23 || min > 59) return null;

  const isAm = AM_WORDS.test(t);
  const isPm = PM_WORDS.test(t);
  const isNoon = NOON_WORDS.test(t) && !isPm && !isAm;

  if (isNoon) {
    // «۱ ظهر» ~ ۱۳، «۱۲ ظهر» ~ ۱۲
    if (h === 12) return hhmm(12, min);
    return hhmm(h < 12 ? h + 12 : h, min);
  }
  if (isPm) {
    if (h >= 1 && h <= 11) h += 12;
  } else if (isAm) {
    if (h === 12) h = 0;
  } else {
    // بدون واژه‌ی صبح/عصر: بر اساس نوع
    if (kind === "exit" && h >= 1 && h <= 11) h += 12;
  }
  return hhmm(h, min);
}

/** بازه‌ی «X تا Y» را تحلیل می‌کند */
export function parseTimeRange(
  text: string,
): { entry: string; exit: string } | null {
  const t = normalizeDigits(text);
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(?:تا|الی|-)\s*(\d{1,2})(?::(\d{2}))?/);
  if (!m) return null;
  const eH = parseInt(m[1], 10);
  const eMin = m[2] ? parseInt(m[2], 10) : 0;
  let xH = parseInt(m[3], 10);
  const xMin = m[4] ? parseInt(m[4], 10) : 0;
  // خروج معمولاً بعدازظهر است
  if (xH >= 1 && xH <= 11) xH += 12;
  return { entry: hhmm(eH, eMin), exit: hhmm(xH, xMin) };
}

/**
 * روزِ هر عضو یک زنجیره‌ی رو به جلو است؛ ساعت‌ها نباید عقب بروند.
 * «ساعت ۸ اومدم دفتر … ساعت ۲ رفتم پروژه» یعنی ۱۴:۰۰، نه ۰۲:۰۰.
 * اگر زمانِ تازه از زمانِ قبلی عقب‌تر باشد و با ۱۲ ساعت جلو رفتن درست شود،
 * همان تصحیح اعمال می‌شود.
 */
export function forwardInDay(time: string, previous: string | null): string {
  const t = timeToMinutes(time);
  const p = timeToMinutes(previous);
  if (t === null || p === null || t >= p) return time;
  const shifted = t + 12 * 60;
  if (shifted >= p && shifted < 24 * 60) return minutesToTime(shifted);
  return time;
}
