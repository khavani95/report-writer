import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { attendance, workDays, workers } from "@/db/schema";
import { HEADER_FILL, SUBHEAD_FILL, thinBorder } from "./report-excel";
import { humanDuration } from "./attendance-calc";
import { getMonthHolidays } from "./holiday-service";
import { monthDays, jalaliMonthLabel, type JalaliDayInfo } from "@/lib/jalali";
import type { Project } from "@/db/schema";

const HOLIDAY_FILL = "FFFCE4E4"; // تعطیل رسمی
const FRIDAY_FILL = "FFF2F2F2"; // جمعه
const WORK_FILL = "FFEAF4EA"; // روزی که کارکرد داشته

interface DayRecord {
  entry: string | null;
  exit: string | null;
  workedMinutes: number;
  overtimeMinutes: number;
  dayFraction: number;
}

interface WorkerSheet {
  workerId: number;
  name: string;
  trade: string | null;
  employmentType: string | null;
  byDate: Map<string, DayRecord>;
}

/**
 * دیتاشیت کارکرد ماهانه: یک فایل اکسل برای همه‌ی نیروهای آن ماه.
 * برگه‌ی نخست خلاصه، و برای هر نیرو یک برگه‌ی ۳۰/۳۱ روزه شامل
 * روز هفته، تعطیلات (جمعه و رسمی) و ساعت ورود/خروج.
 */
export async function buildMonthlyTimesheet(
  project: Project,
  month: string,
): Promise<{ buffer: Buffer; fileName: string; workerCount: number } | null> {
  const baseDays = monthDays(month);
  if (!baseDays.length) return null;

  // تعطیلات رسمی از سرویس تقویم ایران (با کش و fallback داخلی)
  const holidayMap = await getMonthHolidays(month);
  const days: JalaliDayInfo[] = baseDays.map((d) => ({
    ...d,
    // عنوان از سرویس تقویم؛ جمعه‌ها عنوان ندارند و با isFriday مدیریت می‌شوند
    holiday: holidayMap.get(d.key)?.title ?? d.holiday ?? null,
  }));

  const db = getDb();
  const rows = await db
    .select({
      date: workDays.jalaliDate,
      workerId: attendance.workerId,
      name: workers.fullName,
      trade: workers.trade,
      employmentType: workers.employmentType,
      entry: attendance.entryTime,
      exit: attendance.exitTime,
      workedMinutes: attendance.workedMinutes,
      overtimeMinutes: attendance.overtimeMinutes,
      dayFraction: attendance.dayFraction,
    })
    .from(attendance)
    .innerJoin(workDays, eq(attendance.workDayId, workDays.id))
    .innerJoin(workers, eq(attendance.workerId, workers.id))
    .where(eq(workDays.projectId, project.id));

  const inMonth = rows.filter((r) => r.date.startsWith(month));
  if (!inMonth.length) return null;

  // گروه‌بندی بر اساس نیرو
  const byWorker = new Map<number, WorkerSheet>();
  for (const r of inMonth) {
    let w = byWorker.get(r.workerId);
    if (!w) {
      w = {
        workerId: r.workerId,
        name: r.name,
        trade: r.trade,
        employmentType: r.employmentType,
        byDate: new Map(),
      };
      byWorker.set(r.workerId, w);
    }
    w.byDate.set(r.date, {
      entry: r.entry,
      exit: r.exit,
      workedMinutes: r.workedMinutes,
      overtimeMinutes: r.overtimeMinutes,
      dayFraction: r.dayFraction,
    });
  }

  const list = [...byWorker.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "fa"),
  );
  const monthLabel = jalaliMonthLabel(month);

  const wb = new ExcelJS.Workbook();
  wb.creator = "روزنگار";
  wb.created = new Date();

  addGridSheet(wb, project, monthLabel, days, list);
  addSummarySheet(wb, project, monthLabel, days, list);
  const used = new Set<string>();
  for (const w of list) {
    addWorkerSheet(wb, project, monthLabel, days, w, used);
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  const safe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
  return {
    buffer: Buffer.from(arrayBuffer),
    fileName: `کارکرد-ماهانه-${safe(project.name)}-${safe(monthLabel)}.xlsx`,
    workerCount: list.length,
  };
}

