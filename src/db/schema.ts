import {
  pgTable,
  serial,
  bigint,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * پروژه/کارگاه. هر چت تلگرام به یک پروژه نگاشت می‌شود.
 */
export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(), // چند پروژه در یک چت مجاز است
    name: text("name").notNull().default("کارگاه"),
    reportPrefix: text("report_prefix").notNull().default("RN"),
    isArchived: boolean("is_archived").notNull().default(false),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("projects_chat_idx").on(t.chatId)],
);

/**
 * دفترچه‌ی نیروها. نام‌های مستعار برای تطبیق هوشمند نگه داشته می‌شوند.
 */
export const workers = pgTable(
  "workers",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    fullName: text("full_name").notNull(), // نام و نام‌خانوادگی کامل
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    trade: text("trade"), // تخصص: بنا، آرماتوربند، جوشکار، ...
    contractor: text("contractor"), // نام پیمانکار (در صورت پیمانکاری)
    employmentType: text("employment_type"), // روزمزد | پیمانکار
    profileStatus: text("profile_status").notNull().default("pending"), // pending | complete
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("workers_project_idx").on(t.projectId)],
);

/**
 * روزکاری. با «شروع روز» ساخته و با «پایان روز» بسته می‌شود.
 */
export const workDays = pgTable(
  "work_days",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    jalaliDate: text("jalali_date").notNull(), // 1403/04/30
    dateLabel: text("date_label").notNull(), // شنبه ۳۰ تیر ۱۴۰۳
    reportNo: text("report_no"), // تاریخ‌محور مثل RN-14050430
    revision: integer("revision").notNull().default(0), // شماره‌ی بازتولید (rev)
    status: text("status").notNull().default("open"), // open | review | closed
    weather: text("weather"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    closedAt: timestamp("closed_at"),
  },
  (t) => [index("work_days_project_idx").on(t.projectId, t.status)],
);

/**
 * پیام خام — ردِ ممیزی همه‌چیز. اصلِ حرف کاربر همیشه اینجا می‌ماند.
 */
