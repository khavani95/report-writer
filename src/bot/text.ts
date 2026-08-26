import { Keyboard } from "grammy";

/** متن دکمه‌ها (برای تطبیق دقیق استفاده می‌شوند) */
export const BTN = {
  // منوی اصلی
  projects: "📁 پروژه‌ها",
  newProject: "➕ پروژه جدید",
  endAll: "⏹️ پایان روز همه",
  // منوی داخل پروژه
  startDay: "▶️ شروع روز",
  endDay: "⏹️ پایان روز",
  todayReport: "📊 گزارش امروز",
  workers: "👷 نیروها",
  reports: "📈 گزارش‌ها",
  back: "🔙 منوی اصلی",
} as const;

/** صفحه‌کلید منوی اصلی (بدون دکمه‌های شروع/پایان روز) */
export function homeKeyboard() {
  return new Keyboard()
    .text(BTN.projects)
    .text(BTN.newProject)
    .row()
    .text(BTN.endAll)
    .resized()
    .persistent();
}

/** صفحه‌کلید داخل یک پروژه */
export function projectKeyboard() {
  return new Keyboard()
    .text(BTN.startDay)
    .text(BTN.endDay)
    .row()
    .text(BTN.todayReport)
    .text(BTN.workers)
    .row()
    .text(BTN.reports)
    .text(BTN.back)
    .resized()
    .persistent();
}

export const MSG = {
  welcome:
    "به روزنگار خوش آمدی 👷‍♂️\n\n" +
    "دستیار هوشمند گزارش روزانه‌ی کارگاه (چندپروژه‌ای).\n\n" +
    "۱) با «➕ پروژه جدید» پروژه‌هایت را بساز.\n" +
    "۲) از «📁 پروژه‌ها» یک پروژه را باز کن → دکمه‌های شروع/پایان روز ظاهر می‌شوند.\n" +
    "۳) «▶️ شروع روز» → گزارش‌ها را با متن یا ویس بفرست.\n" +
    "۴) «⏹️ پایان روز» → گزارش را کارت‌به‌کارت تأیید/تغییر/حذف می‌کنی.\n\n" +
    "🔸 «⏹️ پایان روز همه» همه‌ی پروژه‌های بازِ امروز را یکجا نشان می‌دهد.",

  selectProjectFirst:
    "اول یک پروژه باز کن یا بساز:\n«📁 پروژه‌ها» یا «➕ پروژه جدید».",

  noProjects: "هنوز پروژه‌ای نساختی. «➕ پروژه جدید» را بزن.",
  askProjectName: "نام پروژه‌ی جدید را بفرست:",
  projectCreated: (name: string) =>
    `✅ پروژه «${name}» ساخته و باز شد.`,
  projectSelected: (name: string) => `📁 پروژه: «${name}»`,

  noOpenDay: (name: string) =>
    `برای پروژه‌ی «${name}» روزی باز نیست. «▶️ شروع روز» را بزن.`,

  dayAlreadyOpen: (name: string, label: string) =>
    `⚠️ پروژه‌ی «${name}» یک روز باز دارد (${label}) و همان فعال است.\n` +
    "گزارش‌هایت را بفرست، یا «⏹️ پایان روز» را بزن.",

  dayStarted: (project: string, label: string, reportNo: string) =>
    `✅ روز باز شد.\n📁 ${project}\n📅 ${label}\n🔖 ${reportNo}\n\n` +
    "گزارش‌هایت را با متن یا ویس بفرست.",

  dayReopened: (project: string, label: string) =>
    `🔓 روز «${label}» پروژه‌ی «${project}» دوباره باز شد. پیام‌ها را بفرست.`,

  saved: (name: string) => `✅ ثبت شد (${name}).`,

  noOpenDaysAll: "هیچ پروژه‌ای روزِ باز ندارد. ✅",

  emptyDay: (label: string) =>
    `برای «${label}» هنوز هیچ پیامی ثبت نشده؛ گزارش خالی می‌شود.\n` +
    "اول ورود/خروج و فعالیت‌ها را بفرست، بعد «⏹️ پایان روز» را بزن.\n" +
    "اگر می‌خواهی این روز را رها کنی، «🏠 بازگشت» را بزن.",

  reviewInProgress:
    "مرور همین روز در جریان است؛ از همان‌جا ادامه بده 👇",

  aiUnavailable:
    "⚠️ سرویس هوش مصنوعی الان جواب نداد (چند بار تلاش شد).\n" +
    "ورود/خروج از روی متن استخراج شد، ولی فعالیت‌ها و موانع تحلیل نشدند — " +
    "موارد ثبت‌شده‌ی قبلی دست‌نخورده ماندند.\n" +
    "با «✏️ تغییر» می‌توانی کم‌وکاست را دستی کامل کنی.",

  aiIncomplete:
    "ℹ️ پاسخ هوش مصنوعی ناقص بود؛ نیروهای جاافتاده از روی متن پیام‌ها تکمیل شدند.\n" +
    "کارت‌ها را یک‌بار مرور کن.",

  aiChangesFailed:
    "⚠️ سرویس هوش مصنوعی هنگام اعمال اصلاحیه‌ها جواب نداد؛ " +
    "ممکن است بعضی تغییرها اعمال نشده باشد. گزارش را ببین و در صورت نیاز روز را دوباره باز کن.",

  notAllowed: "⛔️ دسترسی مجاز نیست.",
  noWorkers: "هنوز نیرویی ثبت نشده.",
  processing: "⏳ در حال بررسی کل روز…",
  error: "❌ خطایی رخ داد. لطفاً دوباره تلاش کن.",
};
