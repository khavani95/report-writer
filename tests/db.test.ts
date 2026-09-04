/**
 * راستی‌آزماییِ لایه‌ی دیتابیس با گرفتنِ fetch و شبیه‌سازی پاسخ نئون.
 * تمرکز روی دو چیز است: درستیِ SQL، و تعداد رفت‌وبرگشت (که مستقیماً زمانِ
 * پاسخِ بات است).
 */
process.env.DATABASE_URL =
  "postgres://u:p@ep-test-123.us-east-2.aws.neon.tech/neondb";

import test from "node:test";
import assert from "node:assert/strict";
import { installNeonMock, type MockRow } from "./helpers/neon-mock";
import { replaceSegments, setPhase, getSegments } from "../src/db/queries";
import {
  ensureToday,
  ingestMessage,
  resolveTarget,
  undoLast,
} from "../src/services/member-day";
import type { Member, MemberDay } from "../src/db/schema";

const MEMBER: Member = {
  id: 7,
  chatId: -100,
  userId: 555,
  fullName: "محمد خوانی",
  aliases: [],
  role: "مدیرعامل",
  profileStatus: "complete",
  isActive: true,
  createdAt: new Date(),
};

const TODAY: MemberDay = {
  id: 42,
  memberId: 7,
  jalaliDate: "1405/05/12",
  dateLabel: "شنبه ۱۲ مرداد ۱۴۰۵",
  status: "open",
  startedAt: new Date(),
  closedAt: null,
};

const DAY_ROW: MockRow = {
  id: ["int4", "42"],
  member_id: ["int4", "7"],
  jalali_date: ["text", "1405/05/12"],
  date_label: ["text", "شنبه ۱۲ مرداد ۱۴۰۵"],
  status: ["text", "open"],
  started_at: ["timestamp", "2026-08-03 06:00:00"],
  closed_at: ["timestamp", null],
};

const STALE_ROW: MockRow = {
  ...DAY_ROW,
  id: ["int4", "41"],
  jalali_date: ["text", "1405/05/11"],
  date_label: ["text", "جمعه ۱۱ مرداد ۱۴۰۵"],
};

test("نوشتنِ زنجیره‌ی روز فقط دو رفت‌وبرگشت دارد (یک حذف، یک درجِ دسته‌ای)", async () => {
  const mock = installNeonMock();
  try {
    await replaceSegments(42, [
      { place: "پروژه همت", description: "الف", startTime: "09:00", endTime: "12:00" },
      { place: "باغ موزه", description: "ب", startTime: "12:00", endTime: "19:00" },
      { place: null, description: "ج", startTime: null, endTime: null },
    ]);
  } finally {
    mock.restore();
  }

  assert.equal(mock.calls.length, 2, "باید دقیقاً دو دستور باشد");
  assert.equal(mock.of("delete").length, 1);
  const insert = mock.of("insert");
  assert.equal(insert.length, 1, "هر سه قطعه با یک درج نوشته می‌شوند");
  assert.equal(insert[0].params.length, 18, "۶ ستون × ۳ ردیف");
  assert.ok(insert[0].params.includes("پروژه همت"));
  assert.ok(insert[0].params.includes("باغ موزه"));
});

test("زنجیره‌ی خالی هیچ درجی نمی‌زند", async () => {
  const mock = installNeonMock();
  try {
    await replaceSegments(42, []);
  } finally {
    mock.restore();
  }
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.of("insert").length, 0);
});

test("وضعیت گفتگو با کلید (chat_id, user_id) نوشته می‌شود، نه فقط chat_id", async () => {
  const mock = installNeonMock();
  try {
    await setPhase(-100, 555, "await_name", "ساعت ۹ اومدم همت");
  } finally {
    mock.restore();
  }

  const call = mock.calls[0];
  assert.match(call.sql, /insert into "conversation_state"/i);
  assert.match(call.sql, /on conflict \("chat_id","user_id"\)/i);
  const params = call.params.map(String);
  assert.ok(params.includes("-100"));
  assert.ok(params.includes("555"));
});

test("روزِ بازمانده‌ی دیروز نهایی می‌شود و روز تازه باز می‌شود", async () => {
  const mock = installNeonMock((call) => {
    const s = call.sql.trim().toLowerCase();
    if (s.startsWith("select") && s.includes('"member_days"')) return [STALE_ROW];
    if (s.startsWith('insert into "member_days"')) return [DAY_ROW];
    return [];
  });

  let ctx;
  try {
    ctx = await ensureToday(MEMBER, {
      key: "1405/05/12",
      label: "شنبه ۱۲ مرداد ۱۴۰۵",
      gregorian: new Date(),
      jy: 1405,
      jm: 5,
      jd: 12,
    });
  } finally {
    mock.restore();
  }

  assert.equal(ctx.autoClosed.length, 1);
  assert.equal(ctx.autoClosed[0].jalaliDate, "1405/05/11");
  assert.equal(ctx.day.jalaliDate, "1405/05/12");

  const update = mock.of("update");
  assert.equal(update.length, 1, "روزِ بازمانده بسته می‌شود");
  assert.ok(update[0].params.map(String).includes("closed"));

  const insert = mock.of("insert");
  assert.equal(insert.length, 1);
  assert.match(insert[0].sql, /on conflict .*do nothing/is);
});

