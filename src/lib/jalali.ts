import { toJalaali, toGregorian } from "jalaali-js";

const FA_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

const FA_WEEKDAYS = [
  "یکشنبه", // 0 = Sunday در getDay()
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
  "شنبه",
];

/** تاریخ فعلی به وقت تهران را برمی‌گرداند */
export function nowInTehran(): Date {
  // ساخت یک Date که اجزای محلی‌اش با ساعت تهران برابر است
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return new Date(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  );
}

export interface JalaliInfo {
  /** رشته‌ی تاریخ شمسی به شکل YYYY/MM/DD برای کلید یکتا */
  key: string;
  /** نمایش کامل فارسی، مثل «شنبه ۳۰ تیر ۱۴۰۳» */
  label: string;
  gregorian: Date;
  jy: number;
  jm: number;
  jd: number;
}

export function toJalali(date: Date = nowInTehran()): JalaliInfo {
  const { jy, jm, jd } = toJalaali(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  const weekday = FA_WEEKDAYS[date.getDay()];
  const key = `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
  const label = `${weekday} ${toFaDigits(jd)} ${FA_MONTHS[jm - 1]} ${toFaDigits(jy)}`;
  return { key, label, gregorian: date, jy, jm, jd };
}

/** تبدیل ارقام لاتین به فارسی */
export function toFaDigits(input: string | number): string {
  const map = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  return String(input).replace(/\d/g, (d) => map[Number(d)]);
}

/** تبدیل ارقام فارسی/عربی به لاتین */
function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => {
    const c = d.charCodeAt(0);
    if (c >= 0x06f0 && c <= 0x06f9) return String(c - 0x06f0);
    if (c >= 0x0660 && c <= 0x0669) return String(c - 0x0660);
    return d;
  });
}

/** تحلیل ورودی تاریخ شمسی مثل «۱۴۰۵/۰۴/۲۸» یا «1405-4-28» */
export function parseJalaliInput(text: string): JalaliInfo | null {
  const nums = toLatinDigits(text).match(/\d+/g);
  if (!nums || nums.length < 3) return null;
  const jy = Number(nums[0]);
  const jm = Number(nums[1]);
  const jd = Number(nums[2]);
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) {
    return null;
  }
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  return toJalali(new Date(gy, gm - 1, gd));
}

/** تاریخ شمسیِ n روز قبل (به وقت تهران) */
export function jalaliDaysAgo(n: number): JalaliInfo {
  const d = nowInTehran();
  d.setDate(d.getDate() - n);
  return toJalali(d);
}

/** برچسب ماه از کلید «1405/04» → «تیر ۱۴۰۵» */
export function jalaliMonthLabel(ym: string): string {
  const [y, m] = ym.split("/").map(Number);
  if (!y || !m || m < 1 || m > 12) return ym;
  return `${FA_MONTHS[m - 1]} ${toFaDigits(y)}`;
}
