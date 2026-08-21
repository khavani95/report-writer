/**
 * پیکربندی مرکزی روزنگار.
 * مقادیر از متغیرهای محیطی خوانده می‌شوند و پیش‌فرض‌های کارگاهی دارند.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`متغیر محیطی «${name}» تنظیم نشده است.`);
  }
  return v;
}

export const config = {
  telegram: {
    get botToken() {
      return required("TELEGRAM_BOT_TOKEN");
    },
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    backupChannelId: process.env.BACKUP_CHANNEL_ID || "",
    /** آی‌دی چت‌های مجاز؛ خالی یعنی همه مجازند */
    allowedChatIds: (process.env.ALLOWED_CHAT_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  gemini: {
    get apiKey() {
      return required("GEMINI_API_KEY");
    },
    model: process.env.GEMINI_MODEL || "gemini-flash-latest",
  },
  db: {
    get url() {
      return required("DATABASE_URL");
    },
  },
  /**
   * سرویس تقویم شمسی/تعطیلات رسمی ایران.
   * قالب درخواست: {base}?year={سال}&month={ماه}  → کل ماه در یک درخواست
   */
  holidayApiUrl:
    process.env.HOLIDAY_API_URL || "https://pnldev.com/api/calender",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  get baseUrl() {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    return "";
  },
};

/**
 * قوانین محاسبه‌ی کارکرد (قابل تنظیم برای هر کارگاه).
 * این‌ها پیش‌فرض هستند و بعداً می‌توان به‌ازای هر پروژه در دیتابیس override کرد.
 */
export const workRules = {
  /** یک روزکاری کامل چند دقیقه کارِ خالص است (۸ ساعت) */
  standardWorkMinutes: 8 * 60,
  /** استراحت ناهار چند دقیقه (۱ ساعت) */
  lunchBreakMinutes: 60,
  /**
   * استراحت ناهار فقط وقتی کسر می‌شود که مدت حضور بیش از این مقدار باشد.
   * (اگر کسی فقط ۳ ساعت کار کند، ناهار کسر نمی‌شود.)
   */
  lunchAppliesAfterMinutes: 6 * 60,
  /** ساعت پیش‌فرض شروع کار در صورت نبود اطلاعات (۰۷:۰۰) */
  defaultDayStart: "07:00",
};

export type WorkRules = typeof workRules;
