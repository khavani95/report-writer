import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  attendance,
  activities,
  activityWorkers,
  issues,
  reworks,
  workers,
  type Worker,
} from "@/db/schema";
import { resolveWorker } from "@/db/queries";
import { calcWork, timeToMinutes } from "./attendance-calc";
import { workRules } from "@/lib/config";
import type { DayData } from "@/ai/day";

export interface AttendanceRow {
  workerId: number;
  name: string;
  trade: string | null;
  employmentType: string | null;
  profileStatus: string;
  entry: string | null;
  exit: string | null;
  workedMinutes: number;
  overtimeMinutes: number;
  dayFraction: number;
  workFront: string | null;
  assignedActivityMinutes: number;
  hasActivity: boolean;
}

export interface ActivityRow {
  activityId: number;
  workFront: string | null;
  activityType: string | null;
  description: string;
  workers: string[];
  workerIds: number[];
  startTime: string | null;
  endTime: string | null;
  isFullDay: boolean;
  hasTime: boolean;
}

export interface DaySummary {
  attendance: AttendanceRow[];
  activities: ActivityRow[];
  issues: Array<{ type: string; description: string; impact: string | null }>;
  reworks: Array<{
    workFront: string | null;
    amount: string | null;
    cause: string | null;
    description: string;
  }>;
  workerCount: number;
}

/**
 * داده‌ی ساختاریافته‌ی یک روز (خروجی استخراج دسته‌ای) را در جدول‌ها می‌نویسد.
 * idempotent: نتایج قبلی روز پاک و از نو نوشته می‌شوند.
 *
 * `keepNonAttendance` برای وقتی است که هوش مصنوعی پاسخ نداده و داده‌ی ورودی
 * فقط از پارسر قطعیِ ورود/خروج آمده. آن‌وقت فعالیت‌ها، موانع و دوباره‌کاری‌های
 * قبلی دست‌نخورده می‌مانند؛ وگرنه یک خطای لحظه‌ایِ سرویس، کلِ گزارش روز را پاک می‌کند.
 */
