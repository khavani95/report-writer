import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  projects,
  workers,
  workDays,
  rawMessages,
  extractedEvents,
  activities,
  activityWorkers,
  attendance,
  conversationState,
  type Project,
  type Worker,
  type WorkDay,
  type ConversationState,
  type CardState,
} from "./schema";
import { toJalali, type JalaliInfo } from "@/lib/jalali";
import { calcWork } from "@/services/attendance-calc";
import { findWorkerMatch } from "@/lib/text-normalize";

/** ساخت پروژه‌ی جدید برای یک چت */
export async function createProject(
  chatId: number,
  name: string,
): Promise<Project> {
  const db = getDb();
  const inserted = await db
    .insert(projects)
    .values({ chatId, name: name.trim() || "کارگاه" })
    .returning();
  return inserted[0];
}

/** فهرست پروژه‌های فعالِ یک چت */
export async function listProjects(chatId: number): Promise<Project[]> {
  const db = getDb();
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.chatId, chatId), eq(projects.isArchived, false)))
    .orderBy(projects.createdAt);
}

export async function getProjectById(id: number): Promise<Project | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** پروژه‌ی فعالِ فعلیِ چت (اگر انتخاب شده باشد) */
export async function getActiveProject(chatId: number): Promise<Project | null> {
  const st = await getConversationState(chatId);
  if (!st?.activeProjectId) return null;
  return getProjectById(st.activeProjectId);
}

/** تعیین پروژه‌ی فعالِ چت */
export async function setActiveProject(chatId: number, projectId: number) {
  const db = getDb();
  await db
    .insert(conversationState)
    .values({ chatId, activeProjectId: projectId, phase: "idle" })
    .onConflictDoUpdate({
      target: conversationState.chatId,
      // با عوض‌کردن پروژه، هر جریانِ نیمه‌تمام (انتظار تاریخ، مرور کارتی) رها می‌شود
      set: {
        activeProjectId: projectId,
        phase: "idle",
        cardState: null,
        updatedAt: new Date(),
      },
    });
}

/** پاک‌کردن پروژه‌ی فعال (بازگشت به منوی اصلی) */
export async function clearActiveProject(chatId: number) {
  const db = getDb();
  await db
    .update(conversationState)
    .set({ activeProjectId: null, phase: "idle", updatedAt: new Date() })
    .where(eq(conversationState.chatId, chatId));
}

/** همه‌ی روزهای بازِ چت (برای «پایان روز همه») */
export async function listOpenDays(
  chatId: number,
): Promise<Array<{ day: WorkDay; project: Project }>> {
  const db = getDb();
  return db
    .select({ day: workDays, project: projects })
    .from(workDays)
    .innerJoin(projects, eq(workDays.projectId, projects.id))
    .where(and(eq(projects.chatId, chatId), eq(workDays.status, "open")))
    .orderBy(projects.name);
}

/** گذاشتن فاز «منتظر نام پروژه» */
export async function setAwaitProjectName(chatId: number) {
  const db = getDb();
  await db
    .insert(conversationState)
    .values({ chatId, phase: "await_project_name" })
    .onConflictDoUpdate({
      target: conversationState.chatId,
      set: { phase: "await_project_name", updatedAt: new Date() },
    });
}

