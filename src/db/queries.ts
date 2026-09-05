import { and, asc, desc, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { getDb } from "./index";
import {
  members,
  memberDays,
  activitySegments,
  rawMessages,
  conversationState,
  processedUpdates,
  type Member,
  type MemberDay,
  type ConversationState,
} from "./schema";
import type { JalaliInfo } from "@/lib/jalali";
import { findWorkerMatch, namesMatch } from "@/lib/text-normalize";
import type { Segment } from "@/ai/segments";

// ── اعضا ──────────────────────────────────────────────────

/** عضو متناظر با یک کاربر تلگرام در این چت */
export async function getMemberByUser(
  chatId: number,
  userId: number,
): Promise<Member | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(members)
    .where(and(eq(members.chatId, chatId), eq(members.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getMemberById(id: number): Promise<Member | null> {
  const db = getDb();
  const rows = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return rows[0] ?? null;
}

/** همه‌ی اعضای فعالِ یک چت */
export async function listMembers(chatId: number): Promise<Member[]> {
  const db = getDb();
  return db
    .select()
    .from(members)
    .where(and(eq(members.chatId, chatId), eq(members.isActive, true)))
    .orderBy(members.fullName);
}

/** ساخت عضو تازه */
export async function createMember(data: {
  chatId: number;
  userId?: number | null;
  fullName: string;
  role?: string | null;
  profileStatus?: string;
}): Promise<Member> {
  const db = getDb();
  const inserted = await db
    .insert(members)
    .values({
      chatId: data.chatId,
      userId: data.userId ?? null,
      fullName: data.fullName.trim(),
      role: data.role ?? null,
      profileStatus: data.profileStatus ?? "pending",
    })
    .returning();
  return inserted[0];
}

/** به‌روزرسانی نام/سمت/آی‌دیِ یک عضو */
export async function updateMember(
  memberId: number,
  patch: Partial<{
    userId: number | null;
    fullName: string;
    role: string | null;
    aliases: string[];
    profileStatus: string;
  }>,
): Promise<void> {
  const db = getDb();
  await db.update(members).set(patch).where(eq(members.id, memberId));
}

/**
 * عضوی که با این نام صدا زده شده را پیدا می‌کند.
 * تطبیق همان مسیر روزنگار است: آیدین/ایدین/یدین یک نفرند.
 */
/**
 * همه‌ی عضوهایی که با این نام می‌خوانند.
 * بیش از یکی یعنی «مبهم» — «محمد» هم به «محمد خوانی» می‌خورد هم به
 * «محمد صادق خوانی». در این حالت نباید حدس زد و نباید عضو تازه ساخت.
 */
export function matchMembersByName(roster: Member[], name: string): Member[] {
  return roster.filter((m) =>
    [m.fullName, ...(m.aliases ?? [])].some((c) => namesMatch(c, name)),
  );
}

export function matchMemberByName(
  roster: Member[],
  name: string,
): Member | null {
  const idx = findWorkerMatch(
    name,
    roster.map((m) => [m.fullName, ...(m.aliases ?? [])]),
  );
  return idx >= 0 ? roster[idx] : null;
}

/**
 * عضوی که فقط نامش را می‌دانیم (چون دیگری برایش گزارش داده).
 * اگر نبود، با نام ساخته می‌شود و بعداً که خودش پیام داد به آی‌دی‌اش وصل می‌شود.
 */
export async function resolveMemberByName(
  chatId: number,
  name: string,
  roster?: Member[],
): Promise<Member> {
  const list = roster ?? (await listMembers(chatId));
  const found = matchMemberByName(list, name);
  if (found) return found;
  return createMember({ chatId, fullName: name });
}

/** عضوهایی که دیگران برایشان گزارش داده‌اند ولی خودشان هنوز پیام نداده‌اند */
export async function listUnlinkedMembers(chatId: number): Promise<Member[]> {
  const db = getDb();
  return db
    .select()
    .from(members)
    .where(
      and(
        eq(members.chatId, chatId),
        eq(members.isActive, true),
        isNull(members.userId),
      ),
    )
    .orderBy(members.fullName);
}

/**
 * عضوی «فقط نام» که با نامِ این کاربر می‌خواند و هنوز آی‌دی ندارد.
 * وقتی کسی که قبلاً دیگران برایش گزارش داده‌اند خودش پیام می‌دهد، باید به
 * همان ردیف وصل شود، نه اینکه ردیف دومی بسازیم.
 */
export async function findUnlinkedMemberByName(
  chatId: number,
  name: string,
): Promise<Member | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(members)
    .where(and(eq(members.chatId, chatId), isNull(members.userId)));
  return matchMemberByName(rows, name);
}

// ── روزهای هر عضو ─────────────────────────────────────────

/** روزِ بازِ این عضو (اگر باشد) */
export async function getOpenDay(memberId: number): Promise<MemberDay | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memberDays)
    .where(and(eq(memberDays.memberId, memberId), eq(memberDays.status, "open")))
    .orderBy(asc(memberDays.jalaliDate))
    .limit(1);
  return rows[0] ?? null;
}

export async function getDayById(id: number): Promise<MemberDay | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memberDays)
    .where(eq(memberDays.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * روزِ این عضو در این تاریخ را برمی‌گرداند و اگر نبود می‌سازد.
 * درج با onConflictDoNothing است تا دو پیامِ همزمان دو روز نسازند.
 */
export async function openDay(
  memberId: number,
  j: JalaliInfo,
): Promise<MemberDay> {
  const db = getDb();
  const inserted = await db
    .insert(memberDays)
    .values({
      memberId,
      jalaliDate: j.key,
      dateLabel: j.label,
      status: "open",
    })
    .onConflictDoNothing({
      target: [memberDays.memberId, memberDays.jalaliDate],
    })
    .returning();
  if (inserted[0]) return inserted[0];

  const rows = await db
    .select()
    .from(memberDays)
    .where(
      and(eq(memberDays.memberId, memberId), eq(memberDays.jalaliDate, j.key)),
    )
    .limit(1);
  if (!rows[0]) {
    throw new Error(`روزِ ${j.key} برای عضو ${memberId} ساخته نشد.`);
  }
  return rows[0];
}

/** روزِ این عضو در یک تاریخ مشخص (بدون ساختن) */
export async function getDayByDate(
  memberId: number,
  jalaliDate: string,
): Promise<MemberDay | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memberDays)
    .where(
      and(
        eq(memberDays.memberId, memberId),
        eq(memberDays.jalaliDate, jalaliDate),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** بستن روز */
export async function closeDay(dayId: number): Promise<void> {
  const db = getDb();
  await db
    .update(memberDays)
    .set({ status: "closed", closedAt: new Date() })
    .where(eq(memberDays.id, dayId));
}

/** بازکردن دوباره‌ی یک روزِ بسته (وقتی عضو گزارشِ تکمیلی می‌فرستد) */
export async function reopenDay(dayId: number): Promise<void> {
  const db = getDb();
  await db
    .update(memberDays)
    .set({ status: "open", closedAt: null })
    .where(eq(memberDays.id, dayId));
}

/**
 * روزهای بازِ این عضو که مربوط به امروز نیستند.
 * اگر کسی «پایان روز» را فراموش کند، روزِ بعد این‌ها نهایی می‌شوند.
 */
export async function staleOpenDays(
  memberId: number,
  todayKey: string,
): Promise<MemberDay[]> {
  const db = getDb();
  return db
    .select()
    .from(memberDays)
    .where(
      and(
        eq(memberDays.memberId, memberId),
        eq(memberDays.status, "open"),
        ne(memberDays.jalaliDate, todayKey),
      ),
    )
    .orderBy(asc(memberDays.jalaliDate));
}

// ── پیام‌های خام ──────────────────────────────────────────

export async function saveRawMessage(data: {
  memberDayId: number;
  senderUserId?: number;
  telegramMessageId?: number;
  kind: "text" | "voice";
  text?: string;
  transcript?: string;
  telegramFileId?: string;
}): Promise<void> {
  const db = getDb();
  await db.insert(rawMessages).values({
    memberDayId: data.memberDayId,
    senderUserId: data.senderUserId ?? null,
    telegramMessageId: data.telegramMessageId ?? null,
    kind: data.kind,
    text: data.text ?? null,
    transcript: data.transcript ?? null,
    telegramFileId: data.telegramFileId ?? null,
  });
}

/** همه‌ی پیام‌های یک روز، به ترتیب */
export async function getDayMessages(dayId: number): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ text: rawMessages.text, transcript: rawMessages.transcript })
    .from(rawMessages)
    .where(eq(rawMessages.memberDayId, dayId))
    .orderBy(asc(rawMessages.id));
  return rows
    .map((r) => (r.text ?? r.transcript ?? "").trim())
    .filter(Boolean);
}

