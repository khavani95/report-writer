import { workRules } from "@/lib/config";
import { timeToMinutes } from "./attendance-calc";

/**
 * فرمول‌های مشترکِ خروجی‌های اکسل.
 *
 * قاعده: هر خانه‌ای که «محاسبه‌شده» است باید فرمول باشد، نه عددِ ثابت؛
 * تا وقتی کاربر ساعت ورود/خروج را در فایل اصلاح می‌کند، کارکرد، نفر-روز،
 * اضافه‌کاری و جمع‌ها خودشان به‌روز شوند.
 *
 * محاسبه‌ها عمداً بر پایه‌ی «دقیقه‌ی صحیح» انجام می‌شوند نه ساعتِ اعشاری:
 * ضربِ کسرِ شبانه‌روز در ۲۴ خطای ممیز شناور می‌سازد (۶ ساعت → ۶.۰۰۰۰۰۰۰۰۰۰۰۰۰۰۱)
 * و آستانه‌ی کسر ناهار را به‌اشتباه فعال می‌کند. با ROUND به دقیقه،
 * نتیجه دقیقاً برابر محاسبه‌ی خودِ بات (attendance-calc) می‌شود.
 */

export const STD_HOURS = workRules.standardWorkMinutes / 60;
export const STD_MIN = workRules.standardWorkMinutes;
export const LUNCH_MIN = workRules.lunchBreakMinutes;
export const LUNCH_AFTER_MIN = workRules.lunchAppliesAfterMinutes;

/** تبدیل «HH:MM» به مقدار زمانیِ اکسل (کسری از شبانه‌روز) */
export function timeValue(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = timeToMinutes(t);
  return m === null ? null : m / 1440;
}

/** قالبِ نمایشِ ساعت و قالبِ اعداد اعشاریِ قابل جمع با AutoSum */
export const TIME_FMT = "hh:mm";
export const NUM_FMT = "0.##";

/**
 * کارکردِ خالص یک روز (ساعت) از روی سلول ورود/خروج.
 * - هر دو خالی → خالی (تا در COUNT/SUM شمرده نشود)
 * - فقط یکی ثبت شده → یک روزکاری استاندارد
 * - هر دو ثبت شده → (خروج − ورود) با احتساب عبور از نیمه‌شب، منهای ناهار
 */
export function workedHoursFormula(entry: string, exit: string): string {
  const span = `ROUND((${exit}-${entry}+IF(${exit}<=${entry},1,0))*1440,0)`;
  return (
    `IF(AND(${entry}="",${exit}=""),"",` +
    `IF(OR(${entry}="",${exit}=""),${STD_HOURS},` +
    `MAX(0,${span}-IF(${span}>${LUNCH_AFTER_MIN},${LUNCH_MIN},0))/60))`
  );
}

/** کارکردِ یک سلول برحسب دقیقه‌ی صحیح — پایه‌ی نفر-روز و اضافه‌کاری */
const inMinutes = (worked: string) => `ROUND(${worked}*60,0)`;

/** نفر-روز از روی سلول کارکرد (سقفِ ۱ روز) */
export function dayFractionFormula(worked: string): string {
  return `IF(${worked}="","",MIN(1,ROUND(${inMinutes(worked)}/${STD_MIN},2)))`;
}

/** اضافه‌کاری (ساعت) از روی سلول کارکرد */
export function overtimeFormula(worked: string): string {
  return `IF(${worked}="","",MAX(0,${inMinutes(worked)}-${STD_MIN})/60)`;
}

/** جمعِ یک بازه در یک ستون */
export function sumFormula(col: string, first: number, last: number): string {
  return `SUM(${col}${first}:${col}${last})`;
}