test("افزودن پیام به روز: ذخیره‌ی خام + بازنویسی زنجیره، بدون هوش مصنوعی", async () => {
  const existing: MockRow = {
    id: ["int4", "1"],
    member_day_id: ["int4", "42"],
    seq: ["int4", "0"],
    place: ["text", "پروژه همت"],
    description: ["text", "صورت وضعیت را رسیدگی کردم"],
    start_time: ["text", "09:00"],
    end_time: ["text", null],
    created_at: ["timestamp", "2026-08-03 09:00:00"],
  };
  const mock = installNeonMock((call) => {
    const s = call.sql.trim().toLowerCase();
    if (s.startsWith("select") && s.includes('"activity_segments"')) return [existing];
    return [];
  });

  let segments;
  try {
    segments = await ingestMessage(
      TODAY,
      "ساعت 12 رفتم پروژه باغ موزه و نقشه‌ها رو بررسی کردم",
      { senderUserId: 555, kind: "text", telegramMessageId: 9 },
    );
  } finally {
    mock.restore();
  }

  // قطعه‌ی قبلی با ساعت ۱۲ بسته و قطعه‌ی تازه باز می‌شود
  assert.equal(segments.length, 2);
  assert.equal(segments[0].endTime, "12:00");
  assert.equal(segments[1].place, "پروژه باغ موزه");
  assert.equal(segments[1].startTime, "12:00");
  assert.equal(segments[1].description, "نقشه‌ها رو بررسی کردم");

  // ذخیره‌ی پیام + خواندن زنجیره + حذف + درج = ۴ رفت‌وبرگشت
  assert.equal(mock.calls.length, 4);
});

test("پیامِ بی‌رویداد زنجیره را بازنویسی نمی‌کند", async () => {
  const mock = installNeonMock(() => []);
  try {
    await ingestMessage(TODAY, "سلام", { senderUserId: 555, kind: "text" });
  } finally {
    mock.restore();
  }
  // هیچ رفت‌وبرگشتی لازم نیست؛ پیام حتی ذخیره هم نمی‌شود
  assert.equal(mock.calls.length, 0);
});

test("خواندن زنجیره فقط یک پرس‌وجو است", async () => {
  const mock = installNeonMock(() => []);
  try {
    await getSegments(42);
  } finally {
    mock.restore();
  }
  assert.equal(mock.calls.length, 1);
  assert.match(mock.calls[0].sql, /order by .*"seq"/is);
});

test("گزارش به‌جای عضوِ شناخته‌شده، به او نسبت داده می‌شود", async () => {
  const AIDIN: MockRow = {
    id: ["int4", "8"],
    chat_id: ["int8", "-100"],
    user_id: ["int8", "777"],
    full_name: ["text", "آیدین نوری"],
    aliases: ["jsonb", "[]"],
    role: ["text", "مدیر فنی"],
    profile_status: ["text", "complete"],
    is_active: ["bool", "t"],
    created_at: ["timestamp", "2026-08-01 08:00:00"],
  };
  const mock = installNeonMock((call) =>
    call.sql.toLowerCase().includes('from "members"') ? [AIDIN] : [],
  );

  let target;
  try {
    target = await resolveTarget(
      -100,
      MEMBER,
      "ایدین امروز ساعت 7 رفت باغ موزه تا 5 اونجا لوله‌کشی مخزن رو انجام دادن",
    );
  } finally {
    mock.restore();
  }

  // «ایدین» و «آیدین» یک نفرند
  assert.equal(target.member.id, 8);
  assert.equal(target.onBehalf, true);
  assert.ok(!target.text.startsWith("ایدین"), "نام از متنِ تحلیل جدا می‌شود");
  // هیچ عضوِ تازه‌ای ساخته نمی‌شود
  assert.equal(mock.of("insert").length, 0);
});

test("جمله‌ی بی‌ربط عضوِ جعلی نمی‌سازد", async () => {
  const mock = installNeonMock(() => []);
  let target;
  try {
    target = await resolveTarget(-100, MEMBER, "جلسه هیئت‌مدیره برگزار شد");
  } finally {
    mock.restore();
  }
  assert.equal(target.member.id, MEMBER.id);
  assert.equal(target.onBehalf, false);
  assert.equal(target.text, "جلسه هیئت‌مدیره برگزار شد");
  assert.equal(mock.of("insert").length, 0);
});

