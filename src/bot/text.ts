import { InlineKeyboard } from "grammy";

/**
 * متن‌ها و دکمه‌های بات.
 *
 * ⚠️ اینجا هیچ صفحه‌کلید reply‌ای نیست. بات در گروه کار می‌کند و صفحه‌کلید
 * reply هم مشترک است هم با privacy mode دیده نمی‌شود. همه‌چیز با دستور
 * (/report ، /month ، /me) و دکمه‌ی شیشه‌ای انجام می‌شود؛ دکمه‌ی شیشه‌ای در
 * گروه درست کار می‌کند و callback_query شناسه‌ی فشاردهنده را همراه دارد،
 * پس می‌دانیم دکمه را کدام عضو زده است.
 */

/**
 * فهرست دستورها برای منوی تلگرام.
 *
 * با `setMyCommands` ثبت می‌شود تا اعضا مجبور نباشند دستور را از حفظ تایپ
 * کنند؛ با زدن «/» یا دکمه‌ی منو همین فهرست بالا می‌آید.
 * ⚠️ هر دستوری که اینجا هست باید در `src/bot/index.ts` هندلر داشته باشد
 * (تست `tests/commands.test.ts` همین را می‌سنجد).
 */
export const COMMANDS = [
  { command: "report", description: "گزارش امروز من" },
  { command: "close", description: "پایان روز من" },
  { command: "month", description: "خروجی اکسل ماهانه" },
  { command: "members", description: "اعضای ثبت‌شده" },
  { command: "me", description: "نام و سمت من" },
  { command: "start", description: "راهنما" },
] as const;

export const MSG = {
  welcome:
    "سلام 👋 من گزارشِ فعالیت روزانه‌ی اعضای هیئت‌مدیره را می‌نویسم.\n\n" +
    "کافی است هر روز همان‌طور که حرف می‌زنید بنویسید:\n" +
    "▪️ «ساعت ۹ اومدم پروژه همت»\n" +
    "▪️ «صورت وضعیت رو رسیدگی کردم»\n" +
    "▪️ «ساعت ۱۲ رفتم باغ موزه و نقشه‌ها رو بررسی کردم»\n" +
    "▪️ «ساعت ۷ رفتم»\n\n" +
    "می‌توانید به‌جای دیگری هم گزارش بدهید: «ایدین امروز ساعت ۷ رفت باغ موزه».\n\n" +
    "دستورها:\n" +
    "/report — گزارش امروزِ من\n" +
    "/close — پایان روزِ من\n" +
    "/month — خروجی اکسل ماهانه\n" +
    "/members — اعضای ثبت‌شده\n" +
    "/me — نام و سمت من",

  help: "برای دیدن راهنما /start را بزنید.",

  askName: (suggestion: string) =>
    "قبل از ثبت گزارش، نام کامل شما را لازم دارم.\n" +
    (suggestion
      ? `نام تلگرام شما «${suggestion}» است. اگر درست است دکمه را بزنید، وگرنه نام کامل را بنویسید.`
      : "نام و نام‌خانوادگی خود را بنویسید."),

  askRole: (name: string) =>
    `ممنون ${name} 🙏\nسمت شما چیست؟ (مثلاً: مدیرعامل، عضو هیئت‌مدیره، مدیر فنی)`,

  profileDone: (name: string, role: string) =>
    `✅ ثبت شد: ${name} — ${role}\nاز این به بعد دیگر نمی‌پرسم؛ گزارش‌هایتان را بفرستید.`,

  pendingSaved: "گزارشی که قبل‌تر فرستاده بودید هم ثبت شد 👇",

  noProfile: "هنوز عضوی ثبت نشده. اولین گزارشتان را بفرستید تا نامتان را بپرسم.",

  notMyButton: "این دکمه برای عضو دیگری است.",

  noOpenDay: "امروز هنوز گزارشی از شما ثبت نشده.",
  noDataForMonth: "برای این ماه گزارشی ثبت نشده است.",
  noMonths: "هنوز داده‌ای برای گزارش‌گیری وجود ندارد.",

  dayClosed: (label: string) => `✅ روز «${label}» بسته شد.`,
  autoClosed: (labels: string[]) =>
    `ℹ️ روز${labels.length > 1 ? "های" : ""} ${labels.join("، ")} هنوز باز بود؛ ` +
    "نهایی‌اش کردم و روز تازه را باز کردم.",

  onBehalf: (name: string) => `📝 به نام «${name}» ثبت شد.`,

  aiUnavailable:
    "⚠️ سرویس هوش مصنوعی الان جواب نداد.\n" +
    "گزارش از روی متنِ خودتان ساخته شد؛ اگر جایی کم‌وکاست دارد، همان را دوباره بنویسید.",

  aiIncomplete:
    "ℹ️ پاسخ هوش مصنوعی ناقص بود؛ زنجیره‌ی روز از روی متن پیام‌ها تکمیل شد.",

  voiceFailed:
    "❌ نتوانستم ویس را پیاده کنم. لطفاً همان را تایپ کنید.",

  processing: "⏳ در حال جمع‌بندی روز…",
  building: "⏳ در حال ساخت فایل اکسل…",
  notAllowed: "⛔️ دسترسی مجاز نیست.",
  error: "❌ خطایی رخ داد. لطفاً دوباره تلاش کنید.",
};

/** دکمه‌ی «همین نام درست است» — شناسه‌ی صاحبِ دکمه داخلش است */
export function nameKeyboard(userId: number, suggestion: string) {
  return new InlineKeyboard().text(
    `✅ «${suggestion}» درست است`,
    `name:${userId}`,
  );
}

/** دکمه‌های زیر گزارش روزانه */
export function reportKeyboard(userId: number, dayId: number) {
  return new InlineKeyboard()
    .text("🔄 به‌روزرسانی", `refresh:${userId}:${dayId}`)
    .text("⏹️ پایان روز من", `close:${userId}:${dayId}`);
}

/** فهرست ماه‌ها برای خروجی اکسل */
export function monthKeyboard(months: Array<{ key: string; label: string }>) {
  const kb = new InlineKeyboard();
  for (const m of months) kb.text(m.label, `month:${m.key}`).row();
  return kb;
}
