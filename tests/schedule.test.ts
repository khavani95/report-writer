/**
 * کارهای زمان‌بندی‌شده: بستنِ شبانه و پیام صبحگاهی.
 * تمرکز روی محافظِ ساعت است — Cron ممکن است دیر اجرا شود و نباید روزِ
 * کسی را وسط بعدازظهر ببندد.
 */
process.env.DATABASE_URL =
  "postgres://u:p@ep-test-123.us-east-2.aws.neon.tech/neondb";
process.env.TELEGRAM_BOT_TOKEN = "123456789:TEST-TOKEN-FOR-UNIT-TESTS-ONLY";

import test from "node:test";
import assert from "node:assert/strict";
import { withinTehranHours, cronAuthorized } from "../src/lib/cron";
import { tehranTime } from "../src/lib/jalali";

test("ساعتِ تهران به شکل HH:MM خوانده می‌شود", () => {
  assert.match(tehranTime(new Date("2026-09-05T20:00:00Z")), /^\d{2}:\d{2}$/);
  // ایران +۳:۳۰ است و ساعت تابستانی ندارد
  assert.equal(tehranTime(new Date("2026-09-05T20:00:00Z")), "23:30");
  assert.equal(tehranTime(new Date("2026-09-05T03:30:00Z")), "07:00");
});

test("بازه‌ی مجاز ساعت درست سنجیده می‌شود", () => {
  const night = new Date("2026-09-05T20:00:00Z"); // ۲۳:۳۰ تهران
  assert.equal(withinTehranHours(22, 23, night), true);
  assert.equal(withinTehranHours(5, 11, night), false);

  const morning = new Date("2026-09-05T03:30:00Z"); // ۰۷:۰۰ تهران
  assert.equal(withinTehranHours(5, 11, morning), true);

  // Cronِ دیرهنگام نباید وسط بعدازظهر روزها را ببندد
  const afternoon = new Date("2026-09-05T11:30:00Z"); // ۱۵:۰۰ تهران
  assert.equal(withinTehranHours(22, 23, afternoon), false);
  assert.equal(withinTehranHours(5, 11, afternoon), false);
});

test("بدون CRON_SECRET مسیر باز است، با آن فقط با هدر درست", () => {
  const req = (auth?: string) =>
    new Request("https://x.test/api/cron/close-day", {
      headers: auth ? { authorization: auth } : {},
    });

  delete process.env.CRON_SECRET;
  assert.equal(cronAuthorized(req()), true);

  process.env.CRON_SECRET = "s3cret";
  try {
    assert.equal(cronAuthorized(req()), false);
    assert.equal(cronAuthorized(req("Bearer wrong")), false);
    assert.equal(cronAuthorized(req("Bearer s3cret")), true);
  } finally {
    delete process.env.CRON_SECRET;
  }
});
