/**
 * راستی‌آزماییِ خروجی ماهانه — مهم‌ترین خروجیِ محصول.
 * فایل ساخته می‌شود، دوباره خوانده می‌شود، و محتوای سلول‌ها بررسی می‌شود.
 */
process.env.DATABASE_URL =
  "postgres://u:p@ep-test-123.us-east-2.aws.neon.tech/neondb";

import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { installNeonMock } from "./helpers/neon-mock";
import { buildMonthlyExcel, describeDay } from "../src/services/board-excel";
import { monthDays } from "../src/lib/jalali";
import type { Member } from "../src/db/schema";

const MONTH = "1405/05"; // مرداد

function member(id: number, fullName: string, role: string): Member {
  return {
    id,
    chatId: -100,
    userId: 500 + id,
    fullName,
    aliases: [],
    role,
    profileStatus: "complete",
    isActive: true,
    createdAt: new Date(),
  };
}

const MEMBERS = [
  member(1, "محمد خوانی", "مدیرعامل"),
  member(2, "آیدین نوری", "مدیر فنی"),
];

const DAYS = [
  {
    memberId: 1,
    jalaliDate: "1405/05/03",
    segments: [
      {
        place: "پروژه همت",
        description: "صورت وضعیت رو رسیدگی کردم",
        startTime: "09:00",
        endTime: "12:00",
      },
      {
        place: "پروژه باغ موزه",
        description: "نقشه‌ها رو بررسی کردم",
        startTime: "12:00",
        endTime: "19:00",
      },
    ],
  },
  {
    memberId: 2,
    jalaliDate: "1405/05/04",
    segments: [
      {
        place: "باغ موزه",
        description: "لوله‌کشی مخزن",
        startTime: "07:00",
        endTime: "17:00",
      },
    ],
  },
];

async function build() {
  const mock = installNeonMock(() => []);
  try {
    return await buildMonthlyExcel("هیئت‌مدیره", MONTH, MEMBERS, DAYS);
  } finally {
    mock.restore();
  }
}

test("برای هر عضوِ دارای گزارش یک برگه ساخته می‌شود", async () => {
  const file = await build();
  assert.ok(file);
  assert.equal(file.memberCount, 2);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ["محمد خوانی", "آیدین نوری"],
  );
});

test("سربرگ و عنوانِ برگه دقیقاً همان قالب خواسته‌شده است", async () => {
  const file = await build();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file!.buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("محمد خوانی")!;

  assert.equal(ws.getCell("A1").value, "گزارش مرداد ۱۴۰۵ — محمد خوانی");
  assert.equal(ws.getCell("A2").value, "سمت: مدیرعامل");
  assert.equal(ws.getCell("A4").value, "تاریخ");
  assert.equal(ws.getCell("B4").value, "شرح فعالیت‌ها");
  assert.equal(ws.getCell("C4").value, "ساعت شروع");
  assert.equal(ws.getCell("D4").value, "ساعت پایان");
});

test("هر روزِ ماه یک سطر دارد و روزهای بدون گزارش خالی می‌مانند", async () => {
  const file = await build();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file!.buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("محمد خوانی")!;

  const days = monthDays(MONTH);
  assert.equal(days.length, 31, "مرداد ۳۱ روز است");

  // سطر ۵ = روز اول ماه
  const firstDataRow = 5;
  const row3 = ws.getRow(firstDataRow + 2); // روز سوم — گزارش دارد
  assert.equal(
    row3.getCell(2).value,
    "پروژه همت: صورت وضعیت رو رسیدگی کردم\nپروژه باغ موزه: نقشه‌ها رو بررسی کردم",
  );
  assert.equal(row3.getCell(3).value, "09:00");
  assert.equal(row3.getCell(4).value, "19:00");

  // نخستین روزِ کاریِ بدون گزارش → کاملاً خالی
  const idle = days.findIndex(
    (d, i) => i !== 2 && !d.isFriday && !d.holiday,
  );
  assert.ok(idle >= 0);
  const idleRow = ws.getRow(firstDataRow + idle);
  assert.equal(idleRow.getCell(2).value, null);
  assert.equal(idleRow.getCell(3).value, null);

  // جمعه‌ها برچسب می‌گیرند تا سطرِ خالی گم‌کننده نباشد
  const friday = days.findIndex((d) => d.isFriday);
  assert.equal(ws.getRow(firstDataRow + friday).getCell(2).value, "جمعه");

  // سطر جمع بلافاصله بعد از آخرین روزِ ماه
  const sumRow = ws.getRow(firstDataRow + days.length);
  assert.equal(sumRow.getCell(1).value, "جمع");
  assert.match(String(sumRow.getCell(2).value), /^1 روز گزارش‌شده از 31 روز$/);
});

test("برگه راست‌به‌چپ است", async () => {
  const file = await build();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file!.buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("محمد خوانی")!;
  assert.equal(ws.views[0].rightToLeft, true);
});

test("اگر هیچ عضوی گزارش نداشته باشد فایلی ساخته نمی‌شود", async () => {
  const mock = installNeonMock(() => []);
  let file;
  try {
    file = await buildMonthlyExcel("هیئت‌مدیره", MONTH, MEMBERS, []);
  } finally {
    mock.restore();
  }
  assert.equal(file, null);
});

test("شرح روز، محل و کار را کنار هم می‌آورد", () => {
  assert.equal(
    describeDay([
      { place: "همت", description: "الف", startTime: null, endTime: null },
      { place: null, description: "ب", startTime: null, endTime: null },
      { place: "دفتر", description: "", startTime: null, endTime: null },
    ]),
    "همت: الف\nب\nدفتر",
  );
});
