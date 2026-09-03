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
