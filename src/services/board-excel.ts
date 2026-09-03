import ExcelJS from "exceljs";
import { jalaliMonthLabel, monthDays, type JalaliDayInfo } from "@/lib/jalali";
import { getMonthHolidays } from "./holiday-service";
import { dayBounds, type Segment } from "@/ai/segments";
import type { Member } from "@/db/schema";
import type { MonthDayRow } from "@/db/queries";

/**
 * خروجی ماهانه — مهم‌ترین خروجیِ این محصول.
 * یک فایل اکسل، برای هر عضو یک برگه:
 *
 *   گزارش مرداد — محمد خوانی
 *   تاریخ | شرح فعالیت‌ها | ساعت شروع | ساعت پایان
 *
 * هر روزِ ماه یک سطر است؛ روزهای بدون گزارش خالی می‌مانند.
 */

const HEADER_FILL = "FF1F4E78";
const SUBHEAD_FILL = "FFDDEBF7";
const HOLIDAY_FILL = "FFFCE4E4"; // تعطیل رسمی
const FRIDAY_FILL = "FFF2F2F2"; // جمعه

const COLS = 4;
const COL_WIDTHS = [16, 62, 12, 12];
/** نخستین سطرِ داده: ۲ سطر عنوان + ۱ خالی + ۱ سربرگ */
const FIRST_DATA_ROW = 5;

function thinBorder(): Partial<ExcelJS.Borders> {
  const s = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
  return { top: s, bottom: s, left: s, right: s };
}

/**
 * راست‌به‌چپ کردن کاملِ یک برگه:
 * هم جهت خودِ برگه، هم جهتِ نوشتار درون تک‌تک سلول‌ها (readingOrder).
 * بدون این، متن فارسیِ ترکیب‌شده با عدد در سلول جابه‌جا دیده می‌شود.
 */
function applyRtl(ws: ExcelJS.Worksheet): void {
  const view = ws.views?.[0] ?? {};
  ws.views = [{ ...view, rightToLeft: true }];
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      const a = cell.alignment ?? {};
      cell.alignment = {
        ...a,
        vertical: a.vertical ?? "middle",
        horizontal: a.horizontal ?? "right",
        wrapText: a.wrapText ?? true,
        readingOrder: "rtl",
      };
    });
  });
}

/**
 * شرحِ یک روز: هر قطعه یک خط، با محل در ابتدای خط.
 * «پروژه همت: صورت وضعیت رو رسیدگی کردم»
 */
export function describeDay(segments: Segment[]): string {
  return segments
    .map((s) => {
      const place = s.place?.trim();
      const desc = s.description?.trim();
      if (place && desc) return `${place}: ${desc}`;
      return place || desc || "";
    })
    .filter(Boolean)
    .join("\n");
}

