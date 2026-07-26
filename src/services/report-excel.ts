import ExcelJS from "exceljs";
import type { DaySummary } from "./consolidate";
import type { ReportTable } from "./reports";
import { humanDuration } from "./attendance-calc";
import type { WorkDay, Project } from "@/db/schema";

/** ساخت اکسل از یک جدول گزارش دوره‌ای */
export async function buildTableExcel(
  title: string,
  subtitle: string,
  table: ReportTable,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "روزنگار";
  wb.created = new Date();
  const ws = wb.addWorksheet("گزارش", { views: [{ rightToLeft: true }] });

  const span = Math.max(table.columns.length, 1);
  const r1 = ws.addRow([title]);
  ws.mergeCells(r1.number, 1, r1.number, span);
  styleTitle(r1.getCell(1), 14);

  const sub = subtitle + (table.note ? `    |    ${table.note}` : "");
  const r2 = ws.addRow([sub]);
  ws.mergeCells(r2.number, 1, r2.number, span);
  styleTitle(r2.getCell(1), 11, false);
  ws.addRow([]);

  addHeaderRow(ws, table.columns);
  for (const row of table.rows) ws.addRow(row as (string | number)[]);
  autoWidth(
    ws,
    table.columns.map(() => 20),
  );

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const HEADER_FILL = "FF1F4E78";
const SUBHEAD_FILL = "FFDDEBF7";

/** تعداد ستون‌های شبکه‌ی گزارش روزانه */
const COLS = 9;
const COL_WIDTHS = [5, 17, 13, 12, 9, 9, 13, 13, 13];

/**
 * ساخت فایل اکسل گزارش روزانه‌ی استاندارد کارگاه.
 * همه‌چیز در یک برگه و به‌صورت بخش‌های پشت‌سرهم:
 * مشخصات پروژه → کارکرد نیروها → فعالیت‌ها → موانع → دوباره‌کاری → امضاها.
 */
export async function buildDailyExcel(
  project: Project,
  day: WorkDay,
  summary: DaySummary,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "روزنگار";
  wb.created = new Date();

  const ws = wb.addWorksheet("گزارش روزانه", {
    views: [{ rightToLeft: true }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.4,
        right: 0.4,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2,
      },
    },
  });
  COL_WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const revTag =
    day.revision > 0 ? ` — rev${String(day.revision).padStart(2, "0")}` : "";

  // ── سربرگ ─────────────────────────────────────────
  const t = ws.addRow([]);
  t.getCell(1).value = `گزارش روزانه‌ی کارگاه${revTag}`;
  ws.mergeCells(t.number, 1, t.number, COLS);
  styleTitle(t.getCell(1), 16);
  t.height = 28;

  // ── ۱) مشخصات پروژه ───────────────────────────────
  sectionHeader(ws, "مشخصات پروژه");
  const totalMinutes = summary.attendance.reduce(
    (s, a) => s + a.workedMinutes,
    0,
  );
  const totalOvertime = summary.attendance.reduce(
    (s, a) => s + a.overtimeMinutes,
    0,
  );
  const personDays = summary.attendance.reduce((s, a) => s + a.dayFraction, 0);

  infoRow(ws, "نام پروژه", project.name, "شماره گزارش", day.reportNo ?? "-");
  infoRow(
    ws,
    "تاریخ",
    day.dateLabel,
    "نسخه",
    day.revision > 0 ? `rev${String(day.revision).padStart(2, "0")}` : "اولیه",
  );
  infoRow(
    ws,
    "تعداد نفرات",
    summary.workerCount,
    "جمع نفر-روز",
    Math.round(personDays * 100) / 100,
  );
  infoRow(
    ws,
    "جمع کارکرد",
    humanDuration(totalMinutes),
    "جمع اضافه‌کاری",
    totalOvertime ? humanDuration(totalOvertime) : "-",
  );
  spacer(ws);

  // ── ۲) کارکرد نیروی انسانی ────────────────────────
  sectionHeader(ws, "۱) کارکرد نیروی انسانی");
  const attSpans = [1, 2, 1, 1, 1, 1, 1, 1];
  gridHeader(
    ws,
    ["ردیف", "نام نیرو", "تخصص", "نوع همکاری", "ورود", "خروج", "کارکرد", "اضافه‌کاری"],
    attSpans,
  );
  if (summary.attendance.length) {
    summary.attendance.forEach((a, i) => {
      gridRow(
        ws,
        [
          i + 1,
          a.name,
          a.trade ?? "-",
          a.employmentType ?? "-",
          a.entry ?? "-",
          a.exit ?? "-",
          a.dayFraction >= 1 ? "۱ روز کامل" : humanDuration(a.workedMinutes),
          a.overtimeMinutes ? humanDuration(a.overtimeMinutes) : "-",
        ],
        attSpans,
      );
    });
    const sum = gridRow(
      ws,
      [
        "",
        `جمع: ${summary.workerCount} نفر`,
        "",
        "",
        "",
        "",
        humanDuration(totalMinutes),
        totalOvertime ? humanDuration(totalOvertime) : "-",
      ],
      attSpans,
    );
    boldRow(sum);
  } else {
    emptyRow(ws, "نیرویی ثبت نشده است.");
  }
  spacer(ws);

  // ── ۳) شرح عملیات اجرایی ──────────────────────────
  sectionHeader(ws, "۲) شرح عملیات اجرایی و نیروهای درگیر");
  const actSpans = [1, 2, 1, 1, 2, 2];
  gridHeader(
    ws,
    ["ردیف", "جبهه‌ی کاری", "نوع فعالیت", "زمان", "شرح فعالیت", "نیروهای درگیر"],
    actSpans,
  );
  if (summary.activities.length) {
    summary.activities.forEach((a, i) => {
      const time = a.isFullDay
        ? "تمام‌روز"
        : a.startTime && a.endTime
          ? `${a.startTime}–${a.endTime}`
          : "-";
      gridRow(
        ws,
        [
          i + 1,
          a.workFront ?? "-",
          a.activityType ?? "-",
          time,
          a.description,
          a.workers.join("، ") || "-",
        ],
        actSpans,
      );
    });
  } else {
    emptyRow(ws, "فعالیتی ثبت نشده است.");
  }
  spacer(ws);

  // ── ۴) موانع و مشکلات ─────────────────────────────
  sectionHeader(ws, "۳) موانع، مشکلات و تأخیرات");
  const issSpans = [1, 2, 3, 3];
  gridHeader(ws, ["ردیف", "نوع", "شرح", "اثر / علت"], issSpans);
  if (summary.issues.length) {
    summary.issues.forEach((i, idx) => {
      gridRow(ws, [idx + 1, i.type, i.description, i.impact ?? "-"], issSpans);
    });
  } else {
    emptyRow(ws, "موردی گزارش نشده است.");
  }
  spacer(ws);

  // ── ۵) دوباره‌کاری ────────────────────────────────
  sectionHeader(ws, "۴) دوباره‌کاری‌ها");
  const rwSpans = [1, 2, 1, 2, 3];
  gridHeader(ws, ["ردیف", "محل", "مقدار", "علت", "شرح"], rwSpans);
  if (summary.reworks.length) {
    summary.reworks.forEach((r, idx) => {
      gridRow(
        ws,
        [
          idx + 1,
          r.workFront ?? "-",
          r.amount ?? "-",
          r.cause ?? "-",
          r.description,
        ],
        rwSpans,
      );
    });
  } else {
    emptyRow(ws, "موردی گزارش نشده است.");
  }
  spacer(ws);

  // ── ۶) امضاها ─────────────────────────────────────
  signatureBlock(ws);

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/** عنوان یک بخش (نوار رنگی تمام‌عرض) */
function sectionHeader(ws: ExcelJS.Worksheet, text: string) {
  const row = ws.addRow([]);
  row.getCell(1).value = text;
  ws.mergeCells(row.number, 1, row.number, COLS);
  const c = row.getCell(1);
  c.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  c.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
  c.border = thinBorder();
  row.height = 22;
}

/** یک ردیف «برچسب: مقدار» دوتایی در بخش مشخصات */
function infoRow(
  ws: ExcelJS.Worksheet,
  l1: string,
  v1: string | number,
  l2: string,
  v2: string | number,
) {
  const row = gridRow(ws, [l1, v1, l2, v2], [2, 3, 2, 2]);
  for (const col of [1, 6]) {
    const cell = row.getCell(col);
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: SUBHEAD_FILL },
    };
  }
}