export async function writeDayData(
  projectId: number,
  workDayId: number,
  data: DayData,
  opts?: { keepNonAttendance?: boolean },
): Promise<void> {
  const db = getDb();
  const keep = opts?.keepNonAttendance === true;

  // پاک‌سازی نتایج قبلی
  if (!keep) {
    const oldActs = await db
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.workDayId, workDayId));
    for (const a of oldActs) {
      await db
        .delete(activityWorkers)
        .where(eq(activityWorkers.activityId, a.id));
    }
    await db.delete(activities).where(eq(activities.workDayId, workDayId));
    await db.delete(issues).where(eq(issues.workDayId, workDayId));
    await db.delete(reworks).where(eq(reworks.workDayId, workDayId));
  }
  await db.delete(attendance).where(eq(attendance.workDayId, workDayId));

  // کش تطبیق نام برای کاهش رفت‌وبرگشت به دیتابیس
  const cache = new Map<string, Worker>();
  const resolve = async (name: string): Promise<Worker> => {
    const k = name.trim();
    const hit = cache.get(k);
    if (hit) return hit;
    const w = await resolveWorker(projectId, k);
    cache.set(k, w);
    return w;
  };

  // نیروها را بر اساس شناسه‌ی نهایی ادغام می‌کنیم (رفع نام‌های تکراری)
  const byId = new Map<
    number,
    { worker: Worker; entry?: string; exit?: string; trade?: string; emp?: string }
  >();
  const add = (
    worker: Worker,
    fields: { entry?: string; exit?: string; trade?: string; emp?: string },
  ) => {
    const cur = byId.get(worker.id) ?? { worker };
    cur.entry = cur.entry ?? fields.entry;
    cur.exit = cur.exit ?? fields.exit;
    cur.trade = cur.trade ?? fields.trade ?? worker.trade ?? undefined;
    cur.emp = cur.emp ?? fields.emp ?? worker.employmentType ?? undefined;
    byId.set(worker.id, cur);
  };

  for (const w of data.workers) {
    const name = (w.name ?? "").trim();
    if (!name) continue;
    if (w.trade) cache.delete(name); // تخصص جدید ممکن است
    const worker = await resolveWorker(projectId, name, w.trade ?? undefined);
    cache.set(name, worker);
    add(worker, {
      entry: w.entry ?? undefined,
      exit: w.exit ?? undefined,
      trade: w.trade ?? undefined,
      emp: w.employmentType ?? undefined,
    });
  }

  // نیروهای داخل فعالیت‌ها هم اگر در فهرست کارکرد نبودند، حاضر محسوب شوند.
  // در حالت keep، فعالیت‌های نگه‌داشته‌شده‌ی دیتابیس مرجع‌اند نه داده‌ی ورودی.
  const activityNames = keep
    ? (
        await db
          .select({ names: activities.workerNames })
          .from(activities)
          .where(eq(activities.workDayId, workDayId))
      ).flatMap((a) => a.names ?? [])
    : data.activities.flatMap((a) => a.workers ?? []);
  for (const nm of activityNames) {
    const clean = nm.trim();
    if (!clean) continue;
    const worker = await resolve(clean);
    if (!byId.has(worker.id)) add(worker, {});
  }

  // به‌روزرسانی پروفایل نیروها (با پاک‌سازی تخصص/نوع همکاری)
  for (const rec of byId.values()) {
    const { trade, employmentType } = cleanProfile(rec.trade, rec.emp);
    rec.trade = trade;
    rec.emp = employmentType;
    const patch: Record<string, unknown> = {};
    if (trade) patch.trade = trade;
    if (employmentType) patch.employmentType = employmentType;
    if (trade && employmentType) patch.profileStatus = "complete";
    if (Object.keys(patch).length) {
      await db.update(workers).set(patch).where(eq(workers.id, rec.worker.id));
    }
  }

  // ثبت کارکرد
  for (const rec of byId.values()) {
    let workedMinutes = 0;
    let overtimeMinutes = 0;
    let dayFraction = 0;
    let breakMinutes = 0;
    if (rec.entry && rec.exit) {
      const c = calcWork(rec.entry, rec.exit);
      if (c) {
        workedMinutes = c.workedMinutes;
        overtimeMinutes = c.overtimeMinutes;
        dayFraction = c.dayFraction;
        breakMinutes = c.breakMinutes;
      }
    } else if (rec.entry || rec.exit) {
      dayFraction = 1;
      workedMinutes = workRules.standardWorkMinutes;
    }
    await db.insert(attendance).values({
      workDayId,
      workerId: rec.worker.id,
      entryTime: rec.entry ?? null,
      exitTime: rec.exit ?? null,
      breakMinutes,
      workedMinutes,
      dayFraction,
      overtimeMinutes,
    });
  }

  // فعالیت‌ها/موانع/دوباره‌کاری‌های قبلی حفظ شده‌اند؛ چیزی بازنویسی نمی‌شود
  if (keep) return;

  // ثبت فعالیت‌ها + نسبت‌دادن نفرات
  for (const a of data.activities) {
    const desc = (a.description ?? "").trim();
    if (!desc) continue;
    const names = (a.workers ?? []).map((x) => x.trim()).filter(Boolean);
    const [ins] = await db
      .insert(activities)
      .values({
        workDayId,
        workFront: a.workFront ?? null,
        activityType: a.activityType ?? null,
        description: desc,
        workerNames: names,
        startTime: a.startTime ?? null,
        endTime: a.endTime ?? null,
        isFullDay: a.isFullDay ?? false,
      })
      .returning({ id: activities.id });
    const seen = new Set<number>();
    for (const nm of names) {
      const worker = await resolve(nm);
      if (seen.has(worker.id)) continue;
      seen.add(worker.id);
      await db
        .insert(activityWorkers)
        .values({ activityId: ins.id, workerId: worker.id });
    }
  }

  // موانع و دوباره‌کاری‌ها
  for (const i of data.issues) {
    if (!(i.description ?? "").trim()) continue;
    await db.insert(issues).values({
      workDayId,
      type: i.type ?? "مشکل",
      description: i.description,
      impact: i.impact ?? null,
    });
  }
  for (const r of data.reworks) {
    if (!(r.description ?? "").trim()) continue;
    await db.insert(reworks).values({
      workDayId,
      workFront: r.workFront ?? null,
      amount: r.amount ?? null,
      cause: r.cause ?? null,
      description: r.description,
    });
  }
}

/**
 * سؤال‌های «حتماً لازم» را از خلاصه‌ی روز می‌سازد.
 * تا وقتی این فهرست خالی نشود، گزارش نهایی نمی‌شود.
 */