/** روزکاریِ بازِ فعلی این پروژه (اگر باشد) */
export async function getOpenWorkDay(
  projectId: number,
): Promise<WorkDay | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(workDays)
    .where(and(eq(workDays.projectId, projectId), eq(workDays.status, "open")))
    .orderBy(desc(workDays.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

/** شروع یک روزکاری جدید برای تاریخ مشخص (پیش‌فرض امروز) */
export async function startWorkDay(
  project: Project,
  j: JalaliInfo = toJalali(),
): Promise<WorkDay> {
  const db = getDb();
  // شماره‌ی گزارش تاریخ‌محور: مثل RN-14050430
  const reportNo = `${project.reportPrefix}-${j.key.replace(/\//g, "")}`;

  const inserted = await db
    .insert(workDays)
    .values({
      projectId: project.id,
      jalaliDate: j.key,
      dateLabel: j.label,
      reportNo,
      status: "open",
    })
    .returning();
  return inserted[0];
}

/** روزکاری موجود برای یک تاریخ (اگر باشد) */
export async function getWorkDayByDate(
  projectId: number,
  jalaliDate: string,
): Promise<WorkDay | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(workDays)
    .where(
      and(
        eq(workDays.projectId, projectId),
        eq(workDays.jalaliDate, jalaliDate),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** روزکاری با شناسه */
export async function getWorkDayById(id: number): Promise<WorkDay | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(workDays)
    .where(eq(workDays.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * روزهای کاری یک پروژه؛ در صورت دادن ماه («1405/04») فقط همان ماه.
 * برای خروجی زیپِ گزارش‌های روزانه استفاده می‌شود.
 */
export async function listWorkDays(
  projectId: number,
  month?: string,
): Promise<WorkDay[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(workDays)
    .where(eq(workDays.projectId, projectId))
    .orderBy(workDays.jalaliDate);
  return month ? rows.filter((d) => d.jalaliDate.startsWith(month)) : rows;
}

/** تغییر وضعیت روز (open | review | closed) */
export async function setDayStatus(
  workDayId: number,
  status: "open" | "review" | "closed",
): Promise<void> {
  const db = getDb();
  await db
    .update(workDays)
    .set({
      status,
      ...(status === "closed" ? { closedAt: new Date() } : {}),
    })
    .where(eq(workDays.id, workDayId));
}

/** بستن روزکاری */
export async function closeWorkDay(workDayId: number): Promise<void> {
  await setDayStatus(workDayId, "closed");
}

/** افزایش شماره‌ی نسخه (rev) و برگرداندن مقدار جدید */
export async function bumpRevision(workDayId: number): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ r: workDays.revision })
    .from(workDays)
    .where(eq(workDays.id, workDayId))
    .limit(1);
  const next = (rows[0]?.r ?? 0) + 1;
  await db
    .update(workDays)
    .set({ revision: next })
    .where(eq(workDays.id, workDayId));
  return next;
}

/** کل مکالمه‌ی روز به‌صورت متن (پیام‌های متنی + متن پیاده‌شده‌ی ویس‌ها) */
export async function getDayConversation(workDayId: number): Promise<string> {
  const db = getDb();
  const rows = await db
    .select()
    .from(rawMessages)
    .where(eq(rawMessages.workDayId, workDayId))
    .orderBy(rawMessages.createdAt);
  return rows
    .map((m) => (m.text ?? m.transcript ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

/** فهرست نیروهای فعال پروژه */
export async function listWorkers(projectId: number): Promise<Worker[]> {
  const db = getDb();
  return db
    .select()
    .from(workers)
    .where(and(eq(workers.projectId, projectId), eq(workers.isActive, true)))
    .orderBy(workers.fullName);
}

/**
 * تطبیق یا ساخت نیرو بر اساس نام گفته‌شده.
 * ابتدا با نام کامل یا نام‌های مستعار تطبیق می‌دهد، در غیر این صورت می‌سازد.
 */
export async function resolveWorker(
  projectId: number,
  name: string,
  trade?: string,
): Promise<Worker> {
  const db = getDb();
  const clean = name.trim();

  // همه‌ی نیروهای پروژه را می‌گیریم و با نرمال‌سازی/شباهت تطبیق می‌دهیم
  // (تا «آیدین/ایدین/یدین» یک نفر شناخته شوند).
  const all = await db
    .select()
    .from(workers)
    .where(eq(workers.projectId, projectId));

  const idx = findWorkerMatch(
    clean,
    all.map((w) => [w.fullName, ...(w.aliases ?? [])]),
  );
  if (idx >= 0) return all[idx];

  const inserted = await db
    .insert(workers)
    .values({
      projectId,
      fullName: clean,
      aliases: [],
      trade: trade ?? null,
    })
    .returning();
  return inserted[0];
}

/** ذخیره‌ی پیام خام */
export async function saveRawMessage(data: {
  workDayId: number;
  telegramMessageId?: number;
  kind: "text" | "voice";
  text?: string;
  transcript?: string;
  telegramFileId?: string;
}) {
  const db = getDb();
  const inserted = await db.insert(rawMessages).values(data).returning();
  return inserted[0];
}

/** ذخیره‌ی رویدادهای استخراج‌شده */
export async function saveEvents(
  workDayId: number,
  rawMessageId: number,
  events: Array<{ type: string; payload: Record<string, unknown> }>,
) {
  if (!events.length) return;
  const db = getDb();
  await db.insert(extractedEvents).values(
    events.map((e) => ({
      workDayId,
      rawMessageId,
      type: e.type,
      payload: e.payload,
    })),
  );
}

// ── تکمیل پروفایل و فعالیت (ویزارد پایان روز) ────────────

/** تکمیل پروفایل یک نیرو و علامت‌گذاری به‌عنوان کامل */
export async function updateWorkerProfile(
  workerId: number,
  data: { fullName?: string; trade?: string; employmentType?: string },
) {
  const db = getDb();
  const patch: Record<string, unknown> = { profileStatus: "complete" };
  if (data.fullName) patch.fullName = data.fullName;
  if (data.trade) patch.trade = data.trade;
  if (data.employmentType) patch.employmentType = data.employmentType;
  await db.update(workers).set(patch).where(eq(workers.id, workerId));
}

/** ثبت ساعت ورود/خروج یک نیرو و بازمحاسبه‌ی کارکرد */
export async function updateAttendanceTime(
  workDayId: number,
  workerId: number,
  entry: string | null,
  exit: string | null,
) {
  const db = getDb();
  const patch: Record<string, unknown> = {
    entryTime: entry,
    exitTime: exit,
  };
  if (entry && exit) {
    const calc = calcWork(entry, exit);
    if (calc) {
      patch.breakMinutes = calc.breakMinutes;
      patch.workedMinutes = calc.workedMinutes;
      patch.dayFraction = calc.dayFraction;
      patch.overtimeMinutes = calc.overtimeMinutes;
    }
  }
  await db
    .update(attendance)
    .set(patch)
    .where(
      and(
        eq(attendance.workDayId, workDayId),
        eq(attendance.workerId, workerId),
      ),
    );
}

/** فهرست فعالیت‌های یک روز (برای دکمه‌های انتخاب در ویزارد) */
export async function listDayActivities(workDayId: number) {
  const db = getDb();
  return db
    .select({
      id: activities.id,
      description: activities.description,
      workFront: activities.workFront,
    })
    .from(activities)
    .where(eq(activities.workDayId, workDayId));
}

/** اتصال یک نیرو به یک فعالیت موجود (بدون ساخت فعالیت جدید) */
export async function linkWorkerToActivity(
  activityId: number,
  workerId: number,
) {
  const db = getDb();
  const existing = await db
    .select({ id: activityWorkers.id })
    .from(activityWorkers)
    .where(
      and(
        eq(activityWorkers.activityId, activityId),
        eq(activityWorkers.workerId, workerId),
      ),
    )
    .limit(1);
  if (existing[0]) return;
  await db.insert(activityWorkers).values({ activityId, workerId });
}

/** ثبت بازه‌ی زمانی یک فعالیت */
export async function updateActivityTime(
  activityId: number,
  data: { startTime?: string; endTime?: string; isFullDay?: boolean },
) {
  const db = getDb();
  await db
    .update(activities)
    .set({
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      isFullDay: data.isFullDay ?? false,
    })
    .where(eq(activities.id, activityId));
}

/** افزودن یک فعالیت جدید برای نیروی بدون فعالیت + اتصال او */
export async function addCoverageActivity(
  workDayId: number,
  workerId: number,
  data: {
    description: string;
    workFront?: string;
    activityType?: string;
    startTime?: string;
    endTime?: string;
    isFullDay?: boolean;
  },
) {
  const db = getDb();
  const [act] = await db
    .insert(activities)
    .values({
      workDayId,
      workFront: data.workFront ?? null,
      activityType: data.activityType ?? null,
      description: data.description,
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      isFullDay: data.isFullDay ?? false,
    })
    .returning({ id: activities.id });
  await db
    .insert(activityWorkers)
    .values({ activityId: act.id, workerId });
}

// ── وضعیت گفتگو (ویزارد) ─────────────────────────────────

export async function getConversationState(
  chatId: number,
): Promise<ConversationState | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(conversationState)
    .where(eq(conversationState.chatId, chatId))
    .limit(1);
  return rows[0] ?? null;
}

/** شروع/به‌روزرسانی دورِ بازبینی با فهرست سؤال‌های تازه */
export async function setReview(
  chatId: number,
  workDayId: number,
  questions: string[],
  round: number,
) {
  const db = getDb();
  await db
    .insert(conversationState)
    .values({
      chatId,
      workDayId,
      phase: "review",
      questions,
      answers: [],
      round,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: conversationState.chatId,
      set: {
        workDayId,
        phase: "review",
        questions,
        answers: [],
        round,
        updatedAt: new Date(),
      },
    });
}

/** شروع مرور کارتیِ پایان روز */
export async function setCards(chatId: number, workDayId: number) {
  const db = getDb();
  const cardState: CardState = {
    index: 0,
    deletions: [],
    changes: [],
    editTarget: null,
  };
  await db
    .update(conversationState)
    .set({ phase: "cards", workDayId, cardState, updatedAt: new Date() })
    .where(eq(conversationState.chatId, chatId));
}

/** به‌روزرسانی وضعیت کارت‌ها (و اختیاری فاز) */
export async function updateCardState(
  chatId: number,
  patch: Partial<CardState>,
  phase?: string,
) {
  const db = getDb();
  const cur = await getConversationState(chatId);
  const base: CardState = cur?.cardState ?? {
    index: 0,
    deletions: [],
    changes: [],
    editTarget: null,
  };
  const cardState: CardState = { ...base, ...patch };
  const set: Record<string, unknown> = { cardState, updatedAt: new Date() };
  if (phase) set.phase = phase;
  await db
    .update(conversationState)
    .set(set)
    .where(eq(conversationState.chatId, chatId));
}

/** گذاشتن فاز «تأیید نهایی» */
export async function setConfirm(chatId: number, workDayId: number) {
  const db = getDb();
  await db
    .insert(conversationState)
    .values({ chatId, workDayId, phase: "confirm" })
    .onConflictDoUpdate({
      target: conversationState.chatId,
      set: { workDayId, phase: "confirm", updatedAt: new Date() },
    });
}

/** به‌روزرسانی فقط سؤال‌ها و شماره‌ی دور (پاسخ‌های قبلی حفظ می‌شوند) */
export async function setReviewQuestions(
  chatId: number,
  questions: string[],
  round: number,
) {
  const db = getDb();
  await db
    .update(conversationState)
    .set({ phase: "review", questions, round, updatedAt: new Date() })
    .where(eq(conversationState.chatId, chatId));
}

/** افزودن یک پاسخ به پاسخ‌های جمع‌شده‌ی این بازبینی */
export async function addAnswer(chatId: number, answer: string) {
  const db = getDb();
  const cur = await getConversationState(chatId);
  const answers = [...(cur?.answers ?? []), answer];
  await db
    .update(conversationState)
    .set({ answers, updatedAt: new Date() })
    .where(eq(conversationState.chatId, chatId));
}

/** گذاشتن فاز «منتظر ورودی تاریخ» */
export async function setAwaitDate(chatId: number) {
  const db = getDb();
  await db
    .insert(conversationState)
    .values({ chatId, phase: "await_date", questions: [], answers: [], round: 0 })
    .onConflictDoUpdate({
      target: conversationState.chatId,
      set: {
        phase: "await_date",
        questions: [],
        answers: [],
        round: 0,
        workDayId: null,
        updatedAt: new Date(),
      },
    });
}

export async function clearConversationState(chatId: number) {
  const db = getDb();
  await db
    .insert(conversationState)
    .values({ chatId, phase: "idle", questions: [], answers: [], round: 0 })
    .onConflictDoUpdate({
      target: conversationState.chatId,
      set: {
        phase: "idle",
        questions: [],
        answers: [],
        cardState: null,
        round: 0,
        workDayId: null,
        updatedAt: new Date(),
      },
    });
}