/** ردیف عنوان ستون‌های یک جدول */
function gridHeader(
  ws: ExcelJS.Worksheet,
  labels: string[],
  spans: number[],
) {
  const row = gridRow(ws, labels, spans);
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  row.height = 20;
}

/** یک ردیف داده روی شبکه‌ی ستون‌ها (با ادغام بر اساس spans) */
function gridRow(
  ws: ExcelJS.Worksheet,
  values: Array<string | number>,
  spans: number[],
): ExcelJS.Row {
  const row = ws.addRow([]);
  let col = 1;
  values.forEach((v, i) => {
    const span = spans[i] ?? 1;
    row.getCell(col).value = v;
    if (span > 1) {
      ws.mergeCells(row.number, col, row.number, col + span - 1);
    }
    col += span;
  });
  for (let c = 1; c <= COLS; c++) {
    const cell = row.getCell(c);
    cell.border = thinBorder();
    if (!cell.alignment) {
      cell.alignment = {
        vertical: "middle",
        horizontal: "right",
        wrapText: true,
      };
    }
  }
  return row;
}

function boldRow(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: SUBHEAD_FILL },
    };
  });
}

/** ردیف «موردی ثبت نشده» */
function emptyRow(ws: ExcelJS.Worksheet, text: string) {
  const row = ws.addRow([]);
  row.getCell(1).value = text;
  ws.mergeCells(row.number, 1, row.number, COLS);
  const c = row.getCell(1);
  c.alignment = { horizontal: "center", vertical: "middle" };
  c.font = { italic: true, color: { argb: "FF808080" } };
  for (let i = 1; i <= COLS; i++) row.getCell(i).border = thinBorder();
}