export function deterministicGaps(summary: DaySummary): string[] {
  const q: string[] = [];
  for (const w of summary.attendance) {
    if (w.profileStatus !== "complete") {
      q.push(`تخصص و نوع همکاری «${w.name}» چیه؟ (مثلاً: برقکار، روزمزد)`);
    }
    if (!w.entry && !w.exit) {
      q.push(`ساعت ورود و خروج «${w.name}» چند بود؟`);
    } else if (!w.entry) {
      q.push(`ساعت ورود «${w.name}» چند بود؟`);
    } else if (!w.exit) {
      q.push(`ساعت خروج «${w.name}» چند بود؟`);
    }
    if (!w.hasActivity) {
      q.push(`«${w.name}» امروز چه کاری و کجا انجام داد؟`);
    }
  }
  for (const a of summary.activities) {
    if (!a.hasTime) {
      q.push(`فعالیت «${a.description}» چه ساعتی تا چه ساعتی بود؟ (یا تمام‌روز)`);
    }
  }
  return q;
}

const EMPLOYMENT = ["روزمزد", "پیمانکار"];

/**
 * تفکیک و پاک‌سازیِ تخصص و نوع همکاری.
 * مدل گاهی همه‌چیز را در یک رشته می‌ریزد («برقکار پورسانتی/روزمزد/برقکار»)
 * و چون این مقدار هر بار روی پروفایل نوشته می‌شود، آشغال انباشته می‌شود.
 * اینجا بخش‌ها جدا، تکراری‌ها و زیرمجموعه‌ها حذف، و نوع همکاری بیرون کشیده می‌شود.
 */
