/**
 * تست پارسر قطعیِ زنجیره‌ی روز.
 * نمونه‌ها عیناً همان جمله‌هایی هستند که اعضا در گروه می‌نویسند.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMessage,
  buildSegments,
  dayBounds,
  splitClauses,
  splitLeadingName,
  isReportable,
} from "../src/ai/segments";

test("«ساعت ۹ اومدم پروژه همت» یک قطعه با محل و ساعت شروع می‌سازد", () => {
  const { personName, events } = parseMessage("ساعت 9 اومدم پروژه همت");
  assert.equal(personName, null);
  assert.deepEqual(events, [
    { kind: "arrive", time: "09:00", place: "پروژه همت" },
  ]);
});

test("شرحِ بدون ساعت فقط یک یادداشت است", () => {
  const { events } = parseMessage(
    "امروز صورت وضعیت رو رسیدگی کردم و کارهای تحویل موقت رو انجام دادم",
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "note");
  assert.equal(
    (events[0] as { text: string }).text,
    "صورت وضعیت رو رسیدگی کردم و کارهای تحویل موقت رو انجام دادم",
  );
});

test("«رفتم» با مقصد یعنی جابه‌جایی، بدون مقصد یعنی پایان", () => {
  const { events } = parseMessage(
    "ساعت 12 رفتم پروژه باغ موزه و اونجا نقشه‌ها رو بررسی کردم و ساعت 7 رفتم",
  );
  assert.deepEqual(events, [
    { kind: "arrive", time: "12:00", place: "پروژه باغ موزه" },
    { kind: "note", text: "نقشه‌ها رو بررسی کردم" },
    { kind: "leave", time: "19:00" },
  ]);
});

test("گزارش به‌جای عضو دیگر: نام از ابتدای پیام جدا می‌شود", () => {
  const { personName, events } = parseMessage(
    "ایدین امروز ساعت 7 رفت باغ موزه تا 5 اونجا لوله‌کشی مخزن رو انجام دادن",
  );
  assert.equal(personName, "ایدین");
  assert.deepEqual(events, [
    { kind: "arrive", time: "07:00", place: "باغ موزه" },
    { kind: "until", time: "17:00" },
    { kind: "note", text: "لوله‌کشی مخزن رو انجام دادن" },
  ]);
});

test("فعلِ اول‌شخص یعنی گزارشِ خودِ فرستنده، نه شخص دیگر", () => {
  assert.equal(splitLeadingName("محمد خوانی ساعت 8 اومدم دفتر").name, null);
  assert.equal(splitLeadingName("ساعت 9 اومدم پروژه همت").name, null);
  assert.equal(splitLeadingName("سلام به همه").name, null);
});

test("«و» داخل نام محل، جمله را نمی‌شکند", () => {
  assert.deepEqual(splitClauses("رفتم پروژه آب و برق"), ["رفتم پروژه آب و برق"]);
  assert.deepEqual(
    splitClauses("رفتم دفتر و نقشه‌ها رو دیدم"),
    ["رفتم دفتر", "نقشه‌ها رو دیدم"],
  );
});

test("ساعت‌های محاوره‌ای: خروج بعدازظهر تفسیر می‌شود", () => {
  assert.deepEqual(parseMessage("ساعت 5 رفتم").events, [
    { kind: "leave", time: "17:00" },
  ]);
  assert.deepEqual(parseMessage("تا 5 اونجا بودم").events, [
    { kind: "until", time: "17:00" },
  ]);
  assert.deepEqual(parseMessage("ساعت ۸ و نیم اومدم دفتر").events, [
    { kind: "arrive", time: "08:30", place: "دفتر" },
  ]);
});

test("ساعتِ ورود که عقب رفته باشد، به بعدازظهر تصحیح می‌شود", () => {
  const segments = buildSegments([
    "ساعت 8 اومدم دفتر مرکزی",
    "ساعت 2 رفتم پروژه همت",
  ]);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].startTime, "08:00");
  assert.equal(segments[0].endTime, "14:00");
  assert.equal(segments[1].startTime, "14:00");
});

test("زنجیره‌ی کاملِ یک روز از چند پیام ساخته می‌شود", () => {
  const segments = buildSegments([
    "ساعت 9 اومدم پروژه همت",
    "امروز صورت وضعیت رو رسیدگی کردم و کارهای تحویل موقت رو انجام دادم",
    "ساعت 12 رفتم پروژه باغ موزه و اونجا نقشه‌ها رو بررسی کردم و ساعت 7 رفتم",
  ]);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].place, "پروژه همت");
  assert.equal(segments[0].startTime, "09:00");
  assert.equal(segments[0].endTime, "12:00");
  assert.equal(
    segments[0].description,
    "صورت وضعیت رو رسیدگی کردم و کارهای تحویل موقت رو انجام دادم",
  );
  assert.equal(segments[1].place, "پروژه باغ موزه");
  assert.equal(segments[1].startTime, "12:00");
  assert.equal(segments[1].endTime, "19:00");
  assert.equal(segments[1].description, "نقشه‌ها رو بررسی کردم");

  assert.deepEqual(dayBounds(segments), { start: "09:00", end: "19:00" });
});

test("شرحِ پیش از نخستین ساعت، قطعه‌ی بی‌صاحب نمی‌سازد", () => {
  const segments = buildSegments([
    "امروز جلسه هیئت‌مدیره داشتیم",
    "ساعت 10 رفتم دفتر",
  ]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].place, "دفتر");
  assert.equal(segments[0].startTime, "10:00");
  assert.equal(segments[0].description, "جلسه هیئت‌مدیره داشتیم");
});

test("پیام‌های غیرگزارشی روز باز نمی‌کنند", () => {
  const chit = ["سلام", "ممنون", "باشه", "👍", "چشم"];
  for (const t of chit) {
    assert.equal(isReportable(parseMessage(t).events), false, t);
  }
  const reports = [
    "ساعت 9 اومدم پروژه همت",
    "امروز صورت وضعیت رو رسیدگی کردم",
    "ساعت 5 رفتم",
  ];
  for (const t of reports) {
    assert.equal(isReportable(parseMessage(t).events), true, t);
  }
});

test("جمله‌ای که با اسم شروع می‌شود ولی گزارشِ کسی نیست، دست‌نخورده می‌ماند", () => {
  const { personName, events } = parseMessage("جلسه هیئت‌مدیره برگزار شد");
  assert.equal(personName, null);
  assert.equal(
    (events[0] as { text: string }).text,
    "جلسه هیئت‌مدیره برگزار شد",
    "هیچ واژه‌ای از شرح حذف نمی‌شود",
  );
});

test("عنوانِ احترامی بخشی از نام شمرده نمی‌شود", () => {
  assert.equal(splitLeadingName("مهندس نوری ساعت 8 رفت پروژه همت").name, "نوری");
  assert.equal(splitLeadingName("آقای رضایی ساعت 9 اومد دفتر").name, "رضایی");
});

test("نام حداکثر دو واژه است", () => {
  const { name, rest } = splitLeadingName("آیدین نوری ساعت 7 رفت باغ موزه");
  assert.equal(name, "آیدین نوری");
  assert.equal(rest, "ساعت 7 رفت باغ موزه");
});

// ── مشکل‌هایی که در گروه واقعی دیده شد ──────────────────

test("ساعتِ دارای «:» خوانده می‌شود (۹:۳۰ و ۱۷:۰۰)", () => {
  assert.deepEqual(parseMessage("ساعت ٩:٣٠ اومدم همت").events, [
    { kind: "arrive", time: "09:30", place: "همت" },
  ]);
  assert.deepEqual(parseMessage("ساعت 9:30 اومدم همت").events, [
    { kind: "arrive", time: "09:30", place: "همت" },
  ]);
  assert.deepEqual(parseMessage("ساعت ۱۷:۰۰ رفتم").events, [
    { kind: "leave", time: "17:00" },
  ]);
  assert.deepEqual(parseMessage("ساعت ١٧ رفتم").events, [
    { kind: "leave", time: "17:00" },
  ]);
});

test("پیامِ چندخطی: هم شرح ثبت می‌شود هم ساعت خروج", () => {
  assert.deepEqual(
    parseMessage("بعد از ظهر رزومه رو طراحی کردیم\nساعت ۱۷:۰۰ رفتم").events,
    [
      { kind: "note", text: "بعد از ظهر رزومه رو طراحی کردیم" },
      { kind: "leave", time: "17:00" },
    ],
  );
});

test("تکرارِ رسیدن به همان محل، ساعت را تصحیح می‌کند نه اینکه قطعه بسازد", () => {
  // دنباله‌ی واقعیِ گروه: عضو دو بار خودش را تصحیح کرد
  const segments = buildSegments([
    "سلام من ساعت ٩:٣٠ اومدم همت",
    "ساعت ٩:٣٠ اومدم همت",
    "ساعت ٩ اومدم همت",
    "امروز کارهای ساختمان آمود رو انجام دادم",
    "با لاچینی در مورد تسویه صحبت کردیم",
    "ساعت ١٧ رفتم",
  ]);
  assert.equal(segments.length, 1, "نباید قطعه‌ی شبح ساخته شود");
  assert.equal(segments[0].place, "همت");
  assert.equal(segments[0].startTime, "09:00", "آخرین تصحیح مبناست");
  assert.equal(segments[0].endTime, "17:00");
  assert.equal(
    segments[0].description,
    "کارهای ساختمان آمود رو انجام دادم؛ با لاچینی در مورد تسویه صحبت کردیم",
  );
});

test("بازگشت به همان محل بعد از ثبت کار، قطعه‌ی تازه است", () => {
  const segments = buildSegments([
    "ساعت 8 اومدم همت",
    "صورت وضعیت رو رسیدگی کردم",
    "ساعت 14 رفتم همت",
  ]);
  assert.equal(segments.length, 2, "قطعه‌ی دارای شرح ادغام نمی‌شود");
  assert.equal(segments[0].endTime, "14:00");
  assert.equal(segments[1].startTime, "14:00");
});

test("«من» ابتدای شرح حذف می‌شود", () => {
  const { events } = parseMessage("من فیش های مالی رو ثبت و کد گذاری کردم");
  assert.equal(
    (events[0] as { text: string }).text,
    "فیش های مالی رو ثبت و کد گذاری کردم",
  );
});

// ── قاعده‌ی تازه: هر پیامی گزارش است مگر آشکارا گپ باشد ──

test("گزارشِ اسمی (بدون فعل) دیگر دور ریخته نمی‌شود", () => {
  const reports = [
    "پیگیری کارهای ساختمان آمود برای رفع نواقص",
    "هماهنگی با پیمانکار",
    "بازدید از سایت",
    "امروز جلسه داشتیم",
  ];
  for (const t of reports) {
    assert.equal(isReportable(parseMessage(t).events), true, t);
  }
});

test("تعارف و گپ همچنان ثبت نمی‌شود", () => {
  const chit = [
    "سلام", "ممنون", "باشه", "چشم", "خب", "👍", "😅", ".",
    "اوکی داداش", "سلام خسته نباشید", "دمت گرم", "خیلی ممنون",
  ];
  for (const t of chit) {
    assert.equal(isReportable(parseMessage(t).events), false, t);
  }
});

test("پیامِ ساعت‌دار همیشه گزارش است، هرچقدر کوتاه", () => {
  assert.equal(isReportable(parseMessage("ساعت ۵ رفتم").events), true);
  assert.equal(isReportable(parseMessage("رفتم دفتر").events), true);
});