test("نامِ ناشناس با فعل حرکتی، عضوِ «فقط نام» می‌سازد", async () => {
  const CREATED: MockRow = {
    id: ["int4", "9"],
    chat_id: ["int8", "-100"],
    user_id: ["int8", null],
    full_name: ["text", "رضا کاظمی"],
    aliases: ["jsonb", "[]"],
    role: ["text", null],
    profile_status: ["text", "pending"],
    is_active: ["bool", "t"],
    created_at: ["timestamp", "2026-08-03 09:00:00"],
  };
  const mock = installNeonMock((call) =>
    call.sql.trim().toLowerCase().startsWith('insert into "members"')
      ? [CREATED]
      : [],
  );

  let target;
  try {
    target = await resolveTarget(
      -100,
      MEMBER,
      "رضا کاظمی امروز ساعت 8 رفت پروژه همت",
    );
  } finally {
    mock.restore();
  }

  assert.equal(target.member.fullName, "رضا کاظمی");
  assert.equal(target.member.userId, null);
  assert.equal(target.onBehalf, true);
  assert.equal(mock.of("insert").length, 1);
});

test("پیامِ تازه بعد از «پایان روز»، روز را دوباره باز می‌کند", async () => {
  const closed: MockRow = { ...DAY_ROW, status: ["text", "closed"] };
  const mock = installNeonMock((call) => {
    const s = call.sql.trim().toLowerCase();
    if (s.startsWith("select") && s.includes('"member_days"')) return [];
    if (s.startsWith('insert into "member_days"')) return [closed];
    return [];
  });

  let ctx;
  try {
    ctx = await ensureToday(MEMBER, {
      key: "1405/05/12",
      label: "شنبه ۱۲ مرداد ۱۴۰۵",
      gregorian: new Date(),
      jy: 1405,
      jm: 5,
      jd: 12,
    });
  } finally {
    mock.restore();
  }

  assert.equal(ctx.reopened, true);
  assert.equal(ctx.day.status, "open");
  const update = mock.of("update");
  assert.equal(update.length, 1);
  assert.ok(update[0].params.map(String).includes("open"));
});

test("روزِ بازِ امروز دوباره باز نمی‌شود", async () => {
  const mock = installNeonMock((call) => {
    const s = call.sql.trim().toLowerCase();
    if (s.startsWith("select") && s.includes('"member_days"')) return [];
    if (s.startsWith('insert into "member_days"')) return [DAY_ROW];
    return [];
  });
  let ctx;
  try {
    ctx = await ensureToday(MEMBER, {
      key: "1405/05/12",
      label: "شنبه ۱۲ مرداد ۱۴۰۵",
      gregorian: new Date(),
      jy: 1405,
      jm: 5,
      jd: 12,
    });
  } finally {
    mock.restore();
  }
  assert.equal(ctx.reopened, false);
  assert.equal(mock.of("update").length, 0);
});

test("/undo آخرین پیام را پاک و زنجیره را از نو می‌سازد", async () => {
  // ستون‌های هر ردیف باید دقیقاً با ستون‌های همان select بخواند
  const RAW = (text: string): MockRow => ({
    text: ["text", text],
    transcript: ["text", null],
  });
  const mock = installNeonMock((call) => {
    const s = call.sql.trim().toLowerCase();
    if (!s.startsWith("select")) return [];
    // نخستین select فقط شناسه‌ی آخرین پیام را می‌خواهد
    if (s.includes('"raw_messages"') && s.includes("limit")) {
      return [{ id: ["int4", "9"] } as MockRow];
    }
    if (s.includes('"raw_messages"')) {
      return [
        RAW("ساعت 9 اومدم همت"),
        RAW("صورت وضعیت رو رسیدگی کردم"),
      ];
    }
    return [];
  });

  let res;
  try {
    res = await undoLast(TODAY);
  } finally {
    mock.restore();
  }

  assert.equal(res.removed, true);
  // زنجیره فقط از دو پیامِ باقی‌مانده ساخته شده
  assert.equal(res.segments.length, 1);
  assert.equal(res.segments[0].place, "همت");
  assert.equal(res.segments[0].startTime, "09:00");
  assert.equal(res.segments[0].description, "صورت وضعیت رو رسیدگی کردم");
  assert.equal(mock.of("delete").length, 2, "یک حذف پیام + یک حذف قطعه‌ها");
});

test("/undo روی روزِ خالی چیزی را خراب نمی‌کند", async () => {
  const mock = installNeonMock(() => []);
  let res;
  try {
    res = await undoLast(TODAY);
  } finally {
    mock.restore();
  }
  assert.equal(res.removed, false);
  assert.equal(mock.of("delete").length, 0, "هیچ حذفی انجام نمی‌شود");
});