export function cleanProfile(
  rawTrade?: string | null,
  rawEmp?: string | null,
): { trade?: string; employmentType?: string } {
  const parts = [rawTrade ?? "", rawEmp ?? ""]
    .join("/")
    .split(/[/،,|]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  let employmentType: string | undefined;
  const trades: string[] = [];
  for (const p of parts) {
    const emp = EMPLOYMENT.find((e) => p === e);
    if (emp) {
      employmentType ??= emp;
      continue;
    }
    // «برقکار روزمزد» → تخصص «برقکار» + نوع همکاری «روزمزد»
    const inline = EMPLOYMENT.find((e) => p.endsWith(` ${e}`));
    if (inline) {
      employmentType ??= inline;
      const rest = p.slice(0, -inline.length).trim();
      if (rest) trades.push(rest);
      continue;
    }
    trades.push(p);
  }

  // حذف بخش‌هایی که درون بخش دیگری تکرار شده‌اند («برقکار» داخل «برقکار پورسانتی»)
  const unique = trades.filter(
    (t, i) => !trades.some((o, j) => j !== i && o !== t && o.includes(t)),
  );
  const trade = [...new Set(unique)].join("، ").slice(0, 60);
  return { trade: trade || undefined, employmentType };
}

/**
 * نواقصی که کاربر در همین مرور برایشان اصلاحیه فرستاده را کنار می‌گذارد.
 * اصلاحیه‌ها هنوز اعمال نشده‌اند (آخر کار یکجا به AI می‌روند)، پس بدون این
 * پالایش، کارت پایانی چیزی را می‌پرسد که کاربر همین الان جواب داده است.
 */
export function pendingGaps(gaps: string[], changes: string[]): string[] {
  const targets = changes
    .map((c) => /^برای (.+?):/.exec(c)?.[1]?.trim())
    .filter((t): t is string => Boolean(t));
  if (!targets.length) return gaps;

  const activitiesEdited = targets.includes("فعالیت‌ها");
  return gaps.filter((g) => {
    // با اصلاحِ «فعالیت‌ها»، سؤال‌های مربوط به فعالیت و انتساب نیرو منتفی‌اند
    if (
      activitiesEdited &&
      (g.includes("چه کاری و کجا") || g.startsWith("فعالیت «"))
    ) {
      return false;
    }
    return !targets.some((t) => t !== "فعالیت‌ها" && g.includes(`«${t}»`));
  });
}

/** مدت فعالیت زمان‌دار به دقیقه (۰ اگر بدون زمان یا تمام‌روز) */
function activityDuration(a: {
  startTime: string | null;
  endTime: string | null;
}): number {
  if (a.startTime && a.endTime) {
    const s = timeToMinutes(a.startTime);
    let e = timeToMinutes(a.endTime);
    if (s === null || e === null) return 0;
    if (e <= s) e += 24 * 60;
    return e - s;
  }
  return 0;
}

/** خلاصه‌ی روز را از جدول‌های نوشته‌شده می‌خواند */
export async function loadDaySummary(workDayId: number): Promise<DaySummary> {
  const db = getDb();

  const attRows = await db
    .select({
      workerId: attendance.workerId,
      entry: attendance.entryTime,
      exit: attendance.exitTime,
      workedMinutes: attendance.workedMinutes,
      overtimeMinutes: attendance.overtimeMinutes,
      dayFraction: attendance.dayFraction,
      workFront: attendance.workFront,
      name: workers.fullName,
      trade: workers.trade,
      employmentType: workers.employmentType,
      profileStatus: workers.profileStatus,
    })
    .from(attendance)
    .innerJoin(workers, eq(attendance.workerId, workers.id))
    .where(eq(attendance.workDayId, workDayId))
    .orderBy(attendance.id);

  const actRows = await db
    .select()
    .from(activities)
    .where(eq(activities.workDayId, workDayId))
    .orderBy(activities.id);

  const links = await db
    .select({
      activityId: activityWorkers.activityId,
      workerId: activityWorkers.workerId,
      name: workers.fullName,
    })
    .from(activityWorkers)
    .innerJoin(activities, eq(activityWorkers.activityId, activities.id))
    .innerJoin(workers, eq(activityWorkers.workerId, workers.id))
    .where(eq(activities.workDayId, workDayId));

  const namesByActivity = new Map<number, string[]>();
  const idsByActivity = new Map<number, number[]>();
  for (const l of links) {
    if (!namesByActivity.has(l.activityId)) {
      namesByActivity.set(l.activityId, []);
      idsByActivity.set(l.activityId, []);
    }
    namesByActivity.get(l.activityId)!.push(l.name);
    idsByActivity.get(l.activityId)!.push(l.workerId);
  }

  const workedByWorkerId = new Map<number, number>();
  for (const a of attRows) workedByWorkerId.set(a.workerId, a.workedMinutes);

  const assignedByWorkerId = new Map<number, number>();
  const hasActivityWorkerId = new Set<number>();
  for (const act of actRows) {
    const dur = activityDuration(act);
    for (const wid of idsByActivity.get(act.id) ?? []) {
      hasActivityWorkerId.add(wid);
      const worked = workedByWorkerId.get(wid) ?? 0;
      const prev = assignedByWorkerId.get(wid) ?? 0;
      const inc = act.isFullDay ? Math.max(worked - prev, 0) : dur;
      assignedByWorkerId.set(wid, prev + inc);
    }
  }

  const attendanceSummary: AttendanceRow[] = attRows.map((a) => ({
    workerId: a.workerId,
    name: a.name,
    trade: a.trade,
    employmentType: a.employmentType,
    profileStatus: a.profileStatus,
    entry: a.entry,
    exit: a.exit,
    workedMinutes: a.workedMinutes,
    overtimeMinutes: a.overtimeMinutes,
    dayFraction: a.dayFraction,
    workFront: a.workFront,
    assignedActivityMinutes: assignedByWorkerId.get(a.workerId) ?? 0,
    hasActivity: hasActivityWorkerId.has(a.workerId),
  }));

  const activitySummary: ActivityRow[] = actRows.map((act) => ({
    activityId: act.id,
    workFront: act.workFront,
    activityType: act.activityType,
    description: act.description,
    workers: namesByActivity.get(act.id) ?? [],
    workerIds: idsByActivity.get(act.id) ?? [],
    startTime: act.startTime,
    endTime: act.endTime,
    isFullDay: act.isFullDay,
    hasTime: act.isFullDay || Boolean(act.startTime && act.endTime),
  }));

  const issueRows = await db
    .select()
    .from(issues)
    .where(eq(issues.workDayId, workDayId));
  const reworkRows = await db
    .select()
    .from(reworks)
    .where(eq(reworks.workDayId, workDayId));

  return {
    attendance: attendanceSummary,
    activities: activitySummary,
    issues: issueRows.map((i) => ({
      type: i.type,
      description: i.description,
      impact: i.impact,
    })),
    reworks: reworkRows.map((r) => ({
      workFront: r.workFront,
      amount: r.amount,
      cause: r.cause,
      description: r.description,
    })),
    workerCount: attendanceSummary.length,
  };
}
