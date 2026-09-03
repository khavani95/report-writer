import {
  pgTable,
  serial,
  bigint,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * عضو هیئت‌مدیره.
 *
 * واحد اصلیِ داده در این محصول «عضو» است، نه پروژه. هر عضو با
 * `telegram_user_id` شناخته می‌شود؛ ولی عضوی که فقط اسمش در گزارشِ دیگری
 * آمده («ایدین امروز رفت باغ موزه») هنوز آی‌دی ندارد و با نام ساخته می‌شود.
 * نخستین باری که خودش پیام بدهد، همان ردیف به آی‌دی‌اش وصل می‌شود.
 */
export const members = pgTable(
  "members",
  {
    id: serial("id").primaryKey(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    /** آی‌دی کاربر تلگرام؛ برای عضوی که تا حالا خودش پیام نداده خالی است */
    userId: bigint("user_id", { mode: "number" }),
    fullName: text("full_name").notNull(),
    /** نام‌های دیگری که با آن‌ها به این عضو اشاره می‌شود */
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    /** سمت: مدیرعامل، عضو هیئت‌مدیره، مدیر فنی، … */
    role: text("role"),
    /** pending تا وقتی نام و سمت را خودش تأیید کند */
    profileStatus: text("profile_status").notNull().default("pending"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("members_chat_idx").on(t.chatId),
    // یک کاربر در هر چت فقط یک ردیف دارد. عضوهای «فقط نام» (user_id خالی)
    // مشمول این قید نیستند، چون در پستگرس چند NULL با هم تداخل ندارند.
    uniqueIndex("members_chat_user_idx").on(t.chatId, t.userId),
  ],
);

/**
 * یک روزِ کاریِ یک عضو.
 * با نخستین پیامِ آن عضو در آن روز باز می‌شود و با «پایان روز» بسته.
 * اگر عضوی بستن را فراموش کند، روزِ بعد به‌صورت خودکار نهایی می‌شود.
 */
export const memberDays = pgTable(
  "member_days",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    jalaliDate: text("jalali_date").notNull(), // 1405/05/12
    dateLabel: text("date_label").notNull(), // شنبه ۱۲ مرداد ۱۴۰۵
    status: text("status").notNull().default("open"), // open | closed
    startedAt: timestamp("started_at").notNull().defaultNow(),
    closedAt: timestamp("closed_at"),
  },
  (t) => [
    uniqueIndex("member_days_member_date_idx").on(t.memberId, t.jalaliDate),
    index("member_days_status_idx").on(t.memberId, t.status),
  ],
);

/**
 * یک «قطعه‌ی فعالیت» از روزِ یک عضو.
 *
 * روزِ هر عضو یک زنجیره است: ۰۹:۰۰ همت → ۱۲:۰۰ باغ موزه → ۱۹:۰۰ پایان.
 * هر حلقه‌ی این زنجیره یک ردیف است. ساعت شروع و پایانِ کلِ روز از اولین و
 * آخرین قطعه به دست می‌آید، پس جایی جداگانه ذخیره نمی‌شود.
 */
export const activitySegments = pgTable(
  "activity_segments",
  {
    id: serial("id").primaryKey(),
    memberDayId: integer("member_day_id")
      .notNull()
      .references(() => memberDays.id),
    /** ترتیب قطعه در روز (از ۰) */
    seq: integer("seq").notNull().default(0),
    /** محل فعالیت: «پروژه همت»، «دفتر مرکزی»، … — فقط یک متن، نه یک موجودیت */
    place: text("place"),
    /** شرح کارهای انجام‌شده در این محل */
    description: text("description").notNull().default(""),
    startTime: text("start_time"), // HH:MM
    endTime: text("end_time"), // HH:MM
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("segments_day_idx").on(t.memberDayId, t.seq)],
);

/**
 * پیام خام — ردِ ممیزی. اصلِ حرف عضو همیشه اینجا می‌ماند تا تحلیلِ
 * دوباره‌ی کل روز (با هوش مصنوعی) همیشه ممکن باشد.
 */
export const rawMessages = pgTable(
  "raw_messages",
  {
    id: serial("id").primaryKey(),
    memberDayId: integer("member_day_id")
      .notNull()
      .references(() => memberDays.id),
    /** فرستنده‌ی پیام؛ با «عضوِ روز» فرق دارد وقتی کسی به‌جای دیگری گزارش می‌دهد */
    senderUserId: bigint("sender_user_id", { mode: "number" }),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    kind: text("kind").notNull(), // text | voice
    text: text("text"),
    transcript: text("transcript"),
    telegramFileId: text("telegram_file_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("raw_messages_day_idx").on(t.memberDayId)],
);

/**
 * وضعیت گفتگو — به‌ازای هر (چت، کاربر).
 *
 * ⚠️ کلید عمداً ترکیبی است. همه‌ی اعضا در یک گروه‌اند و هر کدام روزِ باز و
 * جریانِ گفتگوی مستقل خودش را دارد؛ اگر کلید فقط chat_id بود، اعضا روی هم
 * می‌افتادند و پاسخِ یکی به سؤالِ دیگری نسبت داده می‌شد.
 */
export const conversationState = pgTable(
  "conversation_state",
  {
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    /** idle | await_name | await_role */
    phase: text("phase").notNull().default("idle"),
    /**
     * پیامی که کاربر پیش از تکمیل پروفایل فرستاده بود.
     * بدون این، نخستین گزارشِ هر عضو (که ناخواسته به سؤالِ نام تبدیل می‌شود)
     * از بین می‌رفت.
     */
    pendingText: text("pending_text"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("conversation_state_pk").on(t.chatId, t.userId)],
);

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
 * آپدیت‌های تلگرامِ پردازش‌شده.
 * تلگرام هر آپدیتی را که پاسخ ۲۰۰ نگیرد دوباره می‌فرستد؛ این جدول تضمین
 * می‌کند هر آپدیت فقط یک‌بار اجرا شود (اجرای دوباره، قطعه‌ی تکراری می‌سازد).
 */
export const processedUpdates = pgTable("processed_updates", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Typeهای استنتاج‌شده برای استفاده در سراسر برنامه
export type Member = typeof members.$inferSelect;
export type MemberDay = typeof memberDays.$inferSelect;
export type ActivitySegment = typeof activitySegments.$inferSelect;
export type RawMessage = typeof rawMessages.$inferSelect;
export type ConversationState = typeof conversationState.$inferSelect;