function spacer(ws: ExcelJS.Worksheet) {
  ws.addRow([]).height = 8;
}

/** بخش امضای کارفرما و پیمانکار */
function signatureBlock(ws: ExcelJS.Worksheet) {
  const head = ws.addRow([]);
  head.getCell(1).value = "امضای کارفرما";
  ws.mergeCells(head.number, 1, head.number, 4);
  head.getCell(6).value = "امضای پیمانکار";
  ws.mergeCells(head.number, 6, head.number, COLS);
  for (const col of [1, 6]) {
    const c = head.getCell(col);
    c.font = { bold: true, color: { argb: "FF1F4E78" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: SUBHEAD_FILL },
    };
    c.border = thinBorder();
  }
  head.height = 20;

  const box = ws.addRow([]);
  ws.mergeCells(box.number, 1, box.number, 4);
  ws.mergeCells(box.number, 6, box.number, COLS);
  box.getCell(1).border = thinBorder();
  box.getCell(6).border = thinBorder();
  box.height = 60;

  const name = ws.addRow([]);
  name.getCell(1).value = "نام و نام‌خانوادگی / تاریخ:";
  ws.mergeCells(name.number, 1, name.number, 4);
  name.getCell(6).value = "نام و نام‌خانوادگی / تاریخ:";
  ws.mergeCells(name.number, 6, name.number, COLS);
  for (const col of [1, 6]) {
    const c = name.getCell(col);
    c.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    c.border = thinBorder();
  }
  name.height = 22;
}

function styleTitle(cell: ExcelJS.Cell, size: number, bold = true) {
  cell.font = { bold, size, color: { argb: "FF1F4E78" } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
}

function addHeaderRow(ws: ExcelJS.Worksheet, cols: string[]) {
  const row = ws.addRow(cols);
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = thinBorder();
  });
}

function autoWidth(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  // حاشیه برای همه‌ی سلول‌های داده
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (!cell.border) cell.border = thinBorder();
      if (!cell.alignment)
        cell.alignment = { vertical: "middle", wrapText: true };
    });
  });
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const s = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
  return { top: s, bottom: s, left: s, right: s };
}

// جلوگیری از هشدار استفاده‌نشده
void SUBHEAD_FILL;
