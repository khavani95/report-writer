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

/**
 * ساخت فایل اکسل گزارش روزانه‌ی استاندارد کارگاه.
 * چهار بخش: کارکرد نیرو، فعالیت‌ها، موانع، دوباره‌کاری.
 */
export async function buildDailyExcel(
  project: Project,
  day: WorkDay,
  summary: DaySummary,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "روزنگار";
  wb.created = new Date();

  // ── برگه‌ی کارکرد نیرو ─────────────────────────────
  const ws = wb.addWorksheet("کارکرد نیرو", {
    views: [{ rightToLeft: true }],
  });

  titleBlock(ws, project, day, 8);

  const head = [
    "ردیف",
    "نام نیرو",
    "تخصص",
    "نوع",
    "ورود",
    "خروج",
    "کارکرد",
    "اضافه‌کاری",
  ];
  addHeaderRow(ws, head);

  summary.attendance.forEach((a, i) => {
    ws.addRow([
      i + 1,
      a.name,
      a.trade ?? "-",
      a.employmentType ?? "-",
      a.entry ?? "-",
      a.exit ?? "-",
      a.dayFraction >= 1 ? "۱ روز" : humanDuration(a.workedMinutes),
      a.overtimeMinutes ? humanDuration(a.overtimeMinutes) : "-",
    ]);
  });
  ws.addRow([]);
  ws.addRow(["", "جمع نفرات:", summary.workerCount]);
  autoWidth(ws, [6, 22, 14, 12, 9, 9, 16, 14]);

  // ── برگه‌ی فعالیت‌ها ───────────────────────────────
  const wsAct = wb.addWorksheet("فعالیت‌ها", {
    views: [{ rightToLeft: true }],
  });
  titleBlock(wsAct, project, day, 5);
  addHeaderRow(wsAct, ["جبهه‌ی کاری", "نوع فعالیت", "زمان", "شرح", "نیروها"]);
  for (const a of summary.activities) {
    const time = a.isFullDay
      ? "تمام‌روز"
      : a.startTime && a.endTime
        ? `${a.startTime}–${a.endTime}`
        : "-";
    wsAct.addRow([
      a.workFront ?? "-",
      a.activityType ?? "-",
      time,
      a.description,
      a.workers.join("، ") || "-",
    ]);
  }
  autoWidth(wsAct, [20, 18, 14, 40, 28]);

  // ── برگه‌ی موانع و مشکلات ──────────────────────────
  const wsIss = wb.addWorksheet("موانع و مشکلات", {
    views: [{ rightToLeft: true }],
  });
  titleBlock(wsIss, project, day, 3);
  addHeaderRow(wsIss, ["نوع", "شرح", "اثر/علت"]);
  for (const i of summary.issues) {
    wsIss.addRow([i.type, i.description, i.impact ?? "-"]);
  }
  autoWidth(wsIss, [14, 50, 30]);

  // ── برگه‌ی دوباره‌کاری ─────────────────────────────
  const wsRw = wb.addWorksheet("دوباره‌کاری", {
    views: [{ rightToLeft: true }],
  });
  titleBlock(wsRw, project, day, 4);
  addHeaderRow(wsRw, ["محل", "مقدار", "علت", "شرح"]);
  for (const r of summary.reworks) {
    wsRw.addRow([r.workFront ?? "-", r.amount ?? "-", r.cause ?? "-", r.description]);
  }
  autoWidth(wsRw, [22, 16, 30, 45]);

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function titleBlock(
  ws: ExcelJS.Worksheet,
  project: Project,
  day: WorkDay,
  span: number,
) {
  const r1 = ws.addRow([`گزارش روزانه‌ی ${project.name}`]);
  ws.mergeCells(r1.number, 1, r1.number, span);
  styleTitle(r1.getCell(1), 14);

  const rev = day.revision > 0 ? `-rev${String(day.revision).padStart(2, "0")}` : "";
  const r2 = ws.addRow([
    `شماره گزارش: ${day.reportNo ?? "-"}${rev}    |    تاریخ: ${day.dateLabel}`,
  ]);
  ws.mergeCells(r2.number, 1, r2.number, span);
  styleTitle(r2.getCell(1), 11, false);
  ws.addRow([]);
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
