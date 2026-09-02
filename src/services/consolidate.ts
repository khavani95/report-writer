import { eq, inArray } from "drizzle-orm";
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
import { listWorkers } from "@/db/queries";
import { findWorkerMatch } from "@/lib/text-normalize";
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

  // ── پاک‌سازی نتایج قبلی ─────────────────────────────────────
  // درایور HTTP نئون هر دستور را یک درخواست جداگانه می‌فرستد، پس تعداد
  // رفت‌وبرگشت‌ها مستقیماً زمان پاسخ بات است. حذف پیوندهای فعالیت با یک
  // زیرپرس‌وجو انجام می‌شود، نه یک DELETE به‌ازای هر فعالیت.
  const cleanup: Array<Promise<unknown>> = [
    db.delete(attendance).where(eq(attendance.workDayId, workDayId)),
  ];
  if (!keep) {
    await db.delete(activityWorkers).where(
      inArray(
        activityWorkers.activityId,
        db
          .select({ id: activities.id })
          .from(activities)
          .where(eq(activities.workDayId, workDayId)),
      ),
    );
    cleanup.push(
      db.delete(activities).where(eq(activities.workDayId, workDayId)),
      db.delete(issues).where(eq(issues.workDayId, workDayId)),
      db.delete(reworks).where(eq(reworks.workDayId, workDayId)),
    );
  }
  await Promise.all(cleanup);

  // ── تطبیق نام‌ها: فهرست نیروهای پروژه فقط یک‌بار خوانده می‌شود ──
  const roster = await listWorkers(projectId);
  const cache = new Map<string, Worker>();
  /** نیروهای تازه‌ای که باید ساخته شوند (یک‌جا درج می‌شوند) */
  const pendingNew = new Map<string, { name: string; trade?: string }>();

  const matchInRoster = (name: string): Worker | null => {
    const idx = findWorkerMatch(
      name,
      roster.map((w) => [w.fullName, ...(w.aliases ?? [])]),
    );
    return idx >= 0 ? roster[idx] : null;
  };

  /** نامی که باید شناخته شود؛ اگر در فهرست نبود در صف ساخت می‌رود */
  const want = (name: string, trade?: string) => {
    const k = name.trim();
    if (!k || cache.has(k) || pendingNew.has(k)) return;
    const found = matchInRoster(k);
    if (found) cache.set(k, found);
    else pendingNew.set(k, { name: k, trade });
  };

  const resolve = (name: string): Worker | null => cache.get(name.trim()) ?? null;

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

  // همه‌ی نام‌ها یک‌جا تطبیق داده می‌شوند و نیروهای تازه با یک درج ساخته می‌شوند
  for (const w of data.workers) want(w.name ?? "", w.trade ?? undefined);
  for (const nm of activityNames) want(nm);
  if (pendingNew.size) {
    const created = await db
      .insert(workers)
      .values(
        [...pendingNew.values()].map((n) => ({
          projectId,
          fullName: n.name,
          aliases: [] as string[],
          trade: n.trade ?? null,
        })),
      )
      .returning();
    for (const w of created) {
      roster.push(w);
      cache.set(w.fullName, w);
    }
    pendingNew.clear();
  }

  for (const w of data.workers) {
    const worker = resolve(w.name ?? "");
    if (!worker) continue;
    add(worker, {
      entry: w.entry ?? undefined,
      exit: w.exit ?? undefined,
      trade: w.trade ?? undefined,
      emp: w.employmentType ?? undefined,
    });
  }
  for (const nm of activityNames) {
    const worker = resolve(nm);
    if (worker && !byId.has(worker.id)) add(worker, {});
  }

  // به‌روزرسانی پروفایل نیروها — فقط آن‌هایی که واقعاً عوض شده‌اند
  const profileUpdates: Array<Promise<unknown>> = [];
  for (const rec of byId.values()) {
    const { trade, employmentType } = cleanProfile(rec.trade, rec.emp);
    rec.trade = trade;
    rec.emp = employmentType;
    const patch: Record<string, unknown> = {};
    if (trade && trade !== rec.worker.trade) patch.trade = trade;
    if (employmentType && employmentType !== rec.worker.employmentType) {
      patch.employmentType = employmentType;
    }
    if (trade && employmentType && rec.worker.profileStatus !== "complete") {
      patch.profileStatus = "complete";
    }
    if (Object.keys(patch).length) {
      profileUpdates.push(
        db.update(workers).set(patch).where(eq(workers.id, rec.worker.id)),
      );
    }
  }

  // ثبت کارکرد — یک درج دسته‌ای برای همه‌ی نیروها
  const attendanceRows = [...byId.values()].map((rec) => {
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
    return {
      workDayId,
      workerId: rec.worker.id,
      entryTime: rec.entry ?? null,
      exitTime: rec.exit ?? null,
      breakMinutes,
      workedMinutes,
      dayFraction,
      overtimeMinutes,
    };
  });
  await Promise.all([
    ...profileUpdates,
    ...(attendanceRows.length
      ? [db.insert(attendance).values(attendanceRows)]
      : []),
  ]);

  // فعالیت‌ها/موانع/دوباره‌کاری‌های قبلی حفظ شده‌اند؛ چیزی بازنویسی نمی‌شود
  if (keep) return;

  // ── ثبت فعالیت‌ها، موانع و دوباره‌کاری‌ها ────────────────────
  // هر بخش یک درج دسته‌ای است، نه یک درج به‌ازای هر ردیف.
  const actRows = data.activities
    .filter((a) => (a.description ?? "").trim())
    .map((a) => ({
      workDayId,
      workFront: a.workFront ?? null,
      activityType: a.activityType ?? null,
      description: a.description.trim(),
      workerNames: (a.workers ?? []).map((x) => x.trim()).filter(Boolean),
      startTime: a.startTime ?? null,
      endTime: a.endTime ?? null,
      isFullDay: a.isFullDay ?? false,
    }));

  const issueRows = data.issues
    .filter((i) => (i.description ?? "").trim())
    .map((i) => ({
      workDayId,
      type: i.type ?? "مشکل",
      description: i.description,
      impact: i.impact ?? null,
    }));

  const reworkRows = data.reworks
    .filter((r) => (r.description ?? "").trim())
    .map((r) => ({
      workDayId,
      workFront: r.workFront ?? null,
      amount: r.amount ?? null,
      cause: r.cause ?? null,
      description: r.description,
    }));

  const [inserted] = await Promise.all([
    actRows.length
      ? db.insert(activities).values(actRows).returning({ id: activities.id })
      : Promise.resolve([] as Array<{ id: number }>),
    issueRows.length ? db.insert(issues).values(issueRows) : null,
    reworkRows.length ? db.insert(reworks).values(reworkRows) : null,
  ]);

  // پیوند فعالیت↔نیرو، همه با یک درج
  const links: Array<{ activityId: number; workerId: number }> = [];
  inserted.forEach((row, i) => {
    const seen = new Set<number>();
    for (const nm of actRows[i].workerNames) {
      const worker = resolve(nm);
      if (!worker || seen.has(worker.id)) continue;
      seen.add(worker.id);
      links.push({ activityId: row.id, workerId: worker.id });
    }
  });
  if (links.length) await db.insert(activityWorkers).values(links);
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