/** ساخت اکسل ماهانه؛ اگر هیچ گزارشی در ماه نباشد null */
export async function buildMonthlyExcel(
  chatTitle: string,
  month: string,
  members: Member[],
  days: MonthDayRow[],
): Promise<{ buffer: Buffer; fileName: string; memberCount: number } | null> {
  const baseDays = monthDays(month);
  if (!baseDays.length) return null;

  // تعطیلات رسمی از تقویم ایران (با کش و fallback داخلی)
  const holidayMap = await getMonthHolidays(month);
  const calendar: JalaliDayInfo[] = baseDays.map((d) => ({
    ...d,
    holiday: holidayMap.get(d.key)?.title ?? null,
  }));

  // روزهای هر عضو، کلیدخورده با تاریخ
  const byMember = new Map<number, Map<string, Segment[]>>();
  for (const d of days) {
    if (!d.segments.length) continue;
    const map = byMember.get(d.memberId) ?? new Map<string, Segment[]>();
    map.set(d.jalaliDate, d.segments);
    byMember.set(d.memberId, map);
  }

  const active = members.filter((m) => byMember.has(m.id));
  if (!active.length) return null;

  const monthLabel = jalaliMonthLabel(month);
  const wb = new ExcelJS.Workbook();
  wb.creator = "گزارش فعالیت هیئت‌مدیره";
  wb.created = new Date();

  const used = new Set<string>();
  for (const m of active) {
    addMemberSheet(
      wb,
      sheetName(m.fullName, used),
      m,
      monthLabel,
      calendar,
      byMember.get(m.id) ?? new Map(),
    );
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  const safe = (s: string) =>
    s.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
  return {
    buffer: Buffer.from(arrayBuffer),
    fileName: `گزارش-${safe(monthLabel)}-${safe(chatTitle) || "هیئت‌مدیره"}.xlsx`,
    memberCount: active.length,
  };
}

/** برگه‌ی یک عضو: همه‌ی روزهای ماه، یک سطر برای هر روز */
function addMemberSheet(
  wb: ExcelJS.Workbook,
  name: string,
  member: Member,
  monthLabel: string,
  calendar: JalaliDayInfo[],
  byDate: Map<string, Segment[]>,
) {
  const ws = wb.addWorksheet(name, {
    views: [{ rightToLeft: true, state: "frozen", ySplit: FIRST_DATA_ROW - 1 }],
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1 },
  });
  COL_WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  title(ws, `گزارش ${monthLabel} — ${member.fullName}`, 14);
  title(ws, member.role ? `سمت: ${member.role}` : "‌", 11, false);
  ws.addRow([]);

  const header = ws.addRow([
    "تاریخ",
    "شرح فعالیت‌ها",
    "ساعت شروع",
    "ساعت پایان",
  ]);
  header.height = 22;
  header.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = thinBorder();
  });

  let reportedDays = 0;
  for (const d of calendar) {
    const segments = byDate.get(d.key) ?? [];
    const has = segments.length > 0;
    if (has) reportedDays += 1;
    const { start, end } = dayBounds(segments);

    // روزِ بدون گزارش عمداً خالی می‌ماند (null، نه رشته‌ی تهی) تا در اکسل
    // واقعاً سلولِ خالی باشد
    const row = ws.addRow([
      `${d.key.slice(-2)} ${d.weekday}`,
      has ? describeDay(segments) : null,
      start,
      end,
    ]);
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = thinBorder();
      c.alignment = { vertical: "middle", wrapText: true };
    });
    for (const col of [1, 3, 4]) {
      row.getCell(col).alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    }
    // روزهای تعطیل رنگ می‌گیرند، ولی اگر گزارشی داشته باشند خالی نمی‌مانند
    if (!has) {
      const fill = d.holiday ? HOLIDAY_FILL : d.isFriday ? FRIDAY_FILL : null;
      if (fill) {
        row.eachCell({ includeEmpty: true }, (c) => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        });
        row.getCell(2).value = d.holiday ?? "جمعه";
        row.getCell(2).font = { italic: true, color: { argb: "FF808080" } };
      }
    }
  }

  const last = FIRST_DATA_ROW + calendar.length - 1;
  const sum = ws.addRow([
    "جمع",
    `${reportedDays} روز گزارش‌شده از ${calendar.length} روز`,
    null,
    null,
  ]);
  sum.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEAD_FILL } };
    c.border = thinBorder();
  });
  void last;

  applyRtl(ws);
}

function title(
  ws: ExcelJS.Worksheet,
  text: string,
  size: number,
  bold = true,
) {
  const row = ws.addRow([]);
  row.getCell(1).value = text;
  ws.mergeCells(row.number, 1, row.number, COLS);
  const c = row.getCell(1);
  c.font = { bold, size, color: { argb: "FF1F4E78" } };
  c.alignment = { horizontal: "center", vertical: "middle" };
  if (size >= 14) row.height = 24;
}

/** نام معتبر و یکتا برای برگه‌ی اکسل (حداکثر ۳۱ نویسه) */
function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 28) || "عضو";
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 26)} ${n++}`;
  }
  used.add(candidate);
  return candidate;
}