/**
 * برگه‌ی «جدول ماهانه»: هر نیرو یک سطر، هر روزِ ماه یک ستون،
 * و در هر خانه ساعت ورود/خروج همان روز.
 */
function addGridSheet(
  wb: ExcelJS.Workbook,
  project: Project,
  monthLabel: string,
  days: JalaliDayInfo[],
  list: WorkerSheet[],
) {
  const ws = wb.addWorksheet("جدول ماهانه", {
    views: [{ rightToLeft: true, state: "frozen", xSplit: 1, ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  const NAME_COL = 1;
  const FIRST_DAY_COL = 2;
  const totalCols = FIRST_DAY_COL + days.length + 1; // + ستون جمع

  ws.getColumn(NAME_COL).width = 18;
  days.forEach((_, i) => {
    ws.getColumn(FIRST_DAY_COL + i).width = 7;
  });
  ws.getColumn(FIRST_DAY_COL + days.length).width = 12;

  title(ws, `جدول کارکرد ماهانه — ${monthLabel}`, totalCols - 1, 14);
  title(ws, `پروژه: ${project.name}`, totalCols - 1, 11, false);
  ws.addRow([]);

  // سطر شماره‌ی روز
  const rDay = ws.addRow([]);
  rDay.getCell(NAME_COL).value = "نام نیرو";
  days.forEach((d, i) => {
    rDay.getCell(FIRST_DAY_COL + i).value = d.day;
  });
  rDay.getCell(FIRST_DAY_COL + days.length).value = "جمع";

  // سطر روز هفته
  const rDow = ws.addRow([]);
  rDow.getCell(NAME_COL).value = "روز هفته";
  days.forEach((d, i) => {
    rDow.getCell(FIRST_DAY_COL + i).value = shortWeekday(d.weekday);
  });
  rDow.getCell(FIRST_DAY_COL + days.length).value = "کارکرد";

  for (const row of [rDay, rDow]) {
    row.height = 18;
    for (let c = 1; c < totalCols; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: HEADER_FILL },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thinBorder();
    }
  }
  // ستون‌های تعطیل در سربرگ رنگی شوند
  days.forEach((d, i) => {
    if (!d.holiday && !d.isFriday) return;
    const argb = d.holiday ? "FF9E2A2A" : "FF5A5A5A";
    for (const row of [rDay, rDow]) {
      row.getCell(FIRST_DAY_COL + i).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb },
      };
    }
  });

  // سطر هر نیرو
  for (const w of list) {
    const row = ws.addRow([]);
    row.getCell(NAME_COL).value = w.name;
    row.getCell(NAME_COL).alignment = {
      horizontal: "right",
      vertical: "middle",
      indent: 1,
    };
    row.height = 30;

    days.forEach((d, i) => {
      const rec = w.byDate.get(d.key);
      const cell = row.getCell(FIRST_DAY_COL + i);
      const worked = Boolean(rec && (rec.entry || rec.exit || rec.workedMinutes));

      if (worked && rec) {
        // ساعت ورود و خروج، دو خط زیر هم
        cell.value = `${rec.entry ?? "—"}\n${rec.exit ?? "—"}`;
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: WORK_FILL },
        };
      } else if (d.holiday) {
        cell.value = "ت";
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: HOLIDAY_FILL },
        };
      } else if (d.isFriday) {
        cell.value = "ج";
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: FRIDAY_FILL },
        };
      } else {
        cell.value = "-";
      }
      cell.font = { size: 8 };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      cell.border = thinBorder();
    });

    const t = totals(w);
    const sumCell = row.getCell(FIRST_DAY_COL + days.length);
    sumCell.value = humanDuration(t.minutes);
    sumCell.font = { bold: true, size: 9 };
    sumCell.alignment = { horizontal: "center", vertical: "middle" };
    sumCell.border = thinBorder();
    row.getCell(NAME_COL).border = thinBorder();
  }

  ws.addRow([]);
  const legend = ws.addRow([]);
  legend.getCell(1).value =
    "راهنما: خانه‌ی سبز = ورود/خروج آن روز • «ج» = جمعه • «ت» = تعطیل رسمی • «-» = بدون ثبت";
  ws.mergeCells(legend.number, 1, legend.number, Math.min(totalCols - 1, 16));
  legend.getCell(1).font = { italic: true, size: 9, color: { argb: "FF808080" } };
}