/**
 * آخرین پیام خامِ یک روز را پاک می‌کند (برای /undo).
 * true یعنی چیزی برای پاک‌کردن بود.
 */
export async function deleteLastRawMessage(dayId: number): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: rawMessages.id })
    .from(rawMessages)
    .where(eq(rawMessages.memberDayId, dayId))
    .orderBy(desc(rawMessages.id))
    .limit(1);
  if (!rows[0]) return false;
  await db.delete(rawMessages).where(eq(rawMessages.id, rows[0].id));
  return true;
}

// ── قطعه‌های فعالیت ───────────────────────────────────────

/** قطعه‌های یک روز، به ترتیب */
export async function getSegments(dayId: number): Promise<Segment[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(activitySegments)
    .where(eq(activitySegments.memberDayId, dayId))
    .orderBy(asc(activitySegments.seq), asc(activitySegments.id));
  return rows.map((r) => ({
    place: r.place,
    description: r.description,
    startTime: r.startTime,
    endTime: r.endTime,
  }));
}

/**
 * زنجیره‌ی روز را از نو می‌نویسد.
 * ⚠️ همیشه یک حذف و یک درجِ دسته‌ای — نه یک درج به‌ازای هر قطعه. درایور HTTP
 * نئون هر دستور را یک درخواست جداگانه می‌فرستد و تعداد رفت‌وبرگشت مستقیماً
 * زمان پاسخ بات است.
 */
