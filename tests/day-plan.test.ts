/**
 * قاعده‌ی «پاسخ ناقصِ AI حق حذف ندارد».
 * mergePlans تابعی خالص است و بدون تماس با سرویس تست می‌شود.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mergePlans } from "../src/ai/day-plan";
import type { Segment } from "../src/ai/segments";

const seg = (
  place: string | null,
  description: string,
  startTime: string | null,
  endTime: string | null,
): Segment => ({ place, description, startTime, endTime });

test("پاسخِ کامل AI شرحِ روان‌تر را می‌آورد ولی ساعت‌های قطعی مرجع می‌مانند", () => {
  const det = [
    seg("پروژه همت", "صورت وضعیت", "09:00", "12:00"),
    seg("باغ موزه", "نقشه", "12:00", "19:00"),
  ];
  const ai = [
    seg("پروژه همت", "رسیدگی به صورت وضعیت و تحویل موقت", "09:00", "11:30"),
    seg("باغ موزه", "بررسی نقشه‌ها", null, null),
  ];

  const { segments, incomplete } = mergePlans(det, ai);
  assert.equal(incomplete, false);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].description, "رسیدگی به صورت وضعیت و تحویل موقت");
  assert.equal(segments[0].endTime, "12:00", "ساعت قطعی بازنویسی نمی‌شود");
  assert.equal(segments[1].startTime, "12:00");
});

test("قطعه‌ای که AI جا انداخته حذف نمی‌شود و پاسخ «ناقص» علامت می‌خورد", () => {
  const det = [
    seg("پروژه همت", "صورت وضعیت", "09:00", "12:00"),
    seg("باغ موزه", "نقشه", "12:00", "19:00"),
  ];
  const ai = [seg("پروژه همت", "رسیدگی به صورت وضعیت", "09:00", "12:00")];

  const { segments, incomplete } = mergePlans(det, ai);
  assert.equal(incomplete, true);
  assert.equal(segments.length, 2);
  assert.equal(segments[1].place, "باغ موزه");
  assert.equal(segments[1].endTime, "19:00");
});

test("پاسخ خالیِ AI هیچ‌چیز را پاک نمی‌کند", () => {
  const det = [seg("پروژه همت", "صورت وضعیت", "09:00", "17:00")];
  const { segments, incomplete } = mergePlans(det, []);
  assert.equal(incomplete, true);
  assert.deepEqual(segments, det);
});

test("قطعه‌ی تازه‌ای که فقط AI دیده، افزوده و مرتب می‌شود", () => {
  const det = [seg("پروژه همت", "صورت وضعیت", "09:00", "12:00")];
  const ai = [
    seg("پروژه همت", "صورت وضعیت", "09:00", "12:00"),
    seg("دفتر مرکزی", "جلسه هیئت‌مدیره", "14:00", "17:00"),
  ];
  const { segments } = mergePlans(det, ai);
  assert.equal(segments.length, 2);
  assert.equal(segments[1].place, "دفتر مرکزی");
});

test("وقتی پارسر قطعی چیزی نیافته، پاسخ AI مبنا می‌شود", () => {
  const ai = [seg("دفتر", "جلسه", "10:00", "12:00")];
  const { segments, incomplete } = mergePlans([], ai);
  assert.equal(incomplete, false);
  assert.deepEqual(segments, ai);
});

test("نام محل با املای کمی متفاوت، همان قطعه است", () => {
  const det = [seg("پروژه باغ موزه", "نقشه", "12:00", "19:00")];
  const ai = [seg("باغ موزه", "بررسی نقشه‌ها", "12:00", "19:00")];
  const { segments, incomplete } = mergePlans(det, ai);
  assert.equal(incomplete, false);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].place, "پروژه باغ موزه");
  assert.equal(segments[0].description, "بررسی نقشه‌ها");
});