/** نام کوتاه روز هفته برای سربرگ جدول */
function shortWeekday(name: string): string {
  const map: Record<string, string> = {
    شنبه: "ش",
    یکشنبه: "ی",
    دوشنبه: "د",
    "سه‌شنبه": "س",
    چهارشنبه: "چ",
    پنجشنبه: "پ",
    جمعه: "ج",
  };
  return map[name] ?? name.slice(0, 1);
}

/** برگه‌ی خلاصه‌ی همه‌ی نیروهای ماه */
function addSummarySheet(
  wb: ExcelJS.Workbook,
  project: Project,
  monthLabel: string,
  days: JalaliDayInfo[],
  list: WorkerSheet[],
) {
  const ws = wb.addWorksheet("خلاصه ماه", {
    views: [{ rightToLeft: true }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  const widths = [5, 20, 14, 12, 12, 11, 14, 14];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  const COLS = widths.length;

  title(ws, `دیتاشیت کارکرد ماهانه — ${monthLabel}`, COLS, 15);
  title(
    ws,
    `پروژه: ${project.name}    |    تعداد روزهای ماه: ${days.length}    |    تعداد نیروها: ${list.length}`,
    COLS,
    11,
    false,
  );
  ws.addRow([]);

  headerRow(
    ws,
    [
      "ردیف",
      "نام نیرو",
      "تخصص",
      "نوع همکاری",
      "روزهای کارکرد",
      "نفر-روز",
      "جمع کارکرد",
      "اضافه‌کاری",
    ],
    COLS,
  );

  list.forEach((w, i) => {
    const t = totals(w);
    const row = ws.addRow([
      i + 1,
      w.name,
      w.trade ?? "-",
      w.employmentType ?? "-",
      t.presentDays,
      Math.round(t.personDays * 100) / 100,
      humanDuration(t.minutes),
      t.overtime ? humanDuration(t.overtime) : "-",
    ]);
    borderRow(row, COLS);
  });

  const grand = list.reduce(
    (acc, w) => {
      const t = totals(w);
      acc.minutes += t.minutes;
      acc.overtime += t.overtime;
      acc.personDays += t.personDays;
      return acc;
    },
    { minutes: 0, overtime: 0, personDays: 0 },
  );
  const sum = ws.addRow([
    "",
    "جمع کل",
    "",
    "",
    "",
    Math.round(grand.personDays * 100) / 100,
    humanDuration(grand.minutes),
    grand.overtime ? humanDuration(grand.overtime) : "-",
  ]);
  borderRow(sum, COLS);
  sum.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_FILL } };
  });
}

