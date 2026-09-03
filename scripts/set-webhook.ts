/**
 * اسکریپت ست‌کردن وبهوک تلگرام.
 * اجرا:  npm run set-webhook
 * پیش‌نیاز: TELEGRAM_BOT_TOKEN و PUBLIC_BASE_URL در محیط تنظیم شده باشند.
 */
import { readFileSync } from "node:fs";

// بارگذاری ساده‌ی .env.local اگر وجود داشت
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {
  // .env.local نبود؛ از محیط سیستم استفاده می‌شود
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const base = process.env.PUBLIC_BASE_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";

if (!token || !base) {
  console.error("❌ TELEGRAM_BOT_TOKEN و PUBLIC_BASE_URL لازم‌اند.");
  process.exit(1);
}

const webhookUrl = `${base.replace(/\/$/, "")}/api/telegram`;

async function main() {
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret || undefined,
      // ⚠️ بدون callback_query هیچ‌کدام از دکمه‌های شیشه‌ای کار نمی‌کنند:
      // تأیید نام، پایان روز، به‌روزرسانی گزارش و انتخاب ماه.
      // تلگرام آن‌ها را بی‌صدا دور می‌ریزد و هیچ خطایی هم دیده نمی‌شود.
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    }),
  });
  const data = await res.json();
  if (data.ok) {
    console.log(`✅ وبهوک تنظیم شد:\n   ${webhookUrl}`);
  } else {
    console.error("❌ خطا در تنظیم وبهوک:", data);
    process.exit(1);
  }
}

main();