export async function replaceSegments(
  dayId: number,
  segments: Segment[],
): Promise<void> {
  const db = getDb();
  await db
    .delete(activitySegments)
    .where(eq(activitySegments.memberDayId, dayId));
  if (!segments.length) return;
  await db.insert(activitySegments).values(
    segments.map((s, i) => ({
      memberDayId: dayId,
      seq: i,
      place: s.place,
      description: s.description,
      startTime: s.startTime,
      endTime: s.endTime,
    })),
  );
}

// ── داده‌ی ماهانه (برای اکسل) ─────────────────────────────

export interface MonthDayRow {
  memberId: number;
  jalaliDate: string;
  segments: Segment[];
}

/**
 * همه‌ی روزهای یک ماه برای همه‌ی اعضای این چت، با قطعه‌هایشان.
 * عمداً سه پرس‌وجوی ثابت است، نه یکی به‌ازای هر عضو یا هر روز.
 */
export async function loadMonth(
  chatId: number,
  month: string,
): Promise<{ members: Member[]; days: MonthDayRow[] }> {
  const db = getDb();
  const roster = await listMembers(chatId);
  if (!roster.length) return { members: [], days: [] };

  const dayRows = await db
    .select({
      id: memberDays.id,
      memberId: memberDays.memberId,
      jalaliDate: memberDays.jalaliDate,
    })
    .from(memberDays)
    .where(
      inArray(
        memberDays.memberId,
        roster.map((m) => m.id),
      ),
    );
  const inMonth = dayRows.filter((d) => d.jalaliDate.startsWith(month));
  if (!inMonth.length) return { members: roster, days: [] };

  const segRows = await db
    .select()
    .from(activitySegments)
    .where(
      inArray(
        activitySegments.memberDayId,
        inMonth.map((d) => d.id),
      ),
    )
    .orderBy(asc(activitySegments.seq), asc(activitySegments.id));

  const byDay = new Map<number, Segment[]>();
  for (const s of segRows) {
    const list = byDay.get(s.memberDayId) ?? [];
    list.push({
      place: s.place,
      description: s.description,
      startTime: s.startTime,
      endTime: s.endTime,
    });
    byDay.set(s.memberDayId, list);
  }

  return {
    members: roster,
    days: inMonth.map((d) => ({
      memberId: d.memberId,
      jalaliDate: d.jalaliDate,
      segments: byDay.get(d.id) ?? [],
    })),
  };
}