/** برگه‌ی یک نیرو: جدول روزهای ماه */
function addWorkerSheet(
  wb: ExcelJS.Workbook,
  project: Project,
  monthLabel: string,
  days: JalaliDayInfo[],
  w: WorkerSheet,
  used: Set<string>,
) {
  const ws = wb.addWorksheet(sheetName(w.name, used), {
    views: [{ rightToLeft: true }],
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1 },
  });
  const widths = [6, 14, 12, 20, 9, 9, 14, 13];
  widths.forEach((x, i) => {
    ws.getColumn(i + 1).width = x;
  });
  const COLS = widths.length;

  title(ws, `کارکرد ${w.name} — ${monthLabel}`, COLS, 14);
  const meta = [w.trade, w.employmentType].filter(Boolean).join("، ") || "—";
  title(ws, `پروژه: ${project.name}    |    مشخصات: ${meta}`, COLS, 11, false);
  ws.addRow([]);

  headerRow(
    ws,
    [
      "روز",
      "تاریخ",
      "روز هفته",
      "وضعیت",
      "ورود",
      "خروج",
      "کارکرد",
      "اضافه‌کاری",
    ],
    COLS,
  );

  for (const d of days) {
    const rec = w.byDate.get(d.key);
    const worked = Boolean(rec && (rec.entry || rec.exit || rec.workedMinutes));

    let status: string;
    let fill: string | null = null;
    if (d.holiday) {
      status = worked ? `کار در تعطیل (${d.holiday})` : d.holiday;
      fill = worked ? WORK_FILL : HOLIDAY_FILL;
    } else if (d.isFriday) {
      status = worked ? "کار در جمعه" : "جمعه (تعطیل هفتگی)";
      fill = worked ? WORK_FILL : FRIDAY_FILL;
    } else if (worked) {
      status = "کارکرد";
      fill = WORK_FILL;
    } else {
      status = "بدون ثبت";
    }

    const row = ws.addRow([
      d.day,
      d.key,
      d.weekday,
      status,
      rec?.entry ?? "-",
      rec?.exit ?? "-",
      rec && rec.workedMinutes ? humanDuration(rec.workedMinutes) : "-",
      rec && rec.overtimeMinutes ? humanDuration(rec.overtimeMinutes) : "-",
    ]);
    borderRow(row, COLS);
    if (fill) {
      row.eachCell({ includeEmpty: true }, (c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      });
    }
  }

  const t = totals(w);
  const sum = ws.addRow([
    "",
    "جمع ماه",
    "",
    `${t.presentDays} روز کارکرد`,
    "",
    "",
    humanDuration(t.minutes),
    t.overtime ? humanDuration(t.overtime) : "-",
  ]);
  borderRow(sum, COLS);
  sum.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_FILL } };
  });

  ws.addRow([]);
  const legend = ws.addRow([
    "راهنما: «بدون ثبت» یعنی برای آن روز گزارشی ثبت نشده. تعطیلات رسمی از تقویم رسمی ایران گرفته می‌شود.",
  ]);
  ws.mergeCells(legend.number, 1, legend.number, COLS);
  legend.getCell(1).font = { italic: true, size: 9, color: { argb: "FF808080" } };
}

function totals(w: WorkerSheet) {
  let minutes = 0;
  let overtime = 0;
  let personDays = 0;
  let presentDays = 0;
  for (const r of w.byDate.values()) {
    minutes += r.workedMinutes;
    overtime += r.overtimeMinutes;
    personDays += r.dayFraction;
    if (r.entry || r.exit || r.workedMinutes) presentDays += 1;
  }
  return { minutes, overtime, personDays, presentDays };
}

/** نام معتبر و یکتا برای برگه‌ی اکسل (حداکثر ۳۱ نویسه) */
function sheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 28) || "نیرو";
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 26)} ${n++}`;
  }
  used.add(candidate);
  return candidate;
}

function title(
  ws: ExcelJS.Worksheet,
  text: string,
  span: number,
  size: number,
  bold = true,
) {
  const row = ws.addRow([]);
  row.getCell(1).value = text;
  ws.mergeCells(row.number, 1, row.number, span);
  const c = row.getCell(1);
  c.font = { bold, size, color: { argb: "FF1F4E78" } };
  c.alignment = { horizontal: "center", vertical: "middle" };
  if (size >= 14) row.height = 24;
}

function headerRow(ws: ExcelJS.Worksheet, labels: string[], span: number) {
  const row = ws.addRow(labels);
  row.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = thinBorder();
  });
  row.height = 20;
  void span;
}

function borderRow(row: ExcelJS.Row, cols: number) {
  for (let i = 1; i <= cols; i++) {
    const c = row.getCell(i);
    c.border = thinBorder();
    if (!c.alignment) {
      c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    }
  }
}
