/**
 * پیکربندی مرکزی.
 * همه‌ی مقادیر از متغیرهای محیطی خوانده می‌شوند.
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
    /**
     * زنجیره‌ی مدل‌های پشتیبان برای وقتی مدل اصلی با ۵۰۳ («تحت فشار زیاد»)
     * جواب نمی‌دهد؛ مدل سبک‌تر معمولاً ظرفیت آزادتری دارد.
     * نامِ نامعتبر خطای غیرقابل‌تکرار می‌دهد و بی‌درنگ رد می‌شود، پس چند
     * گزینه پشت‌سرهم می‌آید تا تغییرِ نام‌گذاری گوگل ما را زمین نزند.
     */
    get fallbackModels(): string[] {
      const raw =
        process.env.GEMINI_FALLBACK_MODEL ||
        "gemini-flash-lite-latest,gemini-3.5-flash-lite";
      return raw
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
    },
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