export const rawMessages = pgTable(
  "raw_messages",
  {
    id: serial("id").primaryKey(),
    workDayId: integer("work_day_id")
      .notNull()
      .references(() => workDays.id),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    kind: text("kind").notNull(), // text | voice
    text: text("text"), // متن اصلی (برای پیام متنی)
    transcript: text("transcript"), // متن پیاده‌شده (برای پیام صوتی)
    telegramFileId: text("telegram_file_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("raw_messages_day_idx").on(t.workDayId)],
);

/**
 * رویداد استخراج‌شده — خروجی JSON هوش مصنوعی برای هر پیام، همان لحظه ذخیره می‌شود.
 */
export const extractedEvents = pgTable(
  "extracted_events",
  {
    id: serial("id").primaryKey(),
    workDayId: integer("work_day_id")
      .notNull()
      .references(() => workDays.id),
    rawMessageId: integer("raw_message_id").references(() => rawMessages.id),
    type: text("type").notNull(), // attendance | activity | issue | rework | worker_new | other
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"), // pending | consolidated | ignored
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("events_day_idx").on(t.workDayId, t.type)],
);

/**
 * کارکرد نهایی هر نیرو در هر روز (نتیجه‌ی مرحله‌ی تجمیع).
 */
export const attendance = pgTable(
  "attendance",
  {
    id: serial("id").primaryKey(),
    workDayId: integer("work_day_id")
      .notNull()
      .references(() => workDays.id),
    workerId: integer("worker_id")
      .notNull()
      .references(() => workers.id),
    entryTime: text("entry_time"), // HH:MM
    exitTime: text("exit_time"), // HH:MM
    breakMinutes: integer("break_minutes").notNull().default(0),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    dayFraction: real("day_fraction").notNull().default(0), // 1 = یک روز کامل
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    workFront: text("work_front"), // محل فعالیت
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("attendance_day_idx").on(t.workDayId)],
);

/**
 * فعالیت‌های اجرایی به تفکیک جبهه‌ی کاری.
 */
export const activities = pgTable(
  "activities",
  {
    id: serial("id").primaryKey(),
    workDayId: integer("work_day_id")
      .notNull()
      .references(() => workDays.id),
    workFront: text("work_front"), // جبهه‌ی کاری / محل
    activityType: text("activity_type"), // نوع فعالیت
    description: text("description").notNull(),
    workerNames: jsonb("worker_names").$type<string[]>().notNull().default([]),
    startTime: text("start_time"), // HH:MM
    endTime: text("end_time"), // HH:MM
    isFullDay: boolean("is_full_day").notNull().default(false), // تمام‌روز
    progress: text("progress"), // درصد پیشرفت (اختیاری)
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("activities_day_idx").on(t.workDayId)],
);

/**
 * جدول رابط فعالیت↔نیرو (چند-به-چند).
 * نتیجه‌ی نسبت‌دادن نفرات به فعالیت‌ها در مرحله‌ی تجمیع.
 */
export const activityWorkers = pgTable(
  "activity_workers",
  {
    id: serial("id").primaryKey(),
    activityId: integer("activity_id")
      .notNull()
      .references(() => activities.id),
    workerId: integer("worker_id")
      .notNull()
      .references(() => workers.id),
  },
  (t) => [index("activity_workers_idx").on(t.activityId)],
);

/**
 * وضعیت گفتگوی «بازبینی پایان روز».
 * سوال‌های دور فعلی و پاسخ‌های جمع‌شده تا فشردن «ثبت نهایی».
 */
/** وضعیت مرور کارتیِ پایان روز */
export interface CardState {
  index: number; // شماره‌ی کارت فعلی
  deletions: string[]; // نام نیروهای حذف‌شده
  changes: string[]; // اصلاحیه‌های جمع‌شده
  editTarget: string | null; // در حال اصلاحِ کدام مورد
}

export const conversationState = pgTable("conversation_state", {
  chatId: bigint("chat_id", { mode: "number" }).primaryKey(),
  activeProjectId: integer("active_project_id"), // پروژه‌ی انتخاب‌شده‌ی چت
  workDayId: integer("work_day_id").references(() => workDays.id),
  phase: text("phase").notNull().default("idle"), // idle | await_project_name | await_date | cards | card_edit
  questions: jsonb("questions").$type<string[]>().notNull().default([]),
  answers: jsonb("answers").$type<string[]>().notNull().default([]),
  cardState: jsonb("card_state").$type<CardState | null>(),
  round: integer("round").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * کشِ تعطیلات رسمی تقویم ایران (دریافت‌شده از سرویس بیرونی).
 * چون تعطیلاتِ گذشته تغییر نمی‌کنند، یک‌بار دریافت و برای همیشه نگهداری می‌شود.
 */
export const holidays = pgTable("holidays", {
  jalaliDate: text("jalali_date").primaryKey(), // 1405/04/30
  isHoliday: boolean("is_holiday").notNull().default(false),
  title: text("title"),
  /**
   * منبع داده. با تغییر سرویس تقویم، این مقدار عوض می‌شود تا ردیف‌های
   * کش‌شده‌ی سرویس قبلی نادیده گرفته و بازنویسی شوند.
   */
  source: text("source").notNull().default("legacy"),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
});

/**
 * موانع، مشکلات و تأخیرات.
 */
export const issues = pgTable(
  "issues",
  {
    id: serial("id").primaryKey(),
    workDayId: integer("work_day_id")
      .notNull()
      .references(() => workDays.id),
    type: text("type").notNull().default("مشکل"), // مانع | مشکل | تاخیر
    description: text("description").notNull(),
    impact: text("impact"), // اثر / پیامد
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("issues_day_idx").on(t.workDayId)],
);

/**
 * دوباره‌کاری‌ها — مقدار، محل و علت.
 */
export const reworks = pgTable(
  "reworks",
  {
    id: serial("id").primaryKey(),
    workDayId: integer("work_day_id")
      .notNull()
      .references(() => workDays.id),
    workFront: text("work_front"), // محل دوباره‌کاری
    amount: text("amount"), // مقدار (مثلاً «۳ متر» یا «۲ ستون»)
    cause: text("cause"), // علت
    description: text("description").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("reworks_day_idx").on(t.workDayId)],
);

// Typeهای استنتاج‌شده برای استفاده در سراسر برنامه
export type Project = typeof projects.$inferSelect;
export type Worker = typeof workers.$inferSelect;
export type WorkDay = typeof workDays.$inferSelect;
export type RawMessage = typeof rawMessages.$inferSelect;
export type ExtractedEvent = typeof extractedEvents.$inferSelect;
export type Attendance = typeof attendance.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type Rework = typeof reworks.$inferSelect;
export type ActivityWorker = typeof activityWorkers.$inferSelect;
export type ConversationState = typeof conversationState.$inferSelect;