/** ماه‌هایی که برای این چت داده دارند (تازه‌ترین اول) */
export async function availableMonths(chatId: number): Promise<string[]> {
  const db = getDb();
  const roster = await listMembers(chatId);
  if (!roster.length) return [];
  const rows = await db
    .select({ date: memberDays.jalaliDate })
    .from(memberDays)
    .where(
      inArray(
        memberDays.memberId,
        roster.map((m) => m.id),
      ),
    );
  const months = new Set(rows.map((r) => r.date.slice(0, 7)));
  return [...months].sort().reverse();
}

// ── وضعیت گفتگو (به‌ازای هر کاربر) ────────────────────────

export async function getState(
  chatId: number,
  userId: number,
): Promise<ConversationState | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(conversationState)
    .where(
      and(
        eq(conversationState.chatId, chatId),
        eq(conversationState.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** گذاشتن فاز برای یک کاربرِ مشخص در یک چت */
export async function setPhase(
  chatId: number,
  userId: number,
  phase: string,
  pendingText?: string | null,
): Promise<void> {
  const db = getDb();
  await db
    .insert(conversationState)
    .values({ chatId, userId, phase, pendingText: pendingText ?? null })
    .onConflictDoUpdate({
      target: [conversationState.chatId, conversationState.userId],
      set: { phase, pendingText: pendingText ?? null, updatedAt: new Date() },
    });
}

export async function clearState(chatId: number, userId: number): Promise<void> {
  await setPhase(chatId, userId, "idle", null);
}

// ── حذف آپدیت تکراری ──────────────────────────────────────

/**
 * «تصاحبِ» یک آپدیت تلگرام: اگر تازه باشد true، اگر قبلاً پردازش شده false.
 * درج با کلید اصلی انجام می‌شود، پس حتی اگر دو تحویلِ همزمان برسد فقط یکی
 * موفق می‌شود. در صورت خطای دیتابیس true برمی‌گردانیم تا از دست رفتنِ پیام
 * بدتر از پردازش دوباره نباشد.
 */
export async function claimUpdate(updateId: number): Promise<boolean> {
  const db = getDb();
  try {
    const rows = await db
      .insert(processedUpdates)
      .values({ updateId })
      .onConflictDoNothing()
      .returning({ id: processedUpdates.updateId });
    // گاه‌به‌گاه ردهای قدیمی پاک می‌شوند تا جدول بی‌نهایت بزرگ نشود
    if (Math.random() < 0.005) await pruneProcessedUpdates();
    return rows.length > 0;
  } catch (e) {
    console.error("[claimUpdate] failed:", e);
    return true;
  }
}

/** پاک‌سازی ردِ آپدیت‌های قدیمی‌تر از یک هفته */
export async function pruneProcessedUpdates(): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  try {
    await db
      .delete(processedUpdates)
      .where(lt(processedUpdates.createdAt, cutoff));
  } catch (e) {
    console.error("[pruneProcessedUpdates] failed:", e);
  }
}
