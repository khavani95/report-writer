import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  attendance,
  workDays,
  workers,
  activities,
  activityWorkers,
  reworks,
  issues,
} from "@/db/schema";
import { jalaliMonthLabel } from "@/lib/jalali";

export const REPORTS = [
  { key: "worker-hours", title: "کارکرد ماهانه‌ی نیروها" },
  { key: "headcount", title: "تعداد نفرات روزانه" },
  { key: "activity-labor", title: "نیروی مصرفیِ فعالیت‌ها" },
  { key: "reworks", title: "دوباره‌کاری‌ها" },
  { key: "issues", title: "موانع و مشکلات" },
] as const;

export type ReportType = (typeof REPORTS)[number]["key"];

export function reportTitle(type: ReportType): string {
  return REPORTS.find((r) => r.key === type)?.title ?? "گزارش";
}

export interface ReportTable {
  columns: string[];
  rows: (string | number)[][];
  note?: string;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const monthOf = (jalaliDate: string) => jalaliDate.slice(0, 7); // 1405/04
const inMonth = (jalaliDate: string, month?: string) =>
  !month || jalaliDate.startsWith(month);

/** ماه‌هایی که برای این پروژه داده دارند */
export async function availableMonths(
  projectId: number,
): Promise<{ key: string; label: string }[]> {
  const db = getDb();
  const rows = await db
    .select({ d: workDays.jalaliDate })
    .from(workDays)
    .where(eq(workDays.projectId, projectId));
  const set = new Set(rows.map((r) => monthOf(r.d)));
  return [...set]
    .sort()
    .reverse()
    .map((key) => ({ key, label: jalaliMonthLabel(key) }));
}

export async function buildReport(
  projectId: number,
  type: ReportType,
  month?: string,
): Promise<ReportTable> {
  switch (type) {
    case "worker-hours":
      return workerHours(projectId, month);
    case "headcount":
      return headcount(projectId, month);
    case "activity-labor":
      return activityLabor(projectId, month);
    case "reworks":
      return reworkList(projectId, month);
    case "issues":
      return issueList(projectId, month);
  }
}

async function attendanceRows(projectId: number) {
  const db = getDb();
  return db
    .select({
      date: workDays.jalaliDate,
      name: workers.fullName,
      trade: workers.trade,
      employmentType: workers.employmentType,
      workerId: attendance.workerId,
      workDayId: attendance.workDayId,
      workedMinutes: attendance.workedMinutes,
      overtimeMinutes: attendance.overtimeMinutes,
      dayFraction: attendance.dayFraction,
    })
    .from(attendance)
    .innerJoin(workDays, eq(attendance.workDayId, workDays.id))
    .innerJoin(workers, eq(attendance.workerId, workers.id))
    .where(eq(workDays.projectId, projectId));
}

async function workerHours(
  projectId: number,
  month?: string,
): Promise<ReportTable> {
  const rows = (await attendanceRows(projectId)).filter((r) =>
    inMonth(r.date, month),
  );
  const map = new Map<
    string,
    {
      name: string;
      trade: string | null;
      emp: string | null;
      days: number;
      minutes: number;
      overtime: number;
    }
  >();
  for (const r of rows) {
    const k = r.name;
    const cur =
      map.get(k) ??
      { name: r.name, trade: r.trade, emp: r.employmentType, days: 0, minutes: 0, overtime: 0 };
    cur.days += r.dayFraction;
    cur.minutes += r.workedMinutes;
    cur.overtime += r.overtimeMinutes;
    map.set(k, cur);
  }
  const list = [...map.values()].sort((a, b) => b.minutes - a.minutes);
  return {
    columns: ["نیرو", "تخصص", "نوع", "نفر-روز", "نفر-ساعت", "اضافه‌کاری (ساعت)"],
    rows: list.map((w) => [
      w.name,
      w.trade ?? "-",
      w.emp ?? "-",
      round(w.days, 2),
      round(w.minutes / 60),
      round(w.overtime / 60),
    ]),
    note: `مجموع نیروها: ${list.length}`,
  };
}

async function headcount(
  projectId: number,
  month?: string,
): Promise<ReportTable> {
  const rows = (await attendanceRows(projectId)).filter((r) =>
    inMonth(r.date, month),
  );
  const byDate = new Map<string, { count: number; personDays: number }>();
  for (const r of rows) {
    const cur = byDate.get(r.date) ?? { count: 0, personDays: 0 };
    cur.count += 1;
    cur.personDays += r.dayFraction;
    byDate.set(r.date, cur);
  }
  const list = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return {
    columns: ["تاریخ", "تعداد نفرات", "نفر-روز"],
    rows: list.map(([date, v]) => [date, v.count, round(v.personDays, 2)]),
  };
}

async function activityLabor(
  projectId: number,
  month?: string,
): Promise<ReportTable> {
  const db = getDb();

  // فعالیت‌های پروژه با تاریخ و شناسه‌ی روز
  const acts = await db
    .select({
      id: activities.id,
      workDayId: activities.workDayId,
      date: workDays.jalaliDate,
      description: activities.description,
      activityType: activities.activityType,
    })
    .from(activities)
    .innerJoin(workDays, eq(activities.workDayId, workDays.id))
    .where(eq(workDays.projectId, projectId));
  const actById = new Map(acts.map((a) => [a.id, a]));

  // نیروهای هر فعالیت
  const links = await db
    .select({
      activityId: activityWorkers.activityId,
      workerId: activityWorkers.workerId,
    })
    .from(activityWorkers)
    .innerJoin(activities, eq(activityWorkers.activityId, activities.id))
    .innerJoin(workDays, eq(activities.workDayId, workDays.id))
    .where(eq(workDays.projectId, projectId));

  // نفر-ساعت هر نیرو در هر روز
  const att = await attendanceRows(projectId);
  const minutesByKey = new Map<string, number>();
  for (const a of att) {
    minutesByKey.set(`${a.workDayId}:${a.workerId}`, a.workedMinutes);
  }

  const grp = new Map<string, { count: number; minutes: number }>();
  for (const l of links) {
    const a = actById.get(l.activityId);
    if (!a || !inMonth(a.date, month)) continue;
    const group = a.activityType || a.description || "سایر";
    const minutes = minutesByKey.get(`${a.workDayId}:${l.workerId}`) ?? 0;
    const cur = grp.get(group) ?? { count: 0, minutes: 0 };
    cur.count += 1;
    cur.minutes += minutes;
    grp.set(group, cur);
  }

  const list = [...grp.entries()].sort((a, b) => b[1].minutes - a[1].minutes);
  return {
    columns: ["فعالیت", "دفعاتِ نیرو", "نفر-ساعت"],
    rows: list.map(([g, v]) => [g, v.count, round(v.minutes / 60)]),
  };
}

async function reworkList(
  projectId: number,
  month?: string,
): Promise<ReportTable> {
  const db = getDb();
  const rows = await db
    .select({
      date: workDays.jalaliDate,
      workFront: reworks.workFront,
      amount: reworks.amount,
      cause: reworks.cause,
      description: reworks.description,
    })
    .from(reworks)
    .innerJoin(workDays, eq(reworks.workDayId, workDays.id))
    .where(eq(workDays.projectId, projectId));
  const list = rows.filter((r) => inMonth(r.date, month));
  return {
    columns: ["تاریخ", "محل", "مقدار", "علت", "شرح"],
    rows: list.map((r) => [
      r.date,
      r.workFront ?? "-",
      r.amount ?? "-",
      r.cause ?? "-",
      r.description,
    ]),
    note: `مجموع موارد: ${list.length}`,
  };
}

async function issueList(
  projectId: number,
  month?: string,
): Promise<ReportTable> {
  const db = getDb();
  const rows = await db
    .select({
      date: workDays.jalaliDate,
      type: issues.type,
      description: issues.description,
      impact: issues.impact,
    })
    .from(issues)
    .innerJoin(workDays, eq(issues.workDayId, workDays.id))
    .where(eq(workDays.projectId, projectId));
  const list = rows.filter((r) => inMonth(r.date, month));
  return {
    columns: ["تاریخ", "نوع", "شرح", "اثر"],
    rows: list.map((r) => [r.date, r.type, r.description, r.impact ?? "-"]),
    note: `مجموع موارد: ${list.length}`,
  };
}
